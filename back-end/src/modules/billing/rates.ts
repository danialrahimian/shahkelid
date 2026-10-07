import { rialToToman } from "@shah-kelid/contracts";
import { and, desc, eq, gt, sql } from "drizzle-orm";

import config from "../../config";
import type { Db, Executor } from "../../platform/db/client";
import { exchangeRates } from "./schema";

/**
 * The toman price of USDT, from Nobitex's public market stats (which quote
 * rial). Fetched every minute by the worker.
 *
 * Quotes use `bestBuy`: what the market pays for USDT right now, so turning
 * what we receive back into toman is never at a loss. A rate that is too old
 * (Nobitex unreachable, the worker down) stops crypto checkout rather than
 * quote a price the market has moved away from.
 */

export type RateFetcher = () => Promise<{ bidToman: number; askToman: number }>;

const nobitex: RateFetcher = async () => {
  const response = await fetch(`${config.crypto.nobitexUrl}/market/stats?srcCurrency=usdt&dstCurrency=rls`, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Nobitex answered HTTP ${response.status}`);
  const body = (await response.json()) as {
    status?: string;
    stats?: Record<string, { bestBuy?: string; bestSell?: string; isClosed?: boolean }>;
  };
  const market = body.stats?.["usdt-rls"];
  if (body.status !== "ok" || !market || market.isClosed) throw new Error("Nobitex has no open USDT market");
  return {
    bidToman: rialToToman(Math.floor(Number(market.bestBuy))),
    askToman: rialToToman(Math.ceil(Number(market.bestSell))),
  };
};

let fetcher: RateFetcher = nobitex;

/** Test seam. */
export const setRateFetcher = (replacement: RateFetcher | null) => {
  fetcher = replacement ?? nobitex;
};

/**
 * Fetches and stores the current rate. A nonsensical one (zero, or buying
 * above selling) is refused: the database would refuse it too.
 */
export const refreshRate = async (db: Db) => {
  const { bidToman, askToman } = await fetcher();
  if (!(bidToman > 0) || !(askToman > 0) || bidToman > askToman) {
    throw new Error(`Refusing a broken rate: bid ${bidToman}, ask ${askToman}`);
  }
  const [row] = await db.insert(exchangeRates).values({ source: "nobitex", asset: "USDT", bidToman, askToman }).returning();
  return row!;
};

/**
 * Rates older than a month go, except the ones an invoice was quoted with
 * (kept as the record of what was charged). Fetched every minute, the table
 * would otherwise grow by half a million rows a year.
 */
export const pruneRates = async (db: Db, keepDays = 30) => {
  const { rowCount } = await db.execute(sql`
    delete from ${exchangeRates} r
    where r.fetched_at < now() - make_interval(days => ${keepDays})
      and not exists (select 1 from crypto_invoices i where i.exchange_rate_id = r.id)`);
  return rowCount ?? 0;
};

/** The newest rate if it is fresh enough to quote with; otherwise null. */
export const freshRate = async (executor: Executor) => {
  const [row] = await executor
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.asset, "USDT"),
        gt(exchangeRates.fetchedAt, new Date(Date.now() - config.crypto.rateMaxAgeMs)),
      ),
    )
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(1);
  return row ?? null;
};
