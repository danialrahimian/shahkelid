import { Redis } from "ioredis";

import config from "../config";

/**
 * Redis connections. Two kinds, because producers and consumers want opposite
 * things when Redis goes away.
 */

/**
 * For publishing jobs: fail fast.
 *
 * With ioredis's defaults a command sent while Redis is down waits in memory
 * until Redis returns. For the outbox relay that would mean hanging while
 * holding its database locks. Failing at once leaves the event in the
 * outbox, and the next pass tries again.
 */
export const createProducerConnection = (url = config.redis.url) =>
  new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });

/**
 * For consuming jobs: never give up.
 *
 * BullMQ workers block waiting for work and require retries to be unlimited,
 * so a Redis restart pauses them rather than killing them.
 */
export const createConsumerConnection = (url = config.redis.url) =>
  new Redis(url, { maxRetriesPerRequest: null });

/** Resolves once the connection can take commands. For startup and tests. */
export const whenReady = (connection: Redis) =>
  connection.status === "ready"
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        connection.once("ready", () => resolve());
        connection.once("end", () => reject(new Error("Redis connection ended before it was ready")));
      });
