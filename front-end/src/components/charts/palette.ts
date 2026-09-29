/**
 * The categorical series colours, in fixed order.
 *
 * The hues themselves live in `index.css` as `--chart-1` through `--chart-5`,
 * stepped separately for the light and dark surfaces and validated against
 * both for colour-vision separation. This file only fixes the *order* they are
 * handed out in.
 *
 * Order matters more than it looks. Colour follows the entity, not its rank:
 * if a filter drops one plan from a breakdown, the plans that remain must keep
 * the colours they had, or the reader learns nothing from the chart's colours
 * except how many rows are currently showing.
 */

export const SERIES_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;

/** Anything past the fixed order is grouped, never given a generated hue. */
export const OTHER_COLOR = "var(--color-muted-foreground)";

/**
 * The colour for one entity, decided by a stable key rather than by position.
 *
 * `order` is the full list of entity keys as first seen -- for a plan
 * breakdown, every plan the business sells, not just the ones with sales in
 * the current range.
 */
export const colorForKey = (key: string, order: readonly string[]) => {
  const index = order.indexOf(key);
  if (index < 0 || index >= SERIES_COLORS.length) return OTHER_COLOR;
  return SERIES_COLORS[index];
};
