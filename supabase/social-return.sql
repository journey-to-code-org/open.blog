-- Optional social publishing, the way back to Studio (Studio R2, G6): the address a connection's
-- callback sends the author's browser on to. Run once in the Supabase SQL editor, after social.sql,
-- before deploying the social function that writes it. Running it twice changes nothing.
--
-- Additive only: one nullable column and the check that holds it to Studio's own address. Rows that
-- exist keep return_to null, and a null return_to means what it always did: the callback answers its
-- fixed page. To undo it, see social-return-rollback.sql.
--
-- Why a check as well as the function's own: the callback redirects to this value, so it must never
-- hold anything but `https://<host>/admin/studio/` (or `http://` to a loopback address, for a Studio
-- on the author's own computer), whoever wrote the row.

begin;

insert into public.openblog_social_schema (version) values (5) on conflict do nothing;

alter table public.openblog_social_connections add column if not exists return_to text;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'openblog_social_connections_return_to'
      and conrelid = 'public.openblog_social_connections'::regclass
  ) then
    alter table public.openblog_social_connections
      add constraint openblog_social_connections_return_to check (
        return_to is null or (
          char_length(return_to) <= 300
          and return_to ~ '^(https://[a-z0-9.-]+(:[0-9]{1,5})?|http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?)/admin/studio/$'
        )
      );
  end if;
end
$migration$;

commit;
