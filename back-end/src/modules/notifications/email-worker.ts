import { Worker, type Job } from "bullmq";

import config from "../../config";
import logger from "../../libraries/logger";
import { sendEmail as sendWithSmtp } from "../../libraries/mailer";
import { QUEUES } from "../../platform/queue/routes";
import { createConsumerConnection } from "../../platform/redis";
import type { Db } from "../../platform/db/client";
import { ALERT_TOPIC, deliverAlert, type Alert } from "./alerts";
import type { Email } from "./email";

/**
 * Delivers queued emails. Runs in the worker process.
 *
 * Without SMTP credentials (a development machine), the email is written to
 * the worker's log instead of being sent, so a developer can read the sign-in
 * code there. In production the credentials are required and the app refuses
 * to start without them.
 */
const deliver = async (job: Job<Email>) => {
  const email = job.data;

  if (!config.isProduction && !config.mail.user) {
    logger.info(
      { to: email.to, subject: email.subject, text: email.text },
      "Email (development: logged, not sent)",
    );
    return;
  }

  const result = await sendWithSmtp({ ...email, html: undefined });
  if (!result.delivered) {
    // Thrown so BullMQ retries with backoff; the mailer already logged why.
    throw new Error(`The mail provider did not accept the email to ${email.to}`);
  }
};

/**
 * The notifications queue: emails (queued directly by the API) and alerts to
 * staff (recorded in the outbox; see alerts.ts).
 */
export const startNotificationsWorker = ({ db }: { db: Db }) => {
  const connection = createConsumerConnection();
  const worker = new Worker(
    QUEUES.notifications,
    async (job: Job) => {
      if (job.name === "email.send") return deliver(job as Job<Email>);
      if (job.name === ALERT_TOPIC) return deliverAlert(db, (job.data as { payload: Alert }).payload);
    },
    { connection, concurrency: 5 },
  );

  worker.on("failed", (job, error) =>
    logger.warn({ err: error, job: job?.name, jobId: job?.id, attempts: job?.attemptsMade }, "Notification job failed"),
  );

  return {
    worker,
    /** Finishes the emails in hand, then lets go of Redis (BullMQ leaves a given connection open). */
    close: async () => {
      await worker.close();
      connection.disconnect();
    },
  };
};
