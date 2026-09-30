import type { Compared, ReportBreakdown, ReportSummary, RevenuePoint, TopCustomer } from "@shah-kelid/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { Db } from "../../platform/db/client";

/**
 * Sales reports, read straight from orders and payments.
 *
 * Days are Tehran's: a range from 1 to 7 runs from midnight at the start of
 * the 1st, Tehran time, to midnight at the end of the 7th. Grouping days
 * into Persian weeks and months is left to the screen, which knows the
 * calendar; the server hands out days.
 */

const ZONE = "Asia/Tehran";
const DAY_MS = 86_400_000;

type Range = { from: string; to: string };

/** The instants a range of Tehran days covers: [start, end). */
const bounds = ({ from, to }: Range) => ({
  start: sql`(${from}::date)::timestamp at time zone ${ZONE}`,
  end: sql`((${to}::date) + 1)::timestamp at time zone ${ZONE}`,
});

const daysIn = ({ from, to }: Range) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

/** The range of the same length just before this one. */
const previousOf = (range: Range): Range => {
  const days = daysIn(range);
  const shift = (value: string) => new Date(Date.parse(value) - days * DAY_MS).toISOString().slice(0, 10);
  return { from: shift(range.from), to: shift(range.to) };
};

/** Orders that count as sales: paid, and not a wallet top-up. */
const SOLD = sql`o.status in ('paid', 'fulfilled') and o.kind <> 'wallet_topup'`;

const soldIn = (range: Range) => {
  const { start, end } = bounds(range);
  return sql`${SOLD} and o.paid_at >= ${start} and o.paid_at < ${end}`;
};

const totals = async (db: Db, range: Range) => {
  const { start, end } = bounds(range);
  const { rows } = await db.execute<{ revenue: string; orders: number; customers: number; accounts: number }>(sql`
    select
      coalesce(sum(o.total_toman), 0) as revenue,
      count(*)::int as orders,
      count(distinct o.user_id)::int as customers,
      (select count(*)::int from users u
        where u.created_at >= ${start} and u.created_at < ${end} and u.deleted_at is null) as accounts
    from orders o where ${soldIn(range)}`);
  const row = rows[0]!;
  const revenue = Number(row.revenue);
  return {
    revenue,
    orders: row.orders,
    customers: row.customers,
    accounts: row.accounts,
    average: row.orders ? Math.round(revenue / row.orders) : 0,
  };
};

const compared = (value: number, previous: number): Compared => ({
  value,
  previous,
  change: previous ? Math.round(((value - previous) / previous) * 1000) / 10 : null,
});

export const summary = async (db: Db, range: Range): Promise<ReportSummary> => {
  const { start, end } = bounds(range);
  const [now, before, started, other] = await Promise.all([
    totals(db, range),
    totals(db, previousOf(range)),
    db.execute<{ started: number; completed: number }>(sql`
      select count(*)::int as started,
        count(*) filter (where o.status in ('paid', 'fulfilled'))::int as completed
      from orders o
      where o.kind <> 'wallet_topup' and o.created_at >= ${start} and o.created_at < ${end}`),
    db.execute<{ renewals: number; live: number }>(sql`
      select
        (select count(*)::int from orders o where ${soldIn(range)} and o.kind = 'renewal') as renewals,
        (select count(*)::int from subscriptions s
          where s.status in ('provisioning', 'on_hold', 'active', 'limited')) as live`),
  ]);
  const { started: startedOrders, completed } = started.rows[0]!;
  return {
    range: { ...range, days: daysIn(range) },
    revenueToman: compared(now.revenue, before.revenue),
    paidOrders: compared(now.orders, before.orders),
    averageOrderToman: compared(now.average, before.average),
    payingCustomers: compared(now.customers, before.customers),
    newAccounts: compared(now.accounts, before.accounts),
    startedOrders,
    completionPercent: startedOrders ? Math.round((completed / startedOrders) * 1000) / 10 : null,
    renewals: other.rows[0]!.renewals,
    liveServices: other.rows[0]!.live,
  };
};

export const revenueByDay = async (db: Db, range: Range): Promise<RevenuePoint[]> => {
  const { rows } = await db.execute<{ day: string; revenue: string; orders: number }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(sum(o.total_toman), 0) as revenue,
      count(o.id)::int as orders
    from generate_series(${range.from}::date, ${range.to}::date, interval '1 day') as d(day)
    left join orders o
      on ${SOLD} and (o.paid_at at time zone ${ZONE})::date = d.day::date
    group by d.day order by d.day`);
  return rows.map((row) => ({ day: row.day, revenueToman: Number(row.revenue), orders: row.orders }));
};

const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

export const breakdown = async (db: Db, range: Range): Promise<ReportBreakdown> => {
  const { start, end } = bounds(range);
  const [plans, methods, kinds] = await Promise.all([
    db.execute<{ plan_id: string | null; name: string | null; orders: number; revenue: string }>(sql`
      select i.plan_id, coalesce(p.name, i.plan_snapshot ->> 'name') as name,
        count(distinct o.id)::int as orders, sum(i.total_toman) as revenue
      from orders o
      join order_items i on i.order_id = o.id
      left join plans p on p.id = i.plan_id
      where ${soldIn(range)}
      group by i.plan_id, coalesce(p.name, i.plan_snapshot ->> 'name')
      order by revenue desc`),
    db.execute<{ method: string; payments: number; amount: string }>(sql`
      select y.method, count(*)::int as payments, sum(y.amount_toman) as amount
      from payments y
      where y.status = 'succeeded' and y.succeeded_at >= ${start} and y.succeeded_at < ${end}
      group by y.method order by amount desc`),
    db.execute<{ kind: string; orders: number; revenue: string }>(sql`
      select o.kind, count(*)::int as orders, sum(o.total_toman) as revenue
      from orders o where ${soldIn(range)}
      group by o.kind order by revenue desc`),
  ]);
  const planTotal = plans.rows.reduce((sum, row) => sum + Number(row.revenue), 0);
  const methodTotal = methods.rows.reduce((sum, row) => sum + Number(row.amount), 0);
  return {
    plans: plans.rows.map((row) => ({
      planId: row.plan_id,
      name: row.name ?? "—",
      orders: row.orders,
      revenueToman: Number(row.revenue),
      sharePercent: share(Number(row.revenue), planTotal),
    })),
    methods: methods.rows.map((row) => ({
      method: row.method,
      payments: row.payments,
      amountToman: Number(row.amount),
      sharePercent: share(Number(row.amount), methodTotal),
    })),
    kinds: kinds.rows.map((row) => ({ kind: row.kind, orders: row.orders, revenueToman: Number(row.revenue) })),
  };
};

export const topCustomers = async (db: Db, range: Range, limit = 10): Promise<TopCustomer[]> => {
  const where: SQL = soldIn(range);
  const { rows } = await db.execute<{
    id: string;
    email: string;
    display_name: string;
    orders: number;
    revenue: string;
  }>(sql`
    select u.id, u.email, u.display_name, count(*)::int as orders, sum(o.total_toman) as revenue
    from orders o join users u on u.id = o.user_id
    where ${where}
    group by u.id order by revenue desc, orders desc limit ${limit}`);
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    orders: row.orders,
    revenueToman: Number(row.revenue),
  }));
};
