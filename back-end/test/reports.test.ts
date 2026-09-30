import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { orderItems, orders, payments } from "../src/modules/billing/schema";
import { aCustomerAccount, closeDatabase, database, signedInCustomer, signedInStaff, captureEmails } from "./helpers/accounts";
import { createClient } from "./helpers/api-client";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, installFakePanels, type Store } from "./helpers/store";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * Sales reports on PostgreSQL: the old dashboard's figures (revenue, orders,
 * average, per plan, completion, top customers), on Tehran's days.
 *
 * Every order here is dated in 2031, a year no other test touches, so the
 * figures are exactly what this file arranged.
 */

const REPORTS = "/api/v1/staff/reports";
let accountant: Awaited<ReturnType<typeof signedInStaff>>;
let store: Store;
let emails: ReturnType<typeof captureEmails>;

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  emails = captureEmails();
  installFakePanels();
  accountant = await signedInStaff(["accountant"]);
  store = await aStore();
});

after(async () => {
  emails.stop();
  await closeDatabase();
  await stopTestServer();
});

/** An order paid at this instant, for this plan, by this method. */
const aSale = async (
  userId: string,
  totalToman: number,
  paidAt: string,
  {
    status = "paid",
    kind = "new",
    method = "zarinpal",
  }: { status?: "paid" | "pending" | "failed"; kind?: "new" | "wallet_topup"; method?: "zarinpal" | "card_transfer" } = {},
) => {
  const at = new Date(paidAt);
  const [order] = await database()
    .insert(orders)
    .values({
      userId,
      kind,
      status,
      subtotalToman: totalToman,
      totalToman,
      expiresAt: new Date(at.getTime() + 86_400_000),
      paidAt: status === "paid" ? at : null,
      createdAt: at,
    })
    .returning();
  await database()
    .insert(orderItems)
    .values({ orderId: order!.id, planId: store.planId, unitPriceToman: totalToman, totalToman });
  if (status === "paid") {
    await database()
      .insert(payments)
      .values({ orderId: order!.id, userId, method, status: "succeeded", amountToman: totalToman, succeededAt: at });
  }
  return order!;
};

const report = async (path: string, from: string, to: string) => {
  const response = await accountant.client.get(`${REPORTS}/${path}?from=${from}&to=${to}`);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
};

describe("Reports", () => {
  it("Only analytics:read may read them", async () => {
    assert.equal((await createClient().get(`${REPORTS}/summary?from=2031-01-01&to=2031-01-07`)).status, 401);
    const customer = await signedInCustomer(emails);
    assert.equal((await customer.client.get(`${REPORTS}/summary?from=2031-01-01&to=2031-01-07`)).status, 403);
    const support = await signedInStaff(["support"]);
    assert.equal((await support.client.get(`${REPORTS}/summary?from=2031-01-01&to=2031-01-07`)).status, 403);
  });

  it("Revenue is paid orders only, top-ups excluded; the average is revenue over paid orders; the week before is compared", async () => {
    const one = await aCustomerAccount();
    const two = await aCustomerAccount();
    await aSale(one.id, 100_000, "2031-01-02T10:00:00Z");
    await aSale(two.id, 300_000, "2031-01-03T10:00:00Z", { method: "card_transfer" });
    await aSale(one.id, 999_000, "2031-01-03T11:00:00Z", { status: "pending" });
    await aSale(one.id, 999_000, "2031-01-03T12:00:00Z", { status: "failed" });
    await aSale(two.id, 500_000, "2031-01-04T10:00:00Z", { kind: "wallet_topup" });
    await aSale(one.id, 200_000, "2030-12-28T10:00:00Z"); // the week before

    const figures = await report("summary", "2031-01-01", "2031-01-07");
    assert.deepEqual(figures.revenueToman, { value: 400_000, previous: 200_000, change: 100 });
    assert.equal(figures.paidOrders.value, 2);
    assert.equal(figures.averageOrderToman.value, 200_000);
    assert.equal(figures.payingCustomers.value, 2);
    assert.equal(figures.startedOrders, 4, "top-ups are not orders for this");
    assert.equal(figures.completionPercent, 50);
  });

  it("Days are Tehran's: a sale at 22:00 UTC on the 9th is on the 10th", async () => {
    const buyer = await aCustomerAccount();
    await aSale(buyer.id, 70_000, "2031-02-09T22:00:00Z"); // 01:30 on the 10th in Tehran
    const points = await report("revenue", "2031-02-09", "2031-02-11");
    assert.deepEqual(
      points.map((point: { day: string; revenueToman: number }) => [point.day, point.revenueToman]),
      [
        ["2031-02-09", 0],
        ["2031-02-10", 70_000],
        ["2031-02-11", 0],
      ],
      "a day without sales is there, as zero",
    );
  });

  it("With nothing sold, every figure is zero and changes are null, not a division by zero", async () => {
    const figures = await report("summary", "2031-06-01", "2031-06-30");
    assert.equal(figures.revenueToman.value, 0);
    assert.equal(figures.revenueToman.change, null);
    assert.equal(figures.averageOrderToman.value, 0);
    assert.equal(figures.completionPercent, null);
  });

  it("The breakdown shows each plan's and each method's share; the top customers are ranked by what they paid", async () => {
    const small = await aCustomerAccount();
    const big = await aCustomerAccount();
    await aSale(small.id, 100_000, "2031-03-02T10:00:00Z");
    await aSale(big.id, 300_000, "2031-03-03T10:00:00Z", { method: "card_transfer" });

    const split = await report("breakdown", "2031-03-01", "2031-03-31");
    assert.equal(split.plans.length, 1);
    assert.equal(split.plans[0].revenueToman, 400_000);
    assert.equal(split.plans[0].sharePercent, 100);
    assert.deepEqual(
      split.methods.map((row: { method: string; sharePercent: number }) => [row.method, row.sharePercent]),
      [
        ["card_transfer", 75],
        ["zarinpal", 25],
      ],
    );

    const top = await report("customers", "2031-03-01", "2031-03-31");
    assert.deepEqual(
      top.map((row: { id: string }) => row.id),
      [big.id, small.id],
    );
  });

  it("A range back to front, not a date, or over a year is refused", async () => {
    for (const query of ["from=2031-01-07&to=2031-01-01", "from=yesterday&to=2031-01-01", "from=2030-01-01&to=2031-06-01"]) {
      const response = await accountant.client.get(`${REPORTS}/summary?${query}`);
      assert.equal(response.status, 400, query);
    }
  });
});
