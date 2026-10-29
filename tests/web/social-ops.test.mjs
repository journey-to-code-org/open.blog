// Operations of optional social publishing (epic #353, story #359, ADR 0324): redacted log lines,
// queue health and backlog alerts, the sweep, opt-in retention, the worker's operations step, the
// hosted health route, and canceling an account's scheduled announcements when it is disconnected.
// Storage is an in-memory fake; nothing here touches a network or a provider.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterRun, alertsOf, createOps, logEvent, opsPolicy, redact } from "../../netlify/lib/social-ops.mjs";
import { createHandler as workerHandler } from "../../netlify/functions/social-worker.mjs";
import { createHandler as socialHandler } from "../../netlify/functions/social.mjs";
import { createCredentialStore } from "../../netlify/lib/social-credentials.mjs";
import { socialSettings } from "../../netlify/lib/social-scope.mjs";
import { createAccounts } from "../../netlify/lib/social-accounts.mjs";
import { fakeSupabase } from "./social-oauth-fakes.mjs";
import { ACCESS, ADMIN_KEY, LINKEDIN, SERVICE_KEY, SITE, T0, WORKER_KEY, env, fakeAdapter, queueStorage } from "./social-queue-fakes.mjs";

const sinkOf = () => {
  const lines = [];
  return { lines, log: (line) => lines.push(["info", line]), warn: (line) => lines.push(["warn", line]) };
};
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

// A PostgREST that knows the three operations functions, or none of them.
function opsStorage({ installed = true, health = {}, fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const name = new URL(url).pathname.split("/rest/v1/")[1];
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ name, body, headers: init.headers });
    if (fail) return json(500, { message: `boom ${SERVICE_KEY}` });
    if (!installed) return json(404, { code: "PGRST202", message: "Could not find the function" });
    if (name === "rpc/openblog_social_health") return json(200, [{ due: 0, overdue: 0, processing: 0, expired_leases: 0, retrying: 0, unknown_waiting: 0, needs_review: 0, failed_recently: 0, accounts_need_reconnect: 0, accounts_paused: 0, stale_connections: 0, oldest_due_at: null, ...health }]);
    if (name === "rpc/openblog_social_sweep") return json(200, [{ reaped: 1, expired_connections: 2 }]);
    if (name === "rpc/openblog_social_prune") return json(200, [{ posts: 3, attempts: 7, connections: 1, accounts: 0 }]);
    return json(404, {});
  };
  return { calls, fetchImpl };
}

const settings = socialSettings(env());

test("operations are off unless asked for, and a bad setting is named, never echoed", () => {
  assert.deepEqual({ ...opsPolicy({}) }, { enabled: false, retentionDays: null, overdueMinutes: 15, problems: [] });
  const on = opsPolicy({ OPENBLOG_SOCIAL_OPS: "true", OPENBLOG_SOCIAL_RETENTION_DAYS: "90", OPENBLOG_SOCIAL_BACKLOG_ALERT_MINUTES: "30" });
  assert.equal(on.enabled, true);
  assert.equal(on.retentionDays, 90);
  assert.equal(on.overdueMinutes, 30);
  for (const days of ["29", "3651", "ninety", "-90", "90.5"]) {
    const policy = opsPolicy({ OPENBLOG_SOCIAL_OPS: "true", OPENBLOG_SOCIAL_RETENTION_DAYS: days });
    assert.equal(policy.retentionDays, null, days);
    assert.deepEqual([...policy.problems], ["OPENBLOG_SOCIAL_RETENTION_DAYS"], days);
  }
  const lonely = opsPolicy({ OPENBLOG_SOCIAL_RETENTION_DAYS: "90" });
  assert.equal(lonely.retentionDays, null, "retention needs the operations functions, so it never runs alone");
  assert.deepEqual([...lonely.problems], ["OPENBLOG_SOCIAL_RETENTION_DAYS"]);
  assert.equal(opsPolicy({ OPENBLOG_SOCIAL_OPS: "TRUE" }).enabled, false);
});

test("a log line keeps whole numbers, booleans and short codes, and drops everything else", () => {
  const kept = redact({
    claimed: 2,
    ok: true,
    code: "rate-limited",
    alerts: ["backlog-overdue", `Bearer ${ACCESS}`, "needs-review"],
    token: ACCESS,
    caption: "A new post is live.",
    url: "https://blog.example.org/x",
    negative: -1,
    fraction: 1.5,
    big: Number.MAX_SAFE_INTEGER + 2,
    "bad key": 1,
    nested: { published: 1, secret: SERVICE_KEY, deeper: { count: 1, deepest: { x: 1 } } },
    fn: () => 1,
  });
  assert.deepEqual(kept, { claimed: 2, ok: true, code: "rate-limited", alerts: ["backlog-overdue", "needs-review"], nested: { published: 1, deeper: { count: 1 } } });
  const sink = sinkOf();
  const line = logEvent("openblog-social-worker", { summary: { claimed: 1 }, token: ACCESS }, { sink });
  assert.deepEqual(JSON.parse(line), { event: "openblog-social-worker", summary: { claimed: 1 } });
  assert.equal(sink.lines.length, 1);
  assert.equal(sink.lines[0][0], "info");
  logEvent("openblog-social-ops", { alerts: ["backlog-overdue"] }, { sink, level: "warn" });
  assert.equal(sink.lines[1][0], "warn");
  assert.equal(logEvent("Not An Event", {}, { sink }), null);
  assert.doesNotThrow(() => logEvent("openblog-x", {}, { sink: { log: () => { throw new Error("disk full"); } } }), "a broken log never breaks delivery");
});

test("health is counts and alert codes, most urgent first; a missing install is said plainly", async () => {
  const storage = opsStorage({ health: { overdue: 2, due: 3, needs_review: 1, accounts_need_reconnect: 1, failed_recently: -4, oldest_due_at: "2026-11-01T11:00:00.000+00:00", caption: "leak" } });
  const ops = createOps({ settings, fetchImpl: storage.fetchImpl, policy: opsPolicy({ OPENBLOG_SOCIAL_BACKLOG_ALERT_MINUTES: "20" }) });
  const health = await ops.health();
  assert.equal(health.installed, true);
  assert.equal(health.overdue, 2);
  assert.equal(health.failedRecently, 0, "a count that is not a count is zero");
  assert.equal(health.oldestDueAt, "2026-11-01T11:00:00Z");
  assert.equal(health.caption, undefined);
  assert.deepEqual(health.alerts, ["backlog-overdue", "accounts-need-reconnect", "needs-review"]);
  assert.deepEqual(storage.calls[0].body, { p_site_id: SITE, p_overdue_seconds: 1200, p_skip_providers: [] }, "this site only, with the alert threshold");
  assert.deepEqual(await createOps({ settings, fetchImpl: opsStorage({ installed: false }).fetchImpl }).health(), { installed: false, overdueMinutes: 15, alerts: [] });
  await assert.rejects(createOps({ settings, fetchImpl: opsStorage({ fail: true }).fetchImpl }).health(), (error) => error.code === "storage-failed" && !error.message.includes(SERVICE_KEY));
  assert.deepEqual(alertsOf({ installed: true, expiredLeases: 1, staleConnections: 1 }), ["expired-leases", "stale-connections"]);
  assert.deepEqual(alertsOf({ installed: false, overdue: 9 }), []);
});

test("announcements the claim holds back on purpose are never a late backlog", async () => {
  // A paused account's announcements wait for the pause to end: counted, never an alert.
  const paused = await createOps({ settings, fetchImpl: opsStorage({ health: { waiting_on_pause: 2, accounts_paused: 1 } }).fetchImpl }).health();
  assert.equal(paused.waitingOnPause, 2);
  assert.deepEqual(paused.alerts, [], "a working worker behind a rate-limit pause raises no backlog-overdue");
  // A provider without an adapter is a setup problem with its own code, not a stopped worker.
  const storage = opsStorage({ health: { waiting_on_provider: 3 } });
  const unset = await createOps({ settings, fetchImpl: storage.fetchImpl, skipProviders: ["facebook", "Not A Code", 7] }).health();
  assert.equal(unset.waitingOnProvider, 3);
  assert.deepEqual(unset.alerts, ["provider-not-configured"]);
  assert.deepEqual(storage.calls[0].body.p_skip_providers, ["facebook"], "only provider codes reach the query");
});

test("retention runs only when configured, and the worker's operations step never throws", async () => {
  const off = opsStorage();
  assert.equal(await createOps({ settings, fetchImpl: off.fetchImpl, policy: opsPolicy({ OPENBLOG_SOCIAL_OPS: "true" }) }).prune(), null);
  assert.equal(off.calls.length, 0, "no prune call at all without a retention period");

  const on = opsStorage({ health: { overdue: 1 } });
  const sink = sinkOf();
  const report = await afterRun(createOps({ settings, fetchImpl: on.fetchImpl, policy: opsPolicy({ OPENBLOG_SOCIAL_OPS: "true", OPENBLOG_SOCIAL_RETENTION_DAYS: "90" }) }), { maxAttempts: 5, sink });
  assert.deepEqual(on.calls.map((c) => c.name), ["rpc/openblog_social_sweep", "rpc/openblog_social_health", "rpc/openblog_social_prune"]);
  assert.deepEqual(on.calls[2].body, { p_site_id: SITE, p_keep_days: 90, p_limit: 200 });
  assert.deepEqual(report.alerts, ["backlog-overdue"]);
  assert.deepEqual(report.pruned, { posts: 3, attempts: 7, connections: 1, accounts: 0 });
  assert.equal(sink.lines.length, 1);
  assert.equal(sink.lines[0][0], "warn", "an alert is a warning, so a log drain can page on it");
  const logged = JSON.parse(sink.lines[0][1]);
  assert.equal(logged.event, "openblog-social-ops");
  assert.equal(logged.health.overdue, 1);
  assert.equal(logged.health.oldestDueAt, undefined, "only counts and codes are logged");

  for (const [storage, code] of [[opsStorage({ installed: false }), "ops-not-installed"], [opsStorage({ fail: true }), "storage-failed"]]) {
    const quiet = sinkOf();
    const failed = await afterRun(createOps({ settings, fetchImpl: storage.fetchImpl, policy: opsPolicy({ OPENBLOG_SOCIAL_OPS: "true" }) }), { sink: quiet });
    assert.equal(failed.error, code);
    assert.equal(quiet.lines[0][0], "warn");
    assert.equal(quiet.lines[0][1].includes(SERVICE_KEY), false);
  }
});

// ---- the worker endpoint with operations on and off

async function worker(extraEnv = {}, opsReplies = {}) {
  const now = () => T0;
  const fakes = queueStorage({ now });
  await createCredentialStore({ settings, fetchImpl: fakes.fetchImpl, now }).save(LINKEDIN, { accessToken: ACCESS, expiresIn: 86400 });
  const ops = opsStorage(opsReplies);
  const fetchImpl = (url, init) => (String(url).includes("/rpc/openblog_social_health") || String(url).includes("/rpc/openblog_social_sweep") || String(url).includes("/rpc/openblog_social_prune") ? ops.fetchImpl(url, init) : fakes.fetchImpl(url, init));
  const sink = sinkOf();
  const handler = workerHandler({ env: env(extraEnv), fetchImpl, now, adapters: { linkedin: fakeAdapter("linkedin") }, random: () => 0.5, sink });
  const call = () => handler({ httpMethod: "POST", path: "/api/social-worker", headers: { authorization: `Bearer ${WORKER_KEY}` }, body: "" });
  return { ...fakes, ops, sink, call };
}

test("each worker run logs one line of counts; with operations on it sweeps, checks health and reports alerts", async () => {
  const plain = await worker();
  plain.addPost();
  const reply = await plain.call();
  assert.equal(reply.statusCode, 200);
  assert.equal(JSON.parse(reply.body).ops, undefined, "off by default: the reply is unchanged");
  assert.equal(plain.ops.calls.length, 0, "and no operations function is called");
  assert.equal(plain.sink.lines.length, 1);
  assert.deepEqual(JSON.parse(plain.sink.lines[0][1]).summary.published, 1);

  const on = await worker({ OPENBLOG_SOCIAL_OPS: "true" }, { health: { needs_review: 2 } });
  on.addPost();
  const body = JSON.parse((await on.call()).body);
  assert.deepEqual(body.ops, { alerts: ["needs-review"] });
  const asked = on.ops.calls.find((c) => c.name === "rpc/openblog_social_health");
  assert.deepEqual(asked.body.p_skip_providers, ["facebook"], "health leaves out what the claim leaves out: the providers without an adapter");
  assert.deepEqual(on.sink.lines.map(([level, line]) => [level, JSON.parse(line).event]), [["info", "openblog-social-worker"], ["warn", "openblog-social-ops"]]);
  for (const [, line] of [...plain.sink.lines, ...on.sink.lines]) {
    for (const secret of [ACCESS, SERVICE_KEY, WORKER_KEY, ADMIN_KEY, "A new post is live.", "blog.example.org", "urn:li:person"]) assert.equal(line.includes(secret), false, secret);
  }

  const missing = await worker({ OPENBLOG_SOCIAL_OPS: "true" }, { installed: false });
  missing.addPost();
  const answer = await missing.call();
  assert.equal(answer.statusCode, 200, "a missing install never fails delivery");
  assert.deepEqual(JSON.parse(answer.body).ops, { alerts: [], error: "ops-not-installed" });
  assert.equal(JSON.parse(answer.body).summary.published, 1, "the batch was delivered all the same");
});

// ---- the hosted health route

test("the hosted health route answers the admin key only, for this site only", async () => {
  const storage = opsStorage({ health: { overdue: 1 } });
  const handler = socialHandler({ env: env({ OPENBLOG_SOCIAL_BACKLOG_ALERT_MINUTES: "45" }), fetchImpl: storage.fetchImpl, now: () => T0 });
  const ask = (headers, rawQuery = "") => handler({ httpMethod: "GET", path: "/api/social/announcements/health", rawQuery, headers });
  const ok = await ask({ authorization: `Bearer ${ADMIN_KEY}`, "x-openblog-actor": "mikey" });
  assert.equal(ok.statusCode, 200);
  const { health } = JSON.parse(ok.body);
  assert.equal(health.installed, true);
  assert.equal(health.overdueMinutes, 45);
  assert.deepEqual(health.alerts, ["backlog-overdue"]);
  assert.equal(storage.calls[0].body.p_site_id, SITE);
  assert.deepEqual(storage.calls[0].body.p_skip_providers, ["linkedin", "facebook"], "Admin's health uses the worker's rule: no provider is set up here, so none has an adapter");
  assert.equal((await ask({ authorization: `Bearer ${WORKER_KEY}` })).statusCode, 403);
  assert.equal((await ask({})).statusCode, 401);
  assert.equal((await ask({ authorization: `Bearer ${ADMIN_KEY}`, "x-openblog-actor": "mikey" }, "site_id=other")).statusCode, 400);
  const broken = socialHandler({ env: env(), fetchImpl: opsStorage({ fail: true }).fetchImpl, now: () => T0 });
  const failed = await broken({ httpMethod: "GET", path: "/api/social/announcements/health", headers: { authorization: `Bearer ${ADMIN_KEY}`, "x-openblog-actor": "mikey" } });
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.body.includes(SERVICE_KEY), false);
});

test("the operations SQL is additive, private, deletes only through its one checked function, and rolls back", () => {
  const strip = (name) => readFileSync(fileURLToPath(new URL(`../../supabase/${name}`, import.meta.url)), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
  const ops = strip("social-ops.sql");
  const undo = strip("social-ops-rollback.sql");
  const full = strip("social-rollback.sql");
  assert.doesNotMatch(ops, /\bdrop\b|\btruncate\b|\balter table\b|\bcreate table\b|\bgrant [^;]* on public\.openblog/);
  const fns = [...ops.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).sort();
  assert.deepEqual(fns, ["openblog_social_health", "openblog_social_prune", "openblog_social_sweep"]);
  for (const name of fns) {
    assert.match(ops, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated`));
    assert.match(ops, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role`));
    assert.match(undo, new RegExp(`drop function if exists public\\.${name}\\(`));
    assert.match(full, new RegExp(`drop function if exists public\\.${name}\\(`));
  }
  assert.equal((ops.match(/security definer/g) || []).length, 1, "only retention runs as its owner");
  assert.match(ops, /function public\.openblog_social_prune\(.*?security definer set search_path = public, pg_temp/);
  assert.match(ops, /p_keep_days < 30 or p_keep_days > 3650/);
  assert.match(ops, /p\.status in \('published', 'failed', 'canceled'\)/, "nothing scheduled, in flight or unknown is ever pruned");
  assert.doesNotMatch(ops, /delete from public\.openblog_social_posts[^;]*'(scheduled|claimed|unknown)'/);
  assert.match(ops, /for update skip locked/);
  assert.doesNotMatch(undo, /drop table|delete from public\.openblog_social_(posts|attempts|accounts)/);
});

// ---- the disconnected account policy

test("disconnecting cancels the account's scheduled announcements, fenced by version, and leaves the rest alone", async () => {
  const ACCOUNT = "77777777-7777-4777-8777-777777777777";
  const OTHER = "88888888-8888-4888-8888-888888888888";
  const db = fakeSupabase({ accounts: [
    { id: ACCOUNT, site_id: SITE, provider: "facebook", kind: "page", external_id: "p1", display_name: "Page", status: "connected", connected_by: "mikey" },
    { id: OTHER, site_id: SITE, provider: "facebook", kind: "page", external_id: "p2", display_name: "Other", status: "connected", connected_by: "mikey" },
  ] });
  const post = (n, fields) => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`, site_id: SITE, account_id: ACCOUNT, status: "scheduled", version: 2, scheduled_for: `2026-11-0${n}T09:00:00Z`, ...fields });
  db.tables.openblog_social_posts.push(post(1), post(2, { last_error_code: "rate-limited" }), post(3, { status: "claimed" }), post(4, { status: "unknown" }), post(5, { status: "published" }), post(6, { account_id: OTHER }), post(7, { site_id: "other-site" }));
  const rest = async (method, table, query, body) => {
    const response = await db.fetchImpl(`${settings.url}/rest/v1/${table}?${query}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error("storage");
    return response.json();
  };
  let revoked = 0;
  const connector = { rest, accountOf: (row) => ({ id: row.id, status: row.status }), credentials: { revoke: async (id) => { revoked += 1; await rest("PATCH", "openblog_social_accounts", `id=eq.${id}`, { status: "disconnected", disconnected_at: new Date(T0).toISOString() }); } } };
  const accounts = createAccounts({ connector, settings, providers: {}, fetchImpl: db.fetchImpl, now: () => T0 });
  const view = await accounts.disconnect(ACCOUNT);
  assert.equal(revoked, 1);
  assert.equal(view.canceledAnnouncements, 2);
  const byN = (n) => db.tables.openblog_social_posts[n - 1];
  for (const n of [1, 2]) {
    assert.equal(byN(n).status, "canceled", `post ${n}`);
    assert.equal(byN(n).last_error_code, "account-disconnected");
    assert.equal(byN(n).version, 3, "the version moved, so a stale edit cannot undo it");
    assert.ok(byN(n).canceled_at);
  }
  assert.deepEqual([3, 4, 5, 6, 7].map((n) => byN(n).status), ["claimed", "unknown", "published", "scheduled", "scheduled"], "in flight, unclear, done, another account and another site are untouched");
  for (const call of db.calls.filter((c) => c.url.includes("openblog_social_posts"))) assert.match(decodeURIComponent(call.url), /site_id=eq\.lantern-studios/);

  // A second disconnect finds nothing left; a storage failure while canceling does not undo the disconnect.
  assert.equal((await accounts.disconnect(ACCOUNT)).canceledAnnouncements, 0);
  const failing = createAccounts({ connector: { ...connector, rest: async (method, table, query, body) => { if (table === "openblog_social_posts") throw new Error("down"); return rest(method, table, query, body); } }, settings, providers: {}, fetchImpl: db.fetchImpl, now: () => T0 });
  const after = await failing.disconnect(OTHER);
  assert.equal(after.canceledAnnouncements, undefined, "an unknown count is not reported as zero");
  assert.equal(db.tables.openblog_social_accounts[1].status, "disconnected");
});
