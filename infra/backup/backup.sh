#!/bin/sh
# One backup: the database (pg_dump, custom format) and the private files,
# into the restic repository; then old snapshots are thinned out.
#
# A failure is never silent: owners and admins get an alert through the
# app's own alert path (an outbox event the worker delivers by email and
# Telegram), and BACKUP_PING_URL, if set, is told too.
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env

WORK=/var/lib/backup/work
FILES=/data/files
LOG=/var/lib/backup/last-run.log

say() { echo "[backup $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

alert() {
  # The message goes in as a psql variable, quoted by psql, never pasted into SQL.
  psql -v ON_ERROR_STOP=1 -v msg="$1" -q <<'SQL' || say "could not record the alert either"
insert into outbox_events (topic, aggregate_type, aggregate_id, payload)
values ('admin.alert', 'backup', gen_random_uuid(),
        jsonb_build_object('subject', 'پشتیبان‌گیری انجام نشد', 'text', :'msg'));
SQL
  [ -n "${BACKUP_PING_URL:-}" ] && curl -fsS -m 10 "$BACKUP_PING_URL/fail" > /dev/null || true
}

run() {
  mkdir -p "$WORK"
  say "dumping the database"
  pg_dump --format=custom --compress=6 --file="$WORK/database.dump.tmp"
  mv "$WORK/database.dump.tmp" "$WORK/database.dump"

  # restic retries an unreachable store for many minutes per command; asking
  # once, with a limit, turns "the bucket is down" into an alert within
  # minutes. Exit 10 is restic's "no repository here yet".
  code=0
  timeout "${BACKUP_REACH_TIMEOUT:-180}" restic cat config > /dev/null 2>&1 || code=$?
  if [ "$code" -eq 10 ]; then
    say "no repository yet: creating it"
    restic init
  elif [ "$code" -ne 0 ]; then
    say "the backup store cannot be reached, or the password is wrong (restic exit $code)"
    return 1
  fi

  say "sending the snapshot"
  restic backup --host shah-kelid --tag scheduled "$WORK/database.dump" "$FILES"

  say "thinning out old snapshots"
  restic forget --host shah-kelid --prune \
    --keep-last "${BACKUP_KEEP_LAST:-8}" \
    --keep-daily "${BACKUP_KEEP_DAILY:-7}" \
    --keep-weekly "${BACKUP_KEEP_WEEKLY:-4}" \
    --keep-monthly "${BACKUP_KEEP_MONTHLY:-6}"

  # The repository's structure is checked every time, and a sample of the
  # data itself read back: a backup nobody can read is not a backup.
  restic check --read-data-subset="${BACKUP_CHECK_SUBSET:-5%}"
}

if run > "$LOG" 2>&1; then
  cat "$LOG"
  date +%s > /var/lib/backup/last-success
  say "done"
  [ -n "${BACKUP_PING_URL:-}" ] && curl -fsS -m 10 "$BACKUP_PING_URL" > /dev/null || true
else
  cat "$LOG"
  say "FAILED"
  alert "پشتیبان‌گیری $(date -u +%Y-%m-%dT%H:%MZ) شکست خورد. آخرین خطوط گزارش:
$(tail -n 15 "$LOG")"
  exit 1
fi
