# Backups: pg_dump of the database, the private files and the app key, to
# this server, S3-compatible storage and Telegram as the panel says, with
# restic (encrypted) and openssl (the Telegram file).
#
# Built on the PostgreSQL image so pg_dump is the same version as the
# server it dumps.
FROM postgres:18-alpine
RUN apk add --no-cache restic curl tzdata jq openssl tar util-linux-misc
COPY backup.sh restore.sh entrypoint.sh tick.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh /usr/local/bin/tick.sh \
 && mkdir -p /var/lib/backup
# Unhealthy once no backup has succeeded for two intervals and an hour
# (tick.sh keeps the limit in step with the interval set in the panel).
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s \
  CMD test -f /var/lib/backup/last-success \
   && test $(( $(date +%s) - $(cat /var/lib/backup/last-success) )) -lt "$(cat /var/lib/backup/max-age 2>/dev/null || echo 46800)"
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
