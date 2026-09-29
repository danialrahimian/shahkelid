import { Queue, Worker, type Job } from "bullmq";

import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { QUEUES } from "../../platform/queue/routes";
import { createConsumerConnection, createProducerConnection } from "../../platform/redis";
import { expireLapsedOrders } from "./orders";
import { refreshRate } from "./rates";
import { expireUsdtInvoices, scanUsdt } from "./usdt-checkout";
import { reconcileZarinpal } from "./zarinpal-checkout";

/**
 * The billing queue, in the worker process:
 *
 * - every two minutes, Zarinpal payments whose callback never came are asked
 *   about and the paid ones settled (a customer who paid and closed the tab
 *   still gets their service); unpaid orders and USDT quotes past their time
 *   lapse;
 * - every minute, the USDT rate is read from Nobitex;
 * - every 20 seconds, new USDT transfers into our wallet are read and matched.
 */

export const BILLING_TICK = "billing.tick";
export const RATE_REFRESH = "billing.rate";
export const USDT_SCAN = "billing.usdt_scan";

const SCHEDULES = [
  { id: "billing-tick", name: BILLING_TICK, every: 2 * 60 * 1000 },
  { id: "usdt-rate", name: RATE_REFRESH, every: 60 * 1000 },
  { id: "usdt-scan", name: USDT_SCAN, every: 20 * 1000 },
];

export const billingTick = async (db: Db) => ({
  zarinpal: await reconcileZarinpal(db),
  expiredOrders: await expireLapsedOrders(db),
  expiredUsdtQuotes: await expireUsdtInvoices(db),
});

const handlers: Record<string, (db: Db) => Promise<unknown>> = {
  [BILLING_TICK]: billingTick,
  [RATE_REFRESH]: refreshRate,
  [USDT_SCAN]: scanUsdt,
};

export const startBillingWorker = ({ db }: { db: Db }) => {
  const connection = createConsumerConnection();
  const worker = new Worker(
    QUEUES.billing,
    async (job: Job) => handlers[job.name]?.(db),
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
    for (const schedule of SCHEDULES) {
      await queue.upsertJobScheduler(
        schedule.id,
        { every: schedule.every },
        { name: schedule.name, opts: { removeOnComplete: 100, removeOnFail: 100 } },
      );
    }
  } finally {
    await queue.close();
    connection.disconnect();
  }
};
