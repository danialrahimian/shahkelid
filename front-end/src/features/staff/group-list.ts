import { toLatinDigits } from "@shah-kelid/contracts";

/**
 * "3, 5" into [3, 5]: panel group ids as staff type them, in any digits,
 * separated by Latin or Persian commas or spaces. Duplicates and anything
 * that is not a positive whole number are dropped.
 */
export const parseGroups = (text: string | undefined) =>
  [
    ...new Set(
      toLatinDigits(text ?? "")
        .split(/[\s,،]+/)
        .filter(Boolean)
        .map(Number),
    ),
  ].filter((id) => Number.isInteger(id) && id > 0);
