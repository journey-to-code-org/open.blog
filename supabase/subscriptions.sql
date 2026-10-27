-- Optional update subscriptions for continuations (ADR 0407). Run once in the
-- Supabase SQL editor, only if the site opts in to update subscriptions. A
-- site that does not opt in never needs it, and every continuation link works
-- without it.
--
-- Additive only: it creates one private table and six functions. It does not
-- rename, drop or rewrite any existing table, column, function or row, so
-- comments, feedback and analytics keep working exactly as before. It does
-- not touch openblog_feedback, so no address can reach a moderation export.
-- Running it twice changes nothing. To undo it, see subscriptions-rollback.sql.
--
-- Nothing here is used until OPENBLOG_SUBSCRIPTIONS_ENABLED is set to `true`
-- in the Netlify environment AND a mail provider is configured for the
-- function; with either missing the page offers links only.
--
-- The table is private: row level security is on with no policies, the public
-- roles have no access, and only the Netlify Function (service_role) calls
-- the functions below. Tokens are made here by pgcrypto's gen_random_bytes (a
-- secure random source) and only a SHA-256 digest of each is stored. An
-- address is kept only for a pending or active subscription; unsubscribing,
-- deleting and expiry delete the whole row.

begin;

create extension if not exists pgcrypto;

create table if not exists public.openblog_subscriptions (
  id uuid primary key default gen_random_uuid(),
  site_id text not null check (char_length(site_id) between 1 and 200),
  -- What is followed: one page's questions, or one series. Never a person.
  scope_kind text not null check (scope_kind in ('page', 'series')),
  scope_value text not null check (char_length(scope_value) between 1 and 500),
  address text not null check (char_length(address) between 3 and 254),
  active boolean not null default false,
  requested_at timestamptz not null default now(),
  -- Digest of the single-use confirmation token; null once used.
  confirm_digest text check (confirm_digest ~ '^[0-9a-f]{64}$'),
  -- Digests of the unsubscribe tokens mailed, newest last, at most 8.
  unsubscribe_digests text[] not null default '{}'
    check (cardinality(unsubscribe_digests) between 1 and 8),
  last_sent_at timestamptz
);

create unique index if not exists openblog_subscriptions_one_per_address
  on public.openblog_subscriptions (site_id, scope_kind, scope_value, lower(address));
create unique index if not exists openblog_subscriptions_confirm
  on public.openblog_subscriptions (confirm_digest) where confirm_digest is not null;
create index if not exists openblog_subscriptions_scope
  on public.openblog_subscriptions (site_id, scope_kind, scope_value) where active;

alter table public.openblog_subscriptions enable row level security;
revoke all on public.openblog_subscriptions from public, anon, authenticated;

create or replace function public.openblog_subscription_digest(p_token text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(digest(p_token, 'sha256'), 'hex');
$$;

-- Take a request. Returns the confirmation and unsubscribe tokens to mail, or
-- no row when nothing is to be sent (already active, or asked within the last
-- hour); the caller answers the reader the same way in every case.
create or replace function public.openblog_subscribe(
  p_site text, p_scope_kind text, p_scope_value text, p_address text
) returns table (confirm_token text, unsubscribe_token text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_confirm text := translate(encode(gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
  v_unsub text := translate(encode(gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
  v_row public.openblog_subscriptions;
begin
  select * into v_row from public.openblog_subscriptions
   where site_id = p_site and scope_kind = p_scope_kind and scope_value = p_scope_value
     and lower(address) = lower(p_address);
  if found then
    if v_row.active or v_row.requested_at > now() - interval '1 hour' then
      return;
    end if;
    delete from public.openblog_subscriptions where id = v_row.id;
  end if;
  insert into public.openblog_subscriptions
    (site_id, scope_kind, scope_value, address, confirm_digest, unsubscribe_digests)
  values
    (p_site, p_scope_kind, p_scope_value, p_address,
     public.openblog_subscription_digest(v_confirm),
     array[public.openblog_subscription_digest(v_unsub)]);
  return query select v_confirm, v_unsub;
end $$;

-- Follow a confirmation link: once, and within 48 hours. Any other token,
-- used, late or unknown, is the same false.
create or replace function public.openblog_confirm_subscription(p_token text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  v_row public.openblog_subscriptions;
begin
  select * into v_row from public.openblog_subscriptions
   where confirm_digest = public.openblog_subscription_digest(p_token) for update;
  if not found then
    return false;
  end if;
  update public.openblog_subscriptions set confirm_digest = null where id = v_row.id;
  if v_row.requested_at < now() - interval '48 hours' then
    return false;
  end if;
  update public.openblog_subscriptions set active = true where id = v_row.id;
  return true;
end $$;

-- Unsubscribe or delete: the whole row, address included. No account.
create or replace function public.openblog_unsubscribe(p_token text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  v_count integer;
begin
  delete from public.openblog_subscriptions
   where public.openblog_subscription_digest(p_token) = any (unsubscribe_digests);
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

-- The active subscriptions an update reaches, for the one function that
-- sends, each with a fresh unsubscribe token (the earlier ones keep working,
-- up to eight). At most one a day per subscription.
create or replace function public.openblog_subscription_recipients(
  p_site text, p_page text, p_series text
) returns table (id uuid, address text, unsubscribe_token text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_row public.openblog_subscriptions;
  v_token text;
  v_digests text[];
begin
  for v_row in
    select * from public.openblog_subscriptions s
     where s.site_id = p_site and s.active
       and ((s.scope_kind = 'page' and s.scope_value = p_page)
         or (s.scope_kind = 'series' and p_series is not null and s.scope_value = p_series))
       and (s.last_sent_at is null or s.last_sent_at <= now() - interval '1 day')
     for update
  loop
    v_token := translate(encode(gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
    v_digests := v_row.unsubscribe_digests || public.openblog_subscription_digest(v_token);
    if cardinality(v_digests) > 8 then
      v_digests := v_digests[cardinality(v_digests) - 7:cardinality(v_digests)];
    end if;
    update public.openblog_subscriptions as t
       set last_sent_at = now(), unsubscribe_digests = v_digests
     where t.id = v_row.id;
    id := v_row.id;
    address := v_row.address;
    unsubscribe_token := v_token;
    return next;
  end loop;
end $$;

-- Erase every pending request whose 48 hours have passed. Run it on a
-- schedule (for example from the retention job).
create or replace function public.openblog_purge_subscriptions()
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_count integer;
begin
  delete from public.openblog_subscriptions
   where not active and requested_at < now() - interval '48 hours';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.openblog_subscription_digest(text) from public, anon, authenticated;
revoke all on function public.openblog_subscribe(text, text, text, text) from public, anon, authenticated;
revoke all on function public.openblog_confirm_subscription(text) from public, anon, authenticated;
revoke all on function public.openblog_unsubscribe(text) from public, anon, authenticated;
revoke all on function public.openblog_subscription_recipients(text, text, text) from public, anon, authenticated;
revoke all on function public.openblog_purge_subscriptions() from public, anon, authenticated;
grant execute on function public.openblog_subscribe(text, text, text, text) to service_role;
grant execute on function public.openblog_confirm_subscription(text) to service_role;
grant execute on function public.openblog_unsubscribe(text) to service_role;
grant execute on function public.openblog_subscription_recipients(text, text, text) to service_role;
grant execute on function public.openblog_purge_subscriptions() to service_role;

commit;
