-- Optional received Webmentions (epic #387, story #402, ADRs 0863 and 0864): the hosted store of
-- requests other sites sent to this site's Webmention endpoint, waiting for `openblog mentions
-- pull` to check them. Run once in the Supabase SQL editor, and only if the site opts in to
-- receiving Webmentions (OPENBLOG_WEBMENTION_ENABLED). Running it twice changes nothing.
--
-- Additive only: one new table, one index and two functions. It touches no existing table and
-- drops nothing. To undo it, see webmention-rollback.sql.
--
-- What is stored, and for how long: a request's `source` and `target` addresses, the source's
-- host, when it last arrived and a version. Nothing about the sender's network address, nothing
-- fetched from the source (the hosted function never fetches it) and nothing a moderator decided:
-- a request is deleted as soon as a pull has handled it, and the moderation inbox lives in the
-- author's private project files.
--
-- Private by construction: row level security is on with no policies, the public roles have no
-- access, and only the hosted function, signed in as service_role, reads and writes. The functions
-- run as the caller (security invoker), so they can do nothing the table grants do not allow.
--
-- The rules the functions keep (ADR 0864):
--   * receive is one transaction under a per-site advisory lock. A repeated source and target
--     lands on its one row: it raises the version (so a pull that took the older version does not
--     delete it) unless it arrived again within a minute, which changes nothing. A new pair is
--     refused when its source host already has `p_host_limit` requests waiting or the site has
--     `p_site_limit`, so one sender or a flood cannot grow the store without bound.
--   * settle deletes each named request only at the version the pull took.

begin;

create extension if not exists pgcrypto;

create table if not exists public.openblog_webmention_requests (
  id uuid primary key default gen_random_uuid(),
  site_id text not null check (char_length(site_id) between 1 and 200),
  source text not null check (char_length(source) between 10 and 2048),
  target text not null check (char_length(target) between 10 and 2048),
  source_host text not null check (char_length(source_host) between 1 and 253),
  version integer not null default 1 check (version >= 1),
  received_at timestamptz not null default now(),
  unique (site_id, source, target)
);

create index if not exists openblog_webmention_requests_waiting
  on public.openblog_webmention_requests (site_id, source_host, received_at);

alter table public.openblog_webmention_requests enable row level security;
revoke all on public.openblog_webmention_requests from public, anon, authenticated;
grant select, insert, update, delete on public.openblog_webmention_requests to service_role;

-- One received request. Returns 'accepted', 'repeat', 'host-limit' or 'site-limit'.
create or replace function public.openblog_webmention_receive(
  p_site_id text,
  p_source text,
  p_target text,
  p_source_host text,
  p_host_limit integer default 20,
  p_site_limit integer default 1000
) returns text
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_row public.openblog_webmention_requests%rowtype;
  v_host_waiting integer;
  v_site_waiting integer;
begin
  if p_host_limit < 1 or p_site_limit < 1 then
    raise exception 'invalid webmention limits';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('openblog_webmention:' || p_site_id, 0));
  select * into v_row from public.openblog_webmention_requests
    where site_id = p_site_id and source = p_source and target = p_target
    for update;
  if found then
    if v_row.received_at > now() - interval '1 minute' then
      return 'repeat';
    end if;
    update public.openblog_webmention_requests
      set version = v_row.version + 1, received_at = now()
      where id = v_row.id;
    return 'accepted';
  end if;
  select count(*) into v_host_waiting from public.openblog_webmention_requests
    where site_id = p_site_id and source_host = p_source_host;
  if v_host_waiting >= p_host_limit then
    return 'host-limit';
  end if;
  select count(*) into v_site_waiting from public.openblog_webmention_requests
    where site_id = p_site_id;
  if v_site_waiting >= p_site_limit then
    return 'site-limit';
  end if;
  insert into public.openblog_webmention_requests (site_id, source, target, source_host)
    values (p_site_id, p_source, p_target, p_source_host);
  return 'accepted';
end
$fn$;

-- Deletes the handled requests, each only at the version the pull took. `p_items` is a JSON
-- array of {"id": uuid, "version": integer}. Returns how many it deleted.
create or replace function public.openblog_webmention_settle(
  p_site_id text,
  p_items jsonb
) returns integer
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_count integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'invalid webmention settle request';
  end if;
  delete from public.openblog_webmention_requests r
    using jsonb_to_recordset(p_items) as i(id uuid, version integer)
    where r.site_id = p_site_id and r.id = i.id and r.version = i.version;
  get diagnostics v_count = row_count;
  return v_count;
end
$fn$;

revoke all on function public.openblog_webmention_receive(text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.openblog_webmention_settle(text, jsonb) from public, anon, authenticated;
grant execute on function public.openblog_webmention_receive(text, text, text, text, integer, integer) to service_role;
grant execute on function public.openblog_webmention_settle(text, jsonb) to service_role;

commit;
