# Backups: pg_dump of the database and a copy of the private files, sent
# encrypted to S3-compatible storage with restic, on a schedule.
#
# Built on the PostgreSQL image so pg_dump is the same version as the
# server it dumps.
FROM postgres:18-alpine
RUN apk add --no-cache restic curl tzdata
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh \
 && mkdir -p /var/lib/backup
# Unhealthy once no backup has succeeded for longer than two schedules.
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s \
  CMD test -f /var/lib/backup/last-success \
   && test $(( $(date +%s) - $(cat /var/lib/backup/last-success) )) -lt "${BACKUP_MAX_AGE_SECONDS:-46800}"
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
