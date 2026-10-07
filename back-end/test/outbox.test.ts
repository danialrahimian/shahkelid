import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq, sql } from "drizzle-orm";
import type { Redis } from "ioredis";

import config from "../src/config";
import { createDb, type Db } from "../src/platform/db/client";
import { outboxEvents } from "../src/platform/db/platform-schema";
import { pruneRates } from "../src/modules/billing/rates";
import { exchangeRates } from "../src/modules/billing/schema";
import { pruneOutbox, recordEvent, relayOutbox } from "../src/platform/outbox/outbox";
import { createPublisher, type Publisher } from "../src/platform/queue/publisher";
import { createProducerConnection, whenReady } from "../src/platform/redis";
import { resetTestDatabase } from "./helpers/postgres";

/**
 * The outbox: work recorded with a change is never lost, whatever Redis does.
 *
 * This is the acceptance test for milestone M1: an event recorded while Redis
 * is unreachable waits in PostgreSQL, and reaches its queue once Redis is
 * back. "Unreachable" here is an address nothing listens on, which the
 * application cannot tell apart from a stopped Redis.
 */

const ROUTES = { "test.ping": "notifications" } as const;
// Each run gets its own key prefix, so runs never see each other's jobs.
const PREFIX = `test-${randomBytes(4).toString("hex")}`;
const NOWHERE = "redis://127.0.0.1:6390/1";

let db: Db;
let closeDbPool: () => Promise<void>;
let live: Redis;
let dead: Redis;
let livePublisher: Publisher;
let deadPublisher: Publisher;

const aPing = () => ({
  topic: "test.ping",
  aggregateType: "test",
  aggregateId: randomUUID(),
  payload: { hello: "world" },
});

const rowOf = async (id: number) => {
  const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id));
  return row!;
};

const jobOf = (id: number) => livePublisher.queueFor("notifications").getJob(`outbox-${id}`);

before(async () => {
  await resetTestDatabase();
  const created = createDb(config.postgres.url, 5);
  db = created.db;
  closeDbPool = () => created.pool.end();

  live = createProducerConnection();
  await whenReady(live);
  livePublisher = createPublisher({ connection: live, routes: ROUTES, prefix: PREFIX });

  dead = createProducerConnection(NOWHERE);
  dead.on("error", () => undefined); // expected: nothing is there
  deadPublisher = createPublisher({ connection: dead, routes: ROUTES, prefix: PREFIX });
});

after(async () => {
  await livePublisher.queueFor("notifications").obliterate({ force: true });
  await livePublisher.close();
  await deadPublisher.close();
  live.disconnect();
  dead.disconnect();
  await closeDbPool();
});

describe("Recording an event", () => {
  it("When the change it belongs to is rolled back, then the event is not recorded either", async () => {
    const before = await db.$count(outboxEvents);

    await assert.rejects(
      db.transaction(async (tx) => {
        await recordEvent(tx, aPing());
        throw new Error("the payment failed to save");
      }),
      /failed to save/,
    );

    assert.equal(await db.$count(outboxEvents), before);
  });
});

describe("When Redis is unreachable", () => {
  it("Then the event stays in the outbox with the reason, and the relay does not hang", async () => {
    const id = await recordEvent(db, aPing());

    const started = Date.now();
    const result = await relayOutbox({ db, publish: deadPublisher.publish });
    const elapsed = Date.now() - started;

    assert.equal(result.published, 0);
    assert.equal(result.failed, 1);
    // Failing fast is the point: a relay stuck here would hold its locks.
    assert.ok(elapsed < 3000, `the relay took ${elapsed} ms to give up`);

    const row = await rowOf(id);
    assert.equal(row.publishedAt, null);
    assert.equal(row.attempts, 1);
    assert.ok(row.lastError, "the reason is recorded");
  });

  it("Then once Redis is back, the waiting event reaches its queue", async () => {
    const [waiting] = await db
      .select()
      .from(outboxEvents)
      .where(sql`${outboxEvents.publishedAt} is null`);
    assert.ok(waiting, "an event is waiting from the previous test");

    const result = await relayOutbox({ db, publish: livePublisher.publish });

    assert.equal(result.failed, 0);
    assert.ok(result.published >= 1);

    const row = await rowOf(waiting.id);
    assert.ok(row.publishedAt, "marked as published");
    assert.equal(row.lastError, null);
    assert.equal(row.attempts, 2);

    const job = await jobOf(waiting.id);
    assert.ok(job, "the job is on the queue");
    assert.equal(job.name, "test.ping");
    assert.equal((job.data as { aggregateId: string }).aggregateId, waiting.aggregateId);
  });
});

describe("Publishing exactly once", () => {
  it("When an event was published but the relay crashed before marking it, then the retry does not queue it twice", async () => {
    const id = await recordEvent(db, aPing());
    const event = await rowOf(id);

    // The first relay got as far as the queue, then died.
    await livePublisher.publish(event);
    const countBefore = await livePublisher.queueFor("notifications").getJobCountByTypes("waiting");

    // The next relay sees it unmarked and publishes it again.
    await relayOutbox({ db, publish: livePublisher.publish });

    const countAfter = await livePublisher.queueFor("notifications").getJobCountByTypes("waiting");
    assert.equal(countAfter, countBefore, "the queue holds the job once");
    assert.ok((await rowOf(id)).publishedAt);
  });

  it("When two workers relay at the same moment, then each event is published once", async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => recordEvent(db, aPing())));

    const [a, b] = await Promise.all([
      relayOutbox({ db, publish: livePublisher.publish }),
      relayOutbox({ db, publish: livePublisher.publish }),
    ]);

    assert.equal(a.published + b.published, ids.length);
    for (const id of ids) {
      const row = await rowOf(id);
      assert.equal(row.attempts, 1, `event ${id} was published by exactly one worker`);
    }
  });
});

describe("Housekeeping", () => {
  it("Published events older than a month go; waiting ones and recent ones stay", async () => {
    const old = await recordEvent(db, aPing());
    const recent = await recordEvent(db, aPing());
    const waiting = await recordEvent(db, aPing());
    const longAgo = new Date(Date.now() - 40 * 86_400_000);
    await db.update(outboxEvents).set({ publishedAt: longAgo, createdAt: longAgo }).where(eq(outboxEvents.id, old));
    await db.update(outboxEvents).set({ publishedAt: new Date() }).where(eq(outboxEvents.id, recent));
    await db
      .update(outboxEvents)
      .set({ createdAt: longAgo })
      .where(eq(outboxEvents.id, waiting)); // old, but never published: still work to do

    await pruneOutbox(db);

    const left = new Set((await db.select({ id: outboxEvents.id }).from(outboxEvents)).map((row) => row.id));
    assert.equal(left.has(old), false);
    assert.equal(left.has(recent), true);
    assert.equal(left.has(waiting), true);
  });

  it("Rates older than a month go, unless an invoice was quoted with them", async () => {
    const longAgo = new Date(Date.now() - 40 * 86_400_000);
    const [unused, quoted, fresh] = await db
      .insert(exchangeRates)
      .values([
        { bidToman: 100_000, askToman: 100_100, fetchedAt: longAgo },
        { bidToman: 100_000, askToman: 100_100, fetchedAt: longAgo },
        { bidToman: 100_000, askToman: 100_100 },
      ])
      .returning({ id: exchangeRates.id });
    const user = (await db.execute<{ id: string }>(sql`
      insert into users (email, email_normalized, referral_code)
      values (${`rates-${randomUUID()}@example.com`}, 'x', ${randomBytes(5).toString("hex")}) returning id`)).rows[0]!;
    const order = (await db.execute<{ id: string }>(sql`
      insert into orders (user_id, kind, subtotal_toman, total_toman, expires_at)
      values (${user.id}, 'new', 1000, 1000, now()) returning id`)).rows[0]!;
    const payment = (await db.execute<{ id: string }>(sql`
      insert into payments (order_id, user_id, method, amount_toman)
      values (${order.id}, ${user.id}, 'usdt_tron', 1000) returning id`)).rows[0]!;
    await db.execute(sql`
      insert into crypto_invoices (payment_id, token_contract, amount_units, rate_toman_per_asset, exchange_rate_id, pay_address, expires_at)
      values (${payment.id}, 'T', 10000, 100000, ${quoted!.id}, 'TAddr', now())`);

    await pruneRates(db);

    const left = new Set((await db.select({ id: exchangeRates.id }).from(exchangeRates)).map((row) => row.id));
    assert.equal(left.has(unused!.id), false);
    assert.equal(left.has(quoted!.id), true, "the record of what was charged");
    assert.equal(left.has(fresh!.id), true);
  });
});

describe("An event nothing can receive", () => {
  it("When its topic has no queue, then it is kept with the reason, and the events behind it still go out", async () => {
    const stuck = await recordEvent(db, { ...aPing(), topic: "nobody.listens" });
    const behind = await recordEvent(db, aPing());

    const result = await relayOutbox({ db, publish: livePublisher.publish });

    assert.equal(result.failed, 1);
    const stuckRow = await rowOf(stuck);
    assert.equal(stuckRow.publishedAt, null);
    assert.match(stuckRow.lastError ?? "", /no queue for topic "nobody.listens"/);

    // Not blocked behind the broken one.
    assert.ok((await rowOf(behind)).publishedAt);
  });
});
