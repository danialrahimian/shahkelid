#!/bin/sh
# Runs every few minutes (cron) and decides whether to back up now:
#
#   - "back up now" was pressed in the panel (/control/run-request), or
#   - the interval set in the panel (every 6 hours unless changed) has passed
#     since the last attempt.
#
# Also keeps the health check's limit in step with that interval: unhealthy
# once two intervals and an hour pass without a successful backup.
set -eu
[ -f /etc/backup.env ] && . /etc/backup.env
[ -f /control/backup.env ] && . /control/backup.env

hours=${SK_INTERVAL_HOURS:-6}
echo $(( (hours * 2 + 1) * 3600 )) > /var/lib/backup/max-age

# A backup still running: nothing now (a request waits for the next tick).
if ! flock -n /var/lib/backup/run.lock true; then exit 0; fi

if [ -f /control/run-request ]; then
  rm -f /control/run-request
  exec /usr/local/bin/backup.sh
fi

last=$(cat /var/lib/backup/last-attempt 2> /dev/null || echo 0)
if [ $(( $(date +%s) - last )) -ge $(( hours * 3600 )) ]; then
  exec /usr/local/bin/backup.sh
fi
