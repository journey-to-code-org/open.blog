#!/bin/sh
# Sets up the family service's database: the roles Supabase would have (roles.sql), then each of
# open.blog's SQL files the service uses, in order. A file is applied when it is new or changed
# since it was last applied; each file is written to be run twice safely, so a changed file is
# simply run again. Stops at the first error and says which file.
#
#   DATABASE_URL=postgres://... sh service/migrate.sh
#
# OPENBLOG_SERVICE_SQL lists the files (default: openblog moderation greetings gifts).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
sql_dir="${OPENBLOG_SQL_DIR:-$here/../supabase}"
: "${DATABASE_URL:?Set DATABASE_URL to the Postgres connection string}"
files="${OPENBLOG_SERVICE_SQL:-openblog moderation greetings gifts}"

run() { PGOPTIONS="-c client_min_messages=warning" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q "$@"; }

run -f "$here/roles.sql"
for name in $files; do
  file="$sql_dir/$name.sql"
  if [ ! -f "$file" ]; then
    echo "[migrate] $name.sql isn't in this version; skipped"
    continue
  fi
  sum=$(sha256sum "$file" | cut -d' ' -f1)
  done_sum=$(run -At -c "select sha256 from public.openblog_service_migrations where file = '$name'")
  if [ "$done_sum" = "$sum" ]; then
    continue
  fi
  echo "[migrate] applying $name.sql"
  if ! run -f "$file"; then
    echo "[migrate] $name.sql failed; see the message above" >&2
    exit 1
  fi
  run -c "insert into public.openblog_service_migrations (file, sha256) values ('$name', '$sum') on conflict (file) do update set sha256 = excluded.sha256, applied_at = now()"
done
# Tables made since the last start are the service role's too (the SQL grants its own; this is a net).
run -c "notify pgrst, 'reload schema'"
echo "[migrate] database is ready"
