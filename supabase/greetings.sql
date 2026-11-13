-- Optional greeting cards (ADR 0411). Run once in the Supabase SQL editor, only if the site opts in.
-- A site that does not opt in never needs it: builds, feeds and exports do not read it. Then set
-- OPENBLOG_GREETINGS_ENABLED=true and the other settings in docs/greeting-cards.md and redeploy.
--
-- Additive only: a schema version table, the address book, the cards, and indexes. It renames,
-- drops and rewrites nothing, and running it twice changes nothing. To undo it, see
-- greetings-rollback.sql.
--
-- Private by construction (as in quote.sql): row level security is on with no policies, the public
-- roles have no access, and only the hosted functions, signed in as service_role, read and write.
-- Names, addresses and messages live only here: never in the repository, a page, a log or an error.

begin;

create table if not exists public.openblog_greeting_schema (
  version integer primary key check (version >= 1),
  applied_at timestamptz not null default now()
);
insert into public.openblog_greeting_schema (version) values (1) on conflict do nothing;

create table if not exists public.openblog_greeting_contacts (
  id uuid primary key default gen_random_uuid(),
  site_id text not null check (site_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name text not null check (char_length(name) between 1 and 80),
  email text not null check (char_length(email) between 3 and 254),
  birthday date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists openblog_greeting_contacts_site on public.openblog_greeting_contacts (site_id, name);

create table if not exists public.openblog_greeting_cards (
  id uuid primary key default gen_random_uuid(),
  site_id text not null check (site_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  contact_id uuid not null references public.openblog_greeting_contacts (id) on delete cascade,
  design text not null check (design ~ '^[a-z][a-z-]{0,39}$'),
  subject text not null check (char_length(subject) between 1 and 150),
  message text not null check (char_length(message) between 1 and 4000),
  sign_off text not null default '' check (char_length(sign_off) <= 80),
  send_on date not null,
  send_hour smallint not null default 8 check (send_hour between 0 and 23),
  time_zone text not null check (char_length(time_zone) between 1 and 64),
  yearly boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  next_send_at timestamptz not null,
  last_sent_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 100),
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z-]{0,39}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists openblog_greeting_cards_due on public.openblog_greeting_cards (site_id, status, next_send_at);
create index if not exists openblog_greeting_cards_contact on public.openblog_greeting_cards (contact_id);

alter table public.openblog_greeting_schema enable row level security;
alter table public.openblog_greeting_contacts enable row level security;
alter table public.openblog_greeting_cards enable row level security;
revoke all on public.openblog_greeting_schema, public.openblog_greeting_contacts, public.openblog_greeting_cards from public, anon, authenticated;
grant select, insert, update, delete on public.openblog_greeting_contacts, public.openblog_greeting_cards to service_role;
grant select on public.openblog_greeting_schema to service_role;

commit;
