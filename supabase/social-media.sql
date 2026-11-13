-- Optional approved announcement media. Run after social.sql and social-queue.sql.
-- Existing rows remain text-only. Roll back only after removing or resolving media-bearing rows.
begin;

insert into public.openblog_social_schema (version) values (5) on conflict do nothing;

alter table public.openblog_social_posts
  add column if not exists media jsonb
    check (media is null or (jsonb_typeof(media) = 'object' and octet_length(media::text) <= 8192));

commit;
