-- Roll back optional quote requests (ADR 0381). Run in the Supabase SQL editor.
--
-- First remove OPENBLOG_QUOTE_ENABLED from the Netlify environment and
-- redeploy, so nothing writes while you undo. To keep the requests, export
-- them first:
--
--   select * from public.openblog_quote_requests order by created_at;
--
-- Then empty the photo bucket in Dashboard > Storage (Supabase refuses to
-- delete a bucket that still holds files, and SQL must not delete objects
-- directly) and delete the bucket `openblog-quote-photos` there.
--
-- This drops only what quote.sql added: the request and schema tables (their
-- rows go with them). It touches no comment, feedback, subscription, social
-- or workspace table, and no post.

begin;
drop table if exists public.openblog_quote_requests;
drop table if exists public.openblog_quote_schema;
commit;
