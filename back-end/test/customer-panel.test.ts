import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { orders } from "../src/modules/billing/schema";
import { setZarinpal } from "../src/modules/billing/zarinpal";
import type { PanelUser } from "../src/modules/provisioning/driver";
import { provisionSubscription } from "../src/modules/provisioning/provision";
import { runRenewalJob } from "../src/modules/provisioning/worker";
import { renewalTarget } from "../src/modules/subscriptions/renewal";
import { subscriptionEvents, subscriptions } from "../src/modules/subscriptions/schema";
import { panelUsernameFor } from "../src/modules/subscriptions/service";
import { outboxEvents } from "../src/platform/db/platform-schema";
import { captureEmails, closeDatabase, database, signedInCustomer } from "./helpers/accounts";
import { FakeZarinpal } from "./helpers/fake-zarinpal";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, installFakePanels, owner, type Store } from "./helpers/store";
import { getBaseUrl, startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * The customer panel: their services, renewing, invoices and their name.
 *
 * Renewal rule (decided in M6): at once, nothing already paid for is lost.
 * Days are added to the current expiry, volume to what is left; an expired
 * service starts again from today.
 */

const SHOP = "/api/v1/shop";
const GB = 1024 ** 3;
const DAY = 86400_000;
let emails: ReturnType<typeof captureEmails>;
let gateway: FakeZarinpal;

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  emails = captureEmails();
  installFakePanels();
  gateway = new FakeZarinpal();
  setZarinpal(gateway);
});

after(async () => {
  setZarinpal(null);
  emails.stop();
  await closeDatabase();
  await stopTestServer();
});

// ----------------------------------------------------------------- arrange

type Buyer = Awaited<ReturnType<typeof signedInCustomer>>;

/** Order, pay with Zarinpal, come back. */
const pay = async (buyer: Buyer, body: Record<string, unknown>) => {
  const order = await buyer.client.post(`${SHOP}/orders`, body, { headers: { "idempotency-key": randomUUID() } });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  await buyer.client.post(`${SHOP}/orders/${order.data.id}/pay/zarinpal`);
  gateway.pay(gateway.lastAuthority);
  await fetch(`${getBaseUrl()}/api/v1/payments/zarinpal/callback?Authority=${gateway.lastAuthority}&Status=OK`, {
    redirect: "manual",
  });
  return order.data.id as string;
};

/** A customer with a live service (50 GB, 30 days, on the fake panel). */
const aCustomerWithService = async (store: Store) => {
  const buyer = await signedInCustomer(emails);
  const orderId = await pay(buyer, { planId: store.planId });
  const [order] = await database().select().from(orders).where(eq(orders.id, orderId));
  await provisionSubscription(database(), order!.subscriptionId!);
  return { buyer, subscriptionId: order!.subscriptionId! };
};

const renew = async (buyer: Buyer, subscriptionId: string, planId: string) => {
  const orderId = await pay(buyer, { planId, renewSubscriptionId: subscriptionId });
  return orderId;
};

const row = async (id: string) => (await database().select().from(subscriptions).where(eq(subscriptions.id, id)))[0]!;

const aUser = (overrides: Partial<PanelUser>): PanelUser => ({
  id: 1,
  username: "sk_x",
  status: "active",
  dataLimitBytes: 50 * GB,
  usedBytes: 30 * GB,
  lifetimeUsedBytes: 30 * GB,
  expiresAt: new Date("2026-10-10T00:00:00Z"),
  onHoldDurationSeconds: null,
  deviceLimit: 2,
  groupIds: [2],
  onlineAt: null,
  subscriptionUrl: "https://panel.test/sub/x",
  ...overrides,
});

const plan50x30 = {
  id: "p",
  slug: "m",
  name: "ماهانه",
  description: "",
  dataLimitBytes: 50 * GB,
  durationDays: 30,
  deviceLimit: 3,
  priceToman: 150_000,
};

// ------------------------------------------------------------------- rule

describe("What a renewal adds", () => {
  const now = new Date("2026-09-30T00:00:00Z");

  it("When 10 days and 20 GB are left, then the days go on the current expiry and the volume on what is left", () => {
    const target = renewalTarget(aUser({}), plan50x30, now);

    assert.equal(target.expiresAt, new Date("2026-11-09T00:00:00Z").toISOString(), "10 Oct + 30 days");
    // used 30 + left 20 + plan 50: 70 GB still to use
    assert.equal(target.dataLimitBytes, 100 * GB);
    assert.equal(target.deviceLimit, 3, "the new plan's device limit");
    assert.equal(target.activate, true);
  });

  it("When the volume ran out but days are left, then the plan's volume is added to nothing left", () => {
    const target = renewalTarget(aUser({ status: "limited", usedBytes: 50 * GB }), plan50x30, now);

    assert.equal(target.dataLimitBytes, 100 * GB);
    assert.equal(target.expiresAt, new Date("2026-11-09T00:00:00Z").toISOString());
  });

  it("When it has expired, then it starts again from today with the plan's volume", () => {
    const target = renewalTarget(aUser({ status: "expired", expiresAt: new Date("2026-09-20T00:00:00Z") }), plan50x30, now);

    assert.equal(target.expiresAt, new Date(now.getTime() + 30 * DAY).toISOString());
    assert.equal(target.dataLimitBytes, 30 * GB + 50 * GB, "unused volume of an expired period is not carried");
  });

  it("When it has not been used yet (on hold), then the days are added to the time that starts at first use", () => {
    const target = renewalTarget(
      aUser({ status: "on_hold", expiresAt: null, usedBytes: 0, onHoldDurationSeconds: 30 * 86400 }),
      plan50x30,
      now,
    );

    assert.equal(target.onHoldDurationSeconds, 60 * 86400);
    assert.equal(target.dataLimitBytes, 100 * GB);
    assert.equal(target.expiresAt, undefined);
    assert.equal(target.activate, false);
  });

  it("When the new plan is unlimited, then the renewed service is unlimited", () => {
    assert.equal(renewalTarget(aUser({}), { ...plan50x30, dataLimitBytes: null }, now).dataLimitBytes, null);
  });
});

// -------------------------------------------------------------- renewing

describe("Renewing", () => {
  it("[acceptance] When a customer renews, then their link does not change; only the date and volume do", async () => {
    const store = await aStore();
    const { buyer, subscriptionId } = await aCustomerWithService(store);
    const username = panelUsernameFor(subscriptionId);
    store.fake.use(username, 10 * GB); // starts the clock: 30 days, 40 GB left
    // A few minutes later the customer opens their panel, which reads it.
    await database().update(subscriptions).set({ lastSyncedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(subscriptions.id, subscriptionId));
    const before = (await buyer.client.get(`${SHOP}/subscriptions`)).data[0];
    const expiryBefore = Date.parse(before.expiresAt);

    const orderId = await renew(buyer, subscriptionId, store.planId);
    assert.equal((await buyer.client.get(`${SHOP}/orders/${orderId}`)).data.status, "paid", "applied by the worker");
    await runRenewalJob(database(), { data: { aggregateId: orderId }, attemptsMade: 0, opts: { attempts: 12 } });

    const renewed = (await buyer.client.get(`${SHOP}/subscriptions`)).data[0];
    assert.equal(renewed.id, before.id);
    assert.equal(renewed.link, before.link, "the same link");
    assert.equal(Date.parse(renewed.expiresAt) - expiryBefore, 30 * DAY, "30 more days");
    assert.equal(renewed.remainingBytes, 90 * GB, "40 left + 50 bought");
    assert.equal(store.fake.users.size, 1, "the same panel user, no new one");
    assert.equal((await buyer.client.get(`${SHOP}/orders/${orderId}`)).data.status, "fulfilled");
    const kinds = (await database().select().from(subscriptionEvents).where(eq(subscriptionEvents.subscriptionId, subscriptionId))).map((e) => e.kind);
    assert.ok(kinds.includes("renewed"));
  });

  it("When the panel took the renewal but its answer was lost, then the retry does not add it twice", async () => {
    const store = await aStore();
    const { buyer, subscriptionId } = await aCustomerWithService(store);
    const orderId = await renew(buyer, subscriptionId, store.planId);
    const limitBefore = store.fake.users.get(panelUsernameFor(subscriptionId))!.dataLimitBytes!;
    // The first attempt reaches the panel, then the connection drops.
    const realUpdate = store.fake.updateLimits.bind(store.fake);
    let dropped = false;
    store.fake.updateLimits = async (username, change) => {
      const result = await realUpdate(username, change);
      if (!dropped) {
        dropped = true;
        throw new Error("connection reset");
      }
      return result;
    };

    await assert.rejects(runRenewalJob(database(), { data: { aggregateId: orderId }, attemptsMade: 0, opts: { attempts: 12 } }));
    await runRenewalJob(database(), { data: { aggregateId: orderId }, attemptsMade: 1, opts: { attempts: 12 } });

    assert.equal(store.fake.users.get(panelUsernameFor(subscriptionId))!.dataLimitBytes, limitBefore + 50 * GB, "added once");
    assert.equal((await row(subscriptionId)).dataLimitBytes, limitBefore + 50 * GB);
  });

  it("When the panel is down, then the order stays paid, staff are told, and it applies once the panel is back", async () => {
    const store = await aStore();
    const { buyer, subscriptionId } = await aCustomerWithService(store);
    const orderId = await renew(buyer, subscriptionId, store.planId);
    store.fake.down = true;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await assert.rejects(runRenewalJob(database(), { data: { aggregateId: orderId }, attemptsMade: attempt, opts: { attempts: 12 } }));
    }
    const alerts = await database().select().from(outboxEvents).where(eq(outboxEvents.aggregateId, orderId));
    assert.equal(alerts.filter((event) => event.topic === "admin.alert").length, 1);
    assert.equal((await buyer.client.get(`${SHOP}/orders/${orderId}`)).data.status, "paid");

    store.fake.down = false;
    await runRenewalJob(database(), { data: { aggregateId: orderId }, attemptsMade: 6, opts: { attempts: 12 } });
    assert.equal((await buyer.client.get(`${SHOP}/orders/${orderId}`)).data.status, "fulfilled");
  });

  it("When renewing with another plan on sale, then the service takes that plan's device limit", async () => {
    const store = await aStore();
    const staff = await owner();
    const bigger = await staff.client.post("/api/v1/staff/plans", {
      slug: `family-${randomBytes(3).toString("hex")}`,
      name: "خانوادگی",
      dataLimitGb: 100,
      durationDays: 30,
      deviceLimit: 5,
      priceToman: 250_000,
      panels: [{ panelId: store.panelId, groupIds: [] }],
    });
    const { buyer, subscriptionId } = await aCustomerWithService(store);

    const orderId = await renew(buyer, subscriptionId, bigger.data.id);
    await runRenewalJob(database(), { data: { aggregateId: orderId }, attemptsMade: 0, opts: { attempts: 12 } });

    const renewed = await row(subscriptionId);
    assert.equal(renewed.deviceLimit, 5);
    assert.equal(renewed.planId, bigger.data.id);
  });

  it("When the subscription is not renewable or not theirs, then the order is refused before paying", async () => {
    const store = await aStore();
    const { buyer, subscriptionId } = await aCustomerWithService(store);
    const stranger = await signedInCustomer(emails);

    const notTheirs = await stranger.client.post(`${SHOP}/orders`, { planId: store.planId, renewSubscriptionId: subscriptionId });
    assert.equal(notTheirs.status, 404);

    await database().update(subscriptions).set({ status: "deleted" }).where(eq(subscriptions.id, subscriptionId));
    const deleted = await buyer.client.post(`${SHOP}/orders`, { planId: store.planId, renewSubscriptionId: subscriptionId });
    assert.equal(deleted.status, 409);
    assert.equal(deleted.data.error.code, "NOT_RENEWABLE");
  });

  it("When the plan is not sold on the subscription's panel, then renewing with it is refused", async () => {
    const store = await aStore();
    const other = await aStore();
    const { buyer, subscriptionId } = await aCustomerWithService(store);

    const response = await buyer.client.post(`${SHOP}/orders`, { planId: other.planId, renewSubscriptionId: subscriptionId });

    assert.equal(response.status, 409);
    assert.equal(response.data.error.code, "PLAN_NOT_ON_SALE");
  });
});

// ------------------------------------------------------------- my services

describe("My services", () => {
  it("When a customer opens their panel, then usage is read from the panel right then", async () => {
    const store = await aStore();
    const { buyer, subscriptionId } = await aCustomerWithService(store);
    store.fake.use(panelUsernameFor(subscriptionId), 3 * GB);
    await database().update(subscriptions).set({ lastSyncedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(subscriptions.id, subscriptionId));

    const [mine] = (await buyer.client.get(`${SHOP}/subscriptions`)).data;

    assert.equal(mine.usedBytes, 3 * GB);
    assert.equal(mine.remainingBytes, 47 * GB);
    assert.equal(mine.status, "active");
    assert.ok(mine.expiresAt);
    assert.match(mine.link, /\/s\//);
    assert.equal(mine.renewable, true);
  });

  it("When the service has not been used yet, then it shows the days that start at first use", async () => {
    const store = await aStore();
    const { buyer } = await aCustomerWithService(store);

    const [mine] = (await buyer.client.get(`${SHOP}/subscriptions`)).data;

    assert.equal(mine.status, "on_hold");
    assert.equal(mine.expiresAt, null);
    assert.equal(mine.daysOnHold, 30);
  });

  it("When the panel is down, then the page still answers, with the last usage read", async () => {
    const store = await aStore();
    const { buyer, subscriptionId } = await aCustomerWithService(store);
    store.fake.down = true;
    await database().update(subscriptions).set({ lastSyncedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(subscriptions.id, subscriptionId));

    const response = await buyer.client.get(`${SHOP}/subscriptions`);

    assert.equal(response.status, 200);
    assert.equal(response.data.length, 1);
  });
});

// ------------------------------------------------------ invoices, profile

describe("Invoices and the account", () => {
  it("When an order is paid, then its invoice lists the plan, the total and the payment reference", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    await buyer.client.put("/api/v1/auth/profile", { displayName: "علی رضایی" });
    const orderId = await pay(buyer, { planId: store.planId });

    const invoice = (await buyer.client.get(`${SHOP}/orders/${orderId}/invoice`)).data;

    assert.equal(invoice.totalToman, 150_000);
    assert.equal(invoice.lines[0].description, "ماهانه ۵۰ گیگ");
    assert.equal(invoice.customer.displayName, "علی رضایی");
    assert.equal(invoice.payment.method, "zarinpal");
    assert.ok(invoice.payment.refId);
  });

  it("When an order is not paid, then there is no invoice yet; and nobody else's invoice is visible", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await buyer.client.post(`${SHOP}/orders`, { planId: store.planId });
    const paidId = await pay(buyer, { planId: store.planId });
    const stranger = await signedInCustomer(emails);

    assert.equal((await buyer.client.get(`${SHOP}/orders/${order.data.id}/invoice`)).status, 404);
    assert.equal((await stranger.client.get(`${SHOP}/orders/${paidId}/invoice`)).status, 404);
  });

  it("When a name is too long, then it is refused", async () => {
    const buyer = await signedInCustomer(emails);

    const response = await buyer.client.put("/api/v1/auth/profile", { displayName: "ا".repeat(61) });

    assert.equal(response.status, 400);
  });
});
