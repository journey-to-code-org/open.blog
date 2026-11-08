-- Quote request management (epic #474, story #486; ADR 0384). Run once in the
-- Supabase SQL editor AFTER quote.sql, only if you use the Admin Requests view.
--
-- Additive and reversible: it allows the status 'archived', adds archived_at,
-- and records schema version 2. It rewrites no row. Running it twice changes
-- nothing. To undo it, see quote-v2-rollback.sql.

begin;

alter table public.openblog_quote_requests add column if not exists archived_at timestamptz;

alter table public.openblog_quote_requests drop constraint if exists openblog_quote_requests_status_check;
alter table public.openblog_quote_requests drop constraint if exists openblog_quote_requests_handled_stamp;
alter table public.openblog_quote_requests drop constraint if exists openblog_quote_requests_status_v2;
alter table public.openblog_quote_requests drop constraint if exists openblog_quote_requests_archived_stamp;

alter table public.openblog_quote_requests
  add constraint openblog_quote_requests_status_v2 check (status in ('new', 'handled', 'archived'));
-- A handled request has a handled time; an archived one has an archived time. Nothing else is required.
alter table public.openblog_quote_requests
  add constraint openblog_quote_requests_archived_stamp check ((status = 'archived') = (archived_at is not null));

create index if not exists openblog_quote_requests_archived
  on public.openblog_quote_requests (site_id, archived_at) where status = 'archived';

insert into public.openblog_quote_schema (version) values (2) on conflict do nothing;

commit;
