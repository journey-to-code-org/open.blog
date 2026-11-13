-- Undo push.sql (ADR 0412). This forgets every device that turned notifications on; each would have
-- to turn them on again. Nothing else is lost: comments, feedback and quote requests stay.
--
-- It drops only what push.sql added, and touches no comment, quote, greeting, social or other table.

begin;
drop table if exists public.openblog_push_devices;
drop table if exists public.openblog_push_schema;
commit;
