-- Optional scheduled social publishing, operations (ADR 0701): queue health for monitoring and
-- backlog alerts, a sweep of expired leases and abandoned account handshakes, and opt-in retention
-- of old delivery history. Run once in the Supabase SQL editor, after social.sql and
-- social-queue.sql (and social-history.sql if you use it), only if you want them. Nothing calls
-- these functions until you set OPENBLOG_SOCIAL_OPS=true on the hosted functions; nothing is ever
-- deleted unless you also set OPENBLOG_SOCIAL_RETENTION_DAYS. Running it twice changes nothing.
--
-- Additive only: three functions. No table, column or row is changed by running it. To undo it,
-- see social-ops-rollback.sql.
--
--   * openblog_social_health reads counts only: how late the queue is, what is in flight, what waits
--     for a person, which accounts need connecting again. No caption, token, name or id leaves it.
--   * openblog_social_sweep reaps expired leases (the same rule as the claim, ADR 0316) and expires
--     account handshakes left open past their time, erasing any sealed tokens they still hold.
--   * openblog_social_prune deletes, in bounded batches, announcements that ended (published, failed
--     or canceled) more than the retention period ago, with their attempts and history; finished
--     handshakes; and disconnected accounts nothing refers to any more. It never touches anything
--     scheduled, in flight or unknown. The service role cannot delete rows itself (social.sql grants
--     no delete), so this one function runs as its owner (security definer) with a fixed search path,
--     checks the site and a retention of at least 30 days, and only service_role may execute it.

begin;

insert into public.openblog_social_schema (version) values (4) on conflict do nothing;

create or replace function public.openblog_social_health(
  p_site_id text,
  p_overdue_seconds integer default 900
) returns table (
  due integer,
  overdue integer,
  oldest_due_at timestamptz,
  processing integer,
  expired_leases integer,
  retrying integer,
  unknown_waiting integer,
  needs_review integer,
  failed_recently integer,
  accounts_need_reconnect integer,
  accounts_paused integer,
  stale_connections integer
)
language plpgsql
stable
set search_path = public, pg_temp
as $fn$
declare
  v_late interval := make_interval(secs => least(greatest(coalesce(p_overdue_seconds, 900), 60), 86400));
begin
  if p_site_id is null or p_site_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' then
    raise exception 'invalid site' using errcode = '22023';
  end if;
  return query
  select
    (select count(*)::integer from openblog_social_posts p
      where p.site_id = p_site_id and p.status = 'scheduled'
        and coalesce(p.next_attempt_at, p.scheduled_for) <= now()),
    (select count(*)::integer from openblog_social_posts p
      where p.site_id = p_site_id and p.status = 'scheduled'
        and coalesce(p.next_attempt_at, p.scheduled_for) <= now() - v_late),
    (select min(coalesce(p.next_attempt_at, p.scheduled_for)) from openblog_social_posts p
      where p.site_id = p_site_id and p.status = 'scheduled'
        and coalesce(p.next_attempt_at, p.scheduled_for) <= now()),
    (select count(*)::integer from openblog_social_posts p
      where p.site_id = p_site_id and p.status = 'claimed' and p.lease_expires_at > now()),
    (select count(*)::integer from openblog_social_posts p
      where p.site_id = p_site_id and p.status = 'claimed' and p.lease_expires_at <= now()),
    (select count(*)::integer from openblog_social_posts p
      where p.site_id = p_site_id and p.status = 'scheduled'
        and p.last_error_code is not null and p.last_error_code <> 'deferred'),
    (select count(*)::integer from openblog_social_posts p
      where p.site_id = p_site_id and p.status = 'unknown' and p.next_attempt_at is not null),
    (select count(*)::integer from openblog_social_posts p
      where p.site_id = p_site_id and p.status = 'unknown' and p.next_attempt_at is null),
    (select count(*)::integer from openblog_social_posts p
      where p.site_id = p_site_id and p.status = 'failed' and p.updated_at > now() - interval '1 day'),
    (select count(*)::integer from openblog_social_accounts a
      where a.site_id = p_site_id and a.status = 'needs-reauth'),
    (select count(*)::integer from openblog_social_accounts a
      where a.site_id = p_site_id and a.status = 'connected' and a.paused_until > now()),
    (select count(*)::integer from openblog_social_connections c
      where c.site_id = p_site_id and c.status in ('pending', 'exchanging', 'authorized')
        and c.expires_at <= now());
end
$fn$;

-- Housekeeping that changes state but deletes nothing. Returns what it moved.
create or replace function public.openblog_social_sweep(
  p_site_id text,
  p_max_attempts integer default 5
) returns table (reaped integer, expired_connections integer)
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_reaped integer;
  v_expired integer;
begin
  if p_site_id is null or p_site_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' then
    raise exception 'invalid site' using errcode = '22023';
  end if;
  v_reaped := public.openblog_social_reap_leases(p_site_id, 200, p_max_attempts);
  -- A handshake the author walked away from: its sealed tokens go now, not at the next attempt.
  update public.openblog_social_connections
    set status = 'expired', error_code = 'expired', envelope = null, key_id = null,
        completed_at = coalesce(completed_at, now()), version = version + 1, updated_at = now()
    where site_id = p_site_id and status in ('pending', 'exchanging', 'authorized') and expires_at <= now();
  get diagnostics v_expired = row_count;
  return query select v_reaped, v_expired;
end
$fn$;

-- Retention. Deletes at most p_limit announcements per call; call again for more.
create or replace function public.openblog_social_prune(
  p_site_id text,
  p_keep_days integer,
  p_limit integer default 200
) returns table (posts integer, attempts integer, connections integer, accounts integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_cutoff timestamptz;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_ids uuid[];
  v_posts integer := 0;
  v_attempts integer := 0;
  v_connections integer := 0;
  v_accounts integer := 0;
begin
  if p_site_id is null or p_site_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' then
    raise exception 'invalid site' using errcode = '22023';
  end if;
  if p_keep_days is null or p_keep_days < 30 or p_keep_days > 3650 then
    raise exception 'retention must be 30 to 3650 days' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(days => p_keep_days);

  select coalesce(array_agg(id), '{}') into v_ids from (
    select p.id from public.openblog_social_posts p
    where p.site_id = p_site_id and p.status in ('published', 'failed', 'canceled')
      and p.updated_at < v_cutoff
    order by p.updated_at
    limit v_limit
    for update skip locked
  ) old;
  if array_length(v_ids, 1) > 0 then
    delete from public.openblog_social_attempts a where a.site_id = p_site_id and a.post_id = any (v_ids);
    get diagnostics v_attempts = row_count;
    -- Recorded history (social-history.sql), when installed, goes with its post (on delete cascade).
    delete from public.openblog_social_posts p
      where p.site_id = p_site_id and p.id = any (v_ids) and p.status in ('published', 'failed', 'canceled');
    get diagnostics v_posts = row_count;
  end if;

  delete from public.openblog_social_connections c
    where c.site_id = p_site_id and c.status in ('completed', 'failed', 'expired', 'canceled')
      and c.envelope is null and c.updated_at < v_cutoff;
  get diagnostics v_connections = row_count;

  -- A disconnected account that nothing refers to any more: its revoked credential, then the account.
  delete from public.openblog_social_credentials k
    using public.openblog_social_accounts a
    where k.account_id = a.id and k.site_id = p_site_id and a.site_id = p_site_id and k.status = 'revoked'
      and a.status = 'disconnected' and a.disconnected_at < v_cutoff
      and not exists (select 1 from public.openblog_social_posts p where p.account_id = a.id)
      and not exists (select 1 from public.openblog_social_connections c where c.reauth_account_id = a.id);
  delete from public.openblog_social_accounts a
    where a.site_id = p_site_id and a.status = 'disconnected' and a.disconnected_at < v_cutoff
      and not exists (select 1 from public.openblog_social_posts p where p.account_id = a.id)
      and not exists (select 1 from public.openblog_social_connections c where c.reauth_account_id = a.id)
      and not exists (select 1 from public.openblog_social_credentials k where k.account_id = a.id);
  get diagnostics v_accounts = row_count;

  return query select v_posts, v_attempts, v_connections, v_accounts;
end
$fn$;

revoke all on function public.openblog_social_health(text, integer) from public, anon, authenticated;
revoke all on function public.openblog_social_sweep(text, integer) from public, anon, authenticated;
revoke all on function public.openblog_social_prune(text, integer, integer) from public, anon, authenticated;
grant execute on function public.openblog_social_health(text, integer) to service_role;
grant execute on function public.openblog_social_sweep(text, integer) to service_role;
grant execute on function public.openblog_social_prune(text, integer, integer) to service_role;

commit;
