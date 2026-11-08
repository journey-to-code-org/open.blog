import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../../netlify/functions/quote.mjs";
import { createSweep } from "../../netlify/functions/quote-retention.mjs";
import { retentionDays, toCsv } from "../../netlify/lib/quote-admin.mjs";

const ADMIN = "a".repeat(40);
const ENV = {
  OPENBLOG_QUOTE_ENABLED: "true",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_" + "k".repeat(30),
  OPENBLOG_SITE_ID: "acme",
  OPENBLOG_SITE_ORIGIN: "https://acme.example",
  OPENBLOG_QUOTE_SECRET: "q".repeat(40),
  OPENBLOG_QUOTE_ADMIN_KEY: ADMIN,
};
const NOW = Date.parse("2026-11-01T12:00:00Z");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n, over = {}) => ({
  id: id(n), site_id: "acme", status: "new", name: `Person ${n}`, phone: "+1 360 555 0100", email: null, town: "Bend", service: "Fencing",
  description: "Replace the cedar fence.", page: null, photos: [], created_at: new Date(NOW - n * 3600_000).toISOString(), handled_at: null, archived_at: null, notify_status: "off", ...over,
});
const photo = (n, k) => ({ path: `acme/${id(n)}/${k}.jpg`, type: "image/jpeg", bytes: 10 });

// A small Supabase: rows with PostgREST-style filters, a private bucket, and switches for failures.
function fake(rows, { failRemove = false, failDeleteRows = false, failMoveAt = 0, failMoveBack = false, loseMoveReplyAt = 0 } = {}) {
  let moves = 0;
  const state = { rows: structuredClone(rows), objects: new Set(), calls: [] };
  for (const r of state.rows) for (const p of r.photos) state.objects.add(p.path);
  const reply = (status, body = "") => new Response(status === 204 ? null : typeof body === "string" ? body : JSON.stringify(body), { status });
  const matches = (r, q) => {
    for (const [key, value] of q.entries()) {
      if (["select", "order", "limit"].includes(key)) continue;
      const op = value.slice(0, value.indexOf("."));
      const arg = value.slice(value.indexOf(".") + 1);
      if (key === "id" && op === "in") {
        if (!arg.slice(1, -1).split(",").includes(r.id)) return false;
      } else if (op === "eq") {
        if (String(r[key]) !== arg) return false;
      } else if (op === "lt") {
        if (!(r[key] && r[key] < arg)) return false;
      } else if (op === "gte") {
        if (!(r[key] >= arg)) return false;
      }
    }
    return true;
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    state.calls.push(`${init.method} ${u.pathname}`);
    if (u.pathname.startsWith("/storage/v1/object/sign/")) return reply(200, { signedURL: `/object/sign/${u.pathname.split("/sign/")[1]}?token=t` });
    // The owner's retention choice (ADR 0387): one small object with a body.
    if (u.pathname.endsWith("/openblog-quote-photos/acme/settings/retention.json")) {
      if (init.method === "GET") return state.settings == null ? reply(400, { error: "not_found" }) : reply(200, state.settings);
      if (init.method === "POST") {
        if (init.headers["x-upsert"] !== "true") return reply(409);
        state.settings = init.body;
        return reply(200, { Key: "x" });
      }
      if (init.method === "DELETE") {
        state.settings = null;
        return reply(200, []);
      }
    }
    if (u.pathname === "/storage/v1/object/list/openblog-quote-photos") {
      const prefix = JSON.parse(init.body).prefix + "/";
      return reply(200, [...state.objects].filter((p) => p.startsWith(prefix)).map((p) => ({ name: p.slice(prefix.length) })));
    }
    if (u.pathname === "/storage/v1/object/move" && init.method === "POST") {
      const { bucketId, sourceKey, destinationKey } = JSON.parse(init.body);
      moves += 1;
      const back = !destinationKey.includes("/erasing/");
      if ((failMoveAt && moves === failMoveAt) || (back && failMoveBack) || bucketId !== "openblog-quote-photos" || !state.objects.has(sourceKey)) return reply(500);
      state.objects.delete(sourceKey);
      state.objects.add(destinationKey);
      if (loseMoveReplyAt && moves === loseMoveReplyAt) throw new TypeError("fetch failed"); // moved, but the reply was lost
      return reply(200, { message: "Successfully moved" });
    }
    if (u.pathname === "/storage/v1/object/openblog-quote-photos" && init.method === "DELETE") {
      const { prefixes } = JSON.parse(init.body);
      if (failRemove) {
        state.objects.delete(prefixes[0]); // a partial removal, then an error
        return reply(500);
      }
      for (const p of prefixes) state.objects.delete(p);
      return reply(200, []);
    }
    if (u.pathname === "/rest/v1/openblog_quote_requests") {
      const hits = state.rows.filter((r) => matches(r, u.searchParams));
      if (init.method === "GET") return reply(200, hits);
      if (init.method === "PATCH") {
        for (const r of hits) Object.assign(r, JSON.parse(init.body));
        return reply(204);
      }
      if (init.method === "DELETE") {
        if (failDeleteRows) return reply(500);
        state.rows = state.rows.filter((r) => !hits.includes(r));
        return reply(200, hits);
      }
    }
    return reply(404);
  };
  return { state, fetchImpl };
}

const call = (handler, method, path, { body, query, key = ADMIN } = {}) =>
  handler({ httpMethod: method, path: `/api/quote/${path}`, headers: key ? { authorization: `Bearer ${key}` } : {}, queryStringParameters: query, body: body ? JSON.stringify(body) : undefined });
const make = (rows, options, env = {}) => {
  const f = fake(rows, options);
  return { f, handler: createHandler({ env: { ...ENV, ...env }, fetchImpl: f.fetchImpl, now: () => NOW }) };
};

test("every management route needs the admin key and is dark without one", async () => {
  const { handler, f } = make([row(1)]);
  for (const [method, path] of [["GET", "requests"], ["POST", `requests/${id(1)}/status`], ["GET", "export"], ["POST", "erase/preview"], ["POST", "erase"], ["POST", "retention/run"]]) {
    assert.equal((await call(handler, method, path, { key: null })).statusCode, 401, path);
    assert.equal((await call(handler, method, path, { key: "b".repeat(40) })).statusCode, 401, path);
  }
  assert.deepEqual(f.state.calls, []);
  const noKey = createHandler({ env: { ...ENV, OPENBLOG_QUOTE_ADMIN_KEY: "" }, fetchImpl: f.fetchImpl, now: () => NOW });
  assert.equal((await call(noKey, "GET", "requests")).statusCode, 404);
  assert.deepEqual(f.state.calls, []);
});

test("the list is newest first, filtered, scoped to the site, with signed thumbnails and no hashes", async () => {
  const other = { ...row(9), site_id: "other" };
  const { handler } = make([row(3, { photos: [photo(3, 1)] }), row(1, { service: "Decks" }), row(2, { status: "handled", handled_at: "2026-11-01T00:00:00.000Z" }), other]);
  const all = JSON.parse((await call(handler, "GET", "requests")).body);
  assert.equal(all.requests.length, 3);
  assert.ok(!all.requests.some((r) => r.id === id(9)), "another site's request never appears");
  assert.deepEqual(all.services, ["Decks", "Fencing"]);
  assert.match(all.requests.find((r) => r.id === id(3)).photos[0].url, /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/sign\/openblog-quote-photos\/acme\/.*token=t$/);
  assert.ok(!JSON.stringify(all).includes("client_hash") && !JSON.stringify(all).includes("token_hash"));
  const handled = JSON.parse((await call(handler, "GET", "requests", { query: { status: "handled" } })).body);
  assert.deepEqual(handled.requests.map((r) => r.id), [id(2)]);
  const decks = JSON.parse((await call(handler, "GET", "requests", { query: { service: "Decks" } })).body);
  assert.deepEqual(decks.requests.map((r) => r.id), [id(1)]);
  assert.deepEqual(decks.services, ["Decks", "Fencing"]);
});

test("status moves between new, handled and archived with its stamps, and nothing else", async () => {
  const { handler, f } = make([row(1)]);
  const set = (status, target = id(1)) => call(handler, "POST", `requests/${target}/status`, { body: { status } });
  assert.equal((await set("handled")).statusCode, 200);
  assert.equal(f.state.rows[0].status, "handled");
  assert.equal(f.state.rows[0].handled_at, new Date(NOW).toISOString());
  assert.equal((await set("archived")).statusCode, 200);
  assert.equal(f.state.rows[0].archived_at, new Date(NOW).toISOString());
  assert.equal((await set("new")).statusCode, 200);
  assert.equal(f.state.rows[0].archived_at, null);
  assert.equal(f.state.rows[0].handled_at, null);
  assert.equal((await set("won")).statusCode, 400);
  assert.equal((await set("handled", "not-an-id")).statusCode, 400);
});

test("the list shows when an archived request will be erased", async () => {
  const { handler } = make([row(1, { status: "archived", archived_at: "2026-10-30T12:00:00.000Z" })], {}, { OPENBLOG_QUOTE_RETENTION_DAYS: "30" });
  const body = JSON.parse((await call(handler, "GET", "requests")).body);
  assert.equal(body.retentionDays, 30);
  assert.equal(body.requests[0].eraseAfter, "2026-11-29T12:00:00.000Z");
  assert.equal(retentionDays({ OPENBLOG_QUOTE_RETENTION_DAYS: "0" }), null);
  assert.equal(retentionDays({ OPENBLOG_QUOTE_RETENTION_DAYS: "abc" }), null);
  assert.equal(retentionDays({}), null);
});

test("the list tells Admin which owner emails failed, how often they were tried, and whether it can retry them (#516)", async () => {
  const rows = [row(1, { notify_status: "failed", notify_attempts: 2, notify_error_code: "provider-error" }), row(2, { notify_status: "sent", notify_attempts: 1 })];
  const off = JSON.parse((await call(make(rows).handler, "GET", "requests")).body);
  assert.equal(off.notifyEnabled, false, "no provider set: Admin is told it cannot retry");
  const mail = { OPENBLOG_QUOTE_NOTIFY_PROVIDER: "resend", OPENBLOG_QUOTE_NOTIFY_API_KEY: "re_key", OPENBLOG_QUOTE_NOTIFY_TO: "owner@acme.example", OPENBLOG_QUOTE_NOTIFY_FROM: "Acme <quotes@acme.example>" };
  const on = JSON.parse((await call(make(rows, {}, mail).handler, "GET", "requests")).body);
  assert.equal(on.notifyEnabled, true);
  const failed = on.requests.find((r) => r.id === id(1));
  assert.deepEqual([failed.notify, failed.notifyAttempts, failed.notifyError], ["failed", 2, "provider-error"]);
  const sent = on.requests.find((r) => r.id === id(2));
  assert.deepEqual([sent.notify, sent.notifyAttempts, sent.notifyError], ["sent", 1, null]);
});

test("CSV export covers the chosen days, neutralizes formulas and quotes cells", async () => {
  const { handler } = make([
    row(1, { name: '=HYPERLINK("x")', description: 'a, b\n"c"', created_at: "2026-10-10T08:00:00.000Z" }),
    row(2, { created_at: "2026-10-12T08:00:00.000Z" }),
    row(3, { created_at: "2026-09-01T08:00:00.000Z" }),
  ]);
  const out = JSON.parse((await call(handler, "GET", "export", { query: { from: "2026-10-01", to: "2026-10-12" } })).body);
  assert.equal(out.count, 2);
  assert.equal(out.filename, "quote-requests-2026-10-01-to-2026-10-12.csv");
  assert.match(out.csv.split("\r\n")[0], /^id,received,status,name,phone/);
  assert.ok(out.csv.includes('"\'=HYPERLINK(""x"")"'), "a formula cell becomes text");
  assert.ok(out.csv.includes('"a, b\n""c"""'));
  assert.ok(!out.csv.includes(id(3)));
  assert.equal((await call(handler, "GET", "export", { query: { from: "yesterday" } })).statusCode, 400);
  assert.equal(toCsv([]).split("\r\n").length, 2);
});

test("erase must be previewed, the token fits exactly that list, and it is verified", async () => {
  const { handler, f } = make([row(1, { photos: [photo(1, 1), photo(1, 2)] }), row(2, { photos: [photo(2, 1)] }), row(3)]);
  const preview = JSON.parse((await call(handler, "POST", "erase/preview", { body: { ids: [id(1), id(2)] } })).body);
  assert.equal(preview.count, 2);
  assert.equal(preview.photos, 3);
  assert.equal(f.state.rows.length, 3, "a preview erases nothing");
  assert.equal((await call(handler, "POST", "erase", { body: { ids: [id(1), id(3)], token: preview.token } })).statusCode, 409);
  assert.equal((await call(handler, "POST", "erase", { body: { ids: [id(1), id(2)] } })).statusCode, 409);
  assert.equal(f.state.rows.length, 3);
  const done = await call(handler, "POST", "erase", { body: { ids: [id(2), id(1)], token: preview.token } });
  assert.equal(done.statusCode, 200);
  assert.deepEqual(JSON.parse(done.body), { erased: 2, verified: true });
  assert.deepEqual(f.state.rows.map((r) => r.id), [id(3)]);
  assert.equal(f.state.objects.size, 0);
});

test("an expired preview and a missing request are refused", async () => {
  const { handler, f } = make([row(1)]);
  const preview = JSON.parse((await call(handler, "POST", "erase/preview", { body: { ids: [id(1)] } })).body);
  const later = createHandler({ env: ENV, fetchImpl: f.fetchImpl, now: () => NOW + 11 * 60_000 });
  assert.equal((await call(later, "POST", "erase", { body: { ids: [id(1)], token: preview.token } })).statusCode, 409);
  assert.equal((await call(handler, "POST", "erase/preview", { body: { ids: [id(1), id(7)] } })).statusCode, 409);
  assert.equal((await call(handler, "POST", "erase/preview", { body: { ids: [] } })).statusCode, 400);
  assert.equal(f.state.rows.length, 1);
});

test("a partial failure leaves every request and every photo in place (ADR 0386)", async () => {
  const before = [row(1, { photos: [photo(1, 1), photo(1, 2)] }), row(2, { photos: [photo(2, 1)] })];
  const ids = [id(1), id(2)];
  const paths = [photo(1, 1).path, photo(1, 2).path, photo(2, 1).path].sort();
  // The third photo cannot be moved aside: the two already moved are put back.
  {
    const { handler, f } = make(before, { failMoveAt: 3 });
    const preview = JSON.parse((await call(handler, "POST", "erase/preview", { body: { ids } })).body);
    const result = await call(handler, "POST", "erase", { body: { ids, token: preview.token } });
    assert.equal(result.statusCode, 502);
    assert.deepEqual(JSON.parse(result.body), { error: "erase-failed" });
    assert.deepEqual(f.state.rows.map((r) => r.id).sort(), ids);
    assert.deepEqual([...f.state.objects].sort(), paths, "every photo is where it was: 3 before, 3 after");
    assert.deepEqual(f.state.rows.find((r) => r.id === id(1)).photos, before[0].photos);
  }
  // The records cannot be removed: the photos are put back too.
  {
    const { handler, f } = make(before, { failDeleteRows: true });
    const preview = JSON.parse((await call(handler, "POST", "erase/preview", { body: { ids } })).body);
    assert.equal((await call(handler, "POST", "erase", { body: { ids, token: preview.token } })).statusCode, 503);
    assert.equal(f.state.rows.length, 2);
    assert.deepEqual([...f.state.objects].sort(), paths);
  }
  // A photo that cannot even be put back is still kept, and its request points to where it is.
  {
    const { handler, f } = make(before, { failMoveAt: 3, failMoveBack: true });
    const preview = JSON.parse((await call(handler, "POST", "erase/preview", { body: { ids } })).body);
    assert.equal((await call(handler, "POST", "erase", { body: { ids, token: preview.token } })).statusCode, 502);
    assert.equal(f.state.objects.size, 3, "no photo is lost");
    for (const r of f.state.rows) for (const p of r.photos) assert.ok(f.state.objects.has(p.path), p.path);
    // ...and a later erase that works removes it with its request, and leaves nothing behind.
    const healthy = make([], {});
    healthy.f.state.rows = f.state.rows;
    healthy.f.state.objects = f.state.objects;
    const again = JSON.parse((await call(healthy.handler, "POST", "erase/preview", { body: { ids } })).body);
    assert.equal(again.photos, 3, "the photo it could not put back is still counted");
    assert.deepEqual(JSON.parse((await call(healthy.handler, "POST", "erase", { body: { ids, token: again.token } })).body), { erased: 2, verified: true });
    assert.equal(f.state.objects.size, 0);
    assert.equal(healthy.f.state.rows.length, 0);
  }
});

test("an erase goes ahead when a photo is already gone or was moved but the reply was lost (ADR 0387)", async () => {
  const archived = (n, days, photos = []) => row(n, { photos, status: "archived", archived_at: new Date(NOW - days * 86400_000).toISOString() });
  // The second photo of request 1 is missing from storage: the erase still removes the request.
  {
    const { handler, f } = make([archived(1, 90, [photo(1, 1), photo(1, 2)]), archived(2, 80)]);
    f.state.objects.delete(photo(1, 2).path);
    const preview = JSON.parse((await call(handler, "POST", "erase/preview", { body: { ids: [id(1)] } })).body);
    const result = await call(handler, "POST", "erase", { body: { ids: [id(1)], token: preview.token } });
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(JSON.parse(result.body), { erased: 1, verified: true });
    assert.deepEqual(f.state.rows.map((r) => r.id), [id(2)]);
    assert.equal(f.state.objects.size, 0);
  }
  // ...and the retention run is not blocked by it: both expired requests go.
  {
    const { handler, f } = make([archived(1, 90, [photo(1, 1), photo(1, 2)]), archived(2, 80)], {}, { OPENBLOG_QUOTE_RETENTION_DAYS: "30" });
    f.state.objects.delete(photo(1, 2).path);
    const result = await call(handler, "POST", "retention/run", {});
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(JSON.parse(result.body).erased, 2);
    assert.equal(f.state.rows.length, 0);
  }
  // A move that happened but whose reply was lost is counted as held, so a later failure puts it back...
  {
    const before = [row(1, { photos: [photo(1, 1), photo(1, 2)] })];
    const { handler, f } = make(before, { loseMoveReplyAt: 2, failDeleteRows: true });
    const preview = JSON.parse((await call(handler, "POST", "erase/preview", { body: { ids: [id(1)] } })).body);
    assert.equal((await call(handler, "POST", "erase", { body: { ids: [id(1)], token: preview.token } })).statusCode, 503);
    assert.deepEqual([...f.state.objects].sort(), [photo(1, 1).path, photo(1, 2).path], "both photos are back where the request says");
  }
  // ...and a healthy erase after it removes it with its request.
  {
    const { handler, f } = make([row(1, { photos: [photo(1, 1), photo(1, 2)] })], { loseMoveReplyAt: 2 });
    const preview = JSON.parse((await call(handler, "POST", "erase/preview", { body: { ids: [id(1)] } })).body);
    assert.deepEqual(JSON.parse((await call(handler, "POST", "erase", { body: { ids: [id(1)], token: preview.token } })).body), { erased: 1, verified: true });
    assert.equal(f.state.rows.length, 0);
    assert.equal(f.state.objects.size, 0);
  }
});

test("a photo removal that fails after the records are gone is reported, and the next erase removes it", async () => {
  const { handler, f } = make([row(1, { photos: [photo(1, 1)] }), row(2)], { failRemove: true });
  const preview = JSON.parse((await call(handler, "POST", "erase/preview", { body: { ids: [id(1)] } })).body);
  const result = JSON.parse((await call(handler, "POST", "erase", { body: { ids: [id(1)], token: preview.token } })).body);
  assert.deepEqual(result, { erased: 1, verified: true, photosPending: 1 });
  assert.deepEqual(f.state.rows.map((r) => r.id), [id(2)]);
  assert.ok([...f.state.objects].every((path) => path.startsWith("acme/erasing/")), "anything left is held where no request points");
  // The next erase purges what an erased request left, and only that: a held photo of a request
  // that still exists (one an earlier erase could not put back) is kept.
  f.state.objects.add(`acme/erasing/${id(1)}-1.jpg`);
  f.state.objects.add(`acme/erasing/${id(3)}-1.jpg`);
  const healthy = make([row(3, { photos: [{ path: `acme/erasing/${id(3)}-1.jpg`, type: "image/jpeg", bytes: 10 }] })], {});
  healthy.f.state.rows.push(...f.state.rows);
  healthy.f.state.objects = f.state.objects;
  const next = JSON.parse((await call(healthy.handler, "POST", "erase/preview", { body: { ids: [id(2)] } })).body);
  assert.deepEqual(JSON.parse((await call(healthy.handler, "POST", "erase", { body: { ids: [id(2)], token: next.token } })).body), { erased: 1, verified: true });
  assert.deepEqual([...f.state.objects], [`acme/erasing/${id(3)}-1.jpg`]);
});

test("a failure removing the rows reports and keeps them; nothing personal is in the error", async () => {
  const { handler, f } = make([row(1, { name: "Secret Name" })], { failDeleteRows: true });
  const preview = JSON.parse((await call(handler, "POST", "erase/preview", { body: { ids: [id(1)] } })).body);
  const result = await call(handler, "POST", "erase", { body: { ids: [id(1)], token: preview.token } });
  assert.equal(result.statusCode, 503);
  assert.ok(!result.body.includes("Secret"));
  assert.equal(f.state.rows.length, 1);
});

test("retention erases only archived requests past the period, and is off without a setting", async () => {
  const rows = () => [
    row(1, { status: "archived", archived_at: new Date(NOW - 40 * 86400_000).toISOString(), photos: [photo(1, 1)] }),
    row(2, { status: "archived", archived_at: new Date(NOW - 5 * 86400_000).toISOString() }),
    row(3, { status: "handled", handled_at: new Date(NOW - 400 * 86400_000).toISOString() }),
    row(4, { created_at: new Date(NOW - 900 * 86400_000).toISOString() }),
  ];
  const off = fake(rows());
  assert.deepEqual(await createSweep({ env: ENV, fetchImpl: off.fetchImpl, now: () => NOW })(), { enabled: false, erased: 0 });
  assert.deepEqual(off.state.calls, ["GET /storage/v1/object/authenticated/openblog-quote-photos/acme/settings/retention.json"], "only the owner's choice is read");
  const { handler, f } = make(rows(), {}, { OPENBLOG_QUOTE_RETENTION_DAYS: "30" });
  const run = await call(handler, "POST", "retention/run", { body: {} });
  assert.deepEqual(JSON.parse(run.body), { enabled: true, erased: 1 });
  assert.deepEqual(f.state.rows.map((r) => r.id).sort(), [id(2), id(3), id(4)]);
  assert.equal(f.state.objects.size, 0);
  const env = { ...ENV, OPENBLOG_QUOTE_RETENTION_DAYS: "30" };
  const sweep = fake(rows());
  assert.deepEqual(await createSweep({ env, fetchImpl: sweep.fetchImpl, now: () => NOW })(), { enabled: true, erased: 1 });
  const broken = fake(rows(), { failMoveAt: 1 });
  assert.deepEqual(await createSweep({ env, fetchImpl: broken.fetchImpl, now: () => NOW })(), { enabled: true, erased: 0, error: "erase-failed" });
  assert.equal(broken.state.rows.length, 4);
  assert.equal(broken.state.objects.size, 1, "and its photo is kept");
});

test("the owner sets the retention days in Admin; a host setting wins and cannot be changed there (ADR 0387)", async () => {
  const rows = () => [
    row(1, { status: "archived", archived_at: new Date(NOW - 40 * 86400_000).toISOString() }),
    row(2, { status: "archived", archived_at: new Date(NOW - 5 * 86400_000).toISOString() }),
  ];
  const { handler, f } = make(rows());
  const list = async () => JSON.parse((await call(handler, "GET", "requests")).body);
  assert.deepEqual([(await list()).retentionDays, (await list()).retentionSource], [null, null]);
  for (const days of [0, 3651, 1.5, "30", true]) assert.equal((await call(handler, "POST", "retention", { body: { days } })).statusCode, 400, String(days));
  assert.equal((await call(handler, "POST", "retention", { body: { days: 30 }, key: "b".repeat(40) })).statusCode, 401);
  assert.equal(f.state.settings, undefined, "nothing was written");
  assert.deepEqual(JSON.parse((await call(handler, "POST", "retention", { body: { days: 30 } })).body), { retentionDays: 30, retentionSource: "admin" });
  assert.deepEqual([(await list()).retentionDays, (await list()).retentionSource], [30, "admin"]);
  // The owner's choice is what the daily sweep and "Erase expired now" use.
  const sweep = createSweep({ env: ENV, fetchImpl: f.fetchImpl, now: () => NOW });
  assert.deepEqual(await sweep(), { enabled: true, erased: 1 });
  assert.deepEqual(f.state.rows.map((r) => r.id), [id(2)]);
  assert.deepEqual(JSON.parse((await call(handler, "POST", "retention", { body: { days: null } })).body), { retentionDays: null, retentionSource: null });
  assert.equal((await list()).retentionDays, null);
  // A host setting wins, and Admin is told it cannot change it.
  const host = make(rows(), {}, { OPENBLOG_QUOTE_RETENTION_DAYS: "60" });
  host.f.state.settings = JSON.stringify({ days: 10 });
  const hostList = JSON.parse((await call(host.handler, "GET", "requests")).body);
  assert.deepEqual([hostList.retentionDays, hostList.retentionSource], [60, "host"]);
  const refused = await call(host.handler, "POST", "retention", { body: { days: 30 } });
  assert.equal(refused.statusCode, 409);
  assert.deepEqual(JSON.parse(refused.body), { error: "retention-set-by-host" });
  assert.equal(host.f.state.settings, JSON.stringify({ days: 10 }));
});
