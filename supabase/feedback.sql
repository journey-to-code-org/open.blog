-- Optional passage feedback (ADR 0080). Run once in the Supabase SQL editor,
-- after openblog.sql, only if the site opts in to typed passage feedback. A
-- site that does not opt in never needs it.
--
-- Additive only: it creates the feedback table, its moderation audit table,
-- their indexes, two moderation functions (ADRs 0083 and 0105) and the
-- deletion function engagement protection uses (ADR 0131), and adds the
-- moderation inbox's and protection's columns to those two tables of its
-- own. It does not
-- rename, drop or rewrite any existing table, column, function or row, so
-- comments and analytics keep working exactly as before. Running it twice
-- changes nothing; running it again after an upgrade adds only what is new.
-- To undo it, see feedback-rollback.sql.
--
-- The table is private: row level security is on with no policies, the
-- public roles have no access, and only the Netlify Function (service_role)
-- reads and writes it. Feedback kinds and moderation states are checked here
-- for shape only; the allowed values belong to the code (ADR 0079, #211), so
-- a new kind or state needs no migration.

begin;

create extension if not exists pgcrypto;

create table if not exists public.openblog_feedback (
  id uuid primary key default gen_random_uuid(),
  site_id text not null check (char_length(site_id) between 1 and 200),
  -- The submission format version (ADR 0079).
  format_version integer not null default 1 check (format_version >= 1),
  kind text not null check (kind ~ '^[a-z][a-z0-9-]{0,39}$'),
  -- The work, the passage revision the reader saw and the passage target
  -- (ADRs 0076, 0078). All three, or none for a future kind that is about
  -- the site rather than a passage.
  work text check (char_length(work) between 2 and 500),
  revision text check (revision ~ '^p[1-9][0-9]{0,3}:[0-9a-f]{32}$'),
  target jsonb check (jsonb_typeof(target) = 'object' and octet_length(target::text) <= 16384),
  body text not null check (char_length(body) between 1 and 20000),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 16384),
  -- The reader's own clock (optional, untrusted) and the receiver's stamp.
  seen_at timestamptz,
  received_at timestamptz not null default now(),
  channel text not null default 'hosted' check (channel in ('hosted', 'manual')),
  -- The reader's name is private to moderation unless publish_name is true
  -- (ADR 0078). It is never copied into openblog_comments.author_name.
  reader_name text check (char_length(reader_name) between 1 and 80),
  publish_name boolean not null default false,
  status text not null default 'pending' check (status ~ '^[a-z][a-z-]{0,31}$'),
  -- Every moderation change names the version it expects and raises it, so
  -- two moderators can never both act on one item (ADR 0083).
  version integer not null default 1 check (version >= 1),
  moderated_at timestamptz,
  -- The reason code of the last rejection or removal; never free text.
  moderation_reason text check (moderation_reason ~ '^[a-z][a-z-]{0,31}$'),
  constraint openblog_feedback_passage_complete check (
    (work is null and revision is null and target is null)
    or (work is not null and revision is not null and target is not null)
  ),
  constraint openblog_feedback_consent_needs_name check (reader_name is not null or not publish_name),
  constraint openblog_feedback_seen_before_received check (seen_at is null or seen_at <= received_at)
);

-- Moderation columns (ADR 0083), for a table created by an earlier copy of
-- this file; on a fresh install they already exist and nothing happens.
alter table public.openblog_feedback
  add column if not exists version integer not null default 1 check (version >= 1);
alter table public.openblog_feedback
  add column if not exists moderation_reason text check (moderation_reason ~ '^[a-z][a-z-]{0,31}$');

create index if not exists openblog_feedback_moderation
  on public.openblog_feedback (site_id, status, received_at);
create index if not exists openblog_feedback_work
  on public.openblog_feedback (site_id, work, status, received_at);

alter table public.openblog_feedback enable row level security;
-- Revoke service_role too: Supabase's default privileges grant it DELETE and
-- TRUNCATE, which the function never needs.
revoke all on public.openblog_feedback from public, anon, authenticated, service_role;
grant select, insert, update on public.openblog_feedback to service_role;

-- The moderation audit trail (ADR 0083): who changed which item, from which
-- state to which, why (a reason code), when, and the version it produced.
-- Never what anyone wrote. Rows are only ever inserted, except that with
-- engagement protection (protection.sql, ADR 0131) the retention run may
-- delete events older than the site's audit period, and never one recorded
-- in the last day.
create table if not exists public.openblog_feedback_events (
  id bigint generated always as identity primary key,
  site_id text not null check (char_length(site_id) between 1 and 200),
  feedback_id uuid not null references public.openblog_feedback (id),
  action text not null check (action ~ '^[a-z][a-z-]{0,31}$'),
  from_status text not null check (from_status ~ '^[a-z][a-z-]{0,31}$'),
  to_status text not null check (to_status ~ '^[a-z][a-z-]{0,31}$'),
  reason text check (reason ~ '^[a-z][a-z-]{0,31}$'),
  -- An Admin account name, or @moderation-token for the token itself.
  actor text not null check (char_length(actor) between 1 and 80),
  at timestamptz not null,
  version integer not null check (version >= 1)
);

create index if not exists openblog_feedback_events_item
  on public.openblog_feedback_events (site_id, feedback_id, at);

alter table public.openblog_feedback_events enable row level security;
revoke all on public.openblog_feedback_events from public, anon, authenticated, service_role;
grant select, insert on public.openblog_feedback_events to service_role;

-- One moderation change: applied only while the item still has the state and
-- version the moderator saw, with its audit event, in one statement. It
-- returns the changed row, or nothing when the item changed meanwhile or does
-- not exist. Which changes are allowed is the code's decision (ADR 0083).
create or replace function public.openblog_moderate_feedback(
  p_site_id text,
  p_id uuid,
  p_expected_version integer,
  p_from text,
  p_to text,
  p_action text,
  p_reason text,
  p_actor text,
  p_at timestamptz
)
returns setof public.openblog_feedback
language sql
set search_path = public
as $$
  with changed as (
    update public.openblog_feedback
       set status = p_to,
           moderated_at = p_at,
           moderation_reason = p_reason,
           version = version + 1
     where id = p_id
       and site_id = p_site_id
       and status = p_from
       and version = p_expected_version
    returning *
  ), logged as (
    insert into public.openblog_feedback_events
      (site_id, feedback_id, action, from_status, to_status, reason, actor, at, version)
    select site_id, id, p_action, p_from, p_to, p_reason, p_actor, p_at, version from changed
  )
  select * from changed;
$$;

revoke all on function public.openblog_moderate_feedback(text, uuid, integer, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.openblog_moderate_feedback(text, uuid, integer, text, text, text, text, text, timestamptz) to service_role;

-- The moderation inbox (ADR 0105). Run this file again to add these to a
-- table an earlier copy created; on a fresh install they are added here.
-- Each column is new, with a default or nullable, so every row already
-- stored reads as revision 1, never asked to clarify, without the reader's
-- consent to be asked, and nothing it held changes.
--
-- The facts the one state machine decides on (ADR 0101): the text's
-- revision, the revision an approval covers, the revision a clarification
-- request asked about, and whether the reader agreed to be asked.
alter table public.openblog_feedback
  add column if not exists item_revision integer not null default 1 check (item_revision >= 1);
alter table public.openblog_feedback
  add column if not exists approved_revision integer check (approved_revision >= 1);
alter table public.openblog_feedback
  add column if not exists clarification_asked integer check (clarification_asked >= 1);
alter table public.openblog_feedback
  add column if not exists clarification_consent boolean not null default false;
-- The audit fields ADR 0083 left for the inbox: the item's kind, the
-- revision the decision was about, and the role the actor had on the item's
-- work (ADR 0102). Older events have none.
alter table public.openblog_feedback_events
  add column if not exists kind text check (kind ~ '^[a-z][a-z0-9-]{0,39}$');
alter table public.openblog_feedback_events
  add column if not exists item_revision integer check (item_revision >= 1);
alter table public.openblog_feedback_events
  add column if not exists actor_role text check (actor_role ~ '^[a-z][a-z-]{0,31}$');

-- One inbox decision on a feedback item, with its audit event, in one
-- statement, only while the item still has the state and version both Admin
-- and the function saw. Which changes are allowed is the code's decision
-- (netlify/lib/participation-moderation.mjs); this statement also refuses
-- what must never happen whatever the caller says: approving the text a
-- clarification asked about, reopening it to anything but clarification, or
-- asking a reader who did not agree to be asked. A clarification (the
-- reader's answer, p_body) replaces the text as the next revision. It
-- returns the changed row, or nothing.
create or replace function public.openblog_moderate_feedback_item(
  p_site_id text,
  p_id uuid,
  p_expected_version integer,
  p_from text,
  p_to text,
  p_action text,
  p_reason text,
  p_actor text,
  p_actor_role text,
  p_at timestamptz,
  p_body text default null,
  p_details jsonb default null
)
returns setof public.openblog_feedback
language sql
set search_path = public
as $$
  with changed as (
    update public.openblog_feedback
       set status = p_to,
           moderated_at = p_at,
           moderation_reason = p_reason,
           version = version + 1,
           item_revision = case when p_action = 'clarify' then item_revision + 1 else item_revision end,
           body = case when p_action = 'clarify' then p_body else body end,
           details = case when p_action = 'clarify' then coalesce(p_details, '{}'::jsonb) else details end,
           approved_revision = case when p_to = 'approved' then item_revision end,
           clarification_asked = case when p_action = 'request-clarification' then item_revision else clarification_asked end
     where id = p_id
       and site_id = p_site_id
       and status = p_from
       and version = p_expected_version
       and not (p_to = 'approved' and clarification_asked is not distinct from item_revision)
       and not (p_action = 'reopen' and p_to <> 'clarification' and clarification_asked is not distinct from item_revision)
       and not (p_action = 'request-clarification' and not clarification_consent)
       and (p_action <> 'clarify' or p_body is not null)
    returning *
  ), logged as (
    insert into public.openblog_feedback_events
      (site_id, feedback_id, action, from_status, to_status, reason, actor, at, version, kind, item_revision, actor_role)
    select site_id, id, p_action, p_from, p_to, p_reason, p_actor, p_at, version, kind, item_revision, p_actor_role from changed
  )
  select * from changed;
$$;

revoke all on function public.openblog_moderate_feedback_item(text, uuid, integer, text, text, text, text, text, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.openblog_moderate_feedback_item(text, uuid, integer, text, text, text, text, text, text, timestamptz, text, jsonb) to service_role;

-- Engagement protection (ADRs 0130 and 0131), used only once protection.sql
-- has run and OPENBLOG_PROTECTION_ENABLED is set. Each column is new and
-- nullable, so every row already stored reads as before: no receipt, never
-- purged.
--
-- The SHA-256 digest of the reader's private receipt, a random secret the
-- function returns to the reader once and never stores. Holding the
-- receipt is the only way to answer a clarification request, see the
-- note's state or withdraw and delete it; nothing identifies the reader.
alter table public.openblog_feedback
  add column if not exists receipt_hash text check (receipt_hash ~ '^[0-9a-f]{64}$');
create unique index if not exists openblog_feedback_receipt
  on public.openblog_feedback (site_id, receipt_hash) where receipt_hash is not null;
-- When retention or a deletion request purged the note's text, details and
-- reader name. The row stays, so its state and audit trail stay
-- explainable; the text is overwritten with a placeholder never shown.
alter table public.openblog_feedback
  add column if not exists purged_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'openblog_feedback_purged_never_public') then
    alter table public.openblog_feedback
      add constraint openblog_feedback_purged_never_public check (purged_at is null or status <> 'approved');
  end if;
end $$;

-- A deletion request or a retention purge, in one statement, only while the
-- note is at the version both Admin (or the reader's receipt) and the
-- function saw and not yet purged. With p_withdraw (the reader's own
-- request, ADR 0130) a pending, waiting or approved note is withdrawn
-- first, so it is never public again; without it only a rejected, removed
-- or withdrawn note is purged. The text, details and reader name are
-- deleted, and each step is recorded without them. It returns the row, or
-- nothing.
create or replace function public.openblog_erase_feedback(
  p_site_id text,
  p_id uuid,
  p_expected_version integer,
  p_withdraw boolean,
  p_actor text,
  p_actor_role text,
  p_at timestamptz
)
returns setof public.openblog_feedback
language sql
set search_path = public
as $$
  with before as (
    select id, status, version from public.openblog_feedback
     where id = p_id
       and site_id = p_site_id
       and version = p_expected_version
       and purged_at is null
       and ((p_withdraw and status in ('pending', 'clarification', 'approved'))
         or (not p_withdraw and status in ('rejected', 'removed', 'withdrawn')))
     for update
  ), changed as (
    update public.openblog_feedback f
       set status = case when p_withdraw then 'withdrawn' else f.status end,
           moderated_at = case when p_withdraw then p_at else f.moderated_at end,
           moderation_reason = case when p_withdraw then null else f.moderation_reason end,
           approved_revision = case when p_withdraw then null else f.approved_revision end,
           body = '-',
           details = '{}'::jsonb,
           reader_name = null,
           publish_name = false,
           purged_at = p_at,
           version = f.version + case when p_withdraw then 2 else 1 end
      from before
     where f.id = before.id
    returning f.*
  ), withdrawn as (
    insert into public.openblog_feedback_events
      (site_id, feedback_id, action, from_status, to_status, reason, actor, at, version, kind, item_revision, actor_role)
    select c.site_id, c.id, 'withdraw', b.status, 'withdrawn', null, p_actor, p_at, b.version + 1, c.kind, c.item_revision, p_actor_role
      from changed c join before b on b.id = c.id
     where p_withdraw
  ), purged as (
    insert into public.openblog_feedback_events
      (site_id, feedback_id, action, from_status, to_status, reason, actor, at, version, kind, item_revision, actor_role)
    select c.site_id, c.id, 'purge-content', c.status, c.status, null, p_actor, p_at, c.version, c.kind, c.item_revision, p_actor_role
      from changed c
  )
  select * from changed;
$$;

revoke all on function public.openblog_erase_feedback(text, uuid, integer, boolean, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.openblog_erase_feedback(text, uuid, integer, boolean, text, text, timestamptz) to service_role;

commit;
