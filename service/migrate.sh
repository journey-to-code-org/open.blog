#!/bin/sh
# Sets up the family service's database: the roles Supabase would have (roles.sql), then each of
# open.blog's SQL files the service uses, in order. A file is applied when it is new or changed
# since it was last applied; each file is written to be run twice safely, so a changed file is
# simply run again. Stops at the first error and says which file.
#
#   DATABASE_URL=postgres://... sh service/migrate.sh
#
# OPENBLOG_SERVICE_SQL lists the files. By default: openblog moderation greetings gifts, and the
# files of each optional feature switched on (push, quote requests, Webmentions, social publishing).
# social-cron.sql is never applied here: it schedules the worker with pg_cron, which the service does
# itself.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
sql_dir="${OPENBLOG_SQL_DIR:-$here/../supabase}"
: "${DATABASE_URL:?Set DATABASE_URL to the Postgres connection string}"
on() { [ "$(printenv "$1" | tr '[:upper:]' '[:lower:]' | tr -d ' ')" = "true" ]; }
default="openblog moderation greetings gifts"
if on OPENBLOG_PUSH_ENABLED; then default="$default push"; fi
if on OPENBLOG_QUOTE_ENABLED; then default="$default quote quote-v2"; fi
if on OPENBLOG_WEBMENTION_ENABLED; then default="$default webmention"; fi
if on OPENBLOG_SOCIAL_ENABLED; then default="$default social social-return social-queue social-history social-media social-ops"; fi
files="${OPENBLOG_SERVICE_SQL:-$default}"

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
# PostgREST reloads its view of the tables, so new ones are reachable at once.
run -c "notify pgrst, 'reload schema'"
echo "[migrate] database is ready"
