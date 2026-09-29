import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { analyticsApi } from "@/api/analytics";
import { authApi } from "@/api/auth";
import { env } from "@/config/env";
import { normalizeError } from "@/lib/api-client";
import {
  createTestStore,
  installCookieJar,
  resetSession,
  staffCredentials,
  uniqueCredentials,
  type TestStore,
} from "@/testing/test-store";

/**
 * The sales reports, against a real backend.
 *
 * Two things are worth testing from this side and neither is arithmetic. The
 * first is that the reports are actually closed to customers -- revenue and
 * conversion rates are commercial information, and a client that asks nicely
 * must still be refused. The second is that the figures on one panel agree
 * with the figures on another: the headline total and the chart come from two
 * different aggregations, so nothing but a test stops them drifting apart.
 *
 * Start the API first. The staff cases additionally need credentials in the
 * environment, and skip themselves rather than fail without them.
 */

const isBackendUp = async () => {
  try {
    const response = await fetch(`${env.API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const backendUp = await isBackendUp();
const staff = staffCredentials();

describe.skipIf(!backendUp)("Sales reporting against the live backend", () => {
  let restoreFetch: () => void;
  let store: TestStore;

  beforeAll(() => {
    restoreFetch = installCookieJar();
  });

  afterAll(() => {
    restoreFetch();
  });

  beforeEach(() => {
    resetSession();
    store = createTestStore();
  });

  const signInAsStaff = async () => {
    if (!staff) throw new Error("No staff credentials");

    const result = await store.dispatch(
      authApi.endpoints.login.initiate(staff),
    );

    if ("error" in result && result.error) {
      throw new Error(
        `Staff sign-in failed: ${normalizeError(result.error).message}`,
      );
    }
  };

  describe("Who may read them", () => {
    it("When nobody is signed in, then the summary is refused", async () => {
      const result = await store.dispatch(
        analyticsApi.endpoints.getSalesSummary.initiate(),
      );

      expect(normalizeError(result.error).status).toBe(401);
    });

    it("When an ordinary customer asks, then it is refused", async () => {
      await store.dispatch(
        authApi.endpoints.register.initiate(uniqueCredentials()),
      );

      const result = await store.dispatch(
        analyticsApi.endpoints.getSalesSummary.initiate(),
      );

      expect(normalizeError(result.error).status).toBe(403);
    });
  });

  describe.skipIf(!staff)("What the reports say", () => {
    it("When staff ask for the summary, then every figure is present", async () => {
      await signInAsStaff();

      const result = await store.dispatch(
        analyticsApi.endpoints.getSalesSummary.initiate(),
      );
      const summary = result.data;

      expect(summary).toBeDefined();
      expect(typeof summary?.revenue.value).toBe("number");
      expect(typeof summary?.orders.value).toBe("number");
      // Zero is a real answer; missing is not.
      expect(summary?.averageOrderValue.value).toBeGreaterThanOrEqual(0);
      expect(summary?.mrrCoverage.totalOrders).toBeGreaterThanOrEqual(
        summary?.mrrCoverage.countedOrders ?? 0,
      );
    });

    it("When the chart is added up, then it equals the headline total", async () => {
      // The regression this exists for: the summary sums `totalPrice` while
      // the series groups by day. Change the date field one of them uses and
      // the page shows two different revenues for the same range with no
      // error anywhere.
      await signInAsStaff();
      const range = { from: "2025-01-01", to: "2026-12-31" };

      const [summary, series] = await Promise.all([
        store.dispatch(
          analyticsApi.endpoints.getSalesSummary.initiate(range),
        ),
        store.dispatch(
          analyticsApi.endpoints.getRevenueSeries.initiate({
            ...range,
            interval: "month",
          }),
        ),
      ]);

      const charted = (series.data?.points ?? []).reduce(
        (sum, point) => sum + point.revenue,
        0,
      );

      // Both are rounded to cents independently, so they agree to the cent
      // rather than bit for bit.
      expect(charted).toBeCloseTo(summary.data?.revenue.value ?? -1, 2);
    });

    it("When a range has quiet days, then they are still in the series", async () => {
      await signInAsStaff();

      const result = await store.dispatch(
        analyticsApi.endpoints.getRevenueSeries.initiate({
          from: "2026-09-01",
          to: "2026-09-07",
          interval: "day",
        }),
      );

      // Seven days asked for, seven buckets back, whether or not each sold
      // anything. A gap-free series is what stops the chart drawing a
      // straight line across a week of nothing.
      expect(result.data?.points).toHaveLength(7);
    });

    it("When an interval nobody supports is asked for, then it is refused", async () => {
      await signInAsStaff();

      const result = await store.dispatch(
        analyticsApi.endpoints.getRevenueSeries.initiate({
          // Deliberately not one of the three the server buckets by.
          interval: "fortnight" as unknown as "day",
        }),
      );

      expect(normalizeError(result.error).status).toBe(400);
    });

    it("When plans are broken down, then the shares add up to the whole", async () => {
      await signInAsStaff();

      const result = await store.dispatch(
        analyticsApi.endpoints.getPlanBreakdown.initiate({
          from: "2025-01-01",
          to: "2026-12-31",
        }),
      );
      const plans = result.data?.plans ?? [];
      if (plans.length === 0) return;

      const shares = plans.reduce((sum, plan) => sum + plan.share, 0);
      const revenue = plans.reduce((sum, plan) => sum + plan.revenue, 0);

      // Each share is rounded to a tenth, so a handful of plans can drift by
      // a few tenths between them.
      expect(shares).toBeGreaterThan(99);
      expect(shares).toBeLessThan(101);
      expect(revenue).toBeCloseTo(result.data?.total ?? -1, 2);
    });

    it("When the funnel is read, then paid never exceeds started", async () => {
      await signInAsStaff();

      const result = await store.dispatch(
        analyticsApi.endpoints.getSalesFunnel.initiate({
          from: "2025-01-01",
          to: "2026-12-31",
        }),
      );
      const funnel = result.data;

      expect(funnel).toBeDefined();
      expect(funnel?.ordersPaid ?? 0).toBeLessThanOrEqual(
        funnel?.ordersStarted ?? 0,
      );
      expect(funnel?.checkoutCompletion ?? 0).toBeLessThanOrEqual(100);
    });

    it("When customers are ranked, then they come back largest first", async () => {
      await signInAsStaff();

      const result = await store.dispatch(
        analyticsApi.endpoints.getTopCustomers.initiate({
          from: "2025-01-01",
          to: "2026-12-31",
          limit: 5,
        }),
      );
      const customers = result.data ?? [];

      const sorted = [...customers].sort((a, b) => b.revenue - a.revenue);
      expect(customers.map((entry) => entry.userId)).toEqual(
        sorted.map((entry) => entry.userId),
      );
    });
  });
});
