// The hosted Webmention request store (ADRs 0364 and 0365), run for real. The static checks of the
// schema are in webmention-receiver.test.mjs; this file runs supabase/webmention.sql and its
// rollback against a real Postgres when OPENBLOG_TEST_PG_URL names an empty scratch database (a
// superuser may create roles and tables in it; the test removes everything it adds). It is
// skipped otherwise.
//
//   OPENBLOG_TEST_PG_URL=postgresql://postgres@127.0.0.1:5432/scratch node --test tests/web/webmention-sql.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const path = (name) => fileURLToPath(new URL(`../../supabase/${name}`, import.meta.url));
const url = process.env.OPENBLOG_TEST_PG_URL;
const live = url ? test : test.skip;
const psql = (args, input) => execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], { input, encoding: "utf8" }).trim();
const sql = (text) => psql([], text);
const as = (text) =>
  sql(`set role service_role; ${text}`)
    .split(/\r?\n/)
    .filter((line) => line && line !== "SET");
const receive = (source, host, limits = "") =>
  as(`select openblog_webmention_receive('s', '${source}', 'https://bread.example.org/posts/loaf/', '${host}'${limits})`)[0];

live("against a real Postgres: receive, repeats, limits, the lock, a fenced settle and the rollback", async () => {
  sql(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
  end $$;`);
  try {
    psql(["-f", path("webmention.sql")]);
    psql(["-f", path("webmention.sql")]);

    // The public roles can neither call the functions nor read the table.
    assert.throws(() => sql("set role anon; select openblog_webmention_receive('s','https://a.example/1','https://b.example/1','a.example')"), /permission denied/);
    assert.throws(() => sql("set role authenticated; select count(*) from openblog_webmention_requests"), /permission denied/);

    // A new pair is accepted; the same pair again within a minute changes nothing.
    assert.equal(receive("https://crumb.example/1", "crumb.example"), "accepted");
    assert.equal(receive("https://crumb.example/1", "crumb.example"), "repeat");
    assert.deepEqual(as("select version from openblog_webmention_requests where source = 'https://crumb.example/1'"), ["1"]);

    // After a minute the same pair raises the version, so a pull that took version 1 deletes nothing.
    sql("update openblog_webmention_requests set received_at = now() - interval '2 minutes'");
    assert.equal(receive("https://crumb.example/1", "crumb.example"), "accepted");
    const [id, version] = as("select id || ' ' || version from openblog_webmention_requests where source = 'https://crumb.example/1'")[0].split(" ");
    assert.equal(version, "2");
    assert.deepEqual(as(`select openblog_webmention_settle('s', '[{"id":"${id}","version":1}]')`), ["0"]);
    assert.deepEqual(as(`select openblog_webmention_settle('other', '[{"id":"${id}","version":2}]')`), ["0"], "another site settles nothing");
    assert.deepEqual(as(`select openblog_webmention_settle('s', '[{"id":"${id}","version":2}]')`), ["1"]);
    assert.deepEqual(as("select count(*) from openblog_webmention_requests"), ["0"]);
    assert.throws(() => as(`select openblog_webmention_settle('s', '{"id":"${id}"}')`), /invalid webmention settle request/);
    assert.throws(() => receive("https://crumb.example/2", "crumb.example", ", 0, 10"), /invalid webmention limits/);

    // One host may keep only so many waiting, and the site only so many in all.
    assert.equal(receive("https://crumb.example/a", "crumb.example", ", 2, 3"), "accepted");
    assert.equal(receive("https://crumb.example/b", "crumb.example", ", 2, 3"), "accepted");
    assert.equal(receive("https://crumb.example/c", "crumb.example", ", 2, 3"), "host-limit");
    assert.equal(receive("https://oven.example/a", "oven.example", ", 2, 3"), "accepted");
    assert.equal(receive("https://mill.example/a", "mill.example", ", 2, 3"), "site-limit");
    assert.deepEqual(as("select count(*) from openblog_webmention_requests"), ["3"]);
    sql("delete from openblog_webmention_requests");

    // Two requests from one host at once, with room for one: the per-site lock lets only one in.
    const session = (source, hold) =>
      new Promise((resolve, reject) => {
        const child = spawn("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-At"]);
        let out = "";
        child.stdout.on("data", (chunk) => (out += chunk));
        child.on("close", (code) => (code === 0 ? resolve(out.split(/\r?\n/).filter((line) => line.startsWith("R:"))) : reject(new Error(`psql ${code}`))));
        child.stdin.end(
          `set role service_role; begin; select 'R:' || openblog_webmention_receive('s', '${source}', 'https://bread.example.org/posts/loaf/', 'crumb.example', 1, 10); select pg_sleep(${hold}); commit;`,
        );
      });
    const [first, second] = await Promise.all([
      session("https://crumb.example/x", 2),
      new Promise((resolve) => setTimeout(resolve, 700)).then(() => session("https://crumb.example/y", 0)),
    ]);
    assert.deepEqual([...first, ...second].sort(), ["R:accepted", "R:host-limit"]);
    assert.deepEqual(as("select count(*) from openblog_webmention_requests"), ["1"]);
  } finally {
    psql(["-f", path("webmention-rollback.sql")]);
  }
  assert.equal(sql("select count(*) from pg_tables where tablename like 'openblog_webmention%'"), "0");
  assert.equal(sql("select count(*) from pg_proc where proname like 'openblog_webmention%'"), "0");
});
