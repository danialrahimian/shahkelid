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
 * For publishing a job while someone waits on the answer: a short wait.
 *
 * A request that queues an email (a sign-in code) cannot use the fail-fast
 * connection above: made on first use, it is still connecting when the first
 * job is added, and that job would fail although Redis is fine. Here a
 * command waits for the connection, but for two seconds at most, so a
 * request still fails quickly when Redis really is down.
 */
export const createRequestConnection = (url = config.redis.url) =>
  new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
  });

/**
 * For consuming jobs: never give up.
 *
 * BullMQ workers block waiting for work and require retries to be unlimited,
 * so a Redis restart pauses them rather than killing them.
 */
export const createConsumerConnection = (url = config.redis.url) =>
  new Redis(url, { maxRetriesPerRequest: null });

/**
 * The API's own connection: sessions, sign-in codes, lockouts, rate limits.
 *
 * Every key carries `config.redis.keyPrefix`, which is empty in development
 * and production and unique per process in tests. A command waits at most
 * two seconds: if Redis is down, a request should fail quickly rather than
 * hang, since nothing a session needs can be answered without it.
 *
 * (BullMQ refuses connections with a key prefix, which is why queues use
 * the connections above instead.)
 */
let appRedis: Redis | undefined;

export const getAppRedis = () => {
  appRedis ??= new Redis(config.redis.url, {
    keyPrefix: config.redis.keyPrefix,
    maxRetriesPerRequest: 1,
    commandTimeout: 2000,
    // Connects on the first command, so a process that never serves /api/v1
    // (a test of an old module) never opens a connection it would have to close.
    lazyConnect: true,
  });
  return appRedis;
};

export const closeAppRedis = async () => {
  const connection = appRedis;
  appRedis = undefined;
  if (connection) await connection.quit().catch(() => connection.disconnect());
};

/** Resolves once the connection can take commands. For startup and tests. */
export const whenReady = (connection: Redis) =>
  connection.status === "ready"
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        connection.once("ready", () => resolve());
        connection.once("end", () => reject(new Error("Redis connection ended before it was ready")));
      });
