-- Roll back Suggestions for future work's storage (ADR 0192). Run in the
-- Supabase SQL editor, before feedback-rollback.sql if you are undoing that
-- too (it drops the table, and with it the check this file restores).
--
-- First remove OPENBLOG_SUGGESTIONS_ENABLED from the Netlify environment and
-- redeploy, so the function stops taking suggestions; readers then get the
-- copy-and-send path. If you want to keep what readers sent, export it first,
-- for example with:
--
--   select * from public.openblog_feedback where kind = 'future-suggestion' order by received_at;
--
-- This restores the check feedback.sql loosened: a row has its page, passage
-- revision and passage target together, or none of them. It cannot do that
-- while a row has a page and no passage, which is what every suggestion is,
-- so it refuses and changes nothing until you have dealt with those rows
-- yourself: export them, then delete them with
--
--   delete from public.openblog_feedback
--    where work is not null and (revision is null or target is null);
--
-- (an audit event of a deleted row blocks the delete; delete the events of
-- those rows from public.openblog_feedback_events first). Comments, passage
-- feedback, Third Perspectives and every other table are untouched.

begin;

do $$
begin
  if exists (
    select 1 from public.openblog_feedback
     where work is not null and (revision is null or target is null)
  ) then
    raise exception 'openblog_feedback still has rows with a page and no passage (suggestions for future work); export and delete them, as the header of this file says, then run it again';
  end if;
end $$;

alter table public.openblog_feedback drop constraint if exists openblog_feedback_passage_complete;
alter table public.openblog_feedback add constraint openblog_feedback_passage_complete check (
  (work is null and revision is null and target is null)
  or (work is not null and revision is not null and target is not null)
);

commit;
