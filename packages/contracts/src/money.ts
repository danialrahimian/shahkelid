/**
 * Money: the platform's unit is the toman, as a whole number.
 *
 * Two outside systems speak rial instead: Zarinpal takes amounts in rial, and
 * Nobitex quotes prices in rial. Converting at their edges, with these two
 * functions and nowhere else, is what keeps a factor of ten from slipping into
 * a price. It has happened to every Iranian shop that converted by hand.
 */

const assertWhole = (value: number, label: string) => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a whole number, got ${value}`);
  }
};

/** Toman to rial. Always exact. */
export const tomanToRial = (toman: number): number => {
  assertWhole(toman, "toman");
  return toman * 10;
};

/**
 * Rial to toman, rounded DOWN when the rial amount is not a multiple of ten.
 *
 * Down, because this runs on money coming in (an exchange rate, a received
 * amount). Rounding up would credit a customer, or value a coin, a fraction
 * of a toman higher than what actually arrived.
 */
export const rialToToman = (rial: number): number => {
  assertWhole(rial, "rial");
  return Math.floor(rial / 10);
};

/** A toman amount as Persian readers expect to see it: ۱۲۰٬۰۰۰ تومان */
export const formatToman = (toman: number, locale = "fa-IR"): string =>
  `${toman.toLocaleString(locale)} ${locale.startsWith("fa") ? "تومان" : "toman"}`;
