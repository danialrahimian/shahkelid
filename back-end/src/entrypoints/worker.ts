import { writeFileSync } from "node:fs";

import config from "../config";
import logger from "../libraries/logger";
import { closeDb, getDb } from "../platform/db/client";
import { startOutboxRelay } from "../platform/outbox/outbox";
import { createPublisher } from "../platform/queue/publisher";
import { TOPIC_ROUTES } from "../platform/queue/routes";
import { createProducerConnection } from "../platform/redis";
import { scheduleReminders, startNotificationsWorker } from "../modules/notifications/email-worker";
import { scheduleBilling, startBillingWorker } from "../modules/billing/worker";
import { scheduleUsageSync, startProvisioningWorker } from "../modules/provisioning/worker";
import { writeBackupEnvironment } from "../modules/settings/backup-control";
import { startSettingsRefresh, stopSettingsRefresh } from "../modules/settings/live";

/**
 * The worker process: everything that happens off the request path.
 *
 *   npm run worker -w back-end
 *
 * It runs the outbox relay, delivers emails (M2), puts subscriptions on their
 * panels and copies usage back every few minutes (M3). Other consumers join
 * it milestone by milestone, and so do recurring jobs: BullMQ keeps their schedules in Redis and runs them on the workers,
 * so they need no separate scheduler process.
 *
 * Several workers can run at once; the relay's row locks and the queue's job
 * ids keep them from doing the same work twice.
 */

const main = async () => {
  const db = getDb();
  // Mail, Telegram and payment settings saved in the staff area.
  await startSettingsRefresh(db);
  // The backup service reads its settings from a file the worker keeps in
  // line with the panel (it cannot open the sealed values itself).
  const keepBackupsInformed = () =>
    writeBackupEnvironment().catch((error: unknown) => logger.warn({ err: error }, "Could not write backup.env"));
  void keepBackupsInformed();
  const backupTimer = setInterval(keepBackupsInformed, 15_000);
  backupTimer.unref();
  // The health check reads this: a worker whose event loop stops beating
  // for a minute is reported unhealthy (docker compose ps, shahkelid status).
  const beat = () => {
    try {
      writeFileSync(config.worker.heartbeatFile, String(Date.now()));
    } catch (error) {
      logger.debug({ err: error }, "Could not write the heartbeat");
    }
  };
  beat();
  const heartbeat = setInterval(beat, 10_000);
  heartbeat.unref();
  const connection = createProducerConnection();
  // An idle connection error is logged here; publishing failures are
  // reported by the relay, which keeps the events and retries.
  connection.on("error", (error) => logger.debug({ err: error }, "Redis connection error"));

  const publisher = createPublisher({
    connection,
    routes: TOPIC_ROUTES,
    onError: (error) => logger.debug({ err: error }, "Queue connection error"),
  });
  const relay = startOutboxRelay({ db, publish: publisher.publish, logger });
  const emails = startNotificationsWorker({ db });
  const provisioning = startProvisioningWorker({ db });
  const billing = startBillingWorker({ db });
  // Redis may be down at start; the relay copes with that, and so does this.
  const schedule = () =>
    Promise.all([scheduleUsageSync(), scheduleBilling(), scheduleReminders()]).catch((error: unknown) => {
      logger.warn({ err: error }, "Could not schedule the recurring jobs yet; trying again in 30 s");
      setTimeout(schedule, 30_000).unref();
    });
  void schedule();

  logger.info({ env: config.env }, "Worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "Worker stopping");

    // Finish the pass in progress, then let go of everything.
    clearInterval(backupTimer);
    clearInterval(heartbeat);
    stopSettingsRefresh();
    await relay.stop();
    await emails.close();
    await provisioning.close();
    await billing.close();
    await publisher.close();
    connection.disconnect();
    await closeDb();

    logger.info("Worker stopped");
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
};

main().catch((error: unknown) => {
  logger.error({ err: error }, "Worker failed to start");
  process.exitCode = 1;
});
