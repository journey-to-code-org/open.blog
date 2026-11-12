// Worker races and fault injection for optional social publishing (epic #353, story #359, task
// #378). The real worker over the in-memory queue that keeps the SQL's rules (the SQL itself runs
// against a real Postgres in social-queue-sql.test.mjs): two workers at once, an author racing a
// worker, and a storage failure injected at every single call of a run. Whatever fails, no
// announcement is ever sent twice, nothing is `published` without the provider's id, nothing is
// lost, and no secret reaches a summary, a stored error or a log. No network, no real provider.
import test from "node:test";
import assert from "node:assert/strict";
import { createAnnouncements } from "../../netlify/lib/social-announcements.mjs";
import { socialSettings } from "../../netlify/lib/social-scope.mjs";
import { ACCESS, ADMIN_KEY, FACEBOOK, LINKEDIN, SERVICE_KEY, WORKER_KEY, env, fakeAdapter, workerSetup } from "./social-queue-fakes.mjs";

const SECRETS = [ACCESS, `fb_${ACCESS}`, SERVICE_KEY, ADMIN_KEY, WORKER_KEY];
const LEASE_MS = 300_000;

const sentPerPost = (adapters) => {
  const counts = new Map();
  for (const adapter of adapters) for (const call of adapter.published) counts.set(call.post.id, (counts.get(call.post.id) || 0) + 1);
  return counts;
};

// `resends`: how many sends of one announcement are allowed (more than one only after an answer that
// certainly did not post).
function invariants(s, adapters, label, resends = 1) {
  for (const [id, count] of sentPerPost(adapters)) assert.ok(count <= resends, `${label}: ${id} was sent ${count} times`);
  for (const post of s.posts) {
    if (post.status === "published") assert.ok(post.provider_post_id, `${label}: published without a provider id`);
    assert.ok(["scheduled", "claimed", "published", "failed", "unknown", "canceled"].includes(post.status), `${label}: ${post.status}`);
  }
  const stored = JSON.stringify([s.posts, s.attempts]);
  for (const secret of SECRETS) assert.equal(stored.includes(secret), false, `${label}: a secret was stored`);
}

test("two workers at once deliver each announcement exactly once", async () => {
  const linkedin = fakeAdapter("linkedin", { publish: async (n) => { await new Promise((r) => setTimeout(r, 5)); return { providerPostId: `urn:li:share:${n}` }; } });
  const facebook = fakeAdapter("facebook");
  const s = await workerSetup({ adapters: { linkedin, facebook }, policyEnv: { OPENBLOG_SOCIAL_BATCH_SIZE: "25", OPENBLOG_SOCIAL_WORKER_BUDGET_SECONDS: "50" } });
  for (let i = 0; i < 6; i += 1) s.addPost({ account_id: i % 2 ? LINKEDIN : FACEBOOK });
  const [a, b] = await Promise.all([s.build().run(), s.build().run()]);
  const third = await s.build().run();
  assert.equal(a.published + b.published + third.published, 6);
  assert.deepEqual([...sentPerPost([linkedin, facebook]).values()], [1, 1, 1, 1, 1, 1]);
  assert.ok(s.posts.every((post) => post.status === "published"));
  invariants(s, [linkedin, facebook], "concurrent");
});

test("an author's cancel and a worker's claim cannot both win", async () => {
  const linkedin = fakeAdapter("linkedin");
  const s = await workerSetup({ adapters: { linkedin } });
  const post = s.addPost();
  const routes = createAnnouncements({ settings: socialSettings(env()), fetchImpl: s.fetchImpl, now: s.now });
  const cancel = (version) => routes({ method: "POST", route: "announcements/cancel", query: `id=${post.id}`, headers: { authorization: `Bearer ${ADMIN_KEY}`, "x-openblog-actor": "mikey" }, body: JSON.stringify({ version }) });
  // The worker claims first: the author's cancel (still naming the version they saw) is refused.
  const seen = post.version;
  await s.worker.run();
  const late = await cancel(seen);
  assert.equal(late.status, 409);
  assert.equal(post.status, "published");
  // The author cancels first: the worker never sees it.
  const other = s.addPost();
  const first = await routes({ method: "POST", route: "announcements/cancel", query: `id=${other.id}`, headers: { authorization: `Bearer ${ADMIN_KEY}`, "x-openblog-actor": "mikey" }, body: JSON.stringify({ version: other.version }) });
  assert.equal(first.status, 200);
  await s.worker.run();
  assert.equal(other.status, "canceled");
  assert.equal(linkedin.published.filter((call) => call.post.id === other.id).length, 0);
});

test("a storage failure injected at any call of a run never sends twice, never loses work, and leaks nothing", async () => {
  // Count the storage calls of one clean run first, then fail each one in turn.
  const roomy = { OPENBLOG_SOCIAL_WORKER_BUDGET_SECONDS: "50" };
  const probe = await workerSetup({ adapters: { linkedin: fakeAdapter("linkedin"), facebook: fakeAdapter("facebook") }, policyEnv: roomy });
  probe.addPost({ account_id: LINKEDIN });
  probe.addPost({ account_id: FACEBOOK });
  const before = probe.calls.length;
  await probe.build({ credentials: undefined }).run();
  assert.equal(probe.posts.filter((post) => post.status === "published").length, 2, "the clean run delivers both");
  const total = probe.calls.length - before;
  assert.ok(total >= 6, `a run makes several storage calls (${total})`);

  for (let k = 1; k <= total; k += 1) {
    for (const mode of ["network", "500"]) {
      const label = `call ${k} fails (${mode})`;
      const linkedin = fakeAdapter("linkedin");
      const facebook = fakeAdapter("facebook");
      const s = await workerSetup({ adapters: { linkedin, facebook }, policyEnv: roomy });
      s.addPost({ account_id: LINKEDIN });
      s.addPost({ account_id: FACEBOOK });
      let n = 0;
      const faulty = async (url, init) => {
        n += 1;
        if (n === k) {
          if (mode === "network") throw new TypeError(`fetch failed ${SERVICE_KEY}`);
          return new Response(JSON.stringify({ message: `boom ${SERVICE_KEY}` }), { status: 500 });
        }
        return s.fetchImpl(url, init);
      };
      let summary;
      try {
        summary = await s.build({ fetchImpl: faulty, queue: undefined, credentials: undefined }).run();
      } catch (error) {
        // A run may stop (the function answers 503); it must not carry a secret.
        for (const secret of SECRETS) assert.equal(String(error?.message).includes(secret), false, label);
      }
      if (summary) for (const secret of SECRETS) assert.equal(JSON.stringify(summary).includes(secret), false, label);
      // Later, healthy runs: leases have run out, so whatever the failure left is reaped and finished.
      s.advance(LEASE_MS + 1000);
      for (let run = 0; run < 3; run += 1) {
        await s.worker.run();
        s.advance(LEASE_MS + 1000);
      }
      invariants(s, [linkedin, facebook], label);
      for (const post of s.posts) {
        assert.notEqual(post.status, "claimed", `${label}: nothing is left claimed forever`);
        const sent = [...linkedin.published, ...facebook.published].some((call) => call.post.id === post.id);
        if (!sent) assert.notEqual(post.status, "published", `${label}: published without being sent`);
        if (sent) assert.ok(["published", "unknown"].includes(post.status), `${label}: a sent post is published or awaits a check, not ${post.status}`);
      }
    }
  }
});

test("a provider that fails in every way the contract allows still never causes a second send", async () => {
  const kinds = ["transient", "rate-limited", "rejected", "auth", "uncertain", "plain", "no-id", "slow"];
  const { DeliveryError } = await import("../../netlify/lib/social-delivery.mjs");
  for (const kind of kinds) {
    const linkedin = fakeAdapter("linkedin", {
      publish: async (n, args) => {
        if (n > 1) return { providerPostId: `urn:li:share:${n}` };
        if (kind === "plain") throw new Error(`crash with ${args.accessToken}`);
        if (kind === "no-id") return { requestId: "r" };
        // The provider timeout firing (AbortSignal.timeout's reason), without waiting for real time.
        if (kind === "slow") throw new DOMException("The operation timed out.", "TimeoutError");
        throw new DeliveryError(kind, { status: kind === "rate-limited" ? 429 : 503, retryAfterMs: 1000 });
      },
    });
    const s = await workerSetup({ adapters: { linkedin }, policyEnv: { OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS: "2", OPENBLOG_SOCIAL_WORKER_BUDGET_SECONDS: "5" } });
    const post = s.addPost();
    for (let run = 0; run < 4; run += 1) {
      await s.worker.run();
      s.advance(2 * 3600_000);
    }
    const sends = linkedin.published.length;
    if (["uncertain", "plain", "no-id", "slow"].includes(kind)) {
      assert.equal(sends, 1, `${kind}: an outcome that may have posted is never sent again`);
      assert.equal(post.status, "unknown", kind);
    } else if (["rejected", "auth"].includes(kind)) {
      assert.equal(sends, 1, kind);
      assert.equal(post.status, "failed", kind);
    } else {
      assert.equal(sends, 2, `${kind}: certainly not posted, so tried again`);
      assert.equal(post.status, "published", kind);
    }
    invariants(s, [linkedin], kind, ["transient", "rate-limited"].includes(kind) ? 2 : 1);
  }
});
