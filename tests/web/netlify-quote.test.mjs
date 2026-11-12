import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../../netlify/functions/quote.mjs";
import { PHONE, issueToken, quoteSettings, sniffImage } from "../../netlify/lib/quote-intake.mjs";

const SECRET = "q".repeat(40);
const ENV = {
  OPENBLOG_QUOTE_ENABLED: "true",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_" + "k".repeat(30),
  OPENBLOG_SITE_ID: "acme",
  OPENBLOG_SITE_ORIGIN: "https://acme.example",
  OPENBLOG_QUOTE_SECRET: SECRET,
};
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);

// A tiny in-memory Supabase: rows, objects, and the calls made (for "nothing else was called").
function fakeSupabase({ failInsert = false, failUpload = false } = {}) {
  const state = { rows: [], objects: new Map(), calls: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    state.calls.push(`${init.method} ${u.pathname}`);
    const reply = (status, body = "", headers = {}) => new Response(body, { status, headers });
    if (u.pathname.startsWith("/storage/v1/object/")) {
      if (init.method === "DELETE") return reply(200, state.objects.delete(u.pathname) ? "{}" : "{}");
      if (failUpload) return reply(500);
      state.objects.set(u.pathname, init.body);
      return reply(200, "{}");
    }
    if (u.pathname === "/rest/v1/openblog_quote_requests") {
      if (init.method === "POST") {
        if (failInsert) return reply(500);
        const row = JSON.parse(init.body);
        if (state.rows.some((r) => r.token_hash === row.token_hash)) return reply(409);
        state.rows.push({ ...row, created_at: new Date().toISOString() });
        return reply(201);
      }
      if (init.method === "PATCH") return reply(204);
      const client = u.searchParams.get("client_hash")?.replace("eq.", "");
      const n = state.rows.filter((r) => !client || r.client_hash === client).length;
      return reply(206, "[]", { "content-range": `0-0/${n}` });
    }
    return reply(404);
  };
  return { state, fetchImpl };
}

function multipart(fields, files = []) {
  const boundary = "----testboundary";
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const bytes of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), bytes, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(chunks).toString("base64"), isBase64Encoded: true };
}

const good = { name: "Pat Smith", phone: "+1 360 555 0142", town: "Bend", service: "Fencing", description: "Replace forty feet of cedar fence.", email: "pat@example.com" };

function setup(options = {}) {
  const clock = { now: 1_800_000_000_000 };
  const fake = fakeSupabase(options);
  let n = 0;
  const handler = createHandler({ env: ENV, fetchImpl: fake.fetchImpl, now: () => clock.now, uuid: () => `00000000-0000-4000-8000-00000000000${++n}`, ...options.extra });
  const token = () => {
    const t = issueToken(SECRET, clock.now);
    clock.now += 5000;
    return t;
  };
  const post = (fields, files = [], headers = {}) => {
    const form = multipart(fields, files);
    return handler({ httpMethod: "POST", path: "/api/quote/submit", headers: { ...form.headers, accept: "application/json", "x-nf-client-connection-ip": "203.0.113.9", ...headers }, body: form.body, isBase64Encoded: true });
  };
  return { handler, fake, clock, token, post };
}

test("it is a 404 that touches nothing unless enabled and complete", async () => {
  const calls = [];
  for (const env of [{}, { ...ENV, OPENBLOG_QUOTE_ENABLED: "yes" }, { ...ENV, OPENBLOG_QUOTE_SECRET: "short" }]) {
    const handler = createHandler({ env, fetchImpl: async (...a) => calls.push(a) });
    assert.equal((await handler({ httpMethod: "GET", path: "/api/quote/token", headers: {} })).statusCode, 404);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(quoteSettings({ ...ENV, OPENBLOG_QUOTE_SECRET: "short" }).problems, ["OPENBLOG_QUOTE_SECRET"]);
});

test("a valid request with photos is stored in the site, with photos in the private bucket", async () => {
  const t = setup();
  const response = await t.post({ ...good, token: t.token(), page: "/services/fencing/" }, [JPEG, JPEG]);
  assert.equal(response.statusCode, 201);
  assert.deepEqual(JSON.parse(response.body), { status: "received" });
  assert.equal(t.fake.state.rows.length, 1);
  const row = t.fake.state.rows[0];
  assert.equal(row.site_id, "acme");
  assert.equal(row.name, "Pat Smith");
  assert.equal(row.photos.length, 2);
  assert.match(row.photos[0].path, /^acme\/00000000-0000-4000-8000-000000000001\/1\.jpg$/);
  assert.equal(t.fake.state.objects.size, 2);
  assert.ok(!row.client_hash.includes("203.0.113.9"), "the address is hashed");
  assert.ok(!response.body.includes("Pat"), "nothing personal comes back");
});

test("the response to a no-JavaScript post is a plain page", async () => {
  const t = setup();
  const response = await t.post({ ...good, token: t.token() }, [], { accept: "text/html" });
  assert.equal(response.statusCode, 201);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(response.body, /Request received/);
  assert.ok(!response.body.includes("Bend"));
});

test("scripted abuse is rejected", async () => {
  const t = setup();
  const reasons = [];
  const attempt = async (label, fields, files, headers, expectStatus) => {
    const before = t.fake.state.rows.length;
    const response = await t.post(fields, files, headers);
    assert.equal(response.statusCode, expectStatus, label);
    assert.equal(t.fake.state.rows.length, before + (expectStatus === 201 ? 1 : 0), `${label}: stored`);
    reasons.push(label);
  };
  // No token, a forged token, a token used too fast.
  await attempt("no token", { ...good }, [], {}, 422);
  await attempt("forged token", { ...good, token: issueToken("z".repeat(40), t.clock.now - 60000) }, [], {}, 422);
  await attempt("too fast", { ...good, token: issueToken(SECRET, t.clock.now) }, [], {}, 429);
  // An old token.
  await attempt("expired", { ...good, token: issueToken(SECRET, t.clock.now - 3 * 3600 * 1000) }, [], {}, 422);
  // Another origin.
  await attempt("cross origin", { ...good, token: t.token() }, [], { origin: "https://evil.example" }, 403);
  // Field abuse.
  await attempt("bad phone", { ...good, phone: "call me", token: t.token() }, [], {}, 422);
  await attempt("links", { ...good, description: "buy http://a.example http://b.example http://c.example now", token: t.token() }, [], {}, 422);
  await attempt("empty", { token: t.token() }, [], {}, 422);
  await attempt("huge name", { ...good, name: "x".repeat(500), token: t.token() }, [], {}, 422);
  // Files: wrong type, too many, too large.
  await attempt("not an image", { ...good, token: t.token() }, [Buffer.from("<svg onload=alert(1)>................")], {}, 422);
  await attempt("six photos", { ...good, token: t.token() }, Array(6).fill(JPEG), {}, 422);
  await attempt("big photo", { ...good, token: t.token() }, [Buffer.concat([JPEG, Buffer.alloc(1024 * 1024)])], {}, 422);
  assert.equal(t.fake.state.objects.size, 0);
  // A replayed token stores one request only.
  const token = t.token();
  assert.equal((await t.post({ ...good, token })).statusCode, 201);
  assert.equal((await t.post({ ...good, token })).statusCode, 409);
  assert.equal(t.fake.state.rows.length, 1);
  assert.ok(reasons.length >= 12);
});

test("the honeypot looks like a success and stores nothing", async () => {
  const t = setup();
  const response = await t.post({ ...good, website: "http://spam.example", token: t.token() });
  assert.equal(response.statusCode, 200);
  assert.equal(t.fake.state.rows.length, 0);
  assert.deepEqual(t.fake.state.calls, []);
});

test("one visitor is limited per hour, and then so is the site", async () => {
  const t = setup();
  for (let i = 0; i < 5; i++) assert.equal((await t.post({ ...good, token: t.token() })).statusCode, 201);
  assert.equal((await t.post({ ...good, token: t.token() })).statusCode, 429);
  // Another visitor still gets through until the site's own limit.
  assert.equal((await t.post({ ...good, token: t.token() }, [], { "x-nf-client-connection-ip": "198.51.100.1" })).statusCode, 201);
});

test("without JavaScript the first post is answered with the form to send again", async () => {
  const t = setup();
  const response = await t.post({ ...good, description: "<b>x</b> a long enough description" }, [], { accept: "text/html" });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /One more step/);
  assert.match(response.body, /name="token"/);
  assert.ok(!response.body.includes("<b>x</b>"), "typed text is escaped");
  assert.equal(t.fake.state.rows.length, 0);
});

test("C1 control characters are stripped at intake, so Admin can always show what was stored", async () => {
  const t = setup();
  const response = await t.post({ ...good, name: "Ann\u0085Lee", town: "Be\u009bnd", description: "Replace\u009b31m forty feet of cedar fence.\nThanks", token: t.token() });
  assert.equal(response.statusCode, 201);
  const row = t.fake.state.rows[0];
  assert.equal(row.name, "AnnLee");
  assert.equal(row.town, "Bend");
  assert.equal(row.description, "Replace31m forty feet of cedar fence.\nThanks", "a line break stays");
  // Admin treats every control but a line break or tab as unreadable (Rust's char::is_control).
  for (const value of [row.name, row.phone, row.town, row.service, row.description]) assert.ok(![...value].some((c) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(c)), value);
});

test("without JavaScript a refused field comes back as the form, with that field named and marked", async () => {
  const t = setup();
  const response = await t.post({ ...good, phone: "call me", email: "not an address", token: t.token() }, [], { accept: "text/html" });
  assert.equal(response.statusCode, 422);
  assert.match(response.headers["content-type"], /text\/html/);
  const body = response.body;
  assert.match(body, /Each one is named below/);
  assert.match(body, /<div role="alert"><h2>Fix these 2<\/h2>/);
  assert.match(body, /<a href="#q-phone">Phone<\/a>: Write a phone number of at least 7 digits/);
  assert.match(body, /<a href="#q-email">Email<\/a>: This email address does not look right/);
  assert.match(body, /<input id="q-phone" name="phone" value="call me" type="tel" minlength="7" maxlength="30" pattern="[^"]+" required aria-invalid="true" aria-describedby="q-phone-error">/);
  assert.match(body, /<p class="error" id="q-phone-error">/);
  assert.doesNotMatch(body, /id="q-name"[^>]*aria-invalid/, "a field that was fine is not marked");
  assert.match(body, /name="token" value="[^"]+"/, "a fresh token to send again");
  assert.equal(t.fake.state.rows.length, 0);
  // The page's phone rule is the function's own.
  const pattern = /pattern="([^"]+)"/.exec(body)[1];
  for (const phone of ["call me", "+1 (360) 555-0142", "12345"]) assert.equal(new RegExp(`^(?:${pattern})$`, "v").test(phone), PHONE.test(phone), phone);
  // With JavaScript the answer stays JSON naming the fields.
  const json = await t.post({ ...good, phone: "call me", token: t.token() });
  assert.deepEqual(JSON.parse(json.body), { error: "invalid", fields: [{ field: "phone", reason: "invalid" }] });
});

test("a storage failure loses nothing silently and leaves no orphan photo", async () => {
  const insertFails = setup({ failInsert: true });
  const response = await insertFails.post({ ...good, token: insertFails.token() }, [JPEG]);
  assert.equal(response.statusCode, 503);
  assert.equal(insertFails.fake.state.objects.size, 0, "the uploaded photo was removed");
  const uploadFails = setup({ failUpload: true });
  assert.equal((await uploadFails.post({ ...good, token: uploadFails.token() }, [JPEG])).statusCode, 503);
  assert.equal(uploadFails.fake.state.rows.length, 0);
});

test("no error or response carries a visitor value or a key", async () => {
  const t = setup({ failInsert: true });
  const response = await t.post({ ...good, name: "Zebediah Quux", token: t.token() });
  for (const secret of ["Zebediah", "555", ENV.SUPABASE_SECRET_KEY, SECRET]) assert.ok(!response.body.includes(secret));
});

test("images are recognised by their bytes", () => {
  assert.equal(sniffImage(JPEG).type, "image/jpeg");
  assert.equal(sniffImage(Buffer.from("GIF89a............")), null);
});
