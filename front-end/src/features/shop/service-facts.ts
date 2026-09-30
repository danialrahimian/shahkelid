/**
 * Days left on a service, as its owner counts them: a service that ends
 * later today still has "1 day", not "0.2".
 */
export const daysLeft = (expiresAt: string, now: number) =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 86_400_000));

/** How full the volume is, 0 to 1; an unlimited service is never full. */
export const usedShare = (used: number, limit: number | null) =>
  limit === null || limit <= 0 ? 0 : Math.min(1, used / limit);
