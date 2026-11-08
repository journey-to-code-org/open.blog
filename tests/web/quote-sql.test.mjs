import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A static contract for supabase/quote.sql and its rollback (ADR 0381). The social SQL is also run
// against a real Postgres in CI; this checks the same privacy shape without one.
const read = (name) => readFileSync(new URL(`../../supabase/${name}`, import.meta.url), "utf8");
const strip = (sql) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const up = strip(read("quote.sql"));
const down = strip(read("quote-rollback.sql"));

test("it is additive, repeatable and in one transaction", () => {
  assert.ok(up.startsWith("begin;") && up.endsWith("commit;"));
  assert.ok(!/\bdrop\b|\bdelete from\b|\btruncate\b|\balter table [^;]* drop\b/.test(up.replace("on delete", "")));
  for (const create of up.match(/create table [^(]*/g)) assert.match(create, /if not exists/);
  for (const create of up.match(/create (unique )?index [^ ]* ?[^ ]* ?[^ ]* ?/g) || []) assert.match(create, /if not exists/);
});

test("only service_role can touch the tables, and every row belongs to a site", () => {
  for (const table of ["openblog_quote_schema", "openblog_quote_requests"]) {
    assert.match(up, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(up, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
  }
  assert.ok(!/create policy/.test(up), "no policy: row level security denies every public role");
  assert.ok(!/grant [^;]* to (anon|authenticated|public)/.test(up));
  assert.match(up, /site_id text not null check/);
  assert.match(up, /unique \(site_id, token_hash\)/, "a token sends one request");
});

test("the photo bucket is private and photos are bounded", () => {
  assert.match(up, /values \('openblog-quote-photos', 'openblog-quote-photos', false\)/);
  assert.match(up, /jsonb_array_length\(photos\) <= 5/);
});

test("it keeps no raw address and the notification state is closed", () => {
  assert.match(up, /client_hash text not null/);
  assert.ok(!/\bip(_address)?\b/.test(up));
  assert.match(up, /notify_status in \('off', 'pending', 'sent', 'failed'\)/);
});

test("the rollback drops only what quote.sql made", () => {
  assert.deepEqual(down.match(/drop table if exists public\.\w+/g), ["drop table if exists public.openblog_quote_requests", "drop table if exists public.openblog_quote_schema"]);
  assert.equal(down, "begin; drop table if exists public.openblog_quote_requests; drop table if exists public.openblog_quote_schema; commit;");
});

const v2 = strip(read("quote-v2.sql"));
const v2down = strip(read("quote-v2-rollback.sql"));

test("quote-v2 only admits archived, adds one column and stays in one transaction", () => {
  assert.ok(v2.startsWith("begin;") && v2.endsWith("commit;"));
  assert.match(v2, /add column if not exists archived_at timestamptz/);
  assert.match(v2, /status in \('new', 'handled', 'archived'\)/);
  assert.ok(!/drop table|drop column|truncate|delete from/.test(v2), "it drops no table or data");
  assert.match(v2, /insert into public\.openblog_quote_schema \(version\) values \(2\) on conflict do nothing/);
  assert.ok(!/create policy|grant /.test(v2), "it widens no access");
});

test("quote-v2 rollback keeps every request and restores the first shape", () => {
  assert.match(v2down, /update public\.openblog_quote_requests set status = 'handled'.* where status = 'archived'/);
  assert.ok(!/drop table|delete from public\.openblog_quote_requests|truncate/.test(v2down));
  assert.match(v2down, /status in \('new', 'handled'\)/);
  assert.match(v2down, /drop column if exists archived_at/);
});
