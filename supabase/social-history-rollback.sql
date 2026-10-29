-- Roll back the recorded status history of social publishing (ADR 0323): the trigger, its two
-- functions and the openblog_social_post_events table that social-history.sql added. Run in the
-- Supabase SQL editor. Announcements, their attempts and the queue are untouched; Admin goes back to
-- the history it rebuilds from the attempts, marked as incomplete.
--
-- The recorded events are deleted with the table. Export them first if you want to keep them:
--   copy (select * from public.openblog_social_post_events order by id) to stdout with csv header;
-- social-rollback.sql drops everything, this file included.

begin;

drop trigger if exists openblog_social_posts_history on public.openblog_social_posts;
drop function if exists public.openblog_social_record_event();
drop table if exists public.openblog_social_post_events;
drop function if exists public.openblog_social_delivery_state(text, text);

delete from public.openblog_social_schema where version = 3;

commit;
