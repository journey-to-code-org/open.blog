// Contract tests for the social publishing adapters (epic #353, story #358, ADR 0492): the same
// fixture of provider replies is run through both adapters, every outcome is checked against the
// publish-result contract the worker relies on, unsupported networks are refused, and no secret
// can leak. Scripted providers only; no real network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPublisher, PUBLISH_MESSAGES } from "../../netlify/lib/social-publish.mjs";
import { post, providers, scripted } from "./social-publish-fakes.mjs";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/social-publish.json", import.meta.url), "utf8"));
const TOKEN = fixture.token;
const DESTINATIONS = { linkedin: { id: "urn:li:person:abc123", kind: "member" }, facebook: { id: "10987654321", kind: "page" } };
const FIELDS = ["status", "providerPostId", "retryable", "code", "message", "httpStatus", "reauth", "retryAfterSeconds"];

const replyFor = (reply) => {
  if (reply.fail === "network") return new TypeError(`fetch failed for ${TOKEN}`);
  if (reply.fail === "timeout") return new DOMException(`The operation timed out ${TOKEN}`, "TimeoutError");
  return reply;
};

const run = async (provider, reply, input = {}) => {
  const fake = scripted(replyFor(reply));
  const publisher = createPublisher({ providers: providers(), fetchImpl: fake.fetchImpl, timeoutMs: 500 });
  const result = await publisher.publish(post({ provider, destination: DESTINATIONS[provider], ...input }), { accessToken: TOKEN });
  return { result, calls: fake.calls };
};

for (const entry of fixture.cases) {
  test(`${entry.provider}: ${entry.name}`, async () => {
    const { result, calls } = await run(entry.provider, entry.reply);
    for (const [key, value] of Object.entries(entry.expect)) assert.deepEqual(result[key], value, key);
    // The contract the worker depends on.
    assert.deepEqual(Object.keys(result).sort(), [...FIELDS].sort());
    assert.ok(["published", "failed", "unknown"].includes(result.status));
    assert.equal(calls.length, 1, "exactly one provider call, never a retry inside the adapter");
    assert.equal(result.providerPostId !== null, result.status === "published", "an id exists exactly when published");
    if (result.status === "unknown") assert.equal(result.retryable, false, "an unknown outcome is never retried blindly");
    if (result.retryable) assert.equal(result.status, "failed");
    assert.equal(result.message, PUBLISH_MESSAGES[result.code] ?? "");
    // Secrets and provider text.
    const text = JSON.stringify(result);
    assert.ok(!text.includes(TOKEN), "no token in the result");
    for (const word of ["OAuthException", "fbtrace", "A1b2C3", "serviceErrorCode", "maintenance", "duplicate of", "partnerApi"]) assert.ok(!text.includes(word), word);
    assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(!calls[0].url.includes(TOKEN) && !String(calls[0].body).includes(TOKEN), "the token is only in the header");
    assert.equal(calls[0].redirect, "manual");
    assert.ok(calls[0].hasSignal, "every call has a timeout");
  });
}

test("both adapters only call their own provider host over https", async () => {
  const li = await run("linkedin", { status: 201, headers: { "x-restli-id": "urn:li:share:1" } });
  const fb = await run("facebook", { status: 200, body: { id: "10987654321_1" } });
  assert.equal(new URL(li.calls[0].url).origin, "https://api.linkedin.com");
  assert.equal(new URL(fb.calls[0].url).origin, "https://graph.facebook.com");
});

test("unsupported networks fail explicitly before any request", async () => {
  for (const provider of fixture.unsupported) {
    const fake = scripted({ status: 200, body: { id: "1_1" } });
    const publisher = createPublisher({ providers: providers(), fetchImpl: fake.fetchImpl });
    const result = await publisher.publish(post({ provider }), { accessToken: TOKEN });
    assert.deepEqual([result.status, result.code, result.retryable, result.providerPostId], ["failed", "unsupported-provider", false, null], String(provider));
    assert.equal(fake.calls.length, 0);
  }
  const fake = scripted({ status: 200 });
  const publisher = createPublisher({ providers: providers(), fetchImpl: fake.fetchImpl });
  assert.equal((await publisher.publish(null, { accessToken: TOKEN })).code, "unsupported-provider");
  assert.equal((await publisher.publish(undefined, { accessToken: TOKEN })).code, "unsupported-provider");
});

test("a supported provider with no settings on this server is refused, not guessed", async () => {
  const only = providers({ OPENBLOG_SOCIAL_FACEBOOK_CLIENT_ID: undefined, OPENBLOG_SOCIAL_FACEBOOK_CLIENT_SECRET: undefined });
  const fake = scripted({ status: 200 });
  const publisher = createPublisher({ providers: only, fetchImpl: fake.fetchImpl });
  assert.equal((await publisher.publish(post({ provider: "facebook", destination: DESTINATIONS.facebook }), { accessToken: TOKEN })).code, "provider-not-configured");
  assert.equal(fake.calls.length, 0);
});

test("a caption cannot carry the token or smuggle a second request through the adapter", async () => {
  // The adapter never interpolates a caption into a URL or header.
  const { calls } = await run("facebook", { status: 200, body: { id: "10987654321_1" } }, { caption: "line\nX-Injected: yes & message=other" });
  assert.ok(!calls[0].url.includes("Injected"));
  assert.equal(JSON.stringify(calls[0].headers).includes("Injected"), false);
  assert.equal(new URLSearchParams(calls[0].body).get("message"), "line\nX-Injected: yes & message=other");
});

test("nothing is written to the console, whatever the provider says", async () => {
  const seen = [];
  const originals = {};
  for (const name of ["log", "warn", "error", "info", "debug"]) {
    originals[name] = console[name];
    console[name] = (...args) => seen.push(args.join(" "));
  }
  try {
    for (const entry of fixture.cases) await run(entry.provider, entry.reply);
  } finally {
    Object.assign(console, originals);
  }
  assert.deepEqual(seen, []);
});

test("the adapter module holds no network of its own and no credential setting", () => {
  const source = readFileSync(new URL("../../netlify/lib/social-publish.mjs", import.meta.url), "utf8");
  assert.ok(!/https?:\/\/(?!.*\bexample\b)[a-z0-9.-]+\.[a-z]{2,}/i.test(source.replace(/\/\/.*$/gm, "")), "hosts come from the provider settings");
  assert.ok(!/process\.env|Deno\.env|client_?secret|SERVICE_ROLE/i.test(source));
  assert.ok(!/console\./.test(source));
});
