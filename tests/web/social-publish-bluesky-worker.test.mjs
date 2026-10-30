// Bluesky behind the real delivery worker (epic #382, story #391, task DIST2.1.3, ADRs 0760 and
// 0761): the queue claims, the session is refreshed single-flight when it is about to expire, the
// post is written once under the announcement's record key, a rate limit is retried when the
// service says, a refused session flags the account, and an uncertain outcome is settled by reading
// that one record. Supabase is the in-memory fake; the service is scripted. No network is used.
import test from "node:test";
import assert from "node:assert/strict";
import { socialAdapters } from "../../netlify/lib/social-adapters.mjs";
import { announcementKey } from "../../netlify/lib/social-atproto.mjs";
import { SITE, workerSetup } from "./social-queue-fakes.mjs";
import { allProviders, scripted } from "./social-publish-fakes.mjs";

const MIN = 60_000;
const BLUESKY = "55555555-5555-4555-8555-555555555555";
const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (expMs, tag) => `${b64url({ alg: "ES256K" })}.${b64url({ sub: DID, exp: Math.floor(expMs / 1000), tag })}.c2ln${tag}`;

// A worker with the real Bluesky adapter and the real refresh, over one scripted service.
async function setup(reply, { accessLeftMs = 2 * 3600_000 } = {}) {
  const s = await workerSetup({ accounts: [], policyEnv: { OPENBLOG_SOCIAL_WORKER_BUDGET_SECONDS: "50" } });
  s.accounts.push({ id: BLUESKY, site_id: SITE, provider: "bluesky", kind: "account", external_id: DID, display_name: "@ada.bsky.social", status: "connected", paused_until: null });
  const tokens = { access: jwt(s.now() + accessLeftMs, "access-1"), refresh: jwt(s.now() + 90 * 86400_000, "refresh-1") };
  await s.credentials.save(BLUESKY, { accessToken: tokens.access, refreshToken: tokens.refresh, expiresIn: Math.floor(accessLeftMs / 1000), refreshExpiresIn: 90 * 86400 });
  const service = scripted(reply);
  // The worker's one fetch: the service for bsky.social, the database fake for everything else.
  const fetchImpl = (url, init) => (String(url).startsWith("https://bsky.social/") ? service.fetchImpl(url, init) : s.fetchImpl(url, init));
  const providers = allProviders();
  const adapters = socialAdapters({ providers, fetchImpl, now: s.now });
  const worker = s.build({ adapters, providers, fetchImpl });
  const addPost = (fields = {}) => s.addPost({ account_id: BLUESKY, body: "New post: lanterns #light", ...fields });
  return { ...s, service, worker, tokens, addPost };
}
const calls = (s, method) => s.service.calls.filter((call) => call.url.includes(`/xrpc/${method}`));
const uriOf = async (post) => `at://${DID}/app.bsky.feed.post/${await announcementKey({ scheduledFor: post.scheduled_for, idempotencyKey: post.idempotency_key })}`;
const created = async (post) => ({ status: 200, body: { uri: await uriOf(post), cid: "bafyrei" } });

test("a claimed announcement is written once under its record key and settled with the at:// URI", async () => {
  let post;
  const s = await setup(async () => created(post));
  post = s.addPost();
  const summary = await s.worker.run();
  assert.equal(summary.published, 1);
  assert.deepEqual([post.status, post.provider_post_id], ["published", await uriOf(post)]);
  const [write] = calls(s, "com.atproto.repo.createRecord");
  assert.equal(write.headers.authorization, `Bearer ${s.tokens.access}`);
  const sent = JSON.parse(write.body);
  assert.equal(sent.repo, DID);
  assert.equal(sent.record.text, "New post: lanterns #light");
  assert.equal(sent.record.embed.external.uri, post.canonical_url);
  assert.deepEqual(sent.record.facets.map((f) => f.features[0].$type), ["app.bsky.richtext.facet#tag"]);
  assert.equal(calls(s, "com.atproto.server.refreshSession").length, 0, "a token with time left is not refreshed");
  await s.worker.run();
  assert.equal(s.service.calls.length, 1, "a published announcement is never sent again");
});

test("an access token about to expire is refreshed first, and the rotated session is what is kept", async () => {
  let post;
  const next = { access: null, refresh: null };
  const s = await setup(async (n, url) => {
    if (url.endsWith("refreshSession")) {
      next.access = jwt(Date.parse("2026-11-01T14:00:00Z"), "access-2");
      next.refresh = jwt(Date.parse("2027-01-30T12:00:00Z"), "refresh-2");
      return { status: 200, body: { accessJwt: next.access, refreshJwt: next.refresh, did: DID, handle: "ada.bsky.social" } };
    }
    return created(post);
  }, { accessLeftMs: 2 * MIN });
  post = s.addPost();
  await s.worker.run();
  const [refresh] = calls(s, "com.atproto.server.refreshSession");
  assert.equal(refresh.headers.authorization, `Bearer ${s.tokens.refresh}`);
  const [write] = calls(s, "com.atproto.repo.createRecord");
  assert.equal(write.headers.authorization, `Bearer ${next.access}`);
  assert.equal(post.status, "published");
  assert.equal(await s.credentials.accessToken(BLUESKY), next.access);
  assert.ok(!JSON.stringify(s.credentials).includes(next.refresh));
});

test("a session the service has ended fails the announcement without a send and flags the account", async () => {
  const s = await setup({ status: 400, body: { error: "ExpiredToken", message: "Token has been revoked" } }, { accessLeftMs: MIN });
  const post = s.addPost();
  await s.worker.run();
  assert.deepEqual([post.status, post.last_error_code], ["failed", "needs-reauth"]);
  assert.equal(calls(s, "com.atproto.repo.createRecord").length, 0);
  assert.equal(s.accounts.find((a) => a.id === BLUESKY).status, "needs-reauth");
});

test("an access token the service refuses at write time flags the account for reconnecting", async () => {
  const s = await setup({ status: 400, body: { error: "ExpiredToken" } });
  const post = s.addPost();
  await s.worker.run();
  assert.deepEqual([post.status, post.last_error_code], ["failed", "needs-reauth"]);
  assert.equal(s.accounts.find((a) => a.id === BLUESKY).status, "needs-reauth");
});

test("a rate limit is retried no sooner than the service's reset, with the same record key", async () => {
  let post;
  let limited = true;
  const s = await setup(async () => {
    if (limited) {
      limited = false;
      return { status: 429, headers: { "ratelimit-reset": String(Math.floor(s.now() / 1000) + 900) }, body: { error: "RateLimitExceeded" } };
    }
    return created(post);
  });
  post = s.addPost();
  const summary = await s.worker.run();
  assert.equal(summary.retried, 1);
  assert.deepEqual([post.status, post.last_error_code], ["scheduled", "rate-limited"]);
  assert.ok(Date.parse(post.next_attempt_at) - s.now() >= 15 * MIN);
  s.advance(16 * MIN);
  await s.worker.run();
  assert.equal(post.status, "published");
  const keys = calls(s, "com.atproto.repo.createRecord").map((call) => JSON.parse(call.body).rkey);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1], "every attempt of one announcement names one record");
});

test("an uncertain write is settled by reading its record: found is published, and it is never sent twice", async () => {
  let post;
  const s = await setup(async (n, url) => {
    if (url.includes("getRecord")) return { status: 200, body: { uri: await uriOf(post), cid: "bafyrei", value: { $type: "app.bsky.feed.post", text: post.body, embed: { $type: "app.bsky.embed.external", external: { uri: post.canonical_url, title: "x", description: "" } } } } };
    return { status: 502, body: { error: "UpstreamFailure" } };
  });
  post = s.addPost();
  await s.worker.run();
  assert.equal(post.status, "unknown");
  s.advance(6 * MIN);
  const summary = await s.worker.run();
  assert.equal(summary.reconciled.published, 1);
  assert.deepEqual([post.status, post.provider_post_id], ["published", await uriOf(post)]);
  assert.equal(calls(s, "com.atproto.repo.createRecord").length, 1);
  assert.equal(calls(s, "com.atproto.repo.getRecord")[0].method, "GET");
});

test("an uncertain write whose record is not there is failed as not delivered once the outcome has settled", async () => {
  const s = await setup((n, url) => (url.includes("getRecord") ? { status: 400, body: { error: "RecordNotFound" } } : { status: 500, body: {} }));
  const post = s.addPost();
  await s.worker.run();
  assert.equal(post.status, "unknown");
  s.advance(6 * MIN);
  await s.worker.run();
  assert.equal(post.status, "unknown", "too soon to call it absent");
  s.advance(60 * MIN);
  await s.worker.run();
  assert.deepEqual([post.status, post.last_error_code], ["failed", "not-delivered"]);
  assert.equal(calls(s, "com.atproto.repo.createRecord").length, 1);
});

test("no service text and no token reaches a row, an attempt or a summary", async () => {
  const s = await setup({ status: 400, body: { error: "InvalidRequest", message: "SERVICE-SAID-THIS" } });
  const post = s.addPost();
  const summary = await s.worker.run();
  assert.deepEqual([post.status, post.last_error_code], ["failed", "provider-rejected"]);
  const stored = JSON.stringify({ posts: s.posts, attempts: s.attempts, summary });
  for (const secret of ["SERVICE-SAID-THIS", s.tokens.access, s.tokens.refresh]) assert.ok(!stored.includes(secret));
});
