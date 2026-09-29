import type { Product } from "@/types/api";
import {
  BILLING_PERIODS,
  PERIOD_MONTHS,
  type BillingPeriod,
  isBillingPeriod,
} from "@/utils/billing-periods";

/**
 * Turns the catalogue into what the pricing page draws.
 *
 * The terms themselves live in `utils/billing-periods`, because the admin
 * product form needs the same list and a shared module cannot import a
 * feature.
 */

export type PricingPlan = {
  product: Product;
  period: BillingPeriod;
  months: number;
  /** The price spread across the term, which is the headline figure. */
  monthlyPrice: number;
  /** How much cheaper per month than this same tier bought monthly. */
  savingPercent: number;
  /** What this tier costs per month on the one-month term, when it exists. */
  baselineMonthlyPrice: number | null;
  /** Whether this is the plan the row points at. */
  recommended: boolean;
};

export type PricingCatalogue = {
  /** Only the terms that actually have plans, longest first. */
  periods: BillingPeriod[];
  plansByPeriod: Record<BillingPeriod, PricingPlan[]>;
};

/**
 * Groups the catalogue by term and prices each plan against its own tier.
 *
 * The saving has to be measured against the same tier bought monthly, not
 * against the other tiers on screen. Comparing Basic with Complete would
 * produce a "saving" that is really just the price difference between two
 * different products, which would be a false claim on a pricing page.
 *
 * A tier is identified by its name, because that is what stays the same as the
 * term changes.
 */
export const toPricingCatalogue = (products: Product[]): PricingCatalogue => {
  const usable = products.filter((product) =>
    isBillingPeriod(product.period.trim()),
  );

  // What each tier costs per month when bought one month at a time.
  const baselines = new Map<string, number>();
  for (const product of usable) {
    if (product.period.trim() === "1 month") {
      baselines.set(product.name, product.price);
    }
  }

  const plansByPeriod = {
    "1 month": [],
    "1 year": [],
    "2 years": [],
  } as Record<BillingPeriod, PricingPlan[]>;

  for (const product of usable) {
    const period = product.period.trim() as BillingPeriod;
    const months = PERIOD_MONTHS[period];
    const monthlyPrice = product.price / months;
    const baseline = baselines.get(product.name) ?? null;

    const savingPercent =
      baseline && baseline > 0
        ? Math.max(Math.round((1 - monthlyPrice / baseline) * 100), 0)
        : 0;

    plansByPeriod[period].push({
      product,
      period,
      months,
      monthlyPrice,
      savingPercent,
      baselineMonthlyPrice: baseline,
      recommended: false,
    });
  }

  for (const period of BILLING_PERIODS) {
    const plans = plansByPeriod[period];

    // Cheapest tier first, so the row reads from entry level upwards.
    plans.sort((a, b) => a.monthlyPrice - b.monthlyPrice);

    if (plans.length === 0) continue;

    // The middle card carries the badge. With three tiers that is the one most
    // people choose, and it keeps the row visually balanced. With two or one,
    // the last is the fullest and so the one worth pointing at.
    const highlighted =
      plans.length >= 3 ? Math.floor(plans.length / 2) : plans.length - 1;
    plans[highlighted].recommended = true;
  }

  const periods = [...BILLING_PERIODS]
    .filter((period) => plansByPeriod[period].length > 0)
    .sort((a, b) => PERIOD_MONTHS[b] - PERIOD_MONTHS[a]);

  return { periods, plansByPeriod };
};

/**
 * The best saving available on a term, used to label the term selector.
 *
 * Zero means there is nothing to boast about, and the label stays plain.
 */
export const bestSavingFor = (plans: PricingPlan[]): number =>
  plans.reduce((best, plan) => Math.max(best, plan.savingPercent), 0);

/** Every distinct perk across a set of plans, in the order they first appear. */
export const collectFeatures = (plans: PricingPlan[]): string[] => {
  const seen = new Set<string>();
  const features: string[] = [];

  for (const plan of plans) {
    for (const perk of plan.product.perks ?? []) {
      const key = perk.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      features.push(key);
    }
  }

  return features;
};
