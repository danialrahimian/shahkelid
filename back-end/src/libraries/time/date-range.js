"use strict";

const { badRequest } = require("../errors/app-error");

/**
 * Reading and bucketing the date ranges every report is scoped to.
 *
 * All of it in UTC, deliberately. A report that silently used the server's
 * local zone would move its own boundaries when the server moved, and two
 * people reading the same dashboard from different countries would disagree
 * about what "today" contained. UTC is arbitrary but it is stable and stated.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const INTERVALS = ["day", "week", "month"];

/** Midnight UTC at the start of the day a moment falls in. */
const startOfDay = (date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

/** Monday, because a week that starts on Sunday splits the working week. */
const startOfWeek = (date) => {
  const day = startOfDay(date);
  const weekday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - weekday * DAY_MS);
};

const startOfMonth = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const startOf = (date, interval) => {
  if (interval === "week") return startOfWeek(date);
  if (interval === "month") return startOfMonth(date);
  return startOfDay(date);
};

const advance = (date, interval) => {
  if (interval === "week") return new Date(date.getTime() + 7 * DAY_MS);
  if (interval === "month") {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
    );
  }
  return new Date(date.getTime() + DAY_MS);
};

/** The bucket key a moment belongs to, e.g. "2026-09-13". */
const bucketKey = (date, interval) =>
  startOf(date, interval).toISOString().slice(0, 10);

const parseDate = (value, label) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw badRequest(`${label} is not a date`);
  }
  return parsed;
};

/**
 * Turns `?from=&to=` into a half-open range [from, to).
 *
 * Half-open on purpose: `to` is pushed to the start of the following day, so
 * an order placed at 23:30 on the last day is inside the range. Comparing
 * against midnight of the end day instead would quietly drop most of it, which
 * is the classic way a daily revenue figure comes out short.
 */
const parseRange = (query = {}, { defaultDays = 30 } = {}) => {
  const now = new Date();

  const to = query.to
    ? advance(startOfDay(parseDate(query.to, "to")), "day")
    : advance(startOfDay(now), "day");

  const from = query.from
    ? startOfDay(parseDate(query.from, "from"))
    : new Date(to.getTime() - defaultDays * DAY_MS);

  if (from >= to) {
    throw badRequest("`from` must be before `to`");
  }

  // A century of daily buckets is a mistake, not a request.
  const days = Math.round((to - from) / DAY_MS);
  if (days > 366 * 5) {
    throw badRequest("That range is too long. Ask for five years or less.");
  }

  return { from, to, days };
};

/**
 * The equally long span ending where this one begins.
 *
 * Every "up 12% on last period" number needs one, and it has to be the *same
 * length* or the comparison is meaningless.
 */
const previousRange = ({ from, to }) => {
  const span = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - span), to: new Date(from) };
};

const parseInterval = (value) => {
  if (!value) return "day";
  if (!INTERVALS.includes(value)) {
    throw badRequest(`interval must be one of: ${INTERVALS.join(", ")}`);
  }
  return value;
};

/**
 * Every bucket in the range, in order.
 *
 * Reports return one row per bucket even where nothing happened. A series that
 * simply omits its empty days draws a line straight over them, which reads as
 * steady trade during a week with no sales at all.
 */
const bucketsIn = ({ from, to }, interval) => {
  const keys = [];
  let cursor = startOf(from, interval);

  while (cursor < to) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor = advance(cursor, interval);
  }

  return keys;
};

/** How many whole days a moment is behind now. */
const daysSince = (date) =>
  date ? Math.floor((Date.now() - new Date(date).getTime()) / DAY_MS) : null;

module.exports = {
  DAY_MS,
  INTERVALS,
  parseRange,
  previousRange,
  parseInterval,
  bucketsIn,
  bucketKey,
  startOfDay,
  daysSince,
};
