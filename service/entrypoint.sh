#!/bin/sh
# Starts the hosted functions: sets up the database, starts PostgREST on loopback, then the service.
# If PostgREST stops, the container stops, so the host restarts it whole.
set -eu
: "${DATABASE_URL:?Set DATABASE_URL to the Postgres connection string}"
: "${PGRST_JWT_SECRET:?Set PGRST_JWT_SECRET to 32 or more random characters}"
cd /app

# Railway's Postgres can take a moment after a deploy; wait up to a minute.
tries=0
until psql "$DATABASE_URL" -X -q -c "select 1" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then echo "[service] the database didn't answer" >&2; exit 1; fi
  sleep 2
done
sh service/migrate.sh

PGRST_DB_URI="$DATABASE_URL" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
  PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT=3000 PGRST_LOG_LEVEL=warn \
  PGRST_JWT_SECRET="$PGRST_JWT_SECRET" PGRST_DB_POOL=5 \
  postgrest &
rest=$!

# Behind Railway's proxy the visitor's address is its X-Real-IP; set this off elsewhere if not.
export OPENBLOG_TRUST_X_REAL_IP="${OPENBLOG_TRUST_X_REAL_IP:-true}"
node service/server.mjs &
app=$!

# Whichever stops first takes the container with it.
while kill -0 "$rest" 2>/dev/null && kill -0 "$app" 2>/dev/null; do sleep 5; done
kill "$rest" "$app" 2>/dev/null || true
exit 1
