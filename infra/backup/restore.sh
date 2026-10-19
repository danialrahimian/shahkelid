#!/bin/sh
# Brings a backup back: the database is replaced, the private files are put
# back as they were, and the app key that came with them is left in
# /control/restored-keys.env for `shahkelid restore` to put in .env.
#
#   restore.sh --list [local|s3]                  the snapshots there are
#   restore.sh <id|latest> [--from s3] --yes      a snapshot (this server's by default)
#   restore.sh --file /path/backup.skb --yes      a file the backup bot sent to Telegram
#
# RESTORE_PASSWORD, when given, is the backup password of the server the
# backup came from (when it is not this one's RESTIC_PASSWORD). For S3,
# SK_S3_REPOSITORY and its keys come from the panel's settings, or are given
# by the command when this server has none yet.
#
# Stop the app and the worker first (`shahkelid restore` does), so nothing
# writes while the database is being replaced.
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env
[ -f /control/backup.env ] && . /control/backup.env
export RESTIC_PASSWORD="${RESTORE_PASSWORD:-$RESTIC_PASSWORD}"

LOCAL_REPOSITORY=/backups/restic
S3_REPOSITORY=${SK_S3_REPOSITORY:-}
case "${RESTIC_REPOSITORY:-}" in s3:*) [ -n "$S3_REPOSITORY" ] || S3_REPOSITORY=$RESTIC_REPOSITORY ;; esac
export AWS_ACCESS_KEY_ID="${SK_S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
export AWS_SECRET_ACCESS_KEY="${SK_S3_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
export AWS_DEFAULT_REGION="${SK_S3_REGION:-${AWS_DEFAULT_REGION:-auto}}"

repository_for() {
  case "$1" in
    s3)
      [ -n "$S3_REPOSITORY" ] || { echo "No S3 bucket is set up." >&2; exit 2; }
      echo "$S3_REPOSITORY"
      ;;
    *) echo "$LOCAL_REPOSITORY" ;;
  esac
}

usage() {
  echo "Usage: restore.sh --list [local|s3] | <id|latest> [--from s3] --yes | --file <backup.skb> --yes" >&2
  echo "The current database and files are REPLACED." >&2
  exit 2
}

if [ "${1:-}" = "--list" ]; then
  RESTIC_REPOSITORY=$(repository_for "${2:-local}") exec restic snapshots --host shah-kelid
fi

TARGET=/var/lib/backup/restore
rm -rf "$TARGET"
mkdir -p "$TARGET"
trap 'rm -rf "$TARGET"' EXIT

FILE="" SNAPSHOT="" FROM=local CONFIRMED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE=${2:-}; shift 2 ;;
    --from) FROM=${2:-}; shift 2 ;;
    --yes) CONFIRMED=1; shift ;;
    --*) usage ;;
    *) SNAPSHOT=$1; shift ;;
  esac
done
[ "$CONFIRMED" = 1 ] || usage
[ -n "$FILE$SNAPSHOT" ] || usage

if [ -n "$FILE" ]; then
  [ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 2; }
  echo "Opening $FILE"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:RESTIC_PASSWORD -in "$FILE" \
    | tar -xf - -C "$TARGET" \
    || { echo "The file could not be opened: a different backup password, or not a backup file." >&2; exit 1; }
  DUMP="$TARGET/database.dump" KEYS="$TARGET/keys.env" RESTORED_FILES="$TARGET/files"
else
  echo "Fetching snapshot $SNAPSHOT from $FROM"
  RESTIC_REPOSITORY=$(repository_for "$FROM") restic restore "$SNAPSHOT" --host shah-kelid --target "$TARGET"
  DUMP="$TARGET/var/lib/backup/work/database.dump"
  KEYS="$TARGET/var/lib/backup/work/keys.env"
  RESTORED_FILES="$TARGET/data/files"
fi

[ -f "$DUMP" ] || { echo "The backup holds no database dump" >&2; exit 1; }

# A clean database rather than dropping tables one by one: the audit log
# refuses deletes by design, and a fresh database cannot keep stray rows.
echo "Replacing database $PGDATABASE"
psql -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists \"$PGDATABASE\" with (force)"
psql -v ON_ERROR_STOP=1 -d postgres -c "create database \"$PGDATABASE\" owner \"$PGUSER\""
pg_restore --exit-on-error --no-owner --dbname="$PGDATABASE" "$DUMP"

echo "Putting the files back"
find /data/files -mindepth 1 -delete
if [ -d "$RESTORED_FILES" ]; then
  cp -a "$RESTORED_FILES/." /data/files/
fi
chown -R 1000:1000 /data/files

# Backups made before M11 carry no key: the server's own stays.
rm -f /control/restored-keys.env
if [ -f "$KEYS" ]; then
  (umask 077 && cp "$KEYS" /control/restored-keys.env)
  echo "The app key of the backup is in /control/restored-keys.env"
fi
echo "Restored. Start the app again."
