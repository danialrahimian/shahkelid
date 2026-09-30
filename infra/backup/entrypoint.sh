#!/bin/sh
# Schedules backup.sh with cron, then runs cron in the foreground.
#
# cron starts its jobs with an empty environment, so the settings the
# container was given are written to a file only root can read, and the job
# reads them from there.
set -eu

: "${BACKUP_SCHEDULE:=15 */6 * * *}"

env | grep -E '^(PG|RESTIC_|AWS_|BACKUP_|TZ=)' | sed "s/'/'\\\\''/g; s/=\(.*\)/='\1'/; s/^/export /" > /etc/backup.env
chmod 600 /etc/backup.env

echo "$BACKUP_SCHEDULE /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "Backups scheduled: $BACKUP_SCHEDULE"

# A first backup right away, so a new server is covered from its first hour
# (and a wrong key or bucket shows up now, not at the first scheduled run).
if [ "${BACKUP_ON_START:-true}" = "true" ]; then
  /usr/local/bin/backup.sh || true
fi

exec crond -f -l 6
