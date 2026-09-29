"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  startTestServer,
  stopTestServer,
  clearDatabase,
} = require("./helpers/test-server");
const { createClient } = require("./helpers/api-client");
const { aUserInDb, loginAs } = require("./helpers/test-data");
const { Order } = require("../src/components/orders/order.model");

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);

/**
 * A paid order, dated by when the money actually arrived.
 *
 * Pass `period: null` to build a line with no term at all, the way orders
 * written before that field existed look. A default parameter only fills in
 * for `undefined`, so null is what actually leaves the field off.
 */
const anOrder = async ({
  user,
  status = "paid",
  price = 100,
  period = "1 month",
  quantity = 1,
  name = "Basic",
  createdAt = daysAgo(1),
  paidAt = createdAt,
}) =>
  Order.create({
    user: {
      userId: user._id,
      username: user.username,
      email: user.email,
    },
    items: [
      {
        productId: user._id,
        name,
        ...(period ? { period } : {}),
        price,
        quantity,
      },
    ],
    totalPrice: price * quantity,
    status,
    createdAt,
    ...(status === "paid" ? { paidAt } : {}),
  });

describe("Sales analytics", () => {
  before(async () => startTestServer());
  after(async () => stopTestServer());
  beforeEach(async () => clearDatabase());

  describe("Access control", () => {
    it("When nobody is signed in, then the summary responds 401", async () => {
      const client = createClient();

      const response = await client.get("/analytics/summary");

      assert.equal(response.status, 401);
    });

    it("When an ordinary customer asks, then it responds 403", async () => {
      // Revenue and conversion rates are commercial information.
      const client = createClient();
      await loginAs(client, "user");

      const response = await client.get("/analytics/summary");

      assert.equal(response.status, 403);
    });

    it("When an admin asks, then it is allowed", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.get("/analytics/summary");

      assert.equal(response.status, 200);
    });
  });

  describe("What counts as revenue", () => {
    it("When an order is pending or failed, then it is not revenue", async () => {
      // Counting intentions as income inflates every figure on the page, and
      // the error grows with every abandoned checkout.
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({ user, status: "paid", price: 100 });
      await anOrder({ user, status: "pending", price: 500 });
      await anOrder({ user, status: "failed", price: 900 });

      const response = await client.get("/analytics/summary");

      assert.equal(response.data.revenue.value, 100);
      assert.equal(response.data.orders.value, 1);
    });

    it("When an order is paid in a later period, then it counts in that period", async () => {
      // Opened on the last day of the window, paid two days after it closed.
      // Reporting on the creation date would book money that had not arrived.
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({
        user,
        price: 250,
        createdAt: daysAgo(31),
        paidAt: daysAgo(2),
      });

      const response = await client.get("/analytics/summary");

      assert.equal(response.data.revenue.value, 250);
    });

    it("When the average order value is reported, then it is revenue over paid orders", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({ user, price: 100 });
      await anOrder({ user, price: 300 });
      await anOrder({ user, status: "failed", price: 900 });

      const response = await client.get("/analytics/summary");

      assert.equal(response.data.averageOrderValue.value, 200);
    });

    it("When nothing sold, then every figure is zero rather than missing", async () => {
      const client = createClient();
      await loginAs(client, "owner");

      const response = await client.get("/analytics/summary");

      assert.equal(response.data.revenue.value, 0);
      assert.equal(response.data.orders.value, 0);
      assert.equal(response.data.averageOrderValue.value, 0);
      // No baseline means no percentage, not a fabricated one.
      assert.equal(response.data.revenue.change, null);
    });
  });

  describe("Recurring revenue", () => {
    it("When a plan runs for two years, then it contributes its monthly share", async () => {
      // $96 over 24 months is $4 a month. Adding the $96 straight in would
      // report a run rate the business does not have.
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({ user, price: 96, period: "2 years" });

      const response = await client.get("/analytics/summary");

      assert.equal(response.data.mrr, 4);
      assert.equal(response.data.arr, 48);
    });

    it("When terms differ, then each is spread over its own length", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({ user, price: 96, period: "2 years" }); // 4
      await anOrder({ user, price: 60, period: "1 year" }); // 5
      await anOrder({ user, price: 13, period: "1 month" }); // 13

      const response = await client.get("/analytics/summary");

      assert.equal(response.data.mrr, 22);
    });

    it("When an order predates the term being recorded, then it is left out and said so", async () => {
      // Guessing one month for an unknown term would count a two-year sale
      // twenty-four times over. Excluding it and reporting the coverage is the
      // only honest option.
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({ user, price: 96, period: "2 years" });
      await anOrder({ user, price: 5000, period: null });

      const response = await client.get("/analytics/summary");

      assert.equal(response.data.mrr, 4);
      assert.equal(response.data.mrrCoverage.countedOrders, 1);
      assert.equal(response.data.mrrCoverage.totalOrders, 2);
      assert.equal(response.data.mrrCoverage.percent, 50);
    });
  });

  describe("Comparison with the period before", () => {
    it("When the previous period is given, then the change is measured against it", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      // Ten days in the window, ten days in the one before it.
      await anOrder({ user, price: 200, paidAt: daysAgo(3) });
      await anOrder({ user, price: 100, paidAt: daysAgo(14) });

      const response = await client.get(
        `/analytics/summary?from=${daysAgo(9).toISOString().slice(0, 10)}&to=${daysAgo(0).toISOString().slice(0, 10)}`,
      );

      assert.equal(response.data.revenue.value, 200);
      assert.equal(response.data.revenue.previous, 100);
      assert.equal(response.data.revenue.change, 100);
    });
  });

  describe("Revenue over time", () => {
    it("When a day had no sales, then it still appears as zero", async () => {
      // A series that skips its quiet days draws a straight line over them,
      // which reads as steady trade rather than none.
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({ user, price: 50, paidAt: daysAgo(1) });

      const response = await client.get(
        `/analytics/revenue?from=${daysAgo(6).toISOString().slice(0, 10)}&to=${daysAgo(0).toISOString().slice(0, 10)}`,
      );

      assert.equal(response.status, 200);
      assert.equal(response.data.points.length, 7);
      assert.equal(
        response.data.points.filter((point) => point.revenue === 0).length,
        6,
      );
      assert.equal(
        response.data.points.reduce((sum, point) => sum + point.revenue, 0),
        50,
      );
    });

    it("When the buckets are added up, then they equal the summary total", async () => {
      // The two figures come from different aggregations, so this is the check
      // that the chart and the headline cannot disagree.
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({ user, price: 30, paidAt: daysAgo(2) });
      await anOrder({ user, price: 70, paidAt: daysAgo(5) });
      await anOrder({ user, price: 40, paidAt: daysAgo(9) });

      const [summary, series] = await Promise.all([
        client.get("/analytics/summary"),
        client.get("/analytics/revenue"),
      ]);

      const charted = series.data.points.reduce(
        (sum, point) => sum + point.revenue,
        0,
      );
      assert.equal(charted, summary.data.revenue.value);
    });

    it("When an unknown interval is asked for, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client, "owner");

      const response = await client.get("/analytics/revenue?interval=fortnight");

      assert.equal(response.status, 400);
    });

    it("When the range is back to front, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client, "owner");

      const response = await client.get(
        "/analytics/revenue?from=2026-09-10&to=2026-09-01",
      );

      assert.equal(response.status, 400);
    });
  });

  describe("Breakdown by plan", () => {
    it("When plans sold, then each shows its revenue, units and share", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({ user, name: "Plus", price: 60, quantity: 1 });
      await anOrder({ user, name: "Basic", price: 20, quantity: 2 });

      const response = await client.get("/analytics/plans");

      assert.equal(response.data.total, 100);
      const plus = response.data.plans.find((row) => row.name === "Plus");
      const basic = response.data.plans.find((row) => row.name === "Basic");
      assert.equal(plus.revenue, 60);
      assert.equal(plus.share, 60);
      assert.equal(basic.units, 2);
    });

    it("When a plan has been withdrawn, then its past sales still show", async () => {
      // The breakdown reads the order lines, not the catalogue, so revenue
      // does not vanish when a plan is retired.
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({ user, name: "Discontinued", price: 40 });

      const response = await client.get("/analytics/plans");

      assert.equal(response.data.plans[0].name, "Discontinued");
    });
  });

  describe("The funnel", () => {
    it("When orders were started and some paid, then completion is their ratio", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({ user, status: "paid" });
      await anOrder({ user, status: "paid" });
      await anOrder({ user, status: "paid" });
      await anOrder({ user, status: "failed" });

      const response = await client.get("/analytics/funnel");

      assert.equal(response.data.ordersStarted, 4);
      assert.equal(response.data.ordersPaid, 3);
      assert.equal(response.data.ordersFailed, 1);
      assert.equal(response.data.checkoutCompletion, 75);
    });

    it("When nothing was started, then the rate is zero rather than a division by zero", async () => {
      const client = createClient();
      await loginAs(client, "owner");

      const response = await client.get("/analytics/funnel");

      assert.equal(response.data.checkoutCompletion, 0);
    });
  });

  describe("Top customers", () => {
    it("When customers have bought, then they are ranked by what they paid", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user: small } = await aUserInDb();
      const { user: large } = await aUserInDb();

      await anOrder({ user: small, price: 50 });
      await anOrder({ user: large, price: 300 });
      await anOrder({ user: large, price: 100 });

      const response = await client.get("/analytics/top-customers");

      assert.equal(response.data[0].username, large.username);
      assert.equal(response.data[0].revenue, 400);
      assert.equal(response.data[0].orders, 2);
    });
  });
});
