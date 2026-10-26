-- Roll back feedback.sql (ADR 0088). Run in the Supabase SQL editor.
--
-- First turn the feature off: remove OPENBLOG_FEEDBACK_ENABLED from the
-- Netlify environment and redeploy, so nothing writes to the table. Then, if
-- you want to keep what readers sent, export it, for example from the Table
-- Editor (openblog_feedback, Export to CSV) or with:
--
--   select * from public.openblog_feedback order by received_at;
--
-- This drops only the table feedback.sql created, with its indexes. Comments,
-- analytics, rate limits and every other table are untouched. Feedback rows
-- are deleted with it and cannot be recovered without your export.

begin;

drop table if exists public.openblog_feedback;

commit;
