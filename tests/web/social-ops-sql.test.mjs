// The operations functions of social publishing (ADR 0701) against a real Postgres: health counts,
// the sweep, and retention that deletes only what ended long ago. Runs when OPENBLOG_TEST_PG_URL
// names an empty scratch database (see social-queue-sql.test.mjs); skipped otherwise. The static
// checks of the same file are in social-ops.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const path = (name) => fileURLToPath(new URL(`../../supabase/${name}`, import.meta.url));
const url = process.env.OPENBLOG_TEST_PG_URL;
const live = url ? test : test.skip;
const psql = (args, input) => execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], { input, encoding: "utf8" }).trim();
const sql = (text) => psql([], text);
const as = (text) => sql(`set role service_role; ${text}`).split(/\r?\n/).filter((line) => line && line !== "SET");

live("against a real Postgres: health, sweep and retention", () => {
  sql(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
  end $$;`);
  try {
    for (const file of ["social.sql", "social-queue.sql", "social-history.sql", "social-ops.sql", "social-ops.sql"]) psql(["-f", path(file)]);
    const A = "11111111-1111-4111-8111-111111111111";
    const GONE = "22222222-2222-4222-8222-222222222222";
    const PAUSED = "33333333-3333-4333-8333-333333333333";
    const post = (n, status, cols = "", vals = "", account = A) => `insert into openblog_social_posts (id, site_id, account_id, work, canonical_url, body, scheduled_for, idempotency_key, created_by, status${cols})
      values ('aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}','s','${account}','/p${n}/','https://x.example/p${n}/','b', now() - interval '2 hours', 'key-000000000000000${n}', 'm', '${status}'${vals});`;
    sql(`insert into openblog_social_accounts (id, site_id, provider, kind, external_id, display_name, connected_by) values ('${A}','s','linkedin','member','urn:a','A','m');
      insert into openblog_social_accounts (id, site_id, provider, kind, external_id, display_name, connected_by, status, disconnected_at) values ('${GONE}','s','linkedin','member','urn:gone','Gone','m','disconnected', now() - interval '400 days');
      insert into openblog_social_credentials (account_id, site_id, status, revoked_at) values ('${GONE}','s','revoked', now() - interval '400 days');
      ${post(1, "scheduled")}
      ${post(2, "published", ", published_at, provider_post_id", ", now(), 'urn:li:share:2'")}
      ${post(3, "unknown")}
      ${post(4, "failed")}
      ${post(5, "canceled", ", canceled_at", ", now()")}
      insert into openblog_social_attempts (site_id, post_id, attempt_no, worker, finished_at, outcome) values ('s','aaaaaaaa-aaaa-4aaa-8aaa-000000000004',1,'@worker', now(), 'failed');
      insert into openblog_social_connections (site_id, provider, status, state_hash, redirect_uri, requested_scopes, created_by, expires_at, key_id, envelope)
        values ('s','linkedin','authorized', repeat('a', 64), 'https://x.example/cb', 'openid', 'm', now() - interval '1 minute', 'k1', '{"c":"x"}'),
               ('s','linkedin','completed', repeat('b', 64), 'https://x.example/cb', 'openid', 'm', now() - interval '400 days', null, null);
      update openblog_social_connections set updated_at = now() - interval '400 days' where status = 'completed';`);

    // Health: counts only, this site only.
    assert.deepEqual(as("select due || ' ' || overdue || ' ' || needs_review || ' ' || stale_connections from openblog_social_health('s', 900)"), ["1 1 1 1"]);
    assert.deepEqual(as("select due from openblog_social_health('other')"), ["0"]);
    assert.throws(() => sql("set role anon; select * from openblog_social_health('s')"), /permission denied/);

    // What the claim holds back on purpose is counted apart, never as late: a Page paused by a rate
    // limit for hours, and a provider the worker has no adapter for (passed as the claim takes it).
    sql(`insert into openblog_social_accounts (id, site_id, provider, kind, external_id, display_name, connected_by, paused_until) values ('${PAUSED}','s','facebook','page','1234','P','m', now() + interval '3 hours');
      ${post(6, "scheduled", "", "", PAUSED)}`);
    const health = (skip) => as(`select due || ' ' || overdue || ' ' || (oldest_due_at is not null) || ' ' || accounts_paused || ' ' || waiting_on_pause || ' ' || waiting_on_provider from openblog_social_health('s', 900${skip})`);
    assert.deepEqual(health(""), ["1 1 true 1 1 0"], "the paused Page's past-due announcement is not overdue");
    assert.deepEqual(health(", array['linkedin']"), ["0 0 false 1 1 1"], "nothing the claim could take is late, so no backlog-overdue");
    assert.deepEqual(as("select count(*) from openblog_social_claim_due('s', '@worker', 25, 300, 5, 25, array['linkedin'])"), ["0"], "and the claim agrees: it takes neither");
    sql(`update openblog_social_accounts set paused_until = now() - interval '1 minute' where id = '${PAUSED}'`);
    assert.deepEqual(health(", array['linkedin']"), ["1 1 true 0 0 1"], "once the pause ends it counts, and is late, again");
    sql(`update openblog_social_accounts set paused_until = now() + interval '3 hours' where id = '${PAUSED}'`);

    // Sweep: the abandoned handshake loses its sealed tokens; nothing is deleted.
    assert.deepEqual(as("select reaped || ' ' || expired_connections from openblog_social_sweep('s')"), ["0 1"]);
    assert.deepEqual(as("select status || ' ' || (envelope is null) || ' ' || (key_id is null) from openblog_social_connections where state_hash = repeat('a', 64)"), ["expired true true"]);

    // Retention: refuses a short period; deletes only what ended long ago, with its attempts and history.
    assert.throws(() => sql("set role service_role; select * from openblog_social_prune('s', 29)"), /30 to 3650/);
    assert.throws(() => sql("set role service_role; delete from openblog_social_posts"), /permission denied/, "the service role still cannot delete by itself");
    assert.throws(() => sql("set role anon; select * from openblog_social_prune('s', 90)"), /permission denied/);
    assert.deepEqual(as("select posts || ' ' || attempts || ' ' || connections || ' ' || accounts from openblog_social_prune('s', 90)"), ["0 0 1 1"], "no announcement is old enough yet; the old handshake and the long-disconnected account are");
    sql("alter table openblog_social_posts disable trigger openblog_social_posts_history; update openblog_social_posts set updated_at = now() - interval '100 days'; alter table openblog_social_posts enable trigger openblog_social_posts_history;");
    assert.deepEqual(as("select posts || ' ' || attempts || ' ' || connections || ' ' || accounts from openblog_social_prune('s', 90)"), ["3 1 0 0"]);
    assert.deepEqual(as("select work || ' ' || status from openblog_social_posts order by work"), ["/p1/ scheduled", "/p3/ unknown", "/p6/ scheduled"], "scheduled and unknown are never pruned");
    assert.deepEqual(as("select count(*) from openblog_social_post_events where post_id in ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-000000000004')"), ["0"], "history goes with its post");
    assert.deepEqual(as("select count(*) from openblog_social_accounts where id = '" + GONE + "'"), ["0"], "a long-disconnected account nothing refers to is removed");
    assert.deepEqual(as("select count(*) from openblog_social_credentials"), ["0"]);
    assert.deepEqual(as("select count(*) from openblog_social_accounts where id = '" + A + "'"), ["1"], "an account with announcements stays");

    psql(["-f", path("social-ops-rollback.sql")]);
    assert.equal(sql("select count(*) from pg_proc where proname in ('openblog_social_health','openblog_social_sweep','openblog_social_prune')"), "0");
    assert.equal(sql("select count(*) from openblog_social_posts"), "3", "the rollback touches no row");
  } finally {
    psql(["-f", path("social-rollback.sql")]);
  }
  assert.equal(sql("select count(*) from pg_tables where tablename like 'openblog_social%'"), "0");
  assert.equal(sql("select count(*) from pg_proc where proname like 'openblog_social%'"), "0");
});
