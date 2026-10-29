// The LinkedIn Posts adapter of optional social publishing (epic #353, story #358, ADR 0490),
// against a scripted provider only.
import test from "node:test";
import assert from "node:assert/strict";
import { createPublisher, escapeLinkedInCommentary } from "../../netlify/lib/social-publish.mjs";
import { LI_TOKEN, post, providers, scripted } from "./social-publish-fakes.mjs";

const URN = "urn:li:share:7123456789012345678";
const CREATED = { status: 201, headers: { "x-restli-id": URN } };
const run = async (reply, input = post(), overrides) => {
  const fake = scripted(reply);
  const publisher = createPublisher({ providers: providers(overrides), fetchImpl: fake.fetchImpl, timeoutMs: 500 });
  return { result: await publisher.publish(input, { accessToken: LI_TOKEN }), calls: fake.calls };
};

test("a 201 with the post URN is published and the URN is kept", async () => {
  const { result, calls } = await run(CREATED);
  assert.equal(result.status, "published");
  assert.equal(result.providerPostId, URN);
  assert.equal(result.retryable, false);
  assert.equal(calls.length, 1);
});

test("the request is the versioned REST Posts call with an article, a bearer token and no obsolete headers", async () => {
  const { calls } = await run(CREATED);
  const [call] = calls;
  assert.equal(call.url, "https://api.linkedin.com/rest/posts");
  assert.equal(call.method, "POST");
  assert.equal(call.redirect, "manual");
  assert.ok(call.hasSignal);
  assert.equal(call.headers.authorization, `Bearer ${LI_TOKEN}`);
  assert.equal(call.headers["linkedin-version"], "202510");
  assert.equal(call.headers["x-restli-protocol-version"], "2.0.0");
  assert.equal(JSON.stringify(call.headers).includes("x-li-format"), false);
  assert.ok(!call.url.includes(LI_TOKEN) && !call.body.includes(LI_TOKEN));
  const body = JSON.parse(call.body);
  assert.equal(body.author, "urn:li:person:abc123");
  assert.equal(body.commentary, "A new post is up.");
  assert.equal(body.visibility, "PUBLIC");
  assert.equal(body.lifecycleState, "PUBLISHED");
  assert.deepEqual(body.content, { article: { source: "https://blog.example.com/posts/hello/", title: "Hello" } });
  assert.equal(body.distribution.feedDistribution, "MAIN_FEED");
});

test("the configured API version is sent, and an organization posts as itself", async () => {
  const { calls } = await run(CREATED, post({ destination: { id: "urn:li:organization:777", kind: "organization" } }), { OPENBLOG_SOCIAL_LINKEDIN_API_VERSION: "202601" });
  assert.equal(calls[0].headers["linkedin-version"], "202601");
  assert.equal(JSON.parse(calls[0].body).author, "urn:li:organization:777");
});

test("caption characters LinkedIn reads as markup are escaped", () => {
  assert.equal(escapeLinkedInCommentary("(beta) | v2 *new* #tag @someone _x_ ~y~ [a] {b} <c> \\"), "\\(beta\\) \\| v2 \\*new\\* \\#tag \\@someone \\_x\\_ \\~y\\~ \\[a\\] \\{b\\} \\<c\\> \\\\");
});

test("a missing title falls back to a fixed one and control characters are stripped from a given one", async () => {
  const none = await run(CREATED, post({ title: undefined }));
  assert.equal(JSON.parse(none.calls[0].body).content.article.title, "Read the full post");
  const messy = await run(CREATED, post({ title: "Line\none\u0007" }));
  assert.equal(JSON.parse(messy.calls[0].body).content.article.title, "Line one");
});

test("a 2xx without a usable post id is unknown, never published", async () => {
  for (const reply of [{ status: 201 }, { status: 201, headers: { "x-restli-id": "garbage" } }, { status: 202, headers: { "x-restli-id": URN } }, { status: 200, body: "not json" }]) {
    const { result } = await run(reply);
    assert.equal(result.status, "unknown", JSON.stringify(reply));
    assert.equal(result.providerPostId, null);
    assert.equal(result.retryable, false);
  }
});

test("a 401 asks for reauthorization, a 403 is a permission problem, neither is retried", async () => {
  const unauthorized = (await run({ status: 401, body: { message: `token ${LI_TOKEN} expired` } })).result;
  assert.deepEqual([unauthorized.status, unauthorized.code, unauthorized.reauth, unauthorized.retryable], ["failed", "auth-rejected", true, false]);
  const forbidden = (await run({ status: 403, body: { message: "ACCESS_DENIED" } })).result;
  assert.deepEqual([forbidden.status, forbidden.code, forbidden.reauth, forbidden.retryable], ["failed", "permission-denied", false, false]);
});

test("a 429 is a retryable failure with a bounded wait", async () => {
  const slow = (await run({ status: 429, headers: { "retry-after": "120" } })).result;
  assert.deepEqual([slow.status, slow.code, slow.retryable, slow.retryAfterSeconds], ["failed", "throttled", true, 120]);
  assert.equal((await run({ status: 429, headers: { "retry-after": "999999" } })).result.retryAfterSeconds, 3600);
  assert.equal((await run({ status: 429 })).result.retryAfterSeconds, null);
});

test("a 5xx or a network failure may have posted, so the outcome is unknown and not retried", async () => {
  for (const reply of [{ status: 500 }, { status: 502 }, { status: 503 }, { status: 504 }, new Error(`socket hang up ${LI_TOKEN}`), new DOMException("timed out", "TimeoutError")]) {
    const { result } = await run(reply);
    assert.equal(result.status, "unknown");
    assert.equal(result.retryable, false);
    assert.ok(!JSON.stringify(result).includes(LI_TOKEN));
  }
});

test("a validation refusal is a final failure and a redirect is never followed", async () => {
  for (const status of [400, 422]) {
    const { result } = await run({ status, body: { message: "Content is duplicate" } });
    assert.deepEqual([result.status, result.code, result.retryable], ["failed", "request-rejected", false]);
  }
  assert.equal((await run({ status: 302, headers: { location: "https://evil.example/" } })).result.code, "provider-unexpected");
});

test("invalid input is refused before any request", async () => {
  const bad = [
    post({ destination: { id: "urn:li:person:../x" } }),
    post({ destination: { id: "urn:li:person:abc123", kind: "page" } }),
    post({ destination: null }),
    post({ caption: "   " }),
    post({ caption: "bad‮text" }),
    post({ caption: "x".repeat(3001) }),
    post({ url: "http://blog.example.com/p/" }),
    post({ url: "https://user:pw@blog.example.com/p/" }),
    post({ url: "not a url" }),
  ];
  for (const input of bad) {
    const { result, calls } = await run(CREATED, input);
    assert.equal(result.code, "invalid-post", JSON.stringify(input));
    assert.equal(calls.length, 0);
  }
});

test("a missing or odd token is refused before any request and asks for reauthorization", async () => {
  const fake = scripted({ status: 201 });
  const publisher = createPublisher({ providers: providers(), fetchImpl: fake.fetchImpl });
  for (const credentials of [null, {}, { accessToken: "" }, { accessToken: "has space token" }, { accessToken: "line\nbreak-token" }]) {
    const result = await publisher.publish(post(), credentials);
    assert.deepEqual([result.status, result.code, result.reauth], ["failed", "no-credentials", true]);
  }
  assert.equal(fake.calls.length, 0);
});

test("no provider text or token reaches a result", async () => {
  const { result } = await run({ status: 403, body: { message: `secret ${LI_TOKEN} <script>alert(1)</script>`, serviceErrorCode: 100 } });
  const text = JSON.stringify(result);
  assert.ok(!text.includes(LI_TOKEN) && !text.includes("script") && !text.includes("secret"));
});

test("a provider that is not configured fails explicitly", async () => {
  const publisher = createPublisher({ providers: {}, fetchImpl: async () => assert.fail("no request") });
  assert.equal((await publisher.publish(post(), { accessToken: LI_TOKEN })).code, "provider-not-configured");
});
