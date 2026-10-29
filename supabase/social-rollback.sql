-- Roll back optional scheduled social publishing (ADRs 0450 to 0452). Run in
-- the Supabase SQL editor.
--
-- First remove OPENBLOG_SOCIAL_ENABLED from the Netlify environment and
-- redeploy, and stop the scheduled worker, so nothing writes while you undo.
-- If you want to keep the schedule or the delivery history, export them first:
--
--   select * from public.openblog_social_posts order by scheduled_for;
--   select * from public.openblog_social_attempts order by started_at;
--
-- This drops only what social.sql added: the credential, attempt,
-- queue and account tables (their rows go with them) and the schema version
-- table. It touches no comment, feedback, subscription or workspace table, and
-- no post. Nothing already published to LinkedIn or Facebook is removed there.
-- Revoke the app's access in each provider's own settings as well: stored
-- tokens are deleted here but stay valid at the provider until revoked.
-- Delete OPENBLOG_SOCIAL_TOKEN_KEYS afterwards.
--
-- It leaves the pgcrypto extension, which other files in this folder use.

begin;

drop table if exists public.openblog_social_credentials;
drop table if exists public.openblog_social_attempts;
drop table if exists public.openblog_social_posts;
drop table if exists public.openblog_social_accounts;
drop table if exists public.openblog_social_schema;

commit;
