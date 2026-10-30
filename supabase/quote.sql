-- Optional quote requests (epic #474, story #485; ADR 0900). Run once in the
-- Supabase SQL editor, only if the site opts in. A site that does not opt in
-- never needs it: builds, feeds, exports and syndication do not read it. Then
-- set OPENBLOG_QUOTE_ENABLED=true and the other OPENBLOG_QUOTE_* settings
-- (docs/quote-requests.md) and redeploy. Until then nothing here is used.
--
-- Additive only: it creates a schema version table, the request table, a
-- private storage bucket for photos, and indexes. It does not rename, drop or
-- rewrite anything that exists, and running it twice changes nothing.
-- To undo it, see quote-rollback.sql.
--
-- Private by construction (as in social.sql, ADR 0293): row level security is
-- on with no policies, the public roles have no access, and only the hosted
-- function, signed in as service_role, reads and writes. A visitor's browser
-- never talks to Supabase. Every row carries the site (OPENBLOG_SITE_ID).
-- Visitor details live only here and in the private bucket: never in a
-- static file, a log or an error.

begin;

create table if not exists public.openblog_quote_schema (
  version integer primary key check (version >= 1),
  applied_at timestamptz not null default now()
);
insert into public.openblog_quote_schema (version) values (1) on conflict do nothing;

create table if not exists public.openblog_quote_requests (
  id uuid primary key default gen_random_uuid(),
  site_id text not null check (site_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  status text not null default 'new' check (status in ('new', 'handled')),
  name text not null check (char_length(name) between 1 and 100),
  phone text not null check (char_length(phone) between 7 and 30),
  email text check (email is null or char_length(email) <= 200),
  town text not null check (char_length(town) between 1 and 100),
  service text not null check (char_length(service) between 1 and 100),
  description text not null check (char_length(description) between 10 and 2000),
  -- The page the form was on, as a path. Not a secret.
  page text check (page is null or (page ~ '^/' and char_length(page) <= 500)),
  -- [{ "path": "...", "type": "image/jpeg", "bytes": 12345 }], files in the private bucket.
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 5),
  -- A keyed hash of the visitor's address, only to rate-limit. Never the address.
  client_hash text not null check (char_length(client_hash) between 16 and 128),
  -- A keyed hash of the single-use form token, so one token sends one request.
  token_hash text not null check (char_length(token_hash) between 16 and 128),
  -- Owner notification (ADR 0902): never gates the request.
  notify_status text not null default 'off' check (notify_status in ('off', 'pending', 'sent', 'failed')),
  notify_attempts integer not null default 0 check (notify_attempts between 0 and 20),
  notify_error_code text check (notify_error_code is null or notify_error_code ~ '^[a-z][a-z0-9-]{0,39}$'),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  constraint openblog_quote_requests_handled_stamp check ((status = 'handled') = (handled_at is not null)),
  constraint openblog_quote_requests_token unique (site_id, token_hash)
);
create index if not exists openblog_quote_requests_site
  on public.openblog_quote_requests (site_id, status, created_at desc);
create index if not exists openblog_quote_requests_client
  on public.openblog_quote_requests (site_id, client_hash, created_at desc);

alter table public.openblog_quote_schema enable row level security;
alter table public.openblog_quote_requests enable row level security;
revoke all on public.openblog_quote_schema from public, anon, authenticated;
revoke all on public.openblog_quote_requests from public, anon, authenticated;
grant select on public.openblog_quote_schema to service_role;
grant select, insert, update, delete on public.openblog_quote_requests to service_role;

-- A private bucket for photos (only where Supabase Storage is installed).
do $storage$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('openblog-quote-photos', 'openblog-quote-photos', false)
    on conflict (id) do nothing;
  end if;
end
$storage$;

commit;
