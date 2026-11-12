-- Optional visit attribution for the hosted engagement function (epic DIST9, #615; ADR 0407). Run
-- once in the Supabase SQL editor, after openblog.sql, and only if the site opts in to arrivals
-- (OPENBLOG_ARRIVALS_ENABLED=true). Running it twice changes nothing.
--
-- Additive only: one new table and two functions. It touches no existing table and drops nothing.
-- To undo it, see arrivals-rollback.sql.
--
-- What is stored: per day, destination and page, how many counted views arrived from that
-- destination. The destination is one of the fixed provider ids the function attributes to (the
-- same list as `openblog_core::outcome`); nothing about a visitor is added, and a view not
-- counted (DNT, GPC, rate-limited) is never attributed.
--
-- Private by construction: row level security is on with no policies, the public roles have no
-- grants, and only the service role the function uses may call the functions.

create table if not exists public.openblog_daily_arrivals (
  site_id text not null,
  day date not null,
  destination text not null check (
-- BEGIN openblog destinations: generated from openblog_core::outcome::DESTINATIONS. Do not edit by hand.
destination in ('dev', 'hashnode', 'ghost', 'wordpress', 'medium', 'linkedin', 'facebook', 'bluesky', 'mastodon', 'pinterest', 'youtube', 'hacker-news', 'reddit', 'product-hunt', 'google-business-profile', 'nextdoor')
-- END openblog destinations
  ),
  path text not null check (char_length(path) between 1 and 512),
  views bigint not null default 0,
  primary key (site_id, day, destination, path)
);

alter table public.openblog_daily_arrivals enable row level security;

create or replace function public.openblog_record_arrival(p_site_id text, p_day date, p_destination text, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into openblog_daily_arrivals(site_id, day, destination, path, views)
  values (p_site_id, p_day, p_destination, p_path, 1)
  on conflict (site_id, day, destination, path) do update set views = openblog_daily_arrivals.views + 1;
end $$;

-- Everything `openblog analytics pull` merges, in the same shape as the Cloudflare Worker's export:
-- per day, views, uniques, referrers and (only on a day that has one) arrivals, for the last 400
-- days, plus all-time totals per page.
create or replace function public.openblog_analytics_export(p_site_id text)
returns jsonb language sql stable security definer set search_path = public as $$
with view_days as (
  select day, jsonb_object_agg(path, views) as views,
    coalesce(jsonb_object_agg(path, uniques) filter (where uniques > 0), '{}'::jsonb) as uniques
  from openblog_daily_views where site_id = p_site_id and day >= current_date - 399 group by day
), referrer_days as (
  select day, jsonb_object_agg(host, views) as referrers
  from openblog_daily_referrers where site_id = p_site_id and day >= current_date - 399 group by day
), arrival_pages as (
  select day, destination, jsonb_object_agg(path, views) as pages
  from openblog_daily_arrivals where site_id = p_site_id and day >= current_date - 399 group by day, destination
), arrival_days as (
  select day, jsonb_object_agg(destination, pages) as arrivals from arrival_pages group by day
), days as (
  select day from view_days union select day from referrer_days union select day from arrival_days
)
select jsonb_build_object(
  'version', 1,
  'days', coalesce((
    select jsonb_object_agg(d.day::text, jsonb_strip_nulls(jsonb_build_object(
      'views', coalesce(v.views, '{}'::jsonb),
      'uniques', coalesce(v.uniques, '{}'::jsonb),
      'referrers', coalesce(r.referrers, '{}'::jsonb),
      'arrivals', a.arrivals
    )))
    from days d left join view_days v using (day) left join referrer_days r using (day) left join arrival_days a using (day)
  ), '{}'::jsonb),
  'totals', coalesce((
    select jsonb_object_agg(path, total)
    from (select path, sum(views)::bigint as total from openblog_daily_views where site_id = p_site_id group by path) t
  ), '{}'::jsonb)
);
$$;

revoke all on public.openblog_daily_arrivals from public, anon, authenticated;
revoke all on function public.openblog_record_arrival(text,date,text,text), public.openblog_analytics_export(text) from public, anon, authenticated;
grant all on public.openblog_daily_arrivals to service_role;
grant execute on function public.openblog_record_arrival(text,date,text,text), public.openblog_analytics_export(text) to service_role;
