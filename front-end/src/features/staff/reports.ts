import type { RevenuePoint } from "@shah-kelid/contracts";

/**
 * The calendar arithmetic behind the reports page, kept apart from the page
 * so it can be tested: Tehran's today, ranges ending on it, and grouping days
 * into Persian weeks (starting on Saturday) and Persian months.
 */

const ZONE = "Asia/Tehran";
const DAY_MS = 86_400_000;

/** Today in Tehran, as YYYY-MM-DD. */
export const tehranToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The last `days` days, today included. */
export const lastDays = (days: number, now = new Date()) => {
  const to = tehranToday(now);
  return { from: shift(to, -(days - 1)), to };
};

export type Grouping = "day" | "week" | "month";

const persianMonth = new Intl.DateTimeFormat("en-u-ca-persian", { timeZone: "UTC", year: "numeric", month: "numeric" });

/** The day a point's bucket starts on: itself, the Saturday before, or the first day of its Persian month. */
const bucketOf = (day: string, grouping: Grouping) => {
  if (grouping === "day") return day;
  const date = new Date(`${day}T00:00:00Z`);
  if (grouping === "week") {
    // getUTCDay: Sunday 0 … Saturday 6. Days since the last Saturday:
    return shift(day, -((date.getUTCDay() + 1) % 7));
  }
  return persianMonth.format(date);
};

/** Days added up into weeks or months; each group is labelled by its first day in the range. */
export const groupPoints = (points: RevenuePoint[], grouping: Grouping) => {
  const groups = new Map<string, RevenuePoint>();
  for (const point of points) {
    const key = bucketOf(point.day, grouping);
    const group = groups.get(key);
    if (group) {
      group.revenueToman += point.revenueToman;
      group.orders += point.orders;
    } else {
      groups.set(key, { ...point });
    }
  }
  return [...groups.values()];
};
