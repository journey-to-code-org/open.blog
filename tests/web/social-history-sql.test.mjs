// The recorded status history of social publishing (ADR 0323): additive, private, append-only, and
// complete whoever writes the row. The static checks always run. The behavioural checks run the
// real SQL against a real Postgres when OPENBLOG_TEST_PG_URL names an empty scratch database (see
// social-queue-sql.test.mjs); they are skipped otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (name) => fileURLToPath(new URL(`../../supabase/${name}`, import.meta.url));
const strip = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
const history = strip(readFileSync(path("social-history.sql"), "utf8"));
const undo = strip(readFileSync(path("social-history-rollback.sql"), "utf8"));
const fullUndo = strip(readFileSync(path("social-rollback.sql"), "utf8"));

test("the history schema is additive, re-runnable, private and append-only", () => {
  assert.doesNotMatch(history, /\bdrop\b|\btruncate\b|\bdelete\s+from\b|\bupdate public\./);
  assert.match(history, /create table if not exists public\.openblog_social_post_events/);
  assert.match(history, /create or replace trigger openblog_social_posts_history after insert or update on public\.openblog_social_posts/);
  assert.match(history, /alter table public\.openblog_social_post_events enable row level security/);
  assert.match(history, /revoke all on public\.openblog_social_post_events from public, anon, authenticated/);
  assert.match(history, /grant select, insert on public\.openblog_social_post_events to service_role/);
  assert.doesNotMatch(history, /grant [^;]*\b(update|delete)\b[^;]*openblog_social_post_events/);
  assert.doesNotMatch(history, /security definer|auth\.users|create policy/);
  assert.doesNotMatch(history, /grant [^;]*\bto (anon|authenticated|public)\b/);
  assert.match(history, /where not exists \(select 1 from public\.openblog_social_post_events e where e\.post_id = p\.id\)/, "the baseline is written once");
  // An event holds no caption, token, lease owner or provider text.
  const table = history.match(/create table if not exists public\.openblog_social_post_events \((.*?)\); create index/)[1];
  for (const column of ["body", "token", "claimed_by", "error_detail", "provider_request_id", "envelope"]) assert.equal(table.includes(column), false, column);
});

test("the rollbacks remove the history, the trigger first", () => {
  for (const text of [undo, fullUndo]) {
    assert.match(text, /drop trigger if exists openblog_social_posts_history on public\.openblog_social_posts/);
    assert.match(text, /drop table if exists public\.openblog_social_post_events/);
    assert.ok(text.indexOf("drop trigger") < text.indexOf("drop table if exists public.openblog_social_post_events"));
  }
  assert.ok(fullUndo.indexOf("openblog_social_post_events") < fullUndo.indexOf("drop table if exists public.openblog_social_posts"));
  assert.doesNotMatch(undo, /drop table if exists public\.openblog_social_(posts|attempts|accounts|credentials|connections|schema)\b/);
});

const url = process.env.OPENBLOG_TEST_PG_URL;
const live = url ? test : test.skip;
const psql = (args, input) => execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], { input, encoding: "utf8" }).trim();
const sql = (text) => psql([], text);

live("against a real Postgres: every change of status, time or caption is recorded, by any writer", () => {
  sql(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
  end $$;`);
  try {
    psql(["-f", path("social.sql")]);
    psql(["-f", path("social-queue.sql")]);
    sql(`insert into openblog_social_accounts (id, site_id, provider, kind, external_id, display_name, connected_by) values
      ('11111111-1111-4111-8111-111111111111','s','linkedin','member','urn:a','A','m');
      insert into openblog_social_posts (id, site_id, account_id, work, canonical_url, body, scheduled_for, idempotency_key, created_by, status, last_error_code)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-000000000000','s','11111111-1111-4111-8111-111111111111','/old/','https://x.example/old/','b', now() - interval '2 hours', 'key-00000000000000old', 'm', 'failed', 'provider-rejected');`);
    psql(["-f", path("social-history.sql")]);
    psql(["-f", path("social-history.sql")]);
    const as = (text) => sql(`set role service_role; ${text}`).split(/\r?\n/).filter((line) => line && line !== "SET");
    assert.deepEqual(as("select change || ' ' || state || ' ' || code from openblog_social_post_events"), ["baseline failed provider-rejected"], "one baseline, even when run twice");

    // Created, rescheduled, edited, claimed, retried, claimed, unknown, settled published: as the service role.
    as(`insert into openblog_social_posts (id, site_id, account_id, work, canonical_url, body, scheduled_for, idempotency_key, created_by)
        values ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','s','11111111-1111-4111-8111-111111111111','/p/','https://x.example/p/','b', now() + interval '1 hour', 'key-0000000000000001', 'm')`);
    as("update openblog_social_posts set scheduled_for = now() - interval '1 minute', version = version + 1 where work = '/p/'");
    as("update openblog_social_posts set body = 'c', version = version + 1 where work = '/p/'");
    as("update openblog_social_posts set version = version + 1 where work = '/p/'");
    assert.deepEqual(as("select count(*) from openblog_social_claim_due('s')"), ["1"]);
    as("select 1 from openblog_social_settle('s', (select id from openblog_social_posts where work = '/p/'), (select version from openblog_social_posts where work = '/p/'), 'retry', null, 503, null, 'provider-unavailable', 'x', now() - interval '1 second')");
    assert.deepEqual(as("select count(*) from openblog_social_claim_due('s')"), ["1"]);
    as("select 1 from openblog_social_settle('s', (select id from openblog_social_posts where work = '/p/'), (select version from openblog_social_posts where work = '/p/'), 'unknown', null, null, null, 'timeout', 'x', now() + interval '5 minutes')");
    as("select 1 from openblog_social_settle('s', (select id from openblog_social_posts where work = '/p/'), (select version from openblog_social_posts where work = '/p/'), 'published', 'urn:li:share:9')");
    assert.deepEqual(
      as("select change || ' ' || state || ' ' || attempt_no || ' ' || coalesce(code, '-') from openblog_social_post_events where post_id = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001' order by id"),
      [
        "created pending 0 -",
        "rescheduled pending 0 -",
        "edited pending 0 -",
        "status processing 1 -",
        "status retrying 1 provider-unavailable",
        "status processing 2 -",
        "status unknown 2 timeout",
        "status published 2 -",
      ],
      "a version-only change records nothing; everything else is recorded in order",
    );
    // Cancel and the delivery-state rule.
    as(`insert into openblog_social_posts (site_id, account_id, work, canonical_url, body, scheduled_for, idempotency_key, created_by)
        values ('s','11111111-1111-4111-8111-111111111111','/c/','https://x.example/c/','b', now() + interval '1 hour', 'key-0000000000000002', 'm')`);
    as("update openblog_social_posts set status = 'canceled', canceled_at = now(), last_error_code = 'account-disconnected', version = version + 1 where work = '/c/'");
    assert.deepEqual(as("select state || ' ' || code from openblog_social_post_events where change = 'status' and status = 'canceled'"), ["canceled account-disconnected"]);
    assert.deepEqual(as("select openblog_social_delivery_state('scheduled', 'deferred') || openblog_social_delivery_state('scheduled', 'lease-expired')"), ["pendingretrying"]);

    // Append-only and private.
    assert.throws(() => sql("set role service_role; update openblog_social_post_events set state = 'published'"), /permission denied/);
    assert.throws(() => sql("set role service_role; delete from openblog_social_post_events"), /permission denied/);
    assert.throws(() => sql("set role anon; select * from openblog_social_post_events"), /permission denied/);
    assert.throws(() => sql("set role authenticated; select * from openblog_social_post_events"), /permission denied/);
    // An event cannot point at another site's post.
    assert.throws(() => sql("set role service_role; insert into openblog_social_post_events (site_id, post_id, change, status, state, attempt_no) values ('t', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'note', 'failed', 'failed', 0)"), /foreign key/);

    // The history's own rollback leaves the queue working.
    psql(["-f", path("social-history-rollback.sql")]);
    assert.equal(sql("select count(*) from pg_tables where tablename = 'openblog_social_post_events'"), "0");
    assert.equal(sql("select count(*) from pg_trigger where tgname = 'openblog_social_posts_history'"), "0");
    as("update openblog_social_posts set body = 'd', version = version + 1 where work = '/c/'");
    psql(["-f", path("social-history.sql")]);
  } finally {
    psql(["-f", path("social-queue-rollback.sql")]);
    psql(["-f", path("social-rollback.sql")]);
  }
  assert.equal(sql("select count(*) from pg_tables where tablename like 'openblog_social%'"), "0");
  assert.equal(sql("select count(*) from pg_proc where proname like 'openblog_social%'"), "0");
});
