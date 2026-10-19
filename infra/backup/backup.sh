#!/bin/sh
# One backup: the database (pg_dump, custom format), the private files, and
# the app's encryption key, to every destination set up in the panel:
#
#   this server   always: a restic repository in /backups/restic
#   S3            when a bucket is set up: a second restic repository there
#   Telegram      when turned on: one encrypted file, sent by the alerts bot
#
# Everything is encrypted with RESTIC_PASSWORD, the one secret to keep away
# from the server: with it, a backup brings back the shop on a new server,
# key and all. Each destination is tried even when another fails, and what
# each did goes to /control/status.json, which the panel shows.
#
# A failure is never silent: owners and admins get an alert through the
# app's own alert path (an outbox event the worker delivers by email and
# Telegram), and BACKUP_PING_URL, if set, is told too.
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env
[ -f /control/backup.env ] && . /control/backup.env

# One backup at a time, whoever starts it (the schedule, the panel, ./sk).
exec 9> /var/lib/backup/run.lock
flock -n 9 || { echo "A backup is already running."; exit 0; }

WORK=/var/lib/backup/work
FILES=/data/files
LOG=/var/lib/backup/last-run.log
LOCAL_REPOSITORY=/backups/restic
STATUS=/control/status.json
# The bucket the panel set up; before M11 it was RESTIC_REPOSITORY in .env.
S3_REPOSITORY=${SK_S3_REPOSITORY:-}
case "${RESTIC_REPOSITORY:-}" in s3:*) [ -n "$S3_REPOSITORY" ] || S3_REPOSITORY=$RESTIC_REPOSITORY ;; esac

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

# One restic repository: made on first use, then a snapshot, old ones
# thinned out, and a sample read back (a backup nobody can read is not one).
# Every step says `|| return 1`: this runs as an `if` condition, where the
# shell ignores `set -e`.
to_restic() {
  repository=$1
  # restic retries an unreachable store for many minutes per command; asking
  # once, with a limit, turns "the bucket is down" into an alert within
  # minutes. Exit 10 is restic's "no repository here yet".
  code=0
  RESTIC_REPOSITORY=$repository timeout "${BACKUP_REACH_TIMEOUT:-180}" restic cat config > /dev/null 2>&1 || code=$?
  if [ "$code" -eq 10 ]; then
    say "no repository at $repository yet: creating it"
    RESTIC_REPOSITORY=$repository restic init || return 1
  elif [ "$code" -ne 0 ]; then
    say "$repository cannot be reached, or the password is wrong (restic exit $code)"
    return 1
  fi
  # The account count rides along as a tag, so a list of snapshots shows at a
  # glance which ones hold the shop.
  RESTIC_REPOSITORY=$repository restic backup --host shah-kelid --tag scheduled --tag "accounts-$accounts" \
    "$WORK/database.dump" "$WORK/keys.env" "$FILES" || return 1
  RESTIC_REPOSITORY=$repository restic forget --host shah-kelid --prune \
    --keep-last "${BACKUP_KEEP_LAST:-8}" \
    --keep-daily "${BACKUP_KEEP_DAILY:-7}" \
    --keep-weekly "${BACKUP_KEEP_WEEKLY:-4}" \
    --keep-monthly "${BACKUP_KEEP_MONTHLY:-6}" || return 1
  RESTIC_REPOSITORY=$repository restic check --read-data-subset="${BACKUP_CHECK_SUBSET:-5%}" || return 1
}

# The Telegram file: the dump, the key and the files in one tar, encrypted
# with the backup password (openssl, AES-256, PBKDF2). Telegram takes files
# up to 50 MB; past that, the files are left out and the caption says so.
TG_NOTE=""
to_telegram() {
  archive="$WORK/shahkelid-$(date +%Y%m%d-%H%M).skb"
  encrypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:RESTIC_PASSWORD -out "$archive"; }
  tar -cf - -C "$WORK" database.dump keys.env -C /data files | encrypt || return 1
  if [ "$(stat -c %s "$archive")" -gt 49000000 ]; then
    tar -cf - -C "$WORK" database.dump keys.env | encrypt || return 1
    TG_NOTE="files (receipts, ticket images) left out: over Telegram's 50 MB"
  fi
  caption="پشتیبان شاه‌کلید — $(date '+%Y-%m-%d %H:%M') — $accounts حساب${TG_NOTE:+ — بدون فایل‌ها}"
  sent=0
  for chat in $(echo "$SK_TG_CHATS" | tr ',' ' '); do
    if curl -fsS -m 300 -o /dev/null \
      --form-string "chat_id=$chat" --form-string "caption=$caption" -F "document=@$archive" \
      "${SK_TG_API:-https://api.telegram.org}/bot$SK_TG_TOKEN/sendDocument"; then
      sent=$((sent + 1))
    else
      say "Telegram did not take the file for chat $chat"
    fi
  done
  rm -f "$archive"
  [ "$sent" -gt 0 ] || return 1
}

LOCAL_OK=null S3_OK=null TG_OK=null
LOCAL_NOTE="" S3_NOTE="" SNAPSHOTS=null
accounts=0

run() {
  # A database with no accounts (or no tables yet, before the first
  # migration) is a fresh install: nothing to protect. Backing it up would
  # make an empty copy "the latest", and a new server brought back with
  # `restore latest` would restore that instead of the shop. A database that
  # cannot be reached is a failure, not "no accounts".
  migrated=$(psql -tAc "select to_regclass('public.users') is not null") || return 1
  if [ "$migrated" = "t" ]; then
    accounts=$(psql -tAc "select count(*) from users where deleted_at is null") || return 1
  fi
  if [ "$accounts" -eq 0 ]; then
    say "no accounts yet: nothing to back up"
    NOTHING=1
    return 0
  fi

  mkdir -p "$WORK" || return 1
  say "dumping the database ($accounts accounts)"
  pg_dump --format=custom --compress=6 --file="$WORK/database.dump.tmp" || return 1
  mv "$WORK/database.dump.tmp" "$WORK/database.dump" || return 1
  # The key that opens what the database keeps sealed (authenticators, panel
  # and mail passwords). Inside the encrypted backup, so restoring needs only
  # the backup password.
  umask 077
  printf "APP_ENCRYPTION_KEY='%s'\n" "${APP_ENCRYPTION_KEY:-}" > "$WORK/keys.env" || return 1

  failed=0
  say "to this server"
  if to_restic "$LOCAL_REPOSITORY"; then
    LOCAL_OK=true
    SNAPSHOTS=$(RESTIC_REPOSITORY=$LOCAL_REPOSITORY restic snapshots --host shah-kelid --json 2> /dev/null | jq length || echo null)
  else
    LOCAL_OK=false LOCAL_NOTE="the backup on this server failed"; failed=1
  fi

  if [ -n "$S3_REPOSITORY" ]; then
    say "to S3"
    if AWS_ACCESS_KEY_ID=${SK_S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}} \
      AWS_SECRET_ACCESS_KEY=${SK_S3_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}} \
      AWS_DEFAULT_REGION=${SK_S3_REGION:-${AWS_DEFAULT_REGION:-auto}} \
      to_restic "$S3_REPOSITORY"; then
      S3_OK=true
    else
      S3_OK=false S3_NOTE="the bucket cannot be reached, or its keys are wrong"; failed=1
    fi
  fi

  if [ "${SK_TG_ENABLED:-0}" = 1 ]; then
    say "to Telegram"
    if to_telegram; then TG_OK=true; else TG_OK=false TG_NOTE="Telegram did not take the file"; failed=1; fi
  fi

  rm -f "$WORK/keys.env"
  [ "$failed" -eq 0 ] || return 1
}

# What the panel shows: built with jq, so no value can break the JSON.
report() {
  ok=$1 message=$2
  previous_success=$(jq -r '.lastSuccessAt // empty' "$STATUS" 2> /dev/null || true)
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  success=$previous_success
  [ "$ok" = true ] && success=$now
  dest() { # ok note → {"ok":…,"note":…} or null when not set up
    if [ "$1" = null ]; then echo null; else jq -n --argjson ok "$1" --arg note "$2" '{ok: $ok, note: (if $note == "" then null else $note end)}'; fi
  }
  jq -n \
    --arg lastRunAt "$now" \
    --arg lastSuccessAt "$success" \
    --argjson ok "$ok" \
    --arg message "$message" \
    --argjson accounts "${accounts:-0}" \
    --argjson localOk "${LOCAL_OK}" \
    --arg localNote "$LOCAL_NOTE" \
    --argjson snapshots "${SNAPSHOTS:-null}" \
    --argjson s3 "$(dest "$S3_OK" "$S3_NOTE")" \
    --argjson telegram "$(dest "$TG_OK" "$TG_NOTE")" \
    '{lastRunAt: $lastRunAt,
      lastSuccessAt: (if $lastSuccessAt == "" then null else $lastSuccessAt end),
      ok: $ok,
      message: (if $message == "" then null else $message end),
      accounts: $accounts,
      local: {ok: ($localOk // false), note: (if $localNote == "" then null else $localNote end), snapshots: $snapshots},
      s3: $s3, telegram: $telegram}' > "$STATUS.next" && chmod 644 "$STATUS.next" && mv "$STATUS.next" "$STATUS"
}

date +%s > /var/lib/backup/last-attempt
NOTHING=0
if run > "$LOG" 2>&1; then
  cat "$LOG"
  if [ "$NOTHING" = 1 ]; then
    report true "no accounts yet: nothing to back up" || true
  else
    report true "" || true
  fi
  date +%s > /var/lib/backup/last-success
  say "done"
  [ -n "${BACKUP_PING_URL:-}" ] && curl -fsS -m 10 "$BACKUP_PING_URL" > /dev/null || true
else
  cat "$LOG"
  say "FAILED"
  report false "$(tail -n 3 "$LOG" | tr '\n' ' ')" || true
  alert "پشتیبان‌گیری $(date -u +%Y-%m-%dT%H:%MZ) شکست خورد. آخرین خطوط گزارش:
$(tail -n 15 "$LOG")"
  exit 1
fi
