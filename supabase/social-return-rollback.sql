-- Roll back the way back to Studio (social-return.sql, Studio R2, G6): the return_to column of
-- openblog_social_connections and its check. Run in the Supabase SQL editor, after deploying a social
-- function from before G6 (one that never writes return_to). Connections, accounts and announcements
-- are untouched; a sign-in then ends on the function's fixed page, and Studio's new-tab way still works.
-- social-rollback.sql drops the whole table, this column with it.

begin;

alter table public.openblog_social_connections drop constraint if exists openblog_social_connections_return_to;
alter table public.openblog_social_connections drop column if exists return_to;

delete from public.openblog_social_schema where version = 5;

commit;
