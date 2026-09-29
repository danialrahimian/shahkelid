import { Queue, type JobsOptions } from "bullmq";
import type { Redis } from "ioredis";

import type { QueueName, TopicRoutes } from "./routes";

/**
 * Puts outbox events onto their queues.
 *
 * Each job's id is derived from its outbox row ("outbox-42"), and BullMQ adds
 * a job with an id it already holds only once. So if the relay publishes an
 * event and then crashes before recording that it did, the retry does not
 * queue the work twice. Delivery is still at-least-once in the long run
 * (a finished job can be cleaned out of Redis before a very late retry), so
 * every consumer must be idempotent; provisioning is, by design.
 */

export type PublishableEvent = {
  id: number;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
};

const PUBLISH_TIMEOUT_MS = 5000;

/**
 * An event no queue is set up to receive. A bug in the code, not an outage:
 * retrying will not fix it, so the relay records it and moves on rather than
 * letting it block every event behind it.
 */
export class UnroutableTopicError extends Error {
  constructor(topic: string) {
    super(`no queue for topic "${topic}"`);
    this.name = "UnroutableTopicError";
  }
}

/** Retries and history, per queue. Consumers arrive in later milestones. */
const JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  // The customer is waiting on the checkout page: retry quickly at first.
  provisioning: {
    attempts: 12,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: false,
  },
  notifications: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
};

const withTimeout = async <T>(work: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const createPublisher = ({
  connection,
  routes,
  prefix,
  onError = () => undefined,
}: {
  connection: Redis;
  routes: TopicRoutes;
  /** BullMQ key prefix. Tests use their own, so runs never see each other's jobs. */
  prefix?: string;
  /**
   * Connection errors a queue reports on its own. Publishing failures are
   * already recorded against each event by the relay, so by default these are
   * not reported a second time.
   */
  onError?: (error: Error) => void;
}) => {
  const queues = new Map<QueueName, Queue>();

  const queueFor = (name: QueueName) => {
    let queue = queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection,
        skipWaitingForReady: true,
        ...(prefix ? { prefix } : {}),
      });
      queue.on("error", onError);
      queues.set(name, queue);
    }
    return queue;
  };

  const publish = async (event: PublishableEvent) => {
    const queueName = routes[event.topic];
    if (!queueName) {
      throw new UnroutableTopicError(event.topic);
    }

    await withTimeout(
      queueFor(queueName).add(
        event.topic,
        {
          outboxId: event.id,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
        },
        { ...JOB_OPTIONS[queueName], jobId: `outbox-${event.id}` },
      ),
      PUBLISH_TIMEOUT_MS,
      `publishing ${event.topic}`,
    );
  };

  const close = async () => {
    await Promise.all([...queues.values()].map((queue) => queue.close()));
    queues.clear();
  };

  return { publish, queueFor, close };
};

export type Publisher = ReturnType<typeof createPublisher>;
