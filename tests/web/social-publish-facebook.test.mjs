// The Facebook Page feed adapter of optional social publishing (epic #353, story #358, ADR 0491),
// against a scripted provider only.
import test from "node:test";
import assert from "node:assert/strict";
import { createPublisher } from "../../netlify/lib/social-publish.mjs";
import { PAGE_TOKEN, post, providers, scripted } from "./social-publish-fakes.mjs";

const PAGE = "10987654321";
const POST_ID = `${PAGE}_55512345678`;
const page = (overrides = {}) => post({ provider: "facebook", destination: { id: PAGE, kind: "page" }, ...overrides });
const error = (code, status = 400, extra = {}) => ({ status, body: { error: { message: `Bad token ${PAGE_TOKEN}`, type: "OAuthException", code, ...extra } } });
const run = async (reply, input = page(), overrides) => {
  const fake = scripted(reply);
  const publisher = createPublisher({ providers: providers(overrides), fetchImpl: fake.fetchImpl, timeoutMs: 500 });
  return { result: await publisher.publish(input, { accessToken: PAGE_TOKEN }), calls: fake.calls };
};

test("a 200 with the Page post id is published and the id is kept", async () => {
  const { result, calls } = await run({ status: 200, body: { id: POST_ID } });
  assert.equal(result.status, "published");
  assert.equal(result.providerPostId, POST_ID);
  assert.equal(calls.length, 1);
});

test("the request posts message and link to the Page feed with the token only in the header", async () => {
  const { calls } = await run({ status: 200, body: { id: POST_ID } });
  const [call] = calls;
  assert.equal(call.url, `https://graph.facebook.com/v23.0/${PAGE}/feed`);
  assert.equal(call.method, "POST");
  assert.equal(call.redirect, "manual");
  assert.equal(call.headers.authorization, `Bearer ${PAGE_TOKEN}`);
  assert.ok(!call.url.includes(PAGE_TOKEN) && !call.body.includes(PAGE_TOKEN));
  const form = new URLSearchParams(call.body);
  assert.equal(form.get("message"), "A new post is up.");
  assert.equal(form.get("link"), "https://blog.example.com/posts/hello/");
  assert.equal(form.has("access_token"), false);
});

test("the configured Graph version is used", async () => {
  const { calls } = await run({ status: 200, body: { id: POST_ID } }, page(), { OPENBLOG_SOCIAL_FACEBOOK_API_VERSION: "v24.0" });
  assert.ok(calls[0].url.startsWith("https://graph.facebook.com/v24.0/"));
});

test("a 2xx without a well-formed id for this Page is unknown, never published", async () => {
  for (const reply of [{ status: 200, body: {} }, { status: 200, body: { id: "123" } }, { status: 200, body: { id: "99999_1" } }, { status: 200, body: { id: ["x"] } }, { status: 200, body: "nope" }, { status: 200 }, { status: 201, body: { id: POST_ID } }]) {
    const { result } = await run(reply);
    assert.equal(result.status, "unknown", JSON.stringify(reply));
    assert.equal(result.providerPostId, null);
    assert.equal(result.retryable, false);
  }
});

test("an expired or invalid token (code 190, even on a 400) asks for reauthorization", async () => {
  for (const reply of [error(190), error(102), { status: 401 }]) {
    const { result } = await run(reply);
    assert.deepEqual([result.status, result.code, result.reauth, result.retryable], ["failed", "auth-rejected", true, false]);
  }
});

test("a permission or role problem is a final failure", async () => {
  for (const reply of [error(10), error(200), error(299), { status: 403 }]) {
    const { result } = await run(reply);
    assert.deepEqual([result.status, result.code, result.reauth, result.retryable], ["failed", "permission-denied", false, false]);
  }
});

test("rate limits are retryable failures, with a bounded wait", async () => {
  for (const reply of [error(4), error(17), error(32), error(613), { status: 429, headers: { "retry-after": "30" } }]) {
    const { result } = await run(reply);
    assert.deepEqual([result.status, result.code, result.retryable], ["failed", "throttled", true]);
  }
  assert.equal((await run({ ...error(4), headers: { "retry-after": "90000" } })).result.retryAfterSeconds, 3600);
});

test("an unknown Graph error or a server error may have posted, so it is unknown and not retried", async () => {
  for (const reply of [error(1, 500), error(2, 500), { status: 500 }, { status: 503 }, new Error(`reset ${PAGE_TOKEN}`), new DOMException("timed out", "TimeoutError")]) {
    const { result } = await run(reply);
    assert.deepEqual([result.status, result.retryable], ["unknown", false]);
    assert.ok(!JSON.stringify(result).includes(PAGE_TOKEN));
  }
});

test("any other refusal is a final failure", async () => {
  const { result } = await run(error(100, 400, { error_subcode: 2061006 }));
  assert.deepEqual([result.status, result.code, result.retryable], ["failed", "request-rejected", false]);
});

test("invalid input is refused before any request", async () => {
  const bad = [
    page({ destination: { id: "../me" } }),
    page({ destination: { id: PAGE, kind: "member" } }),
    page({ destination: { id: "urn:li:person:abc123" } }),
    page({ caption: "" }),
    page({ caption: "nul\u0000" }),
    page({ url: "javascript:alert(1)" }),
    page({ url: "http://blog.example.com/p/" }),
  ];
  for (const input of bad) {
    const { result, calls } = await run({ status: 200, body: { id: POST_ID } }, input);
    assert.equal(result.code, "invalid-post", JSON.stringify(input));
    assert.equal(calls.length, 0);
  }
});

test("no Facebook text or token reaches a result", async () => {
  const { result } = await run(error(190, 400, { fbtrace_id: "TRACE123" }));
  const text = JSON.stringify(result);
  assert.ok(!text.includes(PAGE_TOKEN) && !text.includes("OAuthException") && !text.includes("TRACE123"));
});
