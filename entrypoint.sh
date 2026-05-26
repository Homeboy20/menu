#!/bin/sh
set -e
echo "[entrypoint] running migration script (if DATABASE_URL is set)"
if [ -n "$DATABASE_URL" ]; then
  node scripts/add_rooms_enabled_migration.js
  echo "[entrypoint] migration finished"
else
  echo "[entrypoint] DATABASE_URL not set — skipping migration"
fi

exec node server.js
