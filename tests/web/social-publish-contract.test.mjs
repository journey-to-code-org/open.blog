// Contract tests for the social publishing adapters (epic #353, story #358, ADR 0321): the same
// fixture of provider replies is run through both adapters, every outcome is checked against the
// delivery contract the worker relies on (social-delivery.mjs, ADRs 0316 to 0318), unsupported
// networks get no adapter, and no secret can leak. Scripted providers only; no real network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { socialAdapters } from "../../netlify/lib/social-adapters.mjs";
import { DeliveryError, KINDS } from "../../netlify/lib/social-delivery.mjs";
import { allProviders, call, networkFailure, providers, scripted, settle } from "./social-publish-fakes.mjs";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/social-publish.json", import.meta.url), "utf8"));
const TOKEN = fixture.token;
const NOW = Date.parse("2026-11-01T12:00:00Z");
const MESSAGES = new Set(KINDS.map((kind) => new DeliveryError(kind).message));

const replyFor = (reply) => (reply.fail ? networkFailure(reply.fail, TOKEN) : reply);

const run = async (provider, reply, input = {}) => {
  const fake = scripted(replyFor(reply));
  const adapters = socialAdapters({ providers: allProviders(), fetchImpl: fake.fetchImpl, now: () => NOW });
  const args = call(provider, { accessToken: TOKEN, ...input });
  return { ...(await settle(adapters[provider].publish(args))), calls: fake.calls, args };
};

for (const entry of fixture.cases) {
  test(`${entry.provider}: ${entry.name}`, async () => {
    const { value, error, calls, args } = await run(entry.provider, entry.reply);
    if (entry.expect.providerPostId) {
      assert.equal(error, undefined);
      assert.deepEqual(value, { providerPostId: entry.expect.providerPostId }, "a success is exactly the provider's id");
    } else {
      assert.equal(value, undefined, "anything but a confirmed, named success throws");
      assert.ok(error instanceof DeliveryError, "a typed delivery error, never a plain one");
      assert.equal(error.kind, entry.expect.kind);
      assert.equal(error.status, entry.expect.status);
      if ("retryAfterMs" in entry.expect) assert.equal(error.retryAfterMs, entry.expect.retryAfterMs);
      assert.ok(MESSAGES.has(error.message), "the message is fixed text");
      assert.equal(error.requestId, null);
    }
    // The call itself. Bluesky first reads the post's own public page for its card (ADR 0386), and
    // a refusal of the record is checked against the record by a read; neither is a second write.
    const page = calls.filter((c) => c.url === args.post.canonicalUrl);
    for (const c of page) assert.ok(!JSON.stringify(c).includes(TOKEN) && c.method === "GET", "the post's public page is only read, and never gets the token");
    const writes = calls.filter((c) => c.method === "POST");
    assert.equal(writes.length, 1, "exactly one write, never a retry inside the adapter");
    assert.equal(calls.length - page.length - writes.length <= 1, true, "at most one read of the record besides");
    assert.equal(writes[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(!writes[0].url.includes(TOKEN) && !String(writes[0].body).includes(TOKEN), "the token is only in the header");
    assert.equal(writes[0].redirect, "manual");
    assert.equal(writes[0].signal, args.signal, "the worker's signal bounds the call");
    assert.ok(!JSON.stringify(writes[0]).includes(args.post.idempotencyKey), "neither provider honours an idempotency key");
    // Secrets and provider text.
    const text = JSON.stringify({ value, error, message: error?.message, stack: error?.stack });
    assert.ok(!text.includes(TOKEN), "no token in the answer");
    for (const word of ["OAuthException", "fbtrace", "A1b2C3", "serviceErrorCode", "maintenance", "duplicate of", "partnerApi", "ECONNRESET", "graphemes", "Upstream Failure", "Token has expired"]) assert.ok(!text.includes(word), word);
  });
}

test("every adapter only calls its own provider host over https", async () => {
  const li = await run("linkedin", { status: 201, headers: { "x-restli-id": "urn:li:share:1" } });
  const fb = await run("facebook", { status: 200, body: { id: "10987654321_1" } });
  const bs = await run("bluesky", { status: 500 });
  assert.equal(new URL(li.calls[0].url).origin, "https://api.linkedin.com");
  assert.equal(new URL(fb.calls[0].url).origin, "https://graph.facebook.com");
  assert.equal(new URL(bs.calls.find((c) => c.method === "POST").url).origin, "https://bsky.social");
});

test("an adapter is registered only for a provider this deployment configured", () => {
  const none = socialAdapters({ providers: providers({ OPENBLOG_SOCIAL_LINKEDIN_CLIENT_ID: undefined, OPENBLOG_SOCIAL_LINKEDIN_CLIENT_SECRET: undefined, OPENBLOG_SOCIAL_FACEBOOK_CLIENT_ID: undefined, OPENBLOG_SOCIAL_FACEBOOK_CLIENT_SECRET: undefined }) });
  assert.deepEqual(Object.keys(none), [], "off by default");
  assert.deepEqual(Object.keys(socialAdapters()), []);
  assert.deepEqual(Object.keys(socialAdapters({ providers: providers({ OPENBLOG_SOCIAL_FACEBOOK_CLIENT_ID: undefined, OPENBLOG_SOCIAL_FACEBOOK_CLIENT_SECRET: undefined }) })), ["linkedin"]);
  // A provider with a broken setting is not configured, so it gets no adapter either.
  assert.deepEqual(Object.keys(socialAdapters({ providers: providers({ OPENBLOG_SOCIAL_FACEBOOK_API_VERSION: "latest" }) })), ["linkedin"]);
  const both = socialAdapters({ providers: providers() });
  assert.deepEqual(Object.keys(both).sort(), ["facebook", "linkedin"], "Bluesky is off until turned on");
  const all = socialAdapters({ providers: allProviders() });
  assert.deepEqual(Object.keys(all).sort(), ["bluesky", "facebook", "linkedin"]);
  assert.equal(typeof all.bluesky.reconcile, "function", "Bluesky can look the record up by its key");
  assert.equal(typeof both.linkedin.publish, "function");
  assert.equal(both.linkedin.reconcile, undefined, "LinkedIn offers no read-only lookup to this app");
  assert.equal(typeof both.facebook.reconcile, "function");
  assert.ok(Object.isFrozen(both));
});

test("unsupported networks get no adapter", () => {
  const adapters = socialAdapters({ providers: allProviders() });
  for (const provider of fixture.unsupported) assert.equal(Object.hasOwn(adapters, String(provider)), false, String(provider));
  assert.equal(adapters.constructor, undefined, "no inherited member looks like an adapter");
});

test("the registry never exposes a client secret", () => {
  const adapters = socialAdapters({ providers: allProviders() });
  const text = JSON.stringify(adapters) + Object.values(adapters).map((adapter) => JSON.stringify(adapter)).join("");
  assert.ok(!/secret/i.test(text));
});

test("a caption cannot carry the token or smuggle a second request through the adapter", async () => {
  // The adapter never interpolates a caption into a URL or header.
  const { calls } = await run("facebook", { status: 200, body: { id: "10987654321_1" } }, { post: { caption: "line\nX-Injected: yes & message=other" } });
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
  for (const file of ["social-publish.mjs", "social-adapters.mjs"]) {
    const source = readFileSync(new URL(`../../netlify/lib/${file}`, import.meta.url), "utf8");
    assert.ok(!/https?:\/\/(?!.*\bexample\b)[a-z0-9.-]+\.[a-z]{2,}/i.test(source.replace(/\/\/.*$/gm, "")), "hosts come from the provider settings");
    assert.ok(!/process\.env|Deno\.env|client_?secret|SERVICE_ROLE/i.test(source), file);
    assert.ok(!/console\./.test(source), file);
  }
});
