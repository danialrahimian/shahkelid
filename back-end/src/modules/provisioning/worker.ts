import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";

import config from "../../config";
import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { QUEUES } from "../../platform/queue/routes";
import { createConsumerConnection, createProducerConnection } from "../../platform/redis";
import { SUBSCRIPTION_REMOVE_TOPIC } from "../identity/delete-account";
import { removeFromPanel } from "../subscriptions/actions";
import { applyRenewal, RENEWAL_TOPIC } from "../subscriptions/renewal";
import { PROVISION_TOPIC } from "../subscriptions/service";
import { PanelRejectedError } from "./driver";
import { alertStaff } from "../notifications/alerts";
import {
  markProvisioningFailed,
  noteAttemptFailed,
  provisionSubscription,
  provisioningAlert,
} from "./provision";
import { syncAllPanels } from "./sync";

/**
 * The provisioning queue's consumer, in the worker process:
 *
 * - "subscription.provision_requested" (from the outbox): put a subscription
 *   on its panel. A panel that is down is retried with backoff (12 attempts,
 *   about an hour); a panel that says no is not, since asking again will not
 *   change its answer. Either way the subscription then waits for staff.
 * - "subscriptions.sync" (every few minutes): copy usage from the panels.
 */

export const SYNC_JOB = "subscriptions.sync";

/** Attempts after which staff hear about it: 1+2+4+8+16+32 s of backoff ≈ a minute. */
export const ALERT_AFTER_ATTEMPTS = 6;

type OutboxJob = { aggregateId: string };

/** One provisioning attempt, and what a failure means for the next. Exported for tests. */
export const runProvisionJob = async (
  db: Db,
  job: Pick<Job<OutboxJob>, "data" | "attemptsMade" | "opts">,
) => {
  const id = job.data.aggregateId;
  try {
    return await provisionSubscription(db, id);
  } catch (error) {
    const failure = error as Error;
    const last = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (failure instanceof PanelRejectedError || last) {
      await markProvisioningFailed(db, id, failure);
      logger.error({ err: failure, subscriptionId: id }, "Provisioning gave up; the subscription waits for staff");
      throw new UnrecoverableError(failure.message);
    }
    await noteAttemptFailed(db, id, failure);
    // About a minute of failures (1 + 2 + 4 + … seconds of backoff): tell someone,
    // once, while the attempts carry on.
    if (job.attemptsMade + 1 === ALERT_AFTER_ATTEMPTS) {
      await alertStaff(db, await provisioningAlert(db, id, failure, "still_failing"), { type: "subscription", id });
    }
    throw failure;
  }
};

/**
 * One attempt at applying a paid renewal. A panel that is down is retried;
 * when the attempts run out, staff are told (the order stays paid, and they
 * can ask for it again from the customer's page).
 */
export const runRenewalJob = async (
  db: Db,
  job: Pick<Job<OutboxJob>, "data" | "attemptsMade" | "opts">,
) => {
  const orderId = job.data.aggregateId;
  try {
    return await applyRenewal(db, orderId);
  } catch (error) {
    const failure = error as Error;
    const last = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (failure instanceof PanelRejectedError || last || job.attemptsMade + 1 === ALERT_AFTER_ATTEMPTS) {
      await alertStaff(
        db,
        {
          subject: last || failure instanceof PanelRejectedError ? "تمدید روی پنل اعمال نشد" : "اعمال تمدید یک دقیقه است که شکست می‌خورد",
          text: [
            `تمدید سفارش ${orderId} پرداخت شده ولی هنوز روی پنل اعمال نشده است.`,
            `خطا: ${failure.message.slice(0, 300)}`,
            last || failure instanceof PanelRejectedError
              ? "بعد از رفع مشکل پنل، در صفحه‌ی مشتری روی «ساخت اشتراک» همان سفارش بزنید."
              : "تلاش خودکار ادامه دارد.",
          ].join("\n"),
        },
        { type: "order", id: orderId },
      );
    }
    if (failure instanceof PanelRejectedError || last) throw new UnrecoverableError(failure.message);
    throw failure;
  }
};

export const startProvisioningWorker = ({ db, prefix }: { db: Db; prefix?: string }) => {
  const connection = createConsumerConnection();
  const worker = new Worker(
    QUEUES.provisioning,
    async (job: Job) => {
      if (job.name === PROVISION_TOPIC) return runProvisionJob(db, job as Job<OutboxJob>);
      if (job.name === RENEWAL_TOPIC) return runRenewalJob(db, job as Job<OutboxJob>);
      if (job.name === SYNC_JOB) return syncAllPanels(db);
      if (job.name === SUBSCRIPTION_REMOVE_TOPIC) return removeFromPanel(db, (job.data as OutboxJob).aggregateId);
      throw new UnrecoverableError(`No handler for job "${job.name}"`);
    },
    {
      connection,
      // Enough for a burst of purchases without flooding a panel.
      concurrency: 5,
      ...(prefix ? { prefix } : {}),
    },
  );

  worker.on("failed", (job, error) =>
    logger.warn({ err: error, job: job?.name, jobId: job?.id, attempts: job?.attemptsMade }, "Provisioning job failed"),
  );
  return {
    worker,
    /** Finishes the jobs in hand, then lets go of Redis (BullMQ leaves a given connection open). */
    close: async () => {
      await worker.close();
      connection.disconnect();
    },
  };
};

/**
 * Registers the recurring usage sync. Idempotent: BullMQ keeps one schedule
 * under this name however many workers start, and runs each tick once.
 */
export const scheduleUsageSync = async () => {
  const connection = createProducerConnection();
  const queue = new Queue(QUEUES.provisioning, { connection });
  try {
    await queue.upsertJobScheduler(
      "usage-sync",
      { every: config.provisioning.syncEveryMs },
      { name: SYNC_JOB, opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
  } finally {
    await queue.close();
    connection.disconnect();
  }
};
