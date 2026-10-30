// The hosted Webmention receiver (story #402, ADRs 0863 and 0864), over fakes only: a scripted
// Supabase and a scripted site. Nothing here reaches a network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHandler } from "../../netlify/functions/webmention.mjs";
import { acceptedTargets, checkRequest, readForm, webmentionSettings } from "../../netlify/lib/webmention-receiver.mjs";

const KEY = "k".repeat(40);
const ENV = {
  OPENBLOG_WEBMENTION_ENABLED: "true",
  SUPABASE_URL: "https://db.example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  OPENBLOG_SITE_ID: "site-1",
  OPENBLOG_SITE_ORIGIN: "https://blog.example.org",
  OPENBLOG_WEBMENTION_ADMIN_KEY: KEY,
  OPENBLOG_WEBMENTION_BLOCKED_HOSTS: "spam.example",
};
const TARGET = "https://blog.example.org/posts/hello/";

function harness({ env = ENV, manifest = { version: 1, targets: [TARGET] }, rpc = () => "accepted", rows = [] } = {}) {
  const db = [];
  const site = [];
  const fetchImpl = async (url, options = {}) => {
    db.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined });
    if (url.includes("/rpc/openblog_webmention_receive")) return Response.json(rpc(JSON.parse(options.body)));
    if (url.includes("/rpc/openblog_webmention_settle")) return Response.json(JSON.parse(options.body).p_items.length);
    if (url.includes("/rest/v1/openblog_webmention_requests")) return Response.json(rows);
    throw new Error(`unexpected ${url}`);
  };
  const siteFetchImpl = async (url, options) => {
    site.push({ url, options });
    return manifest ? Response.json(manifest) : new Response("", { status: 404 });
  };
  return { handler: createHandler({ env, fetchImpl, siteFetchImpl }), db, site };
}

const form = (fields, extra = {}) => ({
  httpMethod: "POST",
  path: "/api/webmention",
  headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
  body: new URLSearchParams(fields).toString(),
  ...extra,
});

test("off by default: every route is a 404 and nothing is touched", async () => {
  for (const env of [{}, { ...ENV, OPENBLOG_WEBMENTION_ENABLED: "yes" }, { ...ENV, OPENBLOG_WEBMENTION_ADMIN_KEY: "short" }]) {
    const { handler, db, site } = harness({ env });
    const reply = await handler(form({ source: "https://other.example/a", target: TARGET }));
    assert.equal(reply.statusCode, 404);
    assert.equal(db.length + site.length, 0);
  }
  assert.deepEqual(webmentionSettings({ ...ENV, OPENBLOG_WEBMENTION_ADMIN_KEY: ENV.SUPABASE_SECRET_KEY.padEnd(40, "x"), OPENBLOG_ADMIN_API_KEY: ENV.SUPABASE_SECRET_KEY.padEnd(40, "x") }).problems, ["OPENBLOG_WEBMENTION_ADMIN_KEY"]);
});

test("a valid Webmention is stored and answered 202 without fetching the source", async () => {
  const { handler, db, site } = harness();
  const reply = await handler(form({ source: "https://other.example/reply#top", target: `${TARGET}#comments` }));
  assert.equal(reply.statusCode, 202);
  assert.equal(site.length, 1);
  assert.equal(site[0].url, "https://blog.example.org/openblog-webmention.json", "only the site's own manifest is read");
  assert.equal(site[0].options.redirect, "error");
  assert.equal(db.length, 1);
  assert.deepEqual(db[0].body, { p_site_id: "site-1", p_source: "https://other.example/reply#top", p_target: TARGET, p_source_host: "other.example", p_host_limit: 20, p_site_limit: 1000 });
  assert.ok(![...site, ...db].some(({ url }) => url.includes("other.example")), "the source is never requested");
});

test("requests are checked as the recommendation requires, with fixed messages", async () => {
  const cases = [
    [{ source: "ftp://other.example/a", target: TARGET }, "not-web"],
    [{ source: TARGET, target: `${TARGET}#x` }, "same-address"],
    [{ source: "https://other.example/a", target: "https://elsewhere.example/posts/hello/" }, "other-site"],
    [{ source: "https://blog.example.org/x", target: TARGET }, "own-site"],
    [{ source: "https://u:p@other.example/a", target: TARGET }, "credentials"],
    [{ source: "https://other.example/a", target: "https://blog.example.org/drafts/secret/" }, "not-accepted"],
    [{ source: "https://other.example/a" }, "missing-parameters"],
  ];
  for (const [fields, code] of cases) {
    const { handler, db } = harness();
    const reply = await handler(form(fields));
    assert.equal(reply.statusCode, 400, code);
    assert.equal(JSON.parse(reply.body).error, code);
    assert.equal(db.length, 0, `${code} stores nothing`);
  }
  const twice = await harness().handler({ ...form({}), body: `source=https://a.example/1&source=https://b.example/2&target=${encodeURIComponent(TARGET)}` });
  assert.equal(JSON.parse(twice.body).error, "missing-parameters");
  const json = await harness().handler(form({ source: "https://other.example/a", target: TARGET }, { headers: { "content-type": "application/json" } }));
  assert.equal(json.statusCode, 400);
  const big = await harness().handler(form({ source: `https://other.example/${"a".repeat(9000)}`, target: TARGET }));
  assert.equal(big.statusCode, 413);
  assert.equal((await harness().handler({ httpMethod: "GET", path: "/api/webmention" })).statusCode, 405);
});

test("a blocked host is answered like anyone and nothing is stored; limits answer 429", async () => {
  const blocked = harness();
  const reply = await blocked.handler(form({ source: "https://www.spam.example/x", target: TARGET }));
  assert.equal(reply.statusCode, 202);
  assert.equal(blocked.db.length, 0);
  for (const outcome of ["host-limit", "site-limit"]) {
    const limited = await harness({ rpc: () => outcome }).handler(form({ source: "https://other.example/a", target: TARGET }));
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.headers["retry-after"], "3600");
  }
  assert.equal((await harness({ rpc: () => "repeat" }).handler(form({ source: "https://other.example/a", target: TARGET }))).statusCode, 202);
});

test("an unreadable manifest or a storage failure is a safe failure that says nothing stored", async () => {
  const missing = await harness({ manifest: null }).handler(form({ source: "https://other.example/a", target: TARGET }));
  assert.equal(missing.statusCode, 503);
  const broken = await harness({ rpc: () => { throw new Error("db said: secret detail"); } }).handler(form({ source: "https://other.example/a", target: TARGET }));
  assert.equal(broken.statusCode, 500);
  assert.doesNotMatch(broken.body, /secret detail|sb_secret/);
});

test("the inbox routes need the receiver's own key and settle by version", async () => {
  const rows = [{ id: "0b6c3d1e-1111-4222-8333-944455556666", version: 2, source: "https://other.example/a", target: TARGET, received_at: "2026-10-29T10:00:00Z" }];
  const { handler, db } = harness({ rows });
  for (const authorization of [undefined, "Bearer wrong", `Basic ${KEY}`, `Bearer ${ENV.SUPABASE_SECRET_KEY}`]) {
    const reply = await handler({ httpMethod: "GET", path: "/api/webmention/inbox", headers: authorization ? { Authorization: authorization } : {} });
    assert.equal(reply.statusCode, 401);
  }
  assert.equal(db.length, 0, "an unauthorized caller reads nothing");
  const taken = await handler({ httpMethod: "GET", path: "/.netlify/functions/webmention/inbox", rawQuery: "limit=500", headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(taken.statusCode, 200);
  assert.deepEqual(JSON.parse(taken.body), { requests: [{ id: rows[0].id, version: 2, source: rows[0].source, target: TARGET, receivedAt: 1793268000 }] });
  assert.match(db[0].url, /site_id=eq\.site-1&.*limit=100$/);
  const settled = await handler({ httpMethod: "POST", path: "/api/webmention/inbox/settle", headers: { authorization: `Bearer ${KEY}` }, body: JSON.stringify({ items: [{ id: rows[0].id, version: 2 }] }) });
  assert.deepEqual(JSON.parse(settled.body), { settled: 1 });
  assert.deepEqual(db.at(-1).body, { p_site_id: "site-1", p_items: [{ id: rows[0].id, version: 2 }] });
  const bad = await handler({ httpMethod: "POST", path: "/api/webmention/inbox/settle", headers: { authorization: `Bearer ${KEY}` }, body: JSON.stringify({ items: [{ id: "x", version: 1 }] }) });
  assert.equal(bad.statusCode, 400);
});

test("the pure checks agree with the command-line tool's", () => {
  assert.deepEqual(checkRequest("https://Other.Example./a", TARGET, ENV.OPENBLOG_SITE_ORIGIN).sourceHost, "other.example");
  assert.equal(checkRequest("https://other.example/a", "http://blog.example.org/posts/hello/", ENV.OPENBLOG_SITE_ORIGIN).problem, "other-site");
  assert.equal(readForm("source=a").problem, "missing-parameters");
  assert.equal(acceptedTargets({ version: 2, targets: [] }, ENV.OPENBLOG_SITE_ORIGIN), null);
  assert.deepEqual([...acceptedTargets({ version: 1, targets: [TARGET, "https://evil.example/x", 7] }, ENV.OPENBLOG_SITE_ORIGIN)], [TARGET]);
});

test("the schema is additive, private and rolled back by its own file", () => {
  const read = (name) => readFileSync(fileURLToPath(new URL(`../../supabase/${name}`, import.meta.url)), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
  const schema = read("webmention.sql");
  const undo = read("webmention-rollback.sql");
  assert.doesNotMatch(schema, /\bdrop\b|\btruncate\b|alter table (?!public\.openblog_webmention_requests enable)/);
  assert.match(schema, /create table if not exists public\.openblog_webmention_requests/);
  assert.match(schema, /enable row level security/);
  assert.match(schema, /revoke all on public\.openblog_webmention_requests from public, anon, authenticated/);
  assert.doesNotMatch(schema, /create policy|auth\.users|security definer/);
  assert.match(schema, /pg_advisory_xact_lock/);
  assert.match(schema, /r\.version = i\.version/, "settle deletes only the version taken");
  for (const name of ["openblog_webmention_receive", "openblog_webmention_settle"]) {
    assert.match(schema, new RegExp(`grant execute on function public\\.${name}\\(`));
    assert.match(undo, new RegExp(`drop function if exists public\\.${name}\\(`));
  }
  assert.match(undo, /drop table if exists public\.openblog_webmention_requests/);
  assert.doesNotMatch(undo, /openblog_comments|openblog_social/);
  assert.doesNotMatch(readFileSync(fileURLToPath(new URL("../../supabase/webmention.sql", import.meta.url)), "utf8"), /\r/);
});
