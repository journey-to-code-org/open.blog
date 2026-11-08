-- Optional scheduled social publishing, the recorded status history (ADR 0323): every change of an
-- announcement's status, time or caption is appended to openblog_social_post_events by a trigger, so
-- Admin can show an exact timeline (pending, processing, retrying, published, failed, unknown,
-- canceled) instead of one rebuilt from the attempts. Run once in the Supabase SQL editor, after
-- social.sql and social-queue.sql, only if you want the exact history. Without it Admin still shows
-- a history, marked as rebuilt and incomplete. Running it twice changes nothing.
--
-- Additive only: one table, two functions and one trigger. It rewrites no row and drops nothing.
-- Each announcement that already exists gets one `baseline` event describing where it is now, so
-- its history says plainly that nothing before this moment was recorded. To undo it, see
-- social-history-rollback.sql.
--
-- Why a trigger: the history must be complete whoever writes the row, whether an Admin route
-- through PostgREST, the claim and settle functions, or a person in the SQL editor. A writer cannot
-- forget it. The trigger runs as the caller (no security definer), so it can do nothing the
-- caller's grants do not already allow, and an event holds only a status, a fixed short code, an
-- attempt number and times: never a caption, a token, a lease owner or anything a provider wrote.

begin;

insert into public.openblog_social_schema (version) values (3) on conflict do nothing;

create table if not exists public.openblog_social_post_events (
  id bigint generated always as identity primary key,
  site_id text not null check (site_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  post_id uuid not null,
  at timestamptz not null default now(),
  -- What changed: the row was created, its status, its time, its caption, or only its problem code.
  -- `baseline` is the one event written for an announcement that existed before this file was run.
  change text not null check (change in ('baseline', 'created', 'status', 'rescheduled', 'edited', 'note')),
  status text not null check (status in ('scheduled', 'claimed', 'published', 'failed', 'canceled', 'unknown')),
  state text not null
    check (state in ('pending', 'processing', 'retrying', 'published', 'failed', 'unknown', 'canceled')),
  attempt_no integer not null check (attempt_no >= 0),
  code text check (code ~ '^[a-z][a-z0-9-]{0,39}$'),
  scheduled_for timestamptz,
  -- The post's own site; the history goes when (and only when) its post is removed by retention.
  constraint openblog_social_post_events_post
    foreign key (post_id, site_id)
    references public.openblog_social_posts (id, site_id) on delete cascade
);
create index if not exists openblog_social_post_events_post
  on public.openblog_social_post_events (post_id, id);

alter table public.openblog_social_post_events enable row level security;
revoke all on public.openblog_social_post_events from public, anon, authenticated;
-- Append and read only: nobody updates history, and only retention (social-ops.sql) removes it.
grant select, insert on public.openblog_social_post_events to service_role;

-- The delivery state of a stored status (netlify/lib/social-status.mjs says the same in JavaScript).
create or replace function public.openblog_social_delivery_state(p_status text, p_code text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case
    when p_status = 'scheduled' and (p_code is null or p_code = 'deferred') then 'pending'
    when p_status = 'scheduled' then 'retrying'
    when p_status = 'claimed' then 'processing'
    when p_status in ('published', 'failed', 'unknown', 'canceled') then p_status
    else null end
$fn$;

create or replace function public.openblog_social_record_event()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_change text;
  v_state text;
begin
  if tg_op = 'INSERT' then
    v_change := 'created';
  elsif new.status is distinct from old.status then
    v_change := 'status';
  elsif new.scheduled_for is distinct from old.scheduled_for then
    v_change := 'rescheduled';
  elsif new.body is distinct from old.body then
    v_change := 'edited';
  elsif new.last_error_code is distinct from old.last_error_code then
    v_change := 'note';
  else
    return null;
  end if;
  v_state := public.openblog_social_delivery_state(new.status, new.last_error_code);
  -- A code explains a problem; a post that is waiting, sending or posted keeps the previous one on
  -- its row, which is not news, so the event does not repeat it.
  insert into public.openblog_social_post_events (site_id, post_id, change, status, state, attempt_no, code, scheduled_for)
  values (new.site_id, new.id, v_change, new.status, v_state, new.attempt_count,
          case when v_state in ('retrying', 'failed', 'unknown', 'canceled') then new.last_error_code end,
          new.scheduled_for);
  return null;
end
$fn$;

create or replace trigger openblog_social_posts_history
  after insert or update on public.openblog_social_posts
  for each row execute function public.openblog_social_record_event();

-- Where each existing announcement is now, once.
insert into public.openblog_social_post_events (site_id, post_id, at, change, status, state, attempt_no, code, scheduled_for)
select p.site_id, p.id, p.updated_at, 'baseline', p.status,
       public.openblog_social_delivery_state(p.status, p.last_error_code),
       p.attempt_count, p.last_error_code, p.scheduled_for
from public.openblog_social_posts p
where not exists (select 1 from public.openblog_social_post_events e where e.post_id = p.id);

revoke all on function public.openblog_social_delivery_state(text, text) from public, anon, authenticated;
revoke all on function public.openblog_social_record_event() from public, anon, authenticated;
grant execute on function public.openblog_social_delivery_state(text, text) to service_role;

commit;
