-- Roll back received Webmentions (ADRs 0364 and 0365): the request store and its two functions
-- that webmention.sql added. Run in the Supabase SQL editor after setting
-- OPENBLOG_WEBMENTION_ENABLED to anything but "true" (or removing it) and redeploying, so the
-- endpoint answers 404 and nothing writes while you undo.
--
-- What is lost: only requests no pull has handled yet. Mentions already pulled live in the
-- author's private inbox file and in content/webmentions.json, which this does not touch; the
-- site keeps showing what was approved. Pull once more first (`openblog mentions pull --write`)
-- if you want to keep what is waiting.

begin;

drop function if exists public.openblog_webmention_settle(text, jsonb);
drop function if exists public.openblog_webmention_receive(text, text, text, text, integer, integer);
drop table if exists public.openblog_webmention_requests;

commit;
