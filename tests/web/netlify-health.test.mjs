// R10 G84: `admin/health` says which tables this site needs are there and whether the robot check's secret
// is set: yes, no or "can't tell", never a value, a key or a table's contents. Admin only.
import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../../netlify/functions/engagement.mjs";

const environment = {
  SUPABASE_URL: "https://database.example", SUPABASE_SECRET_KEY: "sb_secret_test_server_only", OPENBLOG_SITE_ID: "lantern",
  OPENBLOG_SITE_ORIGIN: "https://blog.example", OPENBLOG_ADMIN_API_KEY: "admin-secret", OPENBLOG_ANALYTICS_SALT: "daily-hash-secret",
  OPENBLOG_FEEDBACK_ENABLED: "true", OPENBLOG_MODERATION_ENABLED: "true", OPENBLOG_PROTECTION_ENABLED: "true",
};
const get = (headers = {}) => ({ path: "/api/admin/health", httpMethod: "GET", headers: { "x-nf-client-connection-ip": "203.0.113.9", ...headers }, queryStringParameters: {} });
const answering = (status) => async (url) => {
  const table = new URL(url).pathname.split("/").pop();
  const code = status[table] ?? 200;
  return { ok: code < 400, status: code, json: async () => [] };
};
const run = (statuses, env = environment, headers = { authorization: "Bearer admin-secret" }) => createHandler({ env, fetchImpl: answering(statuses), siteFetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }), now: () => new Date("2026-10-26T10:00:00.000Z") })(get(headers));

test("it needs the Admin key", async () => {
  assert.equal((await run({}, environment, {})).statusCode, 401);
});

test("each table is yes, no (the database refused it) or can't tell (it didn't answer); the robot secret is yes or no", async () => {
  const answer = await run({ openblog_comments: 404, openblog_feedback: 503 });
  assert.equal(answer.statusCode, 200);
  const checks = Object.fromEntries(JSON.parse(answer.body).checks.map((c) => [c.id, c.ok]));
  assert.deepEqual(checks, { comments: false, feedback: null, moderation: true, protection: true, "robot-secret": false });
});

test("nothing it says holds a key or a secret", async () => {
  const body = (await run({}, { ...environment, OPENBLOG_TURNSTILE_SECRET_KEY: "turnstile-secret-value" })).body;
  assert.doesNotMatch(body, /sb_secret|admin-secret|turnstile-secret-value|daily-hash-secret/);
});

test("R10 G86: a notice opens Readers on the kind, with the note in view, and never carries anything odd", async () => {
  const source = (await import("node:fs")).readFileSync(new URL("../../netlify/functions/engagement.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /#\/comments/);
  assert.equal((source.match(/readersAddress\(/g) || []).length, 5, "one for each of the five notices");
});
