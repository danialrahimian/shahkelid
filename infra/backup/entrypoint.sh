#!/bin/sh
# Starts the backup service: checks every two minutes whether a backup is
# due (tick.sh), and takes one right away.
#
# cron starts its jobs with an empty environment, so the settings the
# container was given are written to a file only root can read, and the jobs
# read them from there. The panel's settings come separately, through
# /control/backup.env, written by the app.
set -eu

env | grep -E '^(PG|RESTIC_|AWS_|BACKUP_|APP_ENCRYPTION_KEY=|TZ=)' \
  | sed "s/'/'\\\\''/g; s/=\(.*\)/='\1'/; s/^/export /" > /etc/backup.env
chmod 600 /etc/backup.env

# The mailbox shared with the app, which runs as uid 1000: it writes the
# settings and requests here, this service writes its reports.
mkdir -p /control /backups
chown 1000:1000 /control
chmod 770 /control
chmod 700 /backups

echo "*/2 * * * * /usr/local/bin/tick.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "Backups: checked every 2 minutes; the interval is set in the panel (6 hours until then)"

# A first backup right away, so a new server is covered from its first hour
# (and a wrong key or bucket shows up now, not at the first scheduled run).
if [ "${BACKUP_ON_START:-true}" = "true" ]; then
  /usr/local/bin/backup.sh || true
fi

exec crond -f -l 6
