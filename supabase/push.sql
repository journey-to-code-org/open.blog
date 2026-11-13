-- Optional push notifications to the owner (ADR 0412). Run once in the Supabase SQL editor, only if
-- the site opts in. A site that does not opt in never needs it: builds, feeds and exports do not read
-- it. Then set OPENBLOG_PUSH_ENABLED=true and the other settings in docs/notifications.md and redeploy.
--
-- Additive only: a schema version table and the devices. It renames, drops and rewrites nothing,
-- and running it twice changes nothing. To undo it, see push-rollback.sql.
--
-- Private by construction (as in quote.sql and greetings.sql): row level security is on with no
-- policies, the public roles have no access, and only the hosted functions, signed in as
-- service_role, read and write. A device's endpoint is a capability URL and stays here.

begin;

create table if not exists public.openblog_push_schema (
  version integer primary key check (version >= 1),
  applied_at timestamptz not null default now()
);
insert into public.openblog_push_schema (version) values (1) on conflict do nothing;

create table if not exists public.openblog_push_devices (
  id uuid primary key default gen_random_uuid(),
  site_id text not null check (site_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  endpoint text not null check (endpoint ~ '^https://' and char_length(endpoint) <= 1024),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  label text not null check (char_length(label) between 1 and 60),
  kinds text[] not null default '{}' check (kinds <@ array['comment', 'feedback', 'quote', 'app']::text[]),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz,
  unique (site_id, endpoint)
);
create index if not exists openblog_push_devices_site on public.openblog_push_devices (site_id, created_at);

alter table public.openblog_push_schema enable row level security;
alter table public.openblog_push_devices enable row level security;
revoke all on public.openblog_push_schema, public.openblog_push_devices from public, anon, authenticated;
grant select, insert, update, delete on public.openblog_push_devices to service_role;
grant select on public.openblog_push_schema to service_role;

commit;
