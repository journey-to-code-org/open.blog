-- Undo arrivals.sql (ADR 0407): removes the hosted arrivals table and its functions. Set
-- OPENBLOG_ARRIVALS_ENABLED to anything but "true" first, so the function stops calling them.
-- Views, uniques and referrers in openblog.sql are untouched. Running it twice changes nothing.

drop function if exists public.openblog_analytics_export(text);
drop function if exists public.openblog_record_arrival(text, date, text, text);
drop table if exists public.openblog_daily_arrivals;
