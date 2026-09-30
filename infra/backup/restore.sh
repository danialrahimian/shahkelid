#!/bin/sh
# Restores a snapshot: the database is replaced and the private files are
# put back as they were.
#
#   restore.sh --list               the snapshots there are
#   restore.sh latest --yes         the newest one
#   restore.sh 4f2a9c1e --yes       a particular one
#
# Stop the app and the worker first (the guide's `sk restore` does), so
# nothing writes while the database is being replaced.
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env

if [ "${1:-}" = "--list" ]; then
  exec restic snapshots --host shah-kelid
fi

SNAPSHOT="${1:-}"
if [ -z "$SNAPSHOT" ] || [ "${2:-}" != "--yes" ]; then
  echo "Usage: restore.sh <snapshot|latest> --yes    (restore.sh --list shows the snapshots)" >&2
  echo "The current database and files are REPLACED." >&2
  exit 2
fi

TARGET=/var/lib/backup/restore
rm -rf "$TARGET"
mkdir -p "$TARGET"

echo "Fetching snapshot $SNAPSHOT"
restic restore "$SNAPSHOT" --host shah-kelid --target "$TARGET"

DUMP="$TARGET/var/lib/backup/work/database.dump"
[ -f "$DUMP" ] || { echo "The snapshot holds no database dump" >&2; exit 1; }

# A clean database rather than dropping tables one by one: the audit log
# refuses deletes by design, and a fresh database cannot keep stray rows.
echo "Replacing database $PGDATABASE"
psql -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists \"$PGDATABASE\" with (force)"
psql -v ON_ERROR_STOP=1 -d postgres -c "create database \"$PGDATABASE\" owner \"$PGUSER\""
pg_restore --exit-on-error --no-owner --dbname="$PGDATABASE" "$DUMP"

echo "Putting the files back"
find /data/files -mindepth 1 -delete
if [ -d "$TARGET/data/files" ]; then
  cp -a "$TARGET/data/files/." /data/files/
fi
chown -R 1000:1000 /data/files

rm -rf "$TARGET"
echo "Restored $SNAPSHOT. Start the app again."
