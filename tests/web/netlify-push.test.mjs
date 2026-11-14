// Push notifications to the owner (ADR 0412): the Web Push encryption and signature, the owner's
// device API, the notify route for her other apps, and the buzz after a comment or quote request,
// all against an in-memory stand-in for Supabase and a fake push service that decrypts what it gets
// the way a browser would.
import assert from "node:assert/strict";
import test from "node:test";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, randomUUID, verify } from "node:crypto";

import { checkSubscription, encrypt, generateVapidKeys, vapidHeader, vapidKeys } from "../../netlify/lib/web-push.mjs";
import { deviceHash, notice, pageWords, pushSettings, tellOwner } from "../../netlify/lib/push-store.mjs";
import { createHandler } from "../../netlify/functions/push.mjs";
import { createHandler as createEngagement } from "../../netlify/functions/engagement.mjs";
import { createHandler as createQuote } from "../../netlify/functions/quote.mjs";
import { issueToken } from "../../netlify/lib/quote-intake.mjs";

const ADMIN = "p".repeat(40);
const NOTIFY = "n".repeat(40);
const KEYS = generateVapidKeys();
const ENV = {
  OPENBLOG_PUSH_ENABLED: "true",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_" + "k".repeat(30),
  OPENBLOG_SITE_ID: "grammis-house",
  OPENBLOG_PUSH_ADMIN_KEY: ADMIN,
  OPENBLOG_PUSH_NOTIFY_KEY: NOTIFY,
  OPENBLOG_PUSH_PUBLIC_KEY: KEYS.publicKey,
  OPENBLOG_PUSH_PRIVATE_KEY: KEYS.privateKey,
  OPENBLOG_PUSH_SUBJECT: "mailto:grammi@family.example",
};

/** A browser: its subscription, and how it reads a push meant for it. */
function browser(host = "fcm.googleapis.com") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const subscription = { endpoint: `https://${host}/fcm/send/${randomUUID()}`, keys: { p256dh: ecdh.getPublicKey("base64url"), auth: auth.toString("base64url") } };
  const read = (body) => {
    const salt = body.subarray(0, 16);
    const idLength = body[20];
    const asPublic = body.subarray(21, 21 + idLength);
    const record = body.subarray(21 + idLength);
    const shared = ecdh.computeSecret(asPublic);
    const ikm = Buffer.from(hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]), 32));
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(record.subarray(-16));
    const padded = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
    assert.equal(padded.at(-1), 2, "a single record ends with the last-record delimiter");
    return JSON.parse(padded.subarray(0, -1).toString());
  };
  return { subscription, read };
}

// Just enough of PostgREST for the device store, and a push service that answers per endpoint.
function world() {
  const devices = [];
  const pushed = [];
  const gone = new Set();
  const browsers = new Map();
  const matches = (row, params) => {
    for (const [key, raw] of params) {
      if (["select", "order", "limit", "on_conflict"].includes(key)) continue;
      const [op, ...rest] = raw.split(".");
      const value = rest.join(".");
      if (op === "eq" && String(row[key]) !== value) return false;
      if (op === "in" && !value.slice(1, -1).split(",").includes(String(row[key]))) return false;
      if (op === "cs" && !row[key].includes(value.slice(1, -1))) return false;
    }
    return true;
  };
  const reply = (value, status = 200) => new Response(value === null ? null : JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    if (u.hostname !== "proj.supabase.co") {
      pushed.push({ url, headers: init.headers, body: init.body, notice: browsers.get(url)?.read(init.body) });
      return new Response(null, { status: gone.has(url) ? 410 : 201 });
    }
    assert.equal(u.pathname, "/rest/v1/openblog_push_devices");
    const params = [...u.searchParams.entries()];
    if (method === "GET") return reply(devices.filter((r) => matches(r, params)));
    if (method === "POST") {
      const row = JSON.parse(init.body);
      const existing = devices.find((d) => d.site_id === row.site_id && d.endpoint === row.endpoint);
      if (existing) return reply([Object.assign(existing, row)]);
      const at = new Date().toISOString();
      const stored = { id: randomUUID(), created_at: at, last_sent_at: null, ...row };
      devices.push(stored);
      return reply([stored], 201);
    }
    if (method === "PATCH") {
      const touched = devices.filter((r) => matches(r, params));
      for (const r of touched) Object.assign(r, JSON.parse(init.body));
      return reply(touched);
    }
    if (method === "DELETE") {
      for (const r of devices.filter((r) => matches(r, params))) devices.splice(devices.indexOf(r), 1);
      return reply(null, 204);
    }
    throw new Error(`unexpected ${method}`);
  };
  const phone = (host) => {
    const b = browser(host);
    browsers.set(b.subscription.endpoint, b);
    return b;
  };
  return { devices, pushed, gone, fetchImpl, phone };
}

const call = (handler, method, path, body, key = ADMIN) =>
  handler({ httpMethod: method, path: `/.netlify/functions/push/${path}`, headers: { Authorization: `Bearer ${key}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

test("the message is encrypted for one browser and the request is signed with the site's key", () => {
  const phone = browser();
  const sealed = encrypt(phone.subscription, JSON.stringify({ title: "Jimmy left a comment ❤️" }));
  assert.deepEqual(phone.read(sealed), { title: "Jimmy left a comment ❤️" });
  assert.notEqual(sealed.toString("latin1").includes("Jimmy"), true);

  const vapid = vapidKeys(KEYS.publicKey, KEYS.privateKey);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(vapidHeader({ endpoint: phone.subscription.endpoint, vapid, subject: "mailto:a@b.co", now: Date.parse("2026-11-13T00:00:00Z") }));
  assert.equal(k, KEYS.publicKey);
  const [head, claims, signature] = jwt.split(".");
  const pub = Buffer.from(k, "base64url");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url")), { aud: "https://fcm.googleapis.com", exp: Date.parse("2026-11-13T12:00:00Z") / 1000, sub: "mailto:a@b.co" });
});

test("keys that don't belong together, and subscriptions to anywhere but a browser's push service, are refused", () => {
  assert.equal(vapidKeys(KEYS.publicKey, generateVapidKeys().privateKey), null);
  assert.deepEqual(pushSettings({ ...ENV, OPENBLOG_PUSH_PRIVATE_KEY: generateVapidKeys().privateKey }).problems, ["OPENBLOG_PUSH_PUBLIC_KEY", "OPENBLOG_PUSH_PRIVATE_KEY"]);
  assert.deepEqual(pushSettings({ ...ENV, OPENBLOG_PUSH_SUBJECT: "" }).problems, ["OPENBLOG_PUSH_SUBJECT"]);
  assert.deepEqual(pushSettings({ ...ENV, OPENBLOG_PUSH_NOTIFY_KEY: ADMIN }).problems, ["OPENBLOG_PUSH_NOTIFY_KEY"]);
  assert.equal(pushSettings({}).enabled, false);
  const { keys } = browser().subscription;
  for (const endpoint of ["https://web.push.apple.com/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://wns2-bl2p.notify.windows.com/w/?token=abc"]) {
    assert.ok(checkSubscription({ endpoint, keys }), endpoint);
  }
  for (const endpoint of ["https://169.254.169.254/latest", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x", "https://user@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x"]) {
    assert.equal(checkSubscription({ endpoint, keys }), null, endpoint);
  }
  assert.equal(checkSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { ...keys, auth: "short" } }), null);
});

test("the owner turns notifications on for a phone, picks what it hears about, tests it, and turns it off", async () => {
  const w = world();
  const handler = createHandler({ env: ENV, fetchImpl: w.fetchImpl });
  const phone = w.phone();

  assert.equal((await call(handler, "GET", "status", undefined, "wrong")).status, 401);
  assert.equal((await call(handler, "GET", "status", undefined, NOTIFY)).status, 401);
  const empty = await call(handler, "GET", "status");
  assert.equal(empty.body.publicKey, KEYS.publicKey);
  assert.deepEqual(empty.body.kinds.map((k) => k.id), ["comment", "feedback", "quote", "app"]);
  assert.equal(empty.body.otherApps, true);

  assert.equal((await call(handler, "POST", "devices", { subscription: { ...phone.subscription, endpoint: "https://evil.example/x" }, label: "Phone" })).body.error, "invalid-subscription");
  const saved = await call(handler, "POST", "devices", { subscription: phone.subscription, label: "Grammi's iPhone" });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.device.kinds, ["comment", "feedback", "quote", "app"]);
  assert.equal(saved.body.device.device, deviceHash(phone.subscription.endpoint));
  assert.ok(!JSON.stringify(saved.body).includes(phone.subscription.endpoint), "the endpoint never leaves");
  assert.ok(!JSON.stringify(saved.body).includes(phone.subscription.keys.auth));

  // Turning it on again on the same phone keeps one row.
  await call(handler, "POST", "devices", { subscription: phone.subscription, label: "Grammi's iPhone", kinds: ["comment"] });
  assert.equal(w.devices.length, 1);
  const id = saved.body.device.id;
  const changed = await call(handler, "POST", `devices/${id}`, { kinds: ["comment", "app"] });
  assert.deepEqual(changed.body.device.kinds, ["comment", "app"]);
  assert.equal((await call(handler, "POST", `devices/${id}`, { kinds: ["everything"] })).body.error, "invalid-kinds");

  assert.equal(w.devices[0].last_sent_at, null);
  const tested = await call(handler, "POST", "test", { id });
  assert.deepEqual(tested.body, { sent: true });
  // In her words, naming the phone, opening Studio's Notifications; and it counts as told (G23).
  assert.deepEqual(w.pushed[0].notice, { title: "Your blog can reach Grammi's iPhone", body: "You'll get one like this when something you picked comes in.", url: "/admin/studio/#/notifications", tag: "test" });
  assert.ok(w.devices[0].last_sent_at, "a test stamps when it was last told");
  assert.equal(w.pushed[0].headers["content-encoding"], "aes128gcm");
  assert.match(w.pushed[0].headers.authorization, /^vapid t=.+, k=/);

  assert.deepEqual((await call(handler, "POST", `devices/${id}/remove`, {})).body, { removed: true });
  assert.equal(w.devices.length, 0);
});

test("another app with the notify key can buzz devices that asked for it, and only with a safe link", async () => {
  const w = world();
  const handler = createHandler({ env: ENV, fetchImpl: w.fetchImpl });
  const all = w.phone();
  const commentsOnly = w.phone();
  await call(handler, "POST", "devices", { subscription: all.subscription, label: "Phone" });
  await call(handler, "POST", "devices", { subscription: commentsOnly.subscription, label: "Laptop", kinds: ["comment"] });

  assert.equal((await call(handler, "POST", "devices", { subscription: all.subscription, label: "x" }, NOTIFY)).status, 401, "the notify key manages nothing");
  assert.equal((await call(handler, "POST", "notify", { title: "x", url: "javascript:alert(1)" }, NOTIFY)).body.error, "invalid-url");
  const sent = await call(handler, "POST", "notify", { title: "Jimmy left you a gift 🎁", body: "It's under the tree.", url: "https://family.example/tree" }, NOTIFY);
  assert.deepEqual(sent.body, { sent: 1 });
  assert.deepEqual(w.pushed.map((p) => p.url), [all.subscription.endpoint]);
  assert.deepEqual(w.pushed[0].notice, { title: "Jimmy left you a gift 🎁", body: "It's under the tree.", url: "https://family.example/tree" });

  const off = createHandler({ env: { ...ENV, OPENBLOG_PUSH_NOTIFY_KEY: "" }, fetchImpl: w.fetchImpl });
  assert.equal((await call(off, "POST", "notify", { title: "x" }, NOTIFY)).status, 401);
});

test("a new comment buzzes the phones that asked, forgets phones that are gone, and is stored either way", async () => {
  const w = world();
  const handler = createHandler({ env: ENV, fetchImpl: w.fetchImpl });
  const phone = w.phone();
  const oldTablet = w.phone();
  const quotesOnly = w.phone();
  await call(handler, "POST", "devices", { subscription: phone.subscription, label: "Phone" });
  await call(handler, "POST", "devices", { subscription: oldTablet.subscription, label: "Old tablet" });
  await call(handler, "POST", "devices", { subscription: quotesOnly.subscription, label: "Shop", kinds: ["quote"] });
  w.gone.add(oldTablet.subscription.endpoint);

  const stored = [];
  const engagement = createEngagement({
    env: { ...ENV, SUPABASE_URL: "https://proj.supabase.co", OPENBLOG_SITE_ORIGIN: "https://family.example", OPENBLOG_ADMIN_API_KEY: "admin-secret", OPENBLOG_ANALYTICS_SALT: "salt" },
    siteFetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ "/stuffing/": "open" }) }),
    fetchImpl: async (url, init = {}) => {
      if (url.includes("openblog_push_devices") || !url.includes("proj.supabase.co")) return w.fetchImpl(url, init);
      if (url.includes("openblog_consume_rate_limit")) return { ok: true, status: 200, json: async () => ({ allowed: true }) };
      stored.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => [{ id: "00000000-0000-0000-0000-000000000009", status: "pending", created_at: "2026-11-13T12:00:00Z" }] };
    },
  });
  const response = await engagement({ path: "/api/comments", httpMethod: "POST", headers: { origin: "https://family.example" }, body: JSON.stringify({ path: "/stuffing/", authorName: "Jimmy", body: "Made this for Friendsgiving and there were no leftovers. ".repeat(3) }) });
  assert.equal(response.statusCode, 202);
  assert.equal(stored[0].author_name, "Jimmy");
  assert.deepEqual(w.pushed.map((p) => p.url).sort(), [phone.subscription.endpoint, oldTablet.subscription.endpoint].sort());
  const told = w.pushed.find((p) => p.url === phone.subscription.endpoint).notice;
  assert.equal(told.title, "Jimmy left a comment");
  assert.match(told.body, /^On “Stuffing”: “Made this for Friendsgiving.+…”$/);
  assert.ok(!told.body.includes("/stuffing/"), "never the raw path");
  assert.ok(told.body.length <= 180);
  assert.equal(told.url, "/admin/studio/#/comments");
  assert.deepEqual(w.devices.map((d) => d.label).sort(), ["Phone", "Shop"], "the gone tablet is forgotten");
  assert.ok(w.devices.find((d) => d.label === "Phone").last_sent_at);
});

test("telling the owner never holds up or breaks the thing that was stored", async () => {
  // A push service that never answers: the budget cuts it off.
  const w = world();
  const handler = createHandler({ env: ENV, fetchImpl: w.fetchImpl });
  const phone = w.phone();
  await call(handler, "POST", "devices", { subscription: phone.subscription, label: "Phone" });
  const started = Date.now();
  const outcome = await tellOwner({ env: ENV, fetchImpl: w.fetchImpl, kind: "comment", notice: { title: "x" }, budgetMs: 50, transport: () => new Promise(() => {}) });
  assert.equal(outcome, null);
  assert.ok(Date.now() - started < 1000);
  // Storage down, push off, an unknown kind: all quietly nothing.
  assert.equal((await tellOwner({ env: ENV, fetchImpl: async () => { throw new Error("down"); }, kind: "comment", notice: { title: "x" } })).failed, -1);
  assert.equal(await tellOwner({ env: {}, fetchImpl: w.fetchImpl, kind: "comment", notice: { title: "x" } }), null);
  assert.equal(await tellOwner({ env: ENV, fetchImpl: w.fetchImpl, kind: "secrets", notice: { title: "x" } }), null);
});

test("a post is named the way she says it, never by its path, and a notice with no title still says something", () => {
  assert.equal(pageWords("/posts/pumpkin-pie/"), "“Pumpkin pie”");
  assert.equal(pageWords("/stuffing/"), "“Stuffing”");
  assert.equal(pageWords("/posts/grammis_rolls.html"), "“Grammis rolls”");
  assert.equal(pageWords("/posts/pie/index.html"), "“Pie”");
  assert.equal(pageWords("/posts/cr%C3%A8me-br%C3%BBl%C3%A9e/?x=1#top"), "“Crème brûlée”");
  assert.equal(pageWords("/"), "your front page");
  assert.equal(pageWords(""), "your front page");
  assert.equal(pageWords(undefined), "your front page");
  const plain = notice({ title: "  " });
  assert.equal(plain.title, "Something new on your blog");
  assert.equal(plain.url, "/admin/studio/");
});

test("reader notes and author answers say which post in her words and open Comments", async () => {
  const w = world();
  const handler = createHandler({ env: ENV, fetchImpl: w.fetchImpl });
  const phone = w.phone();
  await call(handler, "POST", "devices", { subscription: phone.subscription, label: "Phone" });
  // tellOwner is what every engagement route calls; these are the exact notices they send.
  const sent = [];
  const transport = async (_subscription, message) => { sent.push(message); return { ok: true }; };
  for (const fields of [
    { title: `A reader wrote about ${pageWords("/posts/pumpkin-pie/")}.`, url: "/admin/studio/#/comments" },
    { title: `An author answered on ${pageWords("/posts/pumpkin-pie/")}.`, url: "/admin/studio/#/comments" },
  ]) await tellOwner({ env: ENV, fetchImpl: w.fetchImpl, kind: "feedback", notice: fields, transport });
  assert.deepEqual(sent.map((n) => n.title), ["A reader wrote about “Pumpkin pie”.", "An author answered on “Pumpkin pie”."]);
  // And the engagement function sends exactly those: no old address, no raw path in any notice.
  const source = (await import("node:fs")).readFileSync(new URL("../../netlify/functions/engagement.mjs", import.meta.url), "utf8");
  const notices = [...source.matchAll(/tellOwner\(\{[^\n]+\}\);/g)].map((m) => m[0]);
  assert.equal(notices.length, 5);
  for (const line of notices) {
    assert.match(line, /url: "\/admin\/studio\/#\/comments"/, line);
    assert.doesNotMatch(line, /On \$\{(path|submission\.work|answer\.work)\}/, line);
  }
});

test("a quote request buzzes the phones that asked, in her words, and opens Requests", async () => {
  const w = world();
  const handler = createHandler({ env: ENV, fetchImpl: w.fetchImpl });
  const phone = w.phone();
  await call(handler, "POST", "devices", { subscription: phone.subscription, label: "Shop phone", kinds: ["quote"] });
  const SECRET = "q".repeat(40);
  const now = 1_800_000_000_000;
  const quote = createQuote({
    env: { ...ENV, OPENBLOG_QUOTE_ENABLED: "true", OPENBLOG_SITE_ORIGIN: "https://acme.example", OPENBLOG_QUOTE_SECRET: SECRET, OPENBLOG_QUOTE_ADMIN_KEY: "a".repeat(40) },
    fetchImpl: async (url, init = {}) => {
      if (url.includes("openblog_push_devices") || !url.includes("proj.supabase.co")) return w.fetchImpl(url, init);
      if (new URL(url).searchParams.get("select") === "id") return new Response("[]", { status: 206, headers: { "content-range": "0-0/0" } });
      return new Response(init.method === "POST" ? "" : "[]", { status: init.method === "POST" ? 201 : 200, headers: { "content-type": "application/json" } });
    },
    now: () => now,
    uuid: () => "00000000-0000-4000-8000-000000000001",
    sleep: async () => {},
  });
  const fields = { name: "Pat Smith", phone: "+1 360 555 0142", town: "Bend, OR", service: "Fencing", description: "Replace forty feet of cedar fence.", email: "pat@example.com", token: issueToken(SECRET, now - 10000) };
  const body = Object.entries(fields).map(([k, v]) => `--b\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join("") + "--b--\r\n";
  const response = await quote({ httpMethod: "POST", path: "/api/quote/submit", headers: { "content-type": "multipart/form-data; boundary=b", accept: "application/json" }, body });
  assert.equal(response.statusCode, 201);
  assert.equal(w.pushed.length, 1);
  const told = w.pushed[0].notice;
  assert.equal(told.url, "/admin/studio/#/quotes");
  assert.equal(told.body, "Pat Smith · Fencing · Bend, OR");
  for (const secret of ["555", "pat@example.com", "cedar"]) assert.ok(!JSON.stringify(told).includes(secret), secret);
});
