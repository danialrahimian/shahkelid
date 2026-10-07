import { asc, eq, isNull, sql } from "drizzle-orm";

import type { Db, Executor } from "../db/client";
import { outboxEvents } from "../db/platform-schema";
import { UnroutableTopicError, type PublishableEvent } from "../queue/publisher";

/**
 * The transactional outbox.
 *
 * A module that needs work done later (provision this subscription, send this
 * email) does not put a job on the queue itself. It records an event with
 * `recordEvent`, inside the same database transaction as the change that
 * caused it. Either both are saved or neither is: there is no moment where a
 * payment is recorded but the job to deliver the service does not exist.
 *
 * The relay then moves recorded events onto the queue. If Redis is down, the
 * events simply wait in PostgreSQL and go out when it is back.
 */

export type NewEvent = {
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
};

/** Records an event. Pass the transaction the triggering change is part of. */
export const recordEvent = async (executor: Executor, event: NewEvent) => {
  const [row] = await executor
    .insert(outboxEvents)
    .values({ ...event, payload: event.payload ?? {} })
    .returning({ id: outboxEvents.id });
  return row!.id;
};

/**
 * Published events older than a month go. Once on the queue an event's work
 * is done or being retried there; the row was only ever the hand-over.
 * Unpublished ones are never removed: they are work still to do.
 */
export const pruneOutbox = async (db: Db, keepDays = 30) => {
  const { rowCount } = await db.execute(sql`
    delete from ${outboxEvents}
    where ${outboxEvents.publishedAt} < now() - make_interval(days => ${keepDays})`);
  return rowCount ?? 0;
};

export type RelayResult = { published: number; failed: number; lastError?: string };

/**
 * One pass: publishes waiting events, oldest first.
 *
 * Rows are taken with FOR UPDATE SKIP LOCKED, so several workers can relay at
 * once without publishing the same event twice.
 *
 * When publishing fails because the queue is unreachable, the pass stops
 * rather than skipping ahead, so events about the same thing keep their
 * order; the next pass starts again from the oldest. An event whose topic has
 * no queue is different: that is a bug no retry will fix, so it is marked
 * with the reason and skipped, instead of blocking everything behind it.
 */
export const relayOutbox = async ({
  db,
  publish,
  batchSize = 100,
}: {
  db: Db;
  publish: (event: PublishableEvent) => Promise<void>;
  batchSize?: number;
}): Promise<RelayResult> =>
  db.transaction(async (tx) => {
    const waiting = await tx
      .select()
      .from(outboxEvents)
      .where(isNull(outboxEvents.publishedAt))
      .orderBy(asc(outboxEvents.id))
      .limit(batchSize)
      .for("update", { skipLocked: true });

    const result: RelayResult = { published: 0, failed: 0 };

    for (const event of waiting) {
      try {
        await publish(event);
        await tx
          .update(outboxEvents)
          .set({
            publishedAt: new Date(),
            attempts: sql`${outboxEvents.attempts} + 1`,
            lastError: null,
          })
          .where(eq(outboxEvents.id, event.id));
        result.published += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await tx
          .update(outboxEvents)
          .set({ attempts: sql`${outboxEvents.attempts} + 1`, lastError: message })
          .where(eq(outboxEvents.id, event.id));
        result.failed += 1;
        result.lastError = message;
        if (!(error instanceof UnroutableTopicError)) break;
      }
    }

    return result;
  });

type Logger = {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
};

/**
 * Runs the relay continuously until stopped.
 *
 * Polls every `intervalMs`, and immediately again after a full batch, so a
 * backlog drains at full speed. Half a second between polls keeps the
 * delay from payment to provisioning inside the "a few seconds" target.
 */
export const startOutboxRelay = ({
  db,
  publish,
  logger,
  intervalMs = 500,
  batchSize = 100,
}: {
  db: Db;
  publish: (event: PublishableEvent) => Promise<void>;
  logger: Logger;
  intervalMs?: number;
  batchSize?: number;
}) => {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  let failingSince: number | undefined;

  const tick = () => {
    inFlight = (async () => {
      let fullBatch = false;
      try {
        const result = await relayOutbox({ db, publish, batchSize });
        fullBatch = result.published === batchSize;

        if (result.failed > 0) {
          failingSince ??= Date.now();
          logger.warn({ lastError: result.lastError }, "Outbox relay could not publish; events are waiting in the outbox");
        } else if (failingSince !== undefined) {
          logger.info({ downForMs: Date.now() - failingSince }, "Outbox relay is publishing again");
          failingSince = undefined;
        }
      } catch (error) {
        logger.error({ err: error }, "Outbox relay pass failed");
      } finally {
        if (!stopped) timer = setTimeout(tick, fullBatch ? 0 : intervalMs);
      }
    })();
  };

  tick();

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
};
