/**
 * The date ranges the sales reports can be scoped to.
 *
 * The bucket interval travels with the preset because it is not a free choice:
 * a year of daily buckets is 365 marks in the width of a card, and a week of
 * monthly buckets is one.
 */

export type RangePreset = {
  key: string;
  label: string;
  /** Days covered, counting today. */
  days: number;
  interval: "day" | "week" | "month";
};

export const RANGE_PRESETS: RangePreset[] = [
  { key: "7d", label: "7 days", days: 7, interval: "day" },
  { key: "30d", label: "30 days", days: 30, interval: "day" },
  { key: "90d", label: "90 days", days: 90, interval: "week" },
  { key: "12m", label: "12 months", days: 365, interval: "month" },
];

export const DEFAULT_PRESET = RANGE_PRESETS[1];

/** A UTC calendar date, which is the boundary the server cuts ranges on. */
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The range for a preset, expressed the way the API takes it.
 *
 * `to` is today and the server treats it as inclusive, so a 7-day preset is
 * today plus the six days before it -- not today plus seven, which would be
 * eight days of data under a label that says seven.
 */
export const rangeFor = (preset: RangePreset) => {
  const now = new Date();
  const from = new Date(now.getTime() - (preset.days - 1) * 86_400_000);

  return { from: isoDay(from), to: isoDay(now) };
};
