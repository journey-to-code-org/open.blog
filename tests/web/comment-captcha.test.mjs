import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../../netlify/functions/engagement.mjs";
import { issuePass, validPass, verifyCaptcha } from "../../netlify/lib/comment-captcha.mjs";

const secret = "test-signing-value-".repeat(3);
const time = new Date("2026-10-29T12:00:00Z");
const env = { SUPABASE_URL: "https://db.example", SUPABASE_SECRET_KEY: "private-database-key", OPENBLOG_SITE_ID: "site", OPENBLOG_SITE_ORIGIN: "https://blog.example", OPENBLOG_ADMIN_API_KEY: "admin", OPENBLOG_ANALYTICS_SALT: "salt", OPENBLOG_CAPTCHA_ENABLED: "true", OPENBLOG_TURNSTILE_SECRET: "private-provider-key", OPENBLOG_CAPTCHA_PASS_SECRET: secret };
const event = (extra = {}) => ({ path: "/api/comments", httpMethod: "POST", headers: { origin: env.OPENBLOG_SITE_ORIGIN }, body: JSON.stringify({ path: "/post/", authorName: "Reader", body: "My draft", ...extra }) });

test("passes reject forgery, expiry, wrong sites and malformed values", () => {
  const { pass } = issuePass("site", secret, time);
  assert.ok(validPass(pass, "site", secret, time));
  for (const invalid of [null, {}, "x", pass + ".extra", "x" + pass, pass.slice(0, -2), "a".repeat(3000)]) assert.equal(validPass(invalid, "site", secret, time), false);
  assert.equal(validPass(pass, "other", secret, time), false);
  assert.equal(validPass(pass, "site", "wrong", time), false);
  assert.equal(validPass(pass, "site", secret, new Date(time.getTime() + 1800000)), false);
});

test("provider verifies hostname/action and fails closed without leaking errors", async () => {
  for (const result of [{ success: false }, { success: true, hostname: "evil.example", action: "comment" }, { success: true, hostname: "blog.example", action: "other" }, null]) {
    assert.equal(await verifyCaptcha({ provider: "turnstile", token: "token", secret, hostname: "blog.example", fetchImpl: async () => ({ ok: true, json: async () => result }) }), false);
  }
  assert.equal(await verifyCaptcha({ provider: "turnstile", token: "token", secret, hostname: "blog.example", fetchImpl: async () => { throw Error(secret); } }), false);
});

test("handler requires captcha before storage, exchanges once, and quotas every comment", async () => {
  const requests = [];
  let allowed = true, success = true;
  const handler = createHandler({ env, now: () => time, siteFetchImpl: async () => ({ ok: true, json: async () => ({ "/post/": "open" }) }), fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (url.includes("siteverify")) return { ok: true, json: async () => ({ success, hostname: "blog.example", action: "comment" }) };
    return { ok: true, json: async () => url.includes("consume_rate_limit") ? { allowed } : [{ id: "id" }] };
  } });
  const absent = await handler(event());
  assert.equal(JSON.parse(absent.body).code, "captcha_required");
  assert.equal(requests.some(({ url }) => url.includes("openblog_comments")), false);
  assert.equal(requests.some(({ url }) => url.includes("siteverify")), false);
  const verified = await handler(event({ captchaToken: "valid-token" }));
  assert.equal(verified.statusCode, 202);
  const session = JSON.parse(verified.body).captchaSession;
  assert.ok(session.pass);
  assert.equal(session.expiresAt, time.getTime() / 1000 + 1800);
  assert.doesNotMatch(verified.body, /private-provider-key|private-database-key|test-signing-value/);
  requests.length = 0;
  assert.equal((await handler(event({ captchaPass: session.pass }))).statusCode, 202);
  assert.equal(requests.some(({ url }) => url.includes("siteverify")), false);
  assert.deepEqual(requests.filter(({ url }) => url.includes("consume_rate_limit")).map(({ options }) => JSON.parse(options.body).p_bucket), ["comments"]);
  requests.length = 0;
  success = false;
  assert.equal((await handler(event({ captchaToken: "bad" }))).statusCode, 403);
  assert.equal(requests.some(({ url }) => url.includes("openblog_comments")), false);
  allowed = false;
  requests.length = 0;
  assert.equal((await handler(event({ captchaToken: "bad" }))).statusCode, 429);
  assert.equal(requests.some(({ url }) => url.includes("siteverify")), false);
  assert.equal((await handler(event({ captchaPass: session.pass }))).statusCode, 429);
});

test("enabled captcha refuses missing secrets before network calls", async () => {
  for (const missing of ["OPENBLOG_TURNSTILE_SECRET", "OPENBLOG_CAPTCHA_PASS_SECRET"]) {
    const handler = createHandler({ env: { ...env, [missing]: "" }, siteFetchImpl: async () => ({ ok: true, json: async () => ({ "/post/": "open" }) }), fetchImpl: async () => assert.fail("no storage or provider calls") });
    assert.equal((await handler(event())).statusCode, 503);
  }
});
