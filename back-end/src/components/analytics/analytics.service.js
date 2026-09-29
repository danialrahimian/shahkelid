"use strict";

const { Order } = require("../orders/order.model");
const { User } = require("../users/user.model");
const { PERIOD_MONTHS } = require("../products/product.model");
const {
  bucketKey,
  bucketsIn,
  parseInterval,
  parseRange,
  previousRange,
} = require("../../libraries/time/date-range");

/**
 * Sales reporting.
 *
 * Three decisions run through all of it, and they are what make the numbers
 * mean anything:
 *
 * 1. **Only paid orders are revenue.** A pending order is an intention and a
 *    failed one is nothing at all. Counting either inflates every figure on
 *    the page and the error compounds as abandoned checkouts pile up.
 *
 * 2. **Revenue is dated by `paidAt`, not `createdAt`.** An order opened on the
 *    31st and paid on the 1st belongs to the new month. Using the creation
 *    date would move money between periods depending on how long somebody sat
 *    on the payment page.
 *
 * 3. **Recurring revenue is normalised per month.** A two-year plan sold for
 *    $96 is $4 a month, not $96. Adding raw totals across terms produces a
 *    number that spikes whenever somebody buys a long plan and says nothing
 *    about the run rate.
 */

/** Only these count as money received. */
const PAID = { status: "paid" };

const paidBetween = ({ from, to }) => ({
  ...PAID,
  paidAt: { $gte: from, $lt: to },
});

/**
 * How many months an order line covers, or null when it cannot be known.
 *
 * The order stores the term as it stood at the time of sale, but records
 * written before that field existed have nothing. Guessing is worse than
 * declining: assume one month and a two-year sale counts twenty-four times
 * over, which does not understate the run rate, it multiplies it.
 */
const monthsForPeriod = (period) =>
  PERIOD_MONTHS[String(period ?? "").trim()] ?? null;

/**
 * The recurring value of an order, per month, or null if any line's term is
 * unknown.
 *
 * A partial answer would be worse than none: it would quietly drop part of the
 * order and report the remainder as if it were the whole thing.
 */
const normalisedMonthly = (order) => {
  let total = 0;

  for (const item of order.items ?? []) {
    const months = monthsForPeriod(item.period);
    if (months === null) return null;
    total += (item.price * item.quantity) / months;
  }

  return total;
};

/** Rounded to cents, so a third of a dollar does not become 0.3333333. */
const money = (value) => Math.round(value * 100) / 100;

/** Percentage change, and null when there is no baseline to compare against. */
const changeFrom = (previous, current) => {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

/** The headline totals for a range, with the same span before it to compare. */
const totalsFor = async (range) => {
  const [aggregate] = await Order.aggregate([
    { $match: paidBetween(range) },
    {
      $group: {
        _id: null,
        revenue: { $sum: "$totalPrice" },
        orders: { $sum: 1 },
        customers: { $addToSet: "$user.userId" },
        units: { $sum: { $sum: "$items.quantity" } },
      },
    },
  ]);

  const revenue = money(aggregate?.revenue ?? 0);
  const orders = aggregate?.orders ?? 0;

  return {
    revenue,
    orders,
    units: aggregate?.units ?? 0,
    customers: aggregate?.customers?.length ?? 0,
    averageOrderValue: orders > 0 ? money(revenue / orders) : 0,
  };
};

/**
 * The dashboard's headline figures.
 *
 * Every number is paired with the same measure over the preceding span of
 * equal length. A total with nothing to compare it to is decoration.
 */
const getSummary = async (query = {}) => {
  const range = parseRange(query);
  const previous = previousRange(range);

  const [current, before, mrrOrders, newCustomers, pending] = await Promise.all(
    [
      totalsFor(range),
      totalsFor(previous),

      // Everything still running, for the run rate. Not scoped to the range:
      // recurring revenue is a snapshot of now, not a sum over a window.
      Order.find(PAID).select("items").lean(),

      User.countDocuments({
        createdAt: { $gte: range.from, $lt: range.to },
      }),

      Order.countDocuments({
        status: "pending",
        createdAt: { $gte: range.from, $lt: range.to },
      }),
    ],
  );

  /**
   * The run rate, from the orders whose term is actually known.
   *
   * Orders that predate the term being recorded are left out rather than
   * guessed at, and how many were left out travels with the figure. A run rate
   * without its coverage is a number nobody can check.
   */
  let mrrTotal = 0;
  let counted = 0;

  for (const order of mrrOrders) {
    const monthly = normalisedMonthly(order);
    if (monthly === null) continue;
    mrrTotal += monthly;
    counted += 1;
  }

  const mrr = money(mrrTotal);

  return {
    range: { from: range.from, to: range.to, days: range.days },
    revenue: {
      value: current.revenue,
      previous: before.revenue,
      change: changeFrom(before.revenue, current.revenue),
    },
    orders: {
      value: current.orders,
      previous: before.orders,
      change: changeFrom(before.orders, current.orders),
    },
    averageOrderValue: {
      value: current.averageOrderValue,
      previous: before.averageOrderValue,
      change: changeFrom(before.averageOrderValue, current.averageOrderValue),
    },
    customers: {
      value: current.customers,
      previous: before.customers,
      change: changeFrom(before.customers, current.customers),
    },
    units: current.units,
    newCustomers,
    pendingOrders: pending,
    /** Monthly recurring revenue across every paid plan with a known term. */
    mrr,
    /** The same figure annualised, which is how a run rate is usually quoted. */
    arr: money(mrr * 12),
    /**
     * How much of the paid history the run rate actually covers. Anything
     * below 100 means some orders carry no billing term and were left out, and
     * the dashboard says so rather than presenting a partial figure as whole.
     */
    mrrCoverage: {
      countedOrders: counted,
      totalOrders: mrrOrders.length,
      percent:
        mrrOrders.length > 0
          ? Math.round((counted / mrrOrders.length) * 1000) / 10
          : 100,
    },
  };
};

/**
 * Revenue over time, one row per bucket including the empty ones.
 *
 * The gaps matter. A series that skips its quiet days draws a straight line
 * across them, which looks like steady trade rather than none.
 */
const getRevenueSeries = async (query = {}) => {
  const range = parseRange(query);
  const interval = parseInterval(query.interval);

  const rows = await Order.aggregate([
    { $match: paidBetween(range) },
    {
      $group: {
        _id: {
          $dateToString: {
            // Buckets are cut in UTC to match the range boundaries.
            format:
              interval === "month"
                ? "%Y-%m-01"
                : interval === "week"
                  ? "%Y-%m-%d"
                  : "%Y-%m-%d",
            date:
              interval === "week"
                ? {
                    $dateTrunc: {
                      date: "$paidAt",
                      unit: "week",
                      startOfWeek: "monday",
                      timezone: "UTC",
                    },
                  }
                : "$paidAt",
            timezone: "UTC",
          },
        },
        revenue: { $sum: "$totalPrice" },
        orders: { $sum: 1 },
      },
    },
  ]);

  const found = new Map(rows.map((row) => [row._id, row]));

  return {
    interval,
    range: { from: range.from, to: range.to },
    points: bucketsIn(range, interval).map((bucket) => {
      const row = found.get(bucket);
      return {
        bucket,
        revenue: money(row?.revenue ?? 0),
        orders: row?.orders ?? 0,
      };
    }),
  };
};

/**
 * Revenue split by plan, and separately by billing term.
 *
 * Both come from the order lines rather than the catalogue, so a plan that has
 * since been withdrawn still shows the money it made.
 */
const getPlanBreakdown = async (query = {}) => {
  const range = parseRange(query);

  const [byPlan, byTerm] = await Promise.all([
    Order.aggregate([
      { $match: paidBetween(range) },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.name",
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          units: { $sum: "$items.quantity" },
        },
      },
      { $sort: { revenue: -1 } },
    ]),

    Order.aggregate([
      { $match: paidBetween(range) },
      { $unwind: "$items" },
      {
        $group: {
          _id: { $ifNull: ["$items.period", "unknown"] },
          revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          units: { $sum: "$items.quantity" },
        },
      },
      { $sort: { revenue: -1 } },
    ]),
  ]);

  const total = byPlan.reduce((sum, row) => sum + row.revenue, 0);

  return {
    range: { from: range.from, to: range.to },
    total: money(total),
    plans: byPlan.map((row) => ({
      name: row._id ?? "Unknown",
      revenue: money(row.revenue),
      units: row.units,
      share: total > 0 ? Math.round((row.revenue / total) * 1000) / 10 : 0,
    })),
    terms: byTerm.map((row) => ({
      period: row._id,
      revenue: money(row.revenue),
      units: row.units,
      share: total > 0 ? Math.round((row.revenue / total) * 1000) / 10 : 0,
    })),
  };
};

/**
 * How far people get: a cart, then an order, then a payment.
 *
 * The cart figure is a snapshot of carts holding something right now, not a
 * count over the range, because a cart carries no history of when it was
 * filled. It is labelled as such in the response so the dashboard cannot
 * present it as if it were comparable to the other two.
 */
const getFunnel = async (query = {}) => {
  const range = parseRange(query);

  const [cartsNow, created, paid, failed] = await Promise.all([
    User.countDocuments({ "cart.items.0": { $exists: true } }),
    Order.countDocuments({ createdAt: { $gte: range.from, $lt: range.to } }),
    Order.countDocuments({
      status: "paid",
      createdAt: { $gte: range.from, $lt: range.to },
    }),
    Order.countDocuments({
      status: "failed",
      createdAt: { $gte: range.from, $lt: range.to },
    }),
  ]);

  return {
    range: { from: range.from, to: range.to },
    /** Carts with something in them, as of now. */
    openCarts: cartsNow,
    ordersStarted: created,
    ordersPaid: paid,
    ordersFailed: failed,
    /**
     * Of the orders started in this range, the share that were paid. Measured
     * on `createdAt` for both, so the same orders are in the numerator and the
     * denominator.
     */
    checkoutCompletion:
      created > 0 ? Math.round((paid / created) * 1000) / 10 : 0,
  };
};

/** The largest customers by what they have actually paid. */
const getTopCustomers = async (query = {}) => {
  const range = parseRange(query);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 5, 1), 25);

  const rows = await Order.aggregate([
    { $match: paidBetween(range) },
    {
      $group: {
        _id: "$user.userId",
        username: { $last: "$user.username" },
        email: { $last: "$user.email" },
        revenue: { $sum: "$totalPrice" },
        orders: { $sum: 1 },
        lastOrderAt: { $max: "$paidAt" },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: limit },
  ]);

  return rows.map((row) => ({
    userId: row._id,
    username: row.username,
    email: row.email,
    revenue: money(row.revenue),
    orders: row.orders,
    lastOrderAt: row.lastOrderAt,
  }));
};

module.exports = {
  getSummary,
  getRevenueSeries,
  getPlanBreakdown,
  getFunnel,
  getTopCustomers,
  // Exported for the tests, which check the normalisation directly rather than
  // inferring it from a total.
  normalisedMonthly,
  monthsForPeriod,
};
