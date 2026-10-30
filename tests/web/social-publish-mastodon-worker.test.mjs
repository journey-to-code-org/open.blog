// Mastodon behind the real delivery worker (epic #382, story #392, task DIST2.2.3, ADRs 0762 and
// 0763): the queue claims, the instance's capabilities are read before the write, the status is
// posted once with the announcement's Idempotency-Key and settled with its remote id, a rate limit
// waits for the instance's reset with the same key, a refused token flags the account, and an
// uncertain outcome is settled by reading the account's statuses back. Supabase is the in-memory
// fake; the instance is scripted. No network is used.
import test from "node:test";
import assert from "node:assert/strict";
import { socialAdapters } from "../../netlify/lib/social-adapters.mjs";
import { idempotencyHeader } from "../../netlify/lib/social-mastodon.mjs";
import { SITE, workerSetup } from "./social-queue-fakes.mjs";
import { providers, scripted } from "./social-publish-fakes.mjs";

const MIN = 60_000;
const MASTODON_ID = "66666666-6666-4666-8666-666666666666";
const INSTANCE = "https://social.example.org";
const ACCOUNT = "109876543210";
const TOKEN = "mastodon-access-token-0001";
const ENV = { OPENBLOG_SOCIAL_MASTODON_CLIENT_ID: "md-client-id", OPENBLOG_SOCIAL_MASTODON_CLIENT_SECRET: "mastodon-client-secret-0003", OPENBLOG_SOCIAL_MASTODON_INSTANCE: INSTANCE };
const instance = (max = 500) => ({ status: 200, body: { configuration: { statuses: { max_characters: max, characters_reserved_per_url: 23 }, media_attachments: { description_limit: 1500 } } } });

// A worker with the real Mastodon adapter over one scripted instance. `reply(path, init, s)` answers
// everything but the instance's configuration, which `limits` answers.
async function setup(reply, { limits = instance(), env = {} } = {}) {
  const s = await workerSetup({ accounts: [], policyEnv: { OPENBLOG_SOCIAL_WORKER_BUDGET_SECONDS: "50" } });
  s.accounts.push({ id: MASTODON_ID, site_id: SITE, provider: "mastodon", kind: "account", external_id: ACCOUNT, display_name: "@ada@social.example.org", status: "connected", paused_until: null });
  await s.credentials.save(MASTODON_ID, { accessToken: TOKEN });
  const service = scripted(async (n, url, init) => {
    const path = new URL(url).pathname;
    if (path === "/api/v2/instance") return typeof limits === "function" ? limits() : limits;
    return reply(path, init, s);
  });
  const fetchImpl = (url, init) => (String(url).startsWith(`${INSTANCE}/`) ? service.fetchImpl(url, init) : s.fetchImpl(url, init));
  const configured = providers({ ...ENV, ...env });
  const adapters = socialAdapters({ providers: configured, fetchImpl, now: s.now });
  const worker = s.build({ adapters, providers: configured, fetchImpl });
  const addPost = (fields = {}) => s.addPost({ account_id: MASTODON_ID, body: "New post: lanterns #light", ...fields });
  return { ...s, service, worker, addPost };
}
const writes = (s) => s.service.calls.filter((call) => call.method === "POST" && call.url === `${INSTANCE}/api/v1/statuses`);
const posted = (id = "113456789012345678") => ({ status: 200, body: { id, account: { id: ACCOUNT }, content: "<p>html</p>" } });

test("a claimed announcement is posted once, checked against the instance first, and settled with the remote status id", async () => {
  const s = await setup(() => posted());
  const post = s.addPost();
  const summary = await s.worker.run();
  assert.equal(summary.published, 1);
  assert.deepEqual([post.status, post.provider_post_id], ["published", "113456789012345678"]);
  const paths = s.service.calls.map((call) => new URL(call.url).pathname);
  assert.deepEqual(paths, ["/api/v2/instance", "/api/v1/statuses"], "the limits are read before the one write");
  const [write] = writes(s);
  assert.equal(write.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(write.headers["idempotency-key"], await idempotencyHeader(post.idempotency_key));
  const form = Object.fromEntries(new URLSearchParams(write.body));
  assert.deepEqual(form, { status: `New post: lanterns #light\n\n${post.canonical_url}`, visibility: "public" });
  await s.worker.run();
  assert.equal(writes(s).length, 1, "a published announcement is never sent again");
});

test("an instance whose limit the status exceeds fails it without a write; one that cannot say is held to the default", async () => {
  const s = await setup(() => posted(), { limits: instance(100) });
  const post = s.addPost({ body: "x".repeat(200) });
  await s.worker.run();
  assert.deepEqual([post.status, post.last_error_code], ["failed", "provider-rejected"]);
  assert.equal(writes(s).length, 0);

  const quiet = await setup(() => posted(), { limits: { status: 503, body: {} } });
  const fine = quiet.addPost({ body: "y".repeat(475) });
  await quiet.worker.run();
  assert.equal(fine.status, "published", "475 characters, a blank line and a link fit Mastodon's default 500");
});

test("a rate limit is retried no sooner than X-RateLimit-Reset, with the same Idempotency-Key", async () => {
  let limited = true;
  const s = await setup((path, init, world) => {
    if (limited) {
      limited = false;
      return { status: 429, headers: { "x-ratelimit-reset": new Date(world.now() + 20 * MIN).toISOString(), "x-ratelimit-remaining": "0" }, body: { error: "Too many requests" } };
    }
    return posted();
  });
  const post = s.addPost();
  const summary = await s.worker.run();
  assert.equal(summary.retried, 1);
  assert.deepEqual([post.status, post.last_error_code], ["scheduled", "rate-limited"]);
  assert.ok(Date.parse(post.next_attempt_at) - s.now() >= 20 * MIN);
  s.advance(21 * MIN);
  await s.worker.run();
  assert.equal(post.status, "published");
  const keys = writes(s).map((call) => call.headers["idempotency-key"]);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1], "every attempt of one announcement sends one key");
});

test("a token the instance refuses fails the announcement and flags the account for reconnecting", async () => {
  const s = await setup(() => ({ status: 401, body: { error: "The access token is invalid" } }));
  const post = s.addPost();
  await s.worker.run();
  assert.deepEqual([post.status, post.last_error_code], ["failed", "needs-reauth"]);
  assert.equal(s.accounts.find((a) => a.id === MASTODON_ID).status, "needs-reauth");
});

test("an uncertain write is settled by reading the account's statuses back: the one with this text is published, never sent twice", async () => {
  let at = null;
  const s = await setup((path, init, world) => {
    if (path === "/api/v1/statuses") {
      at = new Date(world.now()).toISOString();
      return { status: 502, body: "Bad gateway" };
    }
    if (path === `/api/v1/accounts/${ACCOUNT}/statuses`) return { status: 200, body: [{ id: "113456789012345679", created_at: at, content: "<p>x</p>" }] };
    if (path === "/api/v1/statuses/113456789012345679/source") return { status: 200, body: { id: "113456789012345679", text: `New post: lanterns #light\n\n${post.canonical_url}`, spoiler_text: "" } };
    return { status: 404, body: {} };
  });
  const post = s.addPost();
  await s.worker.run();
  assert.equal(post.status, "unknown");
  s.advance(6 * MIN);
  const summary = await s.worker.run();
  assert.equal(summary.reconciled.published, 1);
  assert.deepEqual([post.status, post.provider_post_id], ["published", "113456789012345679"]);
  assert.equal(writes(s).length, 1);
  assert.ok(s.service.calls.filter((call) => !call.url.endsWith("/api/v1/statuses")).every((call) => call.method === "GET"), "reconcile only reads");
});

test("an uncertain write with no status in the window is failed as not delivered once the outcome has settled", async () => {
  const s = await setup((path) => (path === `/api/v1/accounts/${ACCOUNT}/statuses` ? { status: 200, body: [] } : { status: 500, body: {} }));
  const post = s.addPost();
  await s.worker.run();
  assert.equal(post.status, "unknown");
  s.advance(6 * MIN);
  await s.worker.run();
  assert.equal(post.status, "unknown", "too soon to call it absent");
  s.advance(60 * MIN);
  await s.worker.run();
  assert.deepEqual([post.status, post.last_error_code], ["failed", "not-delivered"]);
  assert.equal(writes(s).length, 1);
});

test("an uncertain write that cannot be looked up (no read:statuses) is never called absent", async () => {
  const s = await setup((path) => (path === `/api/v1/accounts/${ACCOUNT}/statuses` ? { status: 403, body: { error: "This action is outside the authorized scopes" } } : { status: 500, body: {} }));
  const post = s.addPost();
  await s.worker.run();
  for (const minutes of [6, 60, 400]) {
    s.advance(minutes * MIN);
    await s.worker.run();
  }
  assert.notEqual(post.last_error_code, "not-delivered");
  assert.equal(writes(s).length, 1);
});

test("no instance text and no token reaches a row, an attempt or a summary", async () => {
  const s = await setup(() => ({ status: 422, body: { error: "Validation failed: INSTANCE-SAID-THIS" } }));
  const post = s.addPost();
  const summary = await s.worker.run();
  assert.deepEqual([post.status, post.last_error_code], ["failed", "provider-rejected"]);
  const stored = JSON.stringify({ posts: s.posts, attempts: s.attempts, summary });
  for (const secret of ["INSTANCE-SAID-THIS", TOKEN, "mastodon-client-secret-0003"]) assert.ok(!stored.includes(secret));
});
