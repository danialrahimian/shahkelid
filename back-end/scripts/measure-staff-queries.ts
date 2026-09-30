/**
 * Times the heaviest staff queries against whatever database POSTGRES_URL
 * names: the customer list (every customer's value and stage are computed on
 * read), its segments, a year of reports, the ticket queue, and the reminder
 * scan the worker runs every 15 minutes. Read-only except the reminder scan,
 * so run it on a trial server loaded with infra/loadtest/seed.sql, not on
 * the live one.
 *
 *   npx tsx scripts/measure-staff-queries.ts
 */
import { listCustomers, segments } from "../src/modules/crm/service";
import { scanReminders } from "../src/modules/notifications/reminders";
import { breakdown, revenueByDay, summary, topCustomers } from "../src/modules/reports/service";
import { ticketQueue } from "../src/modules/support/service";
import { closeDb, getDb } from "../src/platform/db/client";

const db = getDb();
const year = { from: new Date(Date.now() - 364 * 86_400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };

const time = async (label: string, work: () => Promise<unknown>, runs = 5) => {
  const took: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    await work();
    took.push(performance.now() - start);
  }
  took.sort((a, b) => a - b);
  console.log(`${label.padEnd(44)} median ${took[Math.floor(runs / 2)]!.toFixed(0).padStart(5)} ms   worst ${took.at(-1)!.toFixed(0).padStart(5)} ms`);
};

const main = async () => {
  await time("customers, newest first, page 1", () => listCustomers(db, { sort: "joined", limit: 50, offset: 0 }));
  await time("customers, by value", () => listCustomers(db, { sort: "value", limit: 50, offset: 0 }));
  await time("customers, at risk", () => listCustomers(db, { stage: "at-risk", sort: "joined", limit: 50, offset: 0 }));
  await time("customers, searched", () => listCustomers(db, { search: "load77", sort: "joined", limit: 50, offset: 0 }));
  await time("customer segments", () => segments(db));
  await time("report summary, a year", () => summary(db, year));
  await time("revenue by day, a year", () => revenueByDay(db, year));
  await time("breakdown, a year", () => breakdown(db, year));
  await time("top customers, a year", () => topCustomers(db, year));
  await time("ticket queue, waiting for staff", () =>
    ticketQueue(db, { status: "awaiting_staff", assignee: "all", actorId: "00000000-0000-0000-0000-000000000000" }),
  );
  await time("reminder scan (the worker, every 15 min)", () => scanReminders(db), 3);
  await closeDb();
};

void main();
