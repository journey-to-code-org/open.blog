-- Roll back quote request management (ADR 0384). Run in the Supabase SQL editor.
-- Archived requests become 'handled' (they were already dealt with); nothing is deleted.

begin;
update public.openblog_quote_requests
   set status = 'handled', handled_at = coalesce(handled_at, archived_at, now())
 where status = 'archived';
drop index if exists public.openblog_quote_requests_archived;
alter table public.openblog_quote_requests drop constraint if exists openblog_quote_requests_archived_stamp;
alter table public.openblog_quote_requests drop constraint if exists openblog_quote_requests_status_v2;
alter table public.openblog_quote_requests drop column if exists archived_at;
alter table public.openblog_quote_requests
  add constraint openblog_quote_requests_status_check check (status in ('new', 'handled'));
alter table public.openblog_quote_requests
  add constraint openblog_quote_requests_handled_stamp check ((status = 'handled') = (handled_at is not null));
delete from public.openblog_quote_schema where version = 2;
commit;
