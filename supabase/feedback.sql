-- Optional passage feedback (ADR 0088). Run once in the Supabase SQL editor,
-- after openblog.sql, only if the site opts in to typed passage feedback. A
-- site that does not opt in never needs it.
--
-- Additive only: it creates one new table and its indexes. It does not alter,
-- rename, drop or rewrite any existing table, column, function or row, so
-- comments and analytics keep working exactly as before. Running it twice
-- changes nothing. To undo it, see feedback-rollback.sql.
--
-- The table is private: row level security is on with no policies, the
-- public roles have no access, and only the Netlify Function (service_role)
-- reads and writes it. Feedback kinds and moderation states are checked here
-- for shape only; the allowed values belong to the code (ADR 0087, #211), so
-- a new kind or state needs no migration.

begin;

create extension if not exists pgcrypto;

create table if not exists public.openblog_feedback (
  id uuid primary key default gen_random_uuid(),
  site_id text not null check (char_length(site_id) between 1 and 200),
  -- The submission format version (ADR 0087).
  format_version integer not null default 1 check (format_version >= 1),
  kind text not null check (kind ~ '^[a-z][a-z0-9-]{0,39}$'),
  -- The work, the passage revision the reader saw and the passage target
  -- (ADRs 0084, 0086). All three, or none for a future kind that is about
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
  -- (ADR 0086). It is never copied into openblog_comments.author_name.
  reader_name text check (char_length(reader_name) between 1 and 80),
  publish_name boolean not null default false,
  status text not null default 'pending' check (status ~ '^[a-z][a-z-]{0,31}$'),
  moderated_at timestamptz,
  constraint openblog_feedback_passage_complete check (
    (work is null and revision is null and target is null)
    or (work is not null and revision is not null and target is not null)
  ),
  constraint openblog_feedback_consent_needs_name check (reader_name is not null or not publish_name),
  constraint openblog_feedback_seen_before_received check (seen_at is null or seen_at <= received_at)
);

create index if not exists openblog_feedback_moderation
  on public.openblog_feedback (site_id, status, received_at);
create index if not exists openblog_feedback_work
  on public.openblog_feedback (site_id, work, status, received_at);

alter table public.openblog_feedback enable row level security;
-- Revoke service_role too: Supabase's default privileges grant it DELETE and
-- TRUNCATE, which the function never needs.
revoke all on public.openblog_feedback from public, anon, authenticated, service_role;
grant select, insert, update on public.openblog_feedback to service_role;

commit;
