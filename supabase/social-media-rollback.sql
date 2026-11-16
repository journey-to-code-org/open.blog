-- Refuse to discard an approved media selection from any announcement.
begin;

do $$
begin
  if exists (select 1 from public.openblog_social_posts where media is not null) then
    raise exception 'Resolve all media-bearing announcements before removing social media support';
  end if;
end $$;

alter table public.openblog_social_posts drop column if exists media;
delete from public.openblog_social_schema where version = 5;

commit;
