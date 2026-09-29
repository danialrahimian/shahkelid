/**
 * The three billing terms a plan can run for.
 *
 * The same list the server's schema enforces. It used to be free text on both
 * sides, which filled the catalogue with "/ mo", "/ 6 mo" and "6 mounth", and
 * meant every price had to be parsed before it could be shown.
 *
 * This lives in `utils` rather than in the pricing feature because two
 * unrelated places need it: the pricing page groups by it, and the admin
 * product form offers it as the only choices. A shared module cannot reach
 * into a feature, so the constant has to sit below both.
 */
export const BILLING_PERIODS = ["1 month", "1 year", "2 years"] as const;

export type BillingPeriod = (typeof BILLING_PERIODS)[number];

/** How many months each term covers. */
export const PERIOD_MONTHS: Record<BillingPeriod, number> = {
  "1 month": 1,
  "1 year": 12,
  "2 years": 24,
};

/** The term the pricing page opens on: the longest, and so the best value. */
export const DEFAULT_PERIOD: BillingPeriod = "2 years";

export const isBillingPeriod = (value: string): value is BillingPeriod =>
  (BILLING_PERIODS as readonly string[]).includes(value);

/** How the term is phrased in a sentence about billing. */
export const billingCadence = (period: BillingPeriod): string =>
  period === "1 month" ? "monthly" : `every ${period}`;
