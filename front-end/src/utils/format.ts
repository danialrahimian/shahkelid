/**
 * Shared formatting, so a price or a date never renders two different ways on
 * two different screens.
 */

/** Prices come from the API as plain numbers. */
export const formatPrice = (value: number) =>
  `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** A readable date, or an empty string when there is nothing to show. */
export const formatDate = (value: string | undefined | null) => {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

/** A date with the time, for records where the moment matters. */
export const formatDateTime = (value: string | undefined | null) => {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/**
 * A price short enough for a chart axis: $1.2k rather than $1,200.
 *
 * Axis labels compete with the data for space, so they give up precision the
 * moment they need it. Exact figures stay in the tooltip and the table view.
 */
export const formatCompactPrice = (value: number) => {
  const sign = value < 0 ? "-" : "";
  const size = Math.abs(value);

  if (size >= 1_000_000) return `${sign}$${(size / 1_000_000).toFixed(1)}m`;
  if (size >= 1_000) return `${sign}$${(size / 1_000).toFixed(size >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(size)}`;
};

/** A plain count with thousands separators. */
export const formatCount = (value: number) => value.toLocaleString("en-US");

/** A percentage with at most one decimal, e.g. "12.4%". */
export const formatPercent = (value: number) =>
  `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
