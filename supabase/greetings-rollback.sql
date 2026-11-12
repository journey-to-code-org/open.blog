-- Undo greetings.sql (ADR 0411). This deletes the address book and every card, sent or not, and
-- cannot be undone. Export first if you want to keep them:
--
--   select * from public.openblog_greeting_contacts order by name;
--   select * from public.openblog_greeting_cards order by next_send_at;
--
-- It drops only what greetings.sql added, and touches no comment, quote, social or other table.

begin;
drop table if exists public.openblog_greeting_cards;
drop table if exists public.openblog_greeting_contacts;
drop table if exists public.openblog_greeting_schema;
commit;
