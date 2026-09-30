import { z } from "zod";

/**
 * Sales reports for staff with analytics:read.
 *
 * A range is two calendar days in Tehran's time, both included: "today" in
 * a report is the day the shop's staff are living, not the server's UTC day.
 * Money is what paid orders came to (renewals included, wallet top-ups not,
 * so a top-up spent on a plan is not counted twice).
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "RANGE_INVALID");

export const MAX_REPORT_DAYS = 366;

export const reportRangeInput = z
  .object({ from: day, to: day })
  .refine(({ from, to }) => from <= to, { message: "RANGE_INVALID", path: ["to"] })
  .refine(({ from, to }) => (Date.parse(to) - Date.parse(from)) / 86_400_000 < MAX_REPORT_DAYS, {
    message: "RANGE_INVALID",
    path: ["from"],
  });
export type ReportRange = z.input<typeof reportRangeInput>;

/** A figure for the range, the same figure for the range just before it, and the change in percent (null from zero). */
export type Compared = { value: number; previous: number; change: number | null };

export type ReportSummary = {
  range: { from: string; to: string; days: number };
  revenueToman: Compared;
  paidOrders: Compared;
  averageOrderToman: Compared;
  payingCustomers: Compared;
  newAccounts: Compared;
  /** Orders started in the range, and how many of them were paid. */
  startedOrders: number;
  completionPercent: number | null;
  /** Paid orders that renewed a service, as a share of all paid orders. */
  renewals: number;
  /** Right now, not in the range. */
  liveServices: number;
};

/** One point per day in the range, days without sales included as zero. */
export type RevenuePoint = { day: string; revenueToman: number; orders: number };

export type ReportBreakdown = {
  plans: { planId: string | null; name: string; orders: number; revenueToman: number; sharePercent: number }[];
  methods: { method: string; payments: number; amountToman: number; sharePercent: number }[];
  kinds: { kind: string; orders: number; revenueToman: number }[];
};

export type TopCustomer = { id: string; email: string; displayName: string; orders: number; revenueToman: number };
