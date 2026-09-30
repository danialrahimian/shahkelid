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

# Every step says `|| return 1`: run() is called as an `if` condition, and
# there the shell ignores `set -e`, so a failed pg_dump would otherwise be
# walked past and the backup reported as done.
run() {
  # A database with no accounts (or no tables yet, before the first
  # migration) is a fresh install: nothing to protect. Backing it up would
  # make an empty copy "the latest", and a new server brought back with
  # `restore latest` would restore that instead of the shop. A database that
  # cannot be reached is a failure, not "no accounts".
  migrated=$(psql -tAc "select to_regclass('public.users') is not null") || return 1
  accounts=0
  if [ "$migrated" = "t" ]; then
    accounts=$(psql -tAc "select count(*) from users where deleted_at is null") || return 1
  fi
  if [ "$accounts" -eq 0 ]; then
    say "no accounts yet: nothing to back up"
    return 0
  fi

  mkdir -p "$WORK" || return 1
  say "dumping the database ($accounts accounts)"
  pg_dump --format=custom --compress=6 --file="$WORK/database.dump.tmp" || return 1
  mv "$WORK/database.dump.tmp" "$WORK/database.dump" || return 1

  # restic retries an unreachable store for many minutes per command; asking
  # once, with a limit, turns "the bucket is down" into an alert within
  # minutes. Exit 10 is restic's "no repository here yet".
  code=0
  timeout "${BACKUP_REACH_TIMEOUT:-180}" restic cat config > /dev/null 2>&1 || code=$?
  if [ "$code" -eq 10 ]; then
    say "no repository yet: creating it"
    restic init || return 1
  elif [ "$code" -ne 0 ]; then
    say "the backup store cannot be reached, or the password is wrong (restic exit $code)"
    return 1
  fi

  say "sending the snapshot"
  # The account count rides along as a tag, so a list of snapshots shows at a
  # glance which ones hold the shop.
  restic backup --host shah-kelid --tag scheduled --tag "accounts-$accounts" "$WORK/database.dump" "$FILES" || return 1

  say "thinning out old snapshots"
  restic forget --host shah-kelid --prune \
    --keep-last "${BACKUP_KEEP_LAST:-8}" \
    --keep-daily "${BACKUP_KEEP_DAILY:-7}" \
    --keep-weekly "${BACKUP_KEEP_WEEKLY:-4}" \
    --keep-monthly "${BACKUP_KEEP_MONTHLY:-6}" || return 1

  # The repository's structure is checked every time, and a sample of the
  # data itself read back: a backup nobody can read is not a backup.
  restic check --read-data-subset="${BACKUP_CHECK_SUBSET:-5%}" || return 1
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
