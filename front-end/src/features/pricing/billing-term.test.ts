import { describe, expect, it } from "vitest";

import {
  bestSavingFor,
  collectFeatures,
  toPricingCatalogue,
} from "@/features/pricing/billing-term";
import {
  BILLING_PERIODS,
  DEFAULT_PERIOD,
  isBillingPeriod,
  PERIOD_MONTHS,
} from "@/utils/billing-periods";
import type { Product } from "@/types/api";

/**
 * The pricing page rests on these functions. They decide the headline figure
 * on every card and the percentage next to it, so a mistake here misstates a
 * price, which is the one thing a pricing page must not do.
 */

const aProduct = (overrides: Partial<Product> = {}): Product => ({
  _id: overrides._id ?? Math.random().toString(36).slice(2),
  name: overrides.name ?? "Basic",
  period: overrides.period ?? "1 month",
  price: overrides.price ?? 10,
  perks: overrides.perks ?? [],
  image: overrides.image ?? "/uploads/plan.png",
});

describe("The billing terms", () => {
  it("When the terms are listed, then there are exactly three", () => {
    // The same three the server's schema enforces.
    expect(BILLING_PERIODS).toEqual(["1 month", "1 year", "2 years"]);
    expect(PERIOD_MONTHS).toEqual({
      "1 month": 1,
      "1 year": 12,
      "2 years": 24,
    });
  });

  it("When the page opens, then it opens on the longest term", () => {
    expect(DEFAULT_PERIOD).toBe("2 years");
  });

  it("When a value is checked, then only the three are accepted", () => {
    expect(isBillingPeriod("1 year")).toBe(true);
    expect(isBillingPeriod("/ yr")).toBe(false);
    expect(isBillingPeriod("6 months")).toBe(false);
  });
});

describe("toPricingCatalogue", () => {
  /** Three tiers on all three terms, which is the shape the seed produces. */
  const fullCatalogue = () => [
    aProduct({ name: "Basic", period: "1 month", price: 13 }),
    aProduct({ name: "Basic", period: "1 year", price: 60 }),
    aProduct({ name: "Basic", period: "2 years", price: 96 }),
    aProduct({ name: "Plus", period: "1 month", price: 16 }),
    aProduct({ name: "Plus", period: "1 year", price: 72 }),
    aProduct({ name: "Plus", period: "2 years", price: 120 }),
    aProduct({ name: "Complete", period: "1 month", price: 19 }),
    aProduct({ name: "Complete", period: "1 year", price: 96 }),
    aProduct({ name: "Complete", period: "2 years", price: 168 }),
  ];

  it("When the catalogue is grouped, then each term holds its own tiers", () => {
    const { plansByPeriod } = toPricingCatalogue(fullCatalogue());

    expect(plansByPeriod["2 years"]).toHaveLength(3);
    expect(plansByPeriod["1 year"]).toHaveLength(3);
    expect(plansByPeriod["1 month"]).toHaveLength(3);
  });

  it("When terms are listed, then the longest comes first", () => {
    const { periods } = toPricingCatalogue(fullCatalogue());

    expect(periods).toEqual(["2 years", "1 year", "1 month"]);
  });

  it("When a term has no plans, then it is not offered", () => {
    const { periods } = toPricingCatalogue([
      aProduct({ name: "Basic", period: "1 month", price: 13 }),
    ]);

    expect(periods).toEqual(["1 month"]);
  });

  it("When a plan runs for two years, then the headline is the price per month", () => {
    const { plansByPeriod } = toPricingCatalogue(fullCatalogue());

    const basic = plansByPeriod["2 years"].find(
      (plan) => plan.product.name === "Basic",
    );
    expect(basic?.monthlyPrice).toBe(4);
  });

  it("When a tier is compared, then the saving is against that same tier bought monthly", () => {
    // Basic is $13/month on the short term and $4/month over two years, which
    // is a 69% saving. Comparing Basic against Plus instead would produce a
    // number that is really just the gap between two different products.
    const { plansByPeriod } = toPricingCatalogue(fullCatalogue());

    const basic = plansByPeriod["2 years"].find(
      (plan) => plan.product.name === "Basic",
    );
    const complete = plansByPeriod["2 years"].find(
      (plan) => plan.product.name === "Complete",
    );

    expect(basic?.baselineMonthlyPrice).toBe(13);
    expect(basic?.savingPercent).toBe(69);

    // Complete: $19 against $7, which is 63%. A different number, because it
    // is a different tier.
    expect(complete?.savingPercent).toBe(63);
  });

  it("When the term is one month, then nothing claims a saving against itself", () => {
    const { plansByPeriod } = toPricingCatalogue(fullCatalogue());

    expect(
      plansByPeriod["1 month"].every((plan) => plan.savingPercent === 0),
    ).toBe(true);
  });

  it("When a tier has no monthly price to compare with, then no saving is invented", () => {
    const { plansByPeriod } = toPricingCatalogue([
      aProduct({ name: "Only long", period: "2 years", price: 96 }),
    ]);

    const plan = plansByPeriod["2 years"][0];
    expect(plan.baselineMonthlyPrice).toBeNull();
    expect(plan.savingPercent).toBe(0);
  });

  it("When tiers are ordered, then the cheapest is first", () => {
    const { plansByPeriod } = toPricingCatalogue(fullCatalogue());

    expect(
      plansByPeriod["2 years"].map((plan) => plan.product.name),
    ).toEqual(["Basic", "Plus", "Complete"]);
  });

  it("When there are three tiers, then the middle one is recommended", () => {
    const { plansByPeriod } = toPricingCatalogue(fullCatalogue());

    const recommended = plansByPeriod["2 years"].filter(
      (plan) => plan.recommended,
    );
    expect(recommended).toHaveLength(1);
    expect(recommended[0].product.name).toBe("Plus");
  });

  it("When there is a single tier, then it is the one recommended", () => {
    const { plansByPeriod } = toPricingCatalogue([
      aProduct({ name: "Only", period: "2 years", price: 96 }),
    ]);

    expect(plansByPeriod["2 years"][0].recommended).toBe(true);
  });

  it("When a product carries a term the server no longer allows, then it is left out", () => {
    // Rows written before the terms were fixed would otherwise land in no
    // group at all and quietly disappear from the totals.
    const { periods, plansByPeriod } = toPricingCatalogue([
      aProduct({ name: "Legacy", period: "/ 6 mo", price: 49 }),
      aProduct({ name: "Basic", period: "2 years", price: 96 }),
    ]);

    expect(periods).toEqual(["2 years"]);
    expect(plansByPeriod["2 years"]).toHaveLength(1);
  });

  it("When the period has stray spaces, then it still groups correctly", () => {
    const { plansByPeriod } = toPricingCatalogue([
      aProduct({ name: "Padded", period: "  2 years  ", price: 96 }),
    ]);

    expect(plansByPeriod["2 years"]).toHaveLength(1);
  });

  it("When there is nothing to show, then nothing breaks", () => {
    const { periods, plansByPeriod } = toPricingCatalogue([]);

    expect(periods).toEqual([]);
    expect(plansByPeriod["2 years"]).toEqual([]);
  });
});

describe("bestSavingFor", () => {
  it("When a term has savings, then the largest is reported", () => {
    const { plansByPeriod } = toPricingCatalogue([
      aProduct({ name: "Basic", period: "1 month", price: 13 }),
      aProduct({ name: "Basic", period: "2 years", price: 96 }),
      aProduct({ name: "Plus", period: "1 month", price: 16 }),
      aProduct({ name: "Plus", period: "2 years", price: 120 }),
    ]);

    expect(bestSavingFor(plansByPeriod["2 years"])).toBe(69);
  });

  it("When there is nothing to boast about, then it reports zero", () => {
    expect(bestSavingFor([])).toBe(0);
  });
});

describe("collectFeatures", () => {
  it("When plans share perks, then each is listed once in the order first seen", () => {
    const { plansByPeriod } = toPricingCatalogue([
      aProduct({
        name: "Basic",
        period: "2 years",
        price: 96,
        perks: ["Unlimited data", "Email support"],
      }),
      aProduct({
        name: "Plus",
        period: "2 years",
        price: 120,
        perks: ["Unlimited data", "Live support"],
      }),
    ]);

    expect(collectFeatures(plansByPeriod["2 years"])).toEqual([
      "Unlimited data",
      "Email support",
      "Live support",
    ]);
  });

  it("When a perk is blank, then it is left out of the comparison", () => {
    const { plansByPeriod } = toPricingCatalogue([
      aProduct({ period: "2 years", perks: ["Real perk", "   ", ""] }),
    ]);

    expect(collectFeatures(plansByPeriod["2 years"])).toEqual(["Real perk"]);
  });
});
