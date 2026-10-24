import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../../netlify/functions/engagement.mjs";

const environment = {
  SUPABASE_URL: "https://database.example",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
  OPENBLOG_SITE_ID: "lantern",
  OPENBLOG_SITE_ORIGIN: "https://blog.example",
  OPENBLOG_ADMIN_API_KEY: "admin-secret",
  OPENBLOG_ANALYTICS_SALT: "daily-hash-secret",
};

const event = (path, method = "GET", body, extra = {}) => ({
  path: `/api/${path}`,
  httpMethod: method,
  headers: { origin: "https://blog.example", ...extra.headers },
  queryStringParameters: extra.query || {},
  body: body === undefined ? undefined : JSON.stringify(body),
});

test("comments are pending, public reads are approved-only, and secrets never cross the seam", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    let value;
    if (url.includes("openblog_consume_rate_limit")) value = { allowed: true };
    else if (options.method === "POST") value = [{ id: "00000000-0000-0000-0000-000000000001", status: "pending", created_at: "2026-10-24T12:00:00Z" }];
    else value = [{ id: "approved", author_name: "Mira", body: "A useful thought.", created_at: "2026-10-24T12:00:00Z" }];
    return { ok: true, status: 200, json: async () => value };
  };
  const handler = createHandler({ env: environment, fetchImpl });
  const created = await handler(event("comments", "POST", { path: "/story/", authorName: "Mira", body: "A useful thought." }));
  assert.equal(created.statusCode, 202);
  assert.equal(JSON.parse(created.body).status, "pending");
  assert.match(requests.find((request) => request.url.includes("openblog_comments")).options.body, /"status":"pending"/);
  assert.doesNotMatch(created.body, /service-secret|admin-secret/);

  const listed = await handler(event("comments", "GET", undefined, { query: { path: "/story/" } }));
  assert.equal(listed.statusCode, 200);
  assert.match(requests.at(-1).url, /status=eq\.approved/);
  assert.deepEqual(JSON.parse(listed.body).comments[0], {
    id: "approved", authorName: "Mira", body: "A useful thought.", createdAt: "2026-10-24T12:00:00Z",
  });
});

test("mutations enforce origin and moderation enforces a bearer token", async () => {
  const handler = createHandler({ env: environment, fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }) });
  const foreign = await handler({ ...event("comments", "POST", { path: "/story/", authorName: "Mira", body: "Hi" }), headers: { origin: "https://evil.example" } });
  assert.equal(foreign.statusCode, 403);
  const denied = await handler(event("admin/comments", "GET", undefined, { query: { status: "pending" } }));
  assert.equal(denied.statusCode, 401);
  const allowed = await handler({ ...event("admin/comments", "GET", undefined, { query: { status: "pending" } }), headers: { origin: "https://blog.example", authorization: "Bearer admin-secret" } });
  assert.equal(allowed.statusCode, 200);
  const analytics = await handler({ ...event("admin/analytics", "GET"), headers: { authorization: "Bearer admin-secret" } });
  assert.equal(analytics.statusCode, 200);
});

test("analytics uses a date-scoped hash and never sends raw client identity to Supabase", async () => {
  let request;
  const handler = createHandler({
    env: environment,
    now: () => new Date("2026-10-24T14:00:00Z"),
    fetchImpl: async (url, options) => {
      if (url.includes("openblog_consume_rate_limit")) {
        return { ok: true, status: 200, json: async () => ({ allowed: true }) };
      }
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ views: 7 }) };
    },
  });
  const response = await handler(event("hit", "POST", { path: "/story/", referrer: "https://search.example/results?q=x" }, {
    headers: { "x-nf-client-connection-ip": "203.0.113.5", "user-agent": "Reader Browser" },
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).views, 7);
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.p_day, "2026-10-24");
  assert.equal(payload.p_referrer, "search.example");
  assert.match(payload.p_visitor_hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(request.options.body, /203\.0\.113\.5|Reader Browser|daily-hash-secret/);

  const optedOut = await handler(event("hit", "POST", { path: "/story/" }, { headers: { dnt: "1" } }));
  assert.equal(optedOut.statusCode, 204);
  assert.equal(optedOut.body, "");
});

test("public writes stop before content storage when the server-side quota is exhausted", async () => {
  const requests = [];
  const handler = createHandler({
    env: environment,
    fetchImpl: async (url) => {
      requests.push(url);
      return { ok: true, status: 200, json: async () => ({ allowed: false }) };
    },
  });
  const response = await handler(event("comments", "POST", { path: "/story/", authorName: "Mira", body: "Hi" }));
  assert.equal(response.statusCode, 429);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /openblog_consume_rate_limit/);
});

test("missing environment and malformed public input fail closed", async () => {
  const missing = await createHandler({ env: {}, fetchImpl: async () => assert.fail("must not fetch") })(event("comments"));
  assert.equal(missing.statusCode, 503);
  const handler = createHandler({ env: environment, fetchImpl: async () => assert.fail("must not fetch") });
  assert.equal((await handler(event("comments", "POST", { path: "bad", authorName: "", body: "" }))).statusCode, 422);
  assert.equal((await handler(event("views", "GET", undefined, { query: { path: "../secret" } }))).statusCode, 400);
});

test("international post paths are accepted without allowing traversal", async () => {
  let called = false;
  const handler = createHandler({
    env: environment,
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ views: 1 }) };
    },
  });
  assert.equal((await handler(event("views", "GET", undefined, { query: { path: "/旅の日記/" } }))).statusCode, 200);
  assert.equal(called, true);
  assert.equal((await handler(event("views", "GET", undefined, { query: { path: "/safe/../secret/" } }))).statusCode, 400);
});
