import { Queue, Worker, type Job } from "bullmq";

import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { QUEUES } from "../../platform/queue/routes";
import { createConsumerConnection, createProducerConnection } from "../../platform/redis";
import { expireLapsedOrders } from "./orders";
import { reconcileZarinpal } from "./zarinpal-checkout";

/**
 * The billing queue, in the worker process. Every two minutes:
 *
 * - Zarinpal payments whose callback never came are asked about, and the
 *   paid ones settled: a customer who paid and closed the tab still gets
 *   their service.
 * - Unpaid orders past their time lapse.
 */

export const BILLING_TICK = "billing.tick";
const EVERY_MS = 2 * 60 * 1000;

export const billingTick = async (db: Db) => ({
  zarinpal: await reconcileZarinpal(db),
  expiredOrders: await expireLapsedOrders(db),
});

export const startBillingWorker = ({ db }: { db: Db }) => {
  const connection = createConsumerConnection();
  const worker = new Worker(
    QUEUES.billing,
    async (job: Job) => (job.name === BILLING_TICK ? billingTick(db) : undefined),
    { connection, concurrency: 1 },
  );
  worker.on("failed", (job, error) => logger.warn({ err: error, job: job?.name }, "Billing job failed"));
  return {
    worker,
    close: async () => {
      await worker.close();
      connection.disconnect();
    },
  };
};

export const scheduleBilling = async () => {
  const connection = createProducerConnection();
  const queue = new Queue(QUEUES.billing, { connection });
  try {
    await queue.upsertJobScheduler(
      "billing-tick",
      { every: EVERY_MS },
      { name: BILLING_TICK, opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
  } finally {
    await queue.close();
    connection.disconnect();
  }
};
