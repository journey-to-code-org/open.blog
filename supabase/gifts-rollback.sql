-- Undoes gifts.sql: removes the gifts and the setting. Every gift is lost, opened or not, so only
-- run this when the family has been told.
begin;
drop table if exists public.openblog_gifts;
drop table if exists public.openblog_gift_settings;
commit;
