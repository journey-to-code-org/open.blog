// The hosted feedback transport (ADRs 0088 and 0089), exercised through
// HTTP-shaped events with fake Supabase and site fetches: off by default,
// shared validation before any request, the site's published policy, the
// existing quota, a receiver-stamped time, a private reader name kept out of
// comments, constant-time moderation authorization, provider failures, and the
// SQL the function relies on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHandler } from "../../netlify/functions/engagement.mjs";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/scholarly-feedback.json", import.meta.url), "utf8"));
const migration = readFileSync(new URL("../../supabase/feedback.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../../supabase/feedback-rollback.sql", import.meta.url), "utf8");
const baseSchema = readFileSync(new URL("../../supabase/openblog.sql", import.meta.url), "utf8");

const environment = {
  SUPABASE_URL: "https://database.example",
  SUPABASE_SECRET_KEY: "sb_secret_test_server_only",
  OPENBLOG_SITE_ID: "lantern",
  OPENBLOG_SITE_ORIGIN: "https://blog.example",
  OPENBLOG_ADMIN_API_KEY: "admin-secret",
  OPENBLOG_ANALYTICS_SALT: "daily-hash-secret",
};
const enabled = { ...environment, OPENBLOG_FEEDBACK_ENABLED: "true" };
const NOW = new Date("2026-10-26T10:00:00.750Z");

const textOf = (item) => item.text ?? JSON.stringify(item.submission);
const submission = (index = 0) => textOf(fixture.accepted[index]);

const event = (path, method = "GET", body, extra = {}) => ({
  path: `/api/${path}`,
  httpMethod: method,
  headers: { origin: "https://blog.example", "x-nf-client-connection-ip": "203.0.113.9", ...extra.headers },
  queryStringParameters: extra.query || {},
  body,
});

const sitePolicy = (policy) => async (url) => {
  assert.equal(url, "https://blog.example/openblog-feedback.json");
  return { ok: true, status: 200, json: async () => ({ "/posts/tides/": policy }) };
};

/** A fake Supabase that records requests and answers like PostgREST. */
const fakeDatabase = (answers = {}) => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    let value;
    if (url.includes("openblog_consume_rate_limit")) value = answers.quota ?? { allowed: true };
    else if (options.method === "POST") value = [{ id: "00000000-0000-4000-8000-000000000009", status: "pending", received_at: "2026-10-26T10:00:00+00:00" }];
    else if (options.method === "PATCH") value = null;
    else value = answers.rows ?? [];
    return { ok: true, status: 200, json: async () => value };
  };
  return { requests, fetchImpl };
};

const noFetch = async () => assert.fail("must not reach Supabase or the site");

test("a site that has not opted in sees no change and no request is made", async () => {
  const handler = createHandler({ env: environment, fetchImpl: noFetch, siteFetchImpl: noFetch });
  for (const request of [
    event("feedback", "POST", submission()),
    event("admin/feedback", "GET", undefined, { headers: { authorization: "Bearer admin-secret" } }),
  ]) {
    const response = await handler(request);
    assert.equal(response.statusCode, 404);
    const body = JSON.parse(response.body);
    assert.equal(body.code, "unavailable");
    // A useful canonical explanation, never a backend detail.
    assert.match(body.error, /copy your note and send it to the author/);
    assert.doesNotMatch(response.body, /supabase|sb_secret|admin-secret/i);
  }
  for (const value of ["1", "yes", "TRUE ", "on"]) {
    const off = createHandler({ env: { ...environment, OPENBLOG_FEEDBACK_ENABLED: value }, fetchImpl: noFetch, siteFetchImpl: noFetch });
    assert.equal((await off(event("feedback", "POST", submission()))).statusCode, 404, value);
  }
  // Comments are untouched by the feedback switch.
  const comments = fakeDatabase();
  const commentHandler = createHandler({
    env: environment,
    fetchImpl: comments.fetchImpl,
    siteFetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ "/story/": "open" }) }),
  });
  const posted = await commentHandler(event("comments", "POST", JSON.stringify({ path: "/story/", authorName: "Mira", body: "Hi" })));
  assert.equal(posted.statusCode, 202);
  assert.ok(comments.requests.every((request) => !request.url.includes("openblog_feedback")));
});

test("a valid submission is stored pending with the receiver's time and a private name kept apart", async () => {
  const database = fakeDatabase();
  const handler = createHandler({ env: enabled, fetchImpl: database.fetchImpl, siteFetchImpl: sitePolicy("open"), now: () => NOW });
  const response = await handler(event("feedback", "POST", submission(3)));
  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { id: "00000000-0000-4000-8000-000000000009", status: "pending", receivedAt: "2026-10-26T10:00:00Z" });
  assert.equal(response.headers["Access-Control-Allow-Origin"], "https://blog.example");

  const [quota, insert] = database.requests;
  assert.match(quota.url, /openblog_consume_rate_limit/);
  const limits = JSON.parse(quota.options.body);
  assert.equal(limits.p_bucket, "feedback");
  assert.equal(limits.p_subject_limit, 5);
  assert.match(limits.p_subject_hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(quota.options.body, /203\.0\.113\.9/);

  assert.match(insert.url, /\/rest\/v1\/openblog_feedback\?/);
  const row = JSON.parse(insert.options.body);
  const record = fixture.accepted[3].record;
  assert.deepEqual(row, {
    site_id: "lantern",
    format_version: 1,
    kind: "alternative-interpretation",
    work: "/posts/tides/",
    revision: record.provenance.revision,
    target: record.provenance.target,
    body: "Read it as irony.",
    details: {},
    seen_at: null,
    received_at: "2026-10-26T10:00:00Z",
    channel: "hosted",
    reader_name: "Grace",
    publish_name: false,
    status: "pending",
  });
  // Never through the comments table, whose author_name is published.
  assert.ok(database.requests.every((request) => !request.url.includes("openblog_comments")));
  assert.equal(Object.hasOwn(row, "author_name"), false);
});

test("the reader cannot set the time, status, channel or anything about themselves", async () => {
  const handler = createHandler({ env: enabled, fetchImpl: noFetch, siteFetchImpl: noFetch });
  const base = JSON.parse(submission());
  for (const extra of [{ receivedAt: "2020-01-01T00:00:00Z" }, { status: "approved" }, { channel: "manual" }, { email: "ada@example.org" }, { ip: "203.0.113.9" }]) {
    const response = await handler(event("feedback", "POST", JSON.stringify({ ...base, ...extra })));
    assert.equal(response.statusCode, 422);
    assert.equal(JSON.parse(response.body).code, "malformed");
  }
  // A reader clock running ahead is dropped rather than stored.
  const database = fakeDatabase();
  const ahead = createHandler({ env: enabled, fetchImpl: database.fetchImpl, siteFetchImpl: sitePolicy("open"), now: () => NOW });
  const response = await ahead(event("feedback", "POST", JSON.stringify({ ...base, seenAt: "2026-10-26T10:00:01Z" })));
  assert.equal(response.statusCode, 202);
  assert.equal(JSON.parse(database.requests.at(-1).options.body).seen_at, null);
});

test("every refused fixture is refused before the site or Supabase is asked, with the shared code", async () => {
  const handler = createHandler({ env: enabled, fetchImpl: noFetch, siteFetchImpl: noFetch });
  for (const item of fixture.refused) {
    const response = await handler(event("feedback", "POST", textOf(item)));
    assert.equal(response.statusCode, 422, item.name);
    const body = JSON.parse(response.body);
    assert.equal(body.code, item.code, item.name);
    assert.equal(body.target, item.target, item.name);
  }
  const huge = await handler(event("feedback", "POST", `{"pad":"${"a".repeat(40000)}"}`));
  assert.equal(huge.statusCode, 413);
  const encoded = await handler({ ...event("feedback", "POST", Buffer.from(submission().replace('"start":27', '"start":27.0')).toString("base64")), isBase64Encoded: true });
  assert.equal(JSON.parse(encoded.body).target, "malformed");
});

test("a reader time in year 0000 is refused before the quota or Postgres, which cannot store it", async () => {
  const handler = createHandler({ env: enabled, fetchImpl: noFetch, siteFetchImpl: noFetch, now: () => NOW });
  const value = JSON.parse(submission());
  value.seenAt = "0000-01-01T00:00:00Z";
  const response = await handler(event("feedback", "POST", JSON.stringify(value)));
  assert.equal(response.statusCode, 422);
  assert.equal(JSON.parse(response.body).code, "invalidTime");
  // The first year storage holds is still accepted.
  const database = fakeDatabase();
  const accepting = createHandler({ env: enabled, fetchImpl: database.fetchImpl, siteFetchImpl: sitePolicy("open"), now: () => NOW });
  value.seenAt = "0001-01-01T00:00:00Z";
  assert.equal((await accepting(event("feedback", "POST", JSON.stringify(value)))).statusCode, 202);
});

test("hostile text is stored as data and never echoed", async () => {
  const database = fakeDatabase();
  const handler = createHandler({ env: enabled, fetchImpl: database.fetchImpl, siteFetchImpl: sitePolicy("open"), now: () => NOW });
  const hostile = { ...JSON.parse(submission()), body: "<script>alert(1)</script> ' OR 1=1 --", attribution: { name: "<img src=x onerror=alert(1)>", publishName: false } };
  const response = await handler(event("feedback", "POST", JSON.stringify(hostile)));
  assert.equal(response.statusCode, 202);
  assert.doesNotMatch(response.body, /script|onerror/);
  const row = JSON.parse(database.requests.at(-1).options.body);
  assert.equal(row.body, hostile.body);
  assert.equal(row.reader_name, hostile.attribution.name);
  const refused = await handler(event("feedback", "POST", JSON.stringify({ ...hostile, body: "evil ‮ txt" })));
  assert.doesNotMatch(refused.body, /evil/);
});

test("the published feedback policy is enforced on the server", async () => {
  for (const [policy, status, code] of [["locked", 403, "closed"], ["hidden", 403, "unavailable"], ["nonsense", 403, "unavailable"]]) {
    const handler = createHandler({ env: enabled, fetchImpl: noFetch, siteFetchImpl: sitePolicy(policy) });
    const response = await handler(event("feedback", "POST", submission()));
    assert.equal(response.statusCode, status, policy);
    assert.equal(JSON.parse(response.body).code, code, policy);
  }
  // A site that does not publish the manifest (feedback off in openblog.json) accepts nothing.
  const missing = createHandler({ env: enabled, fetchImpl: noFetch, siteFetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  assert.equal((await missing(event("feedback", "POST", submission()))).statusCode, 403);
  // Another post is not open just because one is.
  const other = createHandler({ env: enabled, fetchImpl: noFetch, siteFetchImpl: sitePolicy("open") });
  const elsewhere = JSON.stringify({ ...JSON.parse(submission()), work: "/posts/other/" });
  assert.equal((await other(event("feedback", "POST", elsewhere))).statusCode, 403);
  // The manifest is read below the site's base path.
  let requested = "";
  const based = createHandler({
    env: { ...enabled, OPENBLOG_SITE_BASE_PATH: "/journal/" },
    fetchImpl: noFetch,
    siteFetchImpl: async (url) => {
      requested = url;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  await based(event("feedback", "POST", submission()));
  assert.equal(requested, "https://blog.example/journal/openblog-feedback.json");
});

test("the existing quota stops a submission before it is stored, and a replay counts again", async () => {
  const limited = fakeDatabase({ quota: { allowed: false } });
  const handler = createHandler({ env: enabled, fetchImpl: limited.fetchImpl, siteFetchImpl: sitePolicy("open") });
  const response = await handler(event("feedback", "POST", submission()));
  assert.equal(response.statusCode, 429);
  assert.equal(JSON.parse(response.body).code, "rateLimited");
  assert.equal(limited.requests.length, 1);

  const database = fakeDatabase();
  const replaying = createHandler({ env: enabled, fetchImpl: database.fetchImpl, siteFetchImpl: sitePolicy("open") });
  await replaying(event("feedback", "POST", submission()));
  await replaying(event("feedback", "POST", submission()));
  assert.equal(database.requests.filter((request) => request.url.includes("openblog_consume_rate_limit")).length, 2);
  assert.ok(database.requests.filter((request) => request.url.includes("openblog_feedback")).every((request) => JSON.parse(request.options.body).status === "pending"));
});

test("submissions need the site's origin; preflight allows only it", async () => {
  const handler = createHandler({ env: enabled, fetchImpl: noFetch, siteFetchImpl: noFetch });
  const foreign = await handler(event("feedback", "POST", submission(), { headers: { origin: "https://evil.example" } }));
  assert.equal(foreign.statusCode, 403);
  const missing = await handler({ ...event("feedback", "POST", submission()), headers: {} });
  assert.equal(missing.statusCode, 403);
  const preflight = await handler(event("feedback", "OPTIONS"));
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["Access-Control-Allow-Origin"], "https://blog.example");
  assert.equal((await handler(event("feedback", "OPTIONS", undefined, { headers: { origin: "https://evil.example" } }))).statusCode, 403);
});

test("moderation needs the server-held token and returns the record the build reads", async () => {
  const database = fakeDatabase({ rows: [fixture.storedRow] });
  const handler = createHandler({ env: enabled, fetchImpl: database.fetchImpl, siteFetchImpl: noFetch, now: () => NOW });
  for (const authorization of [undefined, "Bearer admin-secreT", "Bearer admin-secret-longer", "admin-secret ", "Bearer "]) {
    const denied = await handler(event("admin/feedback", "GET", undefined, { headers: authorization ? { authorization } : {} }));
    assert.equal(denied.statusCode, 401, String(authorization));
    const change = await handler(event("admin/feedback", "PATCH", JSON.stringify({ id: fixture.storedRow.id, status: "approved" }), { headers: authorization ? { authorization } : {} }));
    assert.equal(change.statusCode, 401, String(authorization));
  }
  assert.equal(database.requests.length, 0);

  const admin = { authorization: "Bearer admin-secret" };
  const listed = await handler(event("admin/feedback", "GET", undefined, { headers: admin, query: { status: "pending", kind: "source-suggestion" } }));
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(JSON.parse(listed.body), { feedback: [fixture.hostedItem] });
  const url = new URL(database.requests.at(-1).url);
  assert.equal(url.searchParams.get("site_id"), "eq.lantern");
  assert.equal(url.searchParams.get("status"), "eq.pending");
  assert.equal(url.searchParams.get("kind"), "eq.source-suggestion");
  for (const status of ["approved", "rejected", "bogus"]) {
    await handler(event("admin/feedback", "GET", undefined, { headers: admin, query: { status } }));
    assert.equal(new URL(database.requests.at(-1).url).searchParams.get("status"), `eq.${status === "bogus" ? "pending" : status}`);
  }
  assert.equal((await handler(event("admin/feedback", "GET", undefined, { headers: admin, query: { kind: "constructor" } }))).statusCode, 422);

  for (const status of ["approved", "rejected"]) {
    const changed = await handler(event("admin/feedback", "PATCH", JSON.stringify({ id: fixture.storedRow.id, status }), { headers: admin }));
    assert.equal(changed.statusCode, 200);
    const request = database.requests.at(-1);
    assert.match(request.url, /openblog_feedback\?id=eq\.00000000-0000-4000-8000-000000000001&site_id=eq\.lantern$/);
    assert.deepEqual(JSON.parse(request.options.body), { status, moderated_at: "2026-10-26T10:00:00Z" });
  }
  for (const change of [{ id: "1; drop table", status: "approved" }, { id: fixture.storedRow.id, status: "pending" }, { id: fixture.storedRow.id, status: "removed" }]) {
    assert.equal((await handler(event("admin/feedback", "PATCH", JSON.stringify(change), { headers: admin }))).statusCode, 422);
  }
});

test("provider failures are reported without detail and change nothing else", async () => {
  const failing = createHandler({
    env: enabled,
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ message: "relation openblog_feedback does not exist", hint: "sb_secret_test_server_only" }) }),
    siteFetchImpl: sitePolicy("open"),
  });
  const response = await failing(event("feedback", "POST", submission()));
  assert.equal(response.statusCode, 502);
  assert.doesNotMatch(response.body, /relation|sb_secret|openblog_feedback/);
  const unreachable = createHandler({ env: enabled, fetchImpl: noFetch, siteFetchImpl: async () => { throw new Error("connect ECONNREFUSED 10.0.0.1"); } });
  const down = await unreachable(event("feedback", "POST", submission()));
  assert.equal(down.statusCode, 502);
  assert.doesNotMatch(down.body, /ECONNREFUSED|10\.0\.0\.1/);
});

// The SQL the function relies on: an additive, private table whose columns
// match what the function writes and reads, and a rollback that touches
// nothing else.
const columns = (() => {
  const body = migration.slice(migration.indexOf("create table if not exists public.openblog_feedback ("), migration.indexOf("\n);"));
  return new Set(body.split("\n").slice(1).map((line) => line.trim().match(/^([a-z_]+) (?:uuid|text|integer|jsonb|timestamptz|boolean)\b/)?.[1]).filter(Boolean));
})();

test("the migration is additive, private, and matches what the function writes and reads", async () => {
  const database = fakeDatabase();
  const handler = createHandler({ env: enabled, fetchImpl: database.fetchImpl, siteFetchImpl: sitePolicy("open"), now: () => NOW });
  await handler(event("feedback", "POST", submission(1)));
  const written = Object.keys(JSON.parse(database.requests.at(-1).options.body));
  for (const column of written) assert.ok(columns.has(column), `missing column ${column}`);
  for (const column of Object.keys(fixture.storedRow)) assert.ok(columns.has(column), `missing column ${column}`);

  const statements = migration.replace(/--[^\n]*/g, "").toLowerCase();
  for (const forbidden of [/\balter\s+table\s+(?!public\.openblog_feedback\b)/, /\bdrop\b/, /\brename\b/, /\bupdate\s+public\./, /\bdelete\s+from\b/, /\btruncate\b/, /openblog_comments/, /create\s+or\s+replace\s+function/]) {
    assert.doesNotMatch(statements, forbidden);
  }
  assert.match(statements, /create table if not exists public\.openblog_feedback/);
  assert.match(statements, /alter table public\.openblog_feedback enable row level security/);
  // service_role is revoked too, so Supabase's default DELETE and TRUNCATE
  // grants go and only the three operations the function needs remain.
  assert.match(statements, /revoke all on public\.openblog_feedback from public, anon, authenticated, service_role;\s*grant select, insert, update on public\.openblog_feedback to service_role;/);
  assert.doesNotMatch(statements, /grant[^;]*\b(anon|authenticated)\b/);
  assert.doesNotMatch(statements, /create policy/);
  // Pending by default; the reader's name is a separate, optional column.
  assert.match(statements, /status text not null default 'pending'/);
  assert.match(statements, /reader_name text check/);
  assert.match(statements, /publish_name boolean not null default false/);
  // Fresh installs without the feature are unchanged.
  assert.doesNotMatch(baseSchema, /openblog_feedback/);

  const undo = rollback.replace(/--[^\n]*/g, "").toLowerCase();
  assert.deepEqual(undo.match(/\bdrop\b[^;]*;/g), ["drop table if exists public.openblog_feedback;"]);
  assert.doesNotMatch(undo, /openblog_comments|openblog_rate_limits|openblog_daily/);
});
