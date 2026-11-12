// Visit attribution in the counters open.blog writes but does not run (epic DIST9, #615; ADR 0407):
// the Cloudflare Worker template and the hosted engagement function. Both carry the block generated
// from openblog_core::outcome::attribution_js (its Rust test fails when either copy drifts); these
// tests run the shared cases in tests/fixtures/attribution-cases.json through each copy, and check
// what each counter stores and exports.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHandler } from "../../netlify/functions/engagement.mjs";
import * as hosted from "../../netlify/lib/attribution.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const cases = JSON.parse(read("../fixtures/attribution-cases.json"));
const workerSource = read("../../crates/openblog-cli/templates/counter-worker.js");
const asModule = (source) => import(`data:text/javascript,${encodeURIComponent(source)}`);

const BEGIN = "// BEGIN openblog attribution";
const END = "// END openblog attribution";
const block = (source) => source.slice(source.indexOf(BEGIN), source.indexOf(END) + END.length);

const workerRules = await asModule(
  `${block(workerSource)}\nexport { attributionArrival, attributionForHost, attributionForUtm, attributionOwnHosts };`,
);

for (const [name, rules] of [
  ["the Worker", workerRules],
  ["the hosted function", hosted],
]) {
  test(`${name} attributes every shared case as the engine does`, () => {
    for (const c of cases.hosts) assert.equal(rules.attributionForHost(c.host, c.own), c.expect, JSON.stringify(c));
    for (const c of cases.utm) assert.equal(rules.attributionForUtm(c.value), c.expect, JSON.stringify(c));
    for (const c of cases.arrivals) {
      assert.equal(rules.attributionArrival({ campaigns: c.campaigns, source: c.source, referrerHost: c.referrerHost, ownHosts: c.own }), c.expect, JSON.stringify(c));
    }
  });

  test(`${name} reads only clean host=destination pairs from its settings`, () => {
    assert.deepEqual(rules.attributionOwnHosts("hachyderm.io=mastodon,me.ghost.io=ghost"), [
      ["hachyderm.io", "mastodon"],
      ["me.ghost.io", "ghost"],
    ]);
    assert.deepEqual(rules.attributionOwnHosts("WWW.Hachyderm.IO=Mastodon,hachyderm.io=ghost"), [["hachyderm.io", "mastodon"]]);
    for (const bad of ["", "x=mastodon", "a..b=mastodon", "evil.example=tracker", "a.example=ghost=x", "a b.c=ghost", "-a.b=ghost", undefined]) {
      assert.deepEqual(rules.attributionOwnHosts(bad), [], String(bad));
    }
    const many = Array.from({ length: 40 }, (_, n) => `i${n}.example=mastodon`).join(",");
    assert.equal(rules.attributionOwnHosts(many).length, 32);
  });
}

test("the two copies of the generated block are the same text", () => {
  assert.equal(block(workerSource), block(read("../../netlify/lib/attribution.mjs")));
});

test("the hosted settings include only a valid social Mastodon origin", () => {
  const valid = hosted.attributionSettings({
    OPENBLOG_ARRIVALS_ENABLED: "true",
    OPENBLOG_ANALYTICS_CAMPAIGNS: "true",
    OPENBLOG_ANALYTICS_OWN_HOSTS: "hachyderm.io=mastodon",
    OPENBLOG_SOCIAL_MASTODON_INSTANCE: "https://mastodon.social",
  });
  assert.deepEqual(valid, {
    enabled: true,
    campaigns: true,
    ownHosts: [["hachyderm.io", "mastodon"], ["mastodon.social", "mastodon"]],
  });
  for (const invalid of ["http://mastodon.social", "https://user@mastodon.social", "https://mastodon.social/path", "not a URL"]) {
    assert.deepEqual(hosted.attributionSettings({ OPENBLOG_SOCIAL_MASTODON_INSTANCE: invalid }).ownHosts, [], invalid);
  }
});

// A Workers KV namespace in memory.
function kv() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true };
    },
  };
}

const worker = (await asModule(workerSource)).default;
const day = () => new Date().toISOString().slice(0, 10);
const hit = (env, body, headers = {}, ip = "198.51.100.1") =>
  worker.fetch(
    new Request("https://counter.example/hit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://blog.example", "CF-Connecting-IP": ip, ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );
const stats = async (env) => JSON.parse(await env.VIEWS.get(`day:${day()}`));

test("the Worker attributes counted views per day, destination and page, and keeps the day's shape without one", async () => {
  const env = { VIEWS: kv(), SITE_ORIGIN: "https://blog.example", EXPORT_SECRET: "s", CAMPAIGNS: "false", OWN_HOSTS: "hachyderm.io=mastodon" };
  assert.equal((await hit(env, { path: "/a/", referrer: "https://example.org/x" })).status, 200);
  assert.equal("arrivals" in (await stats(env)), false, "no arrival, no arrivals key");

  await hit(env, { path: "/a/", referrer: "https://bsky.app/profile/me" });
  await hit(env, { path: "/a/", referrer: "https://hachyderm.io/@me/1" });
  await hit(env, { path: "/b/", referrer: "https://www.hachyderm.io/" });
  // Campaign tags are off: the source is ignored and the referrer decides.
  await hit(env, { path: "/b/", referrer: "", source: "pinterest" });
  // Not counted, so not attributed.
  await hit(env, { path: "/a/", referrer: "https://bsky.app/" }, { DNT: "1" });
  assert.deepEqual((await stats(env)).arrivals, { bluesky: { "/a/": 1 }, mastodon: { "/a/": 1, "/b/": 1 } });

  const exported = await worker.fetch(new Request("https://counter.example/export", { headers: { Authorization: "Bearer s" } }), env);
  assert.equal(exported.status, 200);
  const data = await exported.json();
  assert.deepEqual(data.days[day()].arrivals.mastodon, { "/a/": 1, "/b/": 1 });
});

test("the Worker counts a campaign tag only when turned on and never stores an unknown key", async () => {
  const env = { VIEWS: kv(), SITE_ORIGIN: "https://blog.example", CAMPAIGNS: "true", OWN_HOSTS: "" };
  await hit(env, { path: "/a/", referrer: "https://bsky.app/", source: "Pinterest" });
  await hit(env, { path: "/a/", referrer: "", source: "newsletter" });
  await hit(env, { path: "/a/", referrer: "", source: "__proto__" });
  await hit(env, { path: "/a/", referrer: "", source: { toString: () => "pinterest" } });
  assert.deepEqual((await stats(env)).arrivals, { pinterest: { "/a/": 1 } });
});

const environment = {
  SUPABASE_URL: "https://database.example",
  SUPABASE_SECRET_KEY: "sb_secret_test_server_only",
  OPENBLOG_SITE_ID: "lantern",
  OPENBLOG_SITE_ORIGIN: "https://blog.example",
  OPENBLOG_ADMIN_API_KEY: "admin-secret",
  OPENBLOG_ANALYTICS_SALT: "daily-hash-secret",
};
const event = (path, method = "GET", body, headers = {}) => ({
  path: `/api/${path}`,
  httpMethod: method,
  headers: { origin: "https://blog.example", ...headers },
  queryStringParameters: {},
  body: body === undefined ? undefined : JSON.stringify(body),
});
function database(calls, { failArrival = false } = {}) {
  return async (url, options = {}) => {
    const rpc = url.split("/rpc/")[1];
    calls.push({ rpc, body: options.body ? JSON.parse(options.body) : null });
    if (rpc === "openblog_consume_rate_limit") return { ok: true, status: 200, json: async () => ({ allowed: true }) };
    if (rpc === "openblog_record_arrival" && failArrival) return { ok: false, status: 500, json: async () => ({}) };
    if (rpc === "openblog_analytics_export") return { ok: true, status: 200, json: async () => ({ version: 1, days: {}, totals: {} }) };
    return { ok: true, status: 200, json: async () => ({ views: 3 }) };
  };
}
const now = () => new Date("2026-11-11T14:00:00Z");

test("the hosted function attributes a counted view only once arrivals are enabled", async () => {
  const off = [];
  await createHandler({ env: environment, fetchImpl: database(off), now })(event("hit", "POST", { path: "/a/", referrer: "https://bsky.app/" }));
  assert.equal(off.some((call) => call.rpc === "openblog_record_arrival"), false, "nothing changes until the deployer opts in");

  const env = {
    ...environment,
    OPENBLOG_ARRIVALS_ENABLED: "true",
    OPENBLOG_ANALYTICS_OWN_HOSTS: "fosstodon.org=mastodon",
    OPENBLOG_SOCIAL_MASTODON_INSTANCE: "https://hachyderm.io",
  };
  const record = async (body, headers) => {
    const calls = [];
    const response = await createHandler({ env, fetchImpl: database(calls), now })(event("hit", "POST", body, headers));
    return { response, arrival: calls.find((call) => call.rpc === "openblog_record_arrival")?.body ?? null };
  };
  let { response, arrival } = await record({ path: "/a/", referrer: "https://www.bsky.app/profile/me" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(arrival, { p_site_id: "lantern", p_day: "2026-11-11", p_destination: "bluesky", p_path: "/a/" });
  ({ arrival } = await record({ path: "/a/", referrer: "https://hachyderm.io/@me" }));
  assert.equal(arrival.p_destination, "mastodon", "the social Mastodon instance");
  ({ arrival } = await record({ path: "/a/", referrer: "https://fosstodon.org/@me" }));
  assert.equal(arrival.p_destination, "mastodon", "a listed instance");
  ({ arrival } = await record({ path: "/a/", referrer: "https://example.org/", source: "pinterest" }));
  assert.equal(arrival, null, "campaign tags are off and the referrer is unknown");
  ({ response, arrival } = await record({ path: "/a/", referrer: "https://bsky.app/" }, { dnt: "1" }));
  assert.equal(response.statusCode, 204);
  assert.equal(arrival, null);

  const tagged = [];
  await createHandler({ env: { ...env, OPENBLOG_ANALYTICS_CAMPAIGNS: "true" }, fetchImpl: database(tagged), now })(
    event("hit", "POST", { path: "/a/", referrer: "https://bsky.app/", source: "pinterest" }),
  );
  assert.equal(tagged.find((call) => call.rpc === "openblog_record_arrival").body.p_destination, "pinterest");
});

test("a failed arrival keeps the view, and the export is for the author only", async () => {
  const env = { ...environment, OPENBLOG_ARRIVALS_ENABLED: "true" };
  const response = await createHandler({ env, fetchImpl: database([], { failArrival: true }), now })(
    event("hit", "POST", { path: "/a/", referrer: "https://bsky.app/" }),
  );
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).views, 3);

  const calls = [];
  const handler = createHandler({ env, fetchImpl: database(calls), now });
  assert.equal((await handler(event("export"))).statusCode, 401);
  const exported = await handler(event("export", "GET", undefined, { authorization: "Bearer admin-secret" }));
  assert.equal(exported.statusCode, 200);
  assert.deepEqual(JSON.parse(exported.body), { version: 1, days: {}, totals: {} });
  assert.deepEqual(calls.at(-1), { rpc: "openblog_analytics_export", body: { p_site_id: "lantern" } });

  const off = await createHandler({ env: environment, fetchImpl: database([]), now })(
    event("export", "GET", undefined, { authorization: "Bearer admin-secret" }),
  );
  assert.equal(off.statusCode, 404);
});

test("the arrivals schema is additive, private and has a rollback", () => {
  const sql = read("../../supabase/arrivals.sql");
  const rollback = read("../../supabase/arrivals-rollback.sql");
  const netlify = read("../../netlify.toml");
  assert.match(sql, /create table if not exists public\.openblog_daily_arrivals/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.openblog_daily_arrivals from public, anon, authenticated/);
  assert.doesNotMatch(sql, /\bdrop\b|alter table public\.openblog_daily_(views|referrers|visitors)/i);
  assert.match(netlify, /from = "\/api\/export"\s+to = "\/\.netlify\/functions\/engagement\/export"/);
  for (const name of ["openblog_record_arrival", "openblog_analytics_export", "openblog_daily_arrivals"]) assert.match(rollback, new RegExp(name));
});
