-- The roles Supabase provides and open.blog's SQL expects (supabase/*.sql grants to them), for a
-- plain Postgres such as Railway's. Run before those files; running it again changes nothing.
--
-- anon and authenticated get nothing: the tables are private (row level security on, no policies).
-- service_role is the hosted functions' role. As on Supabase it bypasses row level security; it
-- cannot log in, so the only way to act as it is a token signed with PostgREST's secret, which
-- only the service container holds.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- PostgREST connects as the database's own user and switches to the token's role.
do $$
begin
  execute format('grant anon, authenticated, service_role to %I', current_user);
end
$$;

grant usage on schema public to anon, authenticated, service_role;

create extension if not exists pgcrypto;

-- What open.blog's SQL applied once, by file and content, so a start only applies what is new.
create table if not exists public.openblog_service_migrations (
  file text primary key,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
revoke all on public.openblog_service_migrations from public, anon, authenticated, service_role;
