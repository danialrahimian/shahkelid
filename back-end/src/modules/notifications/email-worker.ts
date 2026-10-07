import { Queue, Worker, type Job } from "bullmq";

import logger from "../../libraries/logger";
import { QUEUES } from "../../platform/queue/routes";
import { createConsumerConnection, createProducerConnection } from "../../platform/redis";
import type { Db } from "../../platform/db/client";
import { ALERT_TOPIC, deliverAlert, type Alert } from "./alerts";
import { deliverNotification, NOTIFY_TOPIC } from "./notify";
import { scanReminders } from "./reminders";
import { deliverTicketAlert, resolveQuietTickets, TICKET_ALERT_TOPIC } from "../support/service";
import { deliverEmail, type Email } from "./email";

/**
 * Delivers an email the API queued (a sign-in code, say). A failure is
 * thrown so BullMQ retries with backoff. Without SMTP credentials on a
 * development machine, the email goes to the worker's log instead.
 */
const deliver = (job: Job<Email>) => deliverEmail(job.data);

export const REMINDERS_SCAN = "reminders.scan";
export const TICKETS_SWEEP = "tickets.resolve_quiet";

/**
 * The notifications queue: emails (queued directly by the API), alerts to
 * staff and to support agents, and customers' emails (all three recorded in
 * the outbox), plus the scheduled reminder scan and ticket sweep.
 */
export const startNotificationsWorker = ({ db }: { db: Db }) => {
  const connection = createConsumerConnection();
  const worker = new Worker(
    QUEUES.notifications,
    async (job: Job) => {
      if (job.name === "email.send") return deliver(job as Job<Email>);
      if (job.name === ALERT_TOPIC) return deliverAlert(db, (job.data as { payload: Alert }).payload);
      if (job.name === REMINDERS_SCAN) return scanReminders(db);
      if (job.name === TICKETS_SWEEP) return resolveQuietTickets(db);
      if (job.name === TICKET_ALERT_TOPIC) {
        return deliverTicketAlert(db, (job.data as { payload: Parameters<typeof deliverTicketAlert>[1] }).payload);
      }
      if (job.name === NOTIFY_TOPIC) {
        return deliverNotification(db, (job.data as { payload: { notificationId: number } }).payload.notificationId);
      }
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

/**
 * Every fifteen minutes: queue the reminders that have come due. Every hour:
 * mark resolved the tickets a customer left unanswered for a week.
 * Idempotent, like every schedule.
 */
export const scheduleReminders = async () => {
  const connection = createProducerConnection();
  const queue = new Queue(QUEUES.notifications, { connection });
  try {
    await queue.upsertJobScheduler(
      "reminders",
      { every: 15 * 60 * 1000 },
      { name: REMINDERS_SCAN, opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
    await queue.upsertJobScheduler(
      "tickets-sweep",
      { every: 60 * 60 * 1000 },
      { name: TICKETS_SWEEP, opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
  } finally {
    await queue.close();
    connection.disconnect();
  }
};
