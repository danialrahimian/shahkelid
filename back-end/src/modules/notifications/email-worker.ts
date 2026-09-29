import { Worker, type Job } from "bullmq";

import config from "../../config";
import logger from "../../libraries/logger";
import { sendEmail as sendWithSmtp } from "../../libraries/mailer";
import { QUEUES } from "../../platform/queue/routes";
import { createConsumerConnection } from "../../platform/redis";
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

export const startEmailWorker = () => {
  const connection = createConsumerConnection();
  const worker = new Worker<Email>(
    QUEUES.notifications,
    async (job) => {
      if (job.name === "email.send") await deliver(job);
    },
    { connection, concurrency: 5 },
  );

  worker.on("failed", (job, error) =>
    logger.warn({ err: error, jobId: job?.id, attempts: job?.attemptsMade }, "Email job failed"),
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
