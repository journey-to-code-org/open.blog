-- Roll back the operations functions of social publishing (ADR 0701) that social-ops.sql added:
-- queue health, the sweep and retention. Run in the Supabase SQL editor after removing
-- OPENBLOG_SOCIAL_OPS and OPENBLOG_SOCIAL_RETENTION_DAYS from the hosted functions, so nothing calls
-- them while you undo. No table or row is touched: what retention already deleted stays deleted, and
-- everything else stays as it is. social-rollback.sql drops everything, this file included.

begin;

drop function if exists public.openblog_social_prune(text, integer, integer);
drop function if exists public.openblog_social_sweep(text, integer);
drop function if exists public.openblog_social_health(text, integer, text[]);

delete from public.openblog_social_schema where version = 4;

commit;
