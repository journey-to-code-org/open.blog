#!/bin/sh
# Starts open.blog inside the container. See the Dockerfile for the variables.
set -e

if [ -n "$OPENBLOG_ADMIN_USER" ] && [ -n "$OPENBLOG_ADMIN_PASSWORD" ]; then
  # Create the login if it does not exist; `user add` refuses an existing name,
  # and `user passwd` keeps it current with the variable.
  if OPENBLOG_PASSWORD="$OPENBLOG_ADMIN_PASSWORD" openblog user add "$OPENBLOG_ADMIN_USER" >/dev/null 2>&1; then
    echo "created admin user $OPENBLOG_ADMIN_USER"
  else
    OPENBLOG_PASSWORD="$OPENBLOG_ADMIN_PASSWORD" openblog user passwd "$OPENBLOG_ADMIN_USER" >/dev/null 2>&1 || true
  fi
fi

if [ -n "$GIT_AUTHOR_NAME" ]; then
  git config --global user.name "$GIT_AUTHOR_NAME"
  git config --global user.email "${GIT_AUTHOR_EMAIL:-openblog@localhost}"
fi
git config --global --add safe.directory /blog 2>/dev/null || true

# With a token, the Publish button and analytics backups can push from the
# container: the https remote gets the token baked in (never printed).
if [ -n "$OPENBLOG_GIT_TOKEN" ] && [ -d /blog/.git ]; then
  remote=$(git -C /blog remote get-url origin 2>/dev/null || true)
  case "$remote" in
    https://*)
      host_path=$(printf '%s' "$remote" | sed 's#^https://\([^@]*@\)\{0,1\}##')
      git -C /blog remote set-url origin "https://x-access-token:${OPENBLOG_GIT_TOKEN}@${host_path}"
      ;;
    git@github.com:*)
      git -C /blog remote set-url origin "https://x-access-token:${OPENBLOG_GIT_TOKEN}@github.com/${remote#git@github.com:}"
      ;;
  esac
fi

exec openblog serve --admin --host 0.0.0.0 --port "${PORT:-8080}" "$@"
