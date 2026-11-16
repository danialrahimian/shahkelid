import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { expireLapsedOrders } from "../src/modules/billing/orders";
import { orders, payments } from "../src/modules/billing/schema";
import { runProvisionJob, runRenewalJob } from "../src/modules/provisioning/worker";
import { provisionSubscription } from "../src/modules/provisioning/provision";
import { subscriptions } from "../src/modules/subscriptions/schema";
import { outboxEvents } from "../src/platform/db/platform-schema";
import { captureEmails, closeDatabase, database, signedInCustomer, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, installFakePanels, owner, type Store } from "./helpers/store";
import { getBaseUrl, startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * Every state a payment and its order can be in, and what the buyer's order
 * page is told in each; and the panel connection staff set up first.
 *
 * Written after a card-to-card order was approved and its page said "being
 * prepared" for ever: a paid order whose service cannot be made must say so
 * (the order view's subscription status), not leave the page spinning.
 */

const SHOP = "/api/v1/shop";
const STAFF = "/api/v1/staff";
const PRICE = 150_000;
let emails: ReturnType<typeof captureEmails>;

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  emails = captureEmails();
  installFakePanels();
});

after(async () => {
  emails.stop();
  await closeDatabase();
  await stopTestServer();
});

// ----------------------------------------------------------------- arrange

type Buyer = Awaited<ReturnType<typeof signedInCustomer>>;

const anOrder = async (buyer: Buyer, planId: string) => {
  const response = await buyer.client.post(`${SHOP}/orders`, { planId }, { headers: { "idempotency-key": randomUUID() } });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data as { id: string; number: number; status: string; totalToman: number };
};

const orderRow = async (id: string) => (await database().select().from(orders).where(eq(orders.id, id)))[0]!;
const paymentsOf = async (orderId: string) => database().select().from(payments).where(eq(payments.orderId, orderId));
const subscriptionsOf = async (userId: string) =>
  database().select().from(subscriptions).where(eq(subscriptions.userId, userId));

const aReceiptImage = () =>
  new Blob(
    [
      Buffer.concat([
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        ),
        randomBytes(8),
      ]),
    ],
    { type: "image/png" },
  );

let cardId: string | undefined;
const aCard = async () => {
  if (cardId) return cardId;
  const staff = await owner();
  const card = await staff.client.post(`${STAFF}/payment-cards`, {
    label: "ملت",
    bankName: "بانک ملت",
    cardNumber: "6104337812345678",
    holderName: "شاه‌کلید",
  });
  assert.equal(card.status, 201, JSON.stringify(card.data));
  cardId = card.data.id as string;
  return cardId;
};

const sendReceipt = async (buyer: Buyer, orderId: string) => {
  const form = new FormData();
  form.set("destinationCardId", await aCard());
  form.set("trackingNumber", `${Date.now()}${randomBytes(2).readUInt16BE()}`);
  form.set("claimedAmountToman", String(PRICE));
  form.set("payerCardLast4", "1234");
  form.set("receipt", aReceiptImage(), "receipt.png");
  return buyer.client.post(`${SHOP}/orders/${orderId}/pay/card`, form);
};

/** An order paid by card and waiting for review; returns the payment to review. */
const aReceiptWaiting = async (store: Store) => {
  const buyer = await signedInCustomer(emails);
  const order = await anOrder(buyer, store.planId);
  const sent = await sendReceipt(buyer, order.id);
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  const [payment] = await paymentsOf(order.id);
  return { buyer, order, paymentId: payment!.id };
};

const review = async (paymentId: string, decision: "approve" | "reject", note?: string) => {
  const accountant = await signedInStaff(["accountant"]);
  return accountant.client.post(`${STAFF}/receipts/${paymentId}/review`, { decision, ...(note ? { note } : {}) });
};

/** What the buyer's order page reads. */
const pageOf = async (buyer: Buyer, orderId: string) => {
  const view = await buyer.client.get(`${SHOP}/orders/${orderId}`);
  assert.equal(view.status, 200, JSON.stringify(view.data));
  return view.data as {
    status: string;
    payment: { status: string; failureReason: string | null } | null;
    subscription: { status: string; link: string | null } | null;
  };
};

/** The provisioning job the worker would run for this order's subscription. */
/** A customer with a service on the panel, bought and paid by card. */
const aCustomerWithService = async (store: Store) => {
  const { buyer, order, paymentId } = await aReceiptWaiting(store);
  await review(paymentId, "approve");
  await provisionFor(order.id);
  const { subscriptionId } = await orderRow(order.id);
  return { buyer, subscriptionId: subscriptionId! };
};

/** The staff alerts recorded about an order. */
const alertsAbout = async (orderId: string) =>
  (
    await database()
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.topic, "admin.alert"), eq(outboxEvents.aggregateId, orderId)))
  ).map((event) => event.payload as { subject: string; text: string });

const provisionFor = async (orderId: string, attemptsMade = 0) => {
  const { subscriptionId } = await orderRow(orderId);
  assert.ok(subscriptionId, "the order has a subscription");
  return runProvisionJob(database(), { data: { aggregateId: subscriptionId }, attemptsMade, opts: { attempts: 12 } });
};

// ------------------------------------------------------------------ panels

describe("The panel connection", () => {
  it("When staff check a healthy panel, then its version and last good check are recorded", async () => {
    const store = await aStore();

    const checked = await store.staff.client.post(`${STAFF}/panels/${store.panelId}/check`);

    assert.equal(checked.status, 200, JSON.stringify(checked.data));
    assert.equal(checked.data.version, "5.4.1-fake");
    assert.ok(checked.data.lastOkAt);
    assert.equal(checked.data.lastError, null);
  });

  it("When the panel is down at a check, then it says unreachable and the list shows why", async () => {
    const store = await aStore();
    store.fake.down = true;

    const checked = await store.staff.client.post(`${STAFF}/panels/${store.panelId}/check`);

    assert.equal(checked.status, 503);
    assert.equal(checked.data.error.code, "PANEL_UNREACHABLE");
    const listed = (await store.staff.client.get(`${STAFF}/panels`)).data.find((p: { id: string }) => p.id === store.panelId);
    assert.match(listed.lastError, /down/);

    store.fake.down = false;
    const again = await store.staff.client.post(`${STAFF}/panels/${store.panelId}/check`);
    assert.equal(again.data.lastError, null, "a good check clears the old error");
  });

  it("When the panel refuses the account at a check, then it says rejected", async () => {
    const store = await aStore();
    store.fake.refuse = true;

    const checked = await store.staff.client.post(`${STAFF}/panels/${store.panelId}/check`);

    assert.equal(checked.status, 502);
    assert.equal(checked.data.error.code, "PANEL_REJECTED");
  });

  it("When only the name changes, then the panel is not asked and the saved account is kept", async () => {
    const store = await aStore();
    const [panel] = (await store.staff.client.get(`${STAFF}/panels`)).data.filter((p: { id: string }) => p.id === store.panelId);
    store.fake.down = true;

    const saved = await store.staff.client.put(`${STAFF}/panels/${store.panelId}`, {
      name: "Renamed",
      driver: "pasarguard",
      baseUrl: panel.baseUrl,
      isActive: true,
    });

    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.name, "Renamed");
    assert.deepEqual(saved.data.credentials, { kind: "password", username: "operator" });
    assert.equal(JSON.stringify(saved.data).includes("right"), false, "the password is never shown");
  });

  it("When new credentials are wrong, then nothing is saved and the old account stays", async () => {
    const store = await aStore();
    const [panel] = (await store.staff.client.get(`${STAFF}/panels`)).data.filter((p: { id: string }) => p.id === store.panelId);

    const saved = await store.staff.client.put(`${STAFF}/panels/${store.panelId}`, {
      name: panel.name,
      driver: "pasarguard",
      baseUrl: panel.baseUrl,
      isActive: true,
      credentials: { kind: "password", username: "someone", password: "wrong" },
    });

    assert.equal(saved.status, 502);
    const [now] = (await store.staff.client.get(`${STAFF}/panels`)).data.filter((p: { id: string }) => p.id === store.panelId);
    assert.deepEqual(now.credentials, { kind: "password", username: "operator" });
  });

  it("When a panel is switched off, then nothing new is sold on it", async () => {
    const store = await aStore();
    const [panel] = (await store.staff.client.get(`${STAFF}/panels`)).data.filter((p: { id: string }) => p.id === store.panelId);
    await store.staff.client.put(`${STAFF}/panels/${store.panelId}`, {
      name: panel.name,
      driver: "pasarguard",
      baseUrl: panel.baseUrl,
      isActive: false,
    });
    const buyer = await signedInCustomer(emails);

    const made = await store.staff.client.post(`${STAFF}/subscriptions`, { userId: buyer.id, planId: store.planId });

    assert.equal(made.status, 409);
    assert.equal(made.data.error.code, "NO_SERVER_AVAILABLE");
  });
});

// ------------------------------------------------- card to card, each state

describe("A card-to-card payment, state by state", () => {
  it("When a receipt is sent, then the payment waits for review and the order stays payable by nothing else", async () => {
    const store = await aStore();
    const { buyer, order } = await aReceiptWaiting(store);

    const page = await pageOf(buyer, order.id);
    assert.equal(page.status, "pending");
    assert.equal(page.payment?.status, "pending_review");

    const second = await sendReceipt(buyer, order.id);
    assert.equal(second.status, 409, "one receipt at a time");
    assert.equal(second.data.error.code, "ORDER_NOT_PAYABLE");
  });

  it("When approved, then the order is paid and fulfilled, and the page shows the link once the worker has run", async () => {
    const store = await aStore();
    const { buyer, order, paymentId } = await aReceiptWaiting(store);

    assert.equal((await review(paymentId, "approve")).status, 200);
    const before = await pageOf(buyer, order.id);
    assert.equal(before.status, "fulfilled");
    assert.equal(before.payment?.status, "succeeded");
    assert.equal(before.subscription?.status, "provisioning");
    assert.equal(before.subscription?.link, null, "being prepared");

    assert.equal(await provisionFor(order.id), "provisioned");
    const ready = await pageOf(buyer, order.id);
    assert.equal(ready.subscription?.status, "on_hold");
    assert.match(ready.subscription?.link ?? "", /\/s\//);
  });

  it("When two accountants approve at the same moment, then one wins and there is one subscription", async () => {
    const store = await aStore();
    const { buyer, order, paymentId } = await aReceiptWaiting(store);

    const results = await Promise.all([review(paymentId, "approve"), review(paymentId, "approve")]);

    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await subscriptionsOf(buyer.id)).length, 1);
    assert.equal((await paymentsOf(order.id)).filter((p) => p.status === "succeeded").length, 1);
  });

  it("When rejected, then it cannot be approved afterwards, and a new receipt can be", async () => {
    const store = await aStore();
    const { buyer, order, paymentId } = await aReceiptWaiting(store);

    assert.equal((await review(paymentId, "reject", "واریزی دیده نشد")).status, 200);
    const page = await pageOf(buyer, order.id);
    assert.equal(page.status, "pending");
    assert.equal(page.payment?.status, "failed");
    assert.equal(page.payment?.failureReason, "واریزی دیده نشد");

    const late = await review(paymentId, "approve");
    assert.equal(late.status, 409);
    assert.equal(late.data.error.code, "ALREADY_REVIEWED");

    const again = await sendReceipt(buyer, order.id);
    assert.equal(again.status, 201, JSON.stringify(again.data));
    const [, retry] = (await paymentsOf(order.id)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    assert.equal((await review(retry!.id, "approve")).status, 200);
    assert.equal((await orderRow(order.id)).status, "fulfilled");
  });

  it("When approved, then rejecting it afterwards is refused", async () => {
    const store = await aStore();
    const { paymentId } = await aReceiptWaiting(store);
    await review(paymentId, "approve");

    const late = await review(paymentId, "reject", "اشتباه شد");

    assert.equal(late.status, 409);
    assert.equal(late.data.error.code, "ALREADY_REVIEWED");
  });

  it("When an order is paid, then no further receipt is taken for it", async () => {
    const store = await aStore();
    const { buyer, order, paymentId } = await aReceiptWaiting(store);
    await review(paymentId, "approve");

    const another = await sendReceipt(buyer, order.id);

    assert.equal(another.status, 409);
    assert.equal(another.data.error.code, "ORDER_NOT_PAYABLE");
  });
});

// ----------------------------------------- paid, but the service is not made

describe("Paid, but the service cannot be made yet", () => {
  it("When the panel refuses to make the user, then the page says the subscription failed, and a staff retry makes it", async () => {
    const store = await aStore();
    const { buyer, order, paymentId } = await aReceiptWaiting(store);
    await review(paymentId, "approve");
    store.fake.refuse = true;

    await assert.rejects(provisionFor(order.id), { name: "UnrecoverableError" });

    const stuck = await pageOf(buyer, order.id);
    assert.equal(stuck.status, "fulfilled", "the money is kept");
    assert.equal(stuck.subscription?.status, "provisioning_failed", "the page can tell it is stuck");
    assert.equal(stuck.subscription?.link, null);

    store.fake.refuse = false;
    const { subscriptionId } = await orderRow(order.id);
    const retried = await store.staff.client.post(`${STAFF}/subscriptions/${subscriptionId}/actions/retry`);
    assert.equal(retried.status, 200, JSON.stringify(retried.data));
    await provisionSubscription(database(), subscriptionId!);
    assert.match((await pageOf(buyer, order.id)).subscription?.link ?? "", /\/s\//);
  });

  it("When the panel is down, then the page keeps saying 'being prepared' while the attempts go on", async () => {
    const store = await aStore();
    const { buyer, order, paymentId } = await aReceiptWaiting(store);
    await review(paymentId, "approve");
    store.fake.down = true;

    await assert.rejects(provisionFor(order.id, 0));

    const page = await pageOf(buyer, order.id);
    assert.equal(page.subscription?.status, "provisioning");
    const [row] = await subscriptionsOf(buyer.id);
    assert.match(row!.lastError ?? "", /down/, "staff can see why");

    store.fake.down = false;
    assert.equal(await provisionFor(order.id, 1), "provisioned");
  });

  it("When the receipt is approved but no server has room, then the order is paid without a subscription until staff make it", async () => {
    const store = await aStore({ servers: [{ capacity: 1, priority: 0 }] });
    const first = await aReceiptWaiting(store);
    await review(first.paymentId, "approve");
    const { buyer, order, paymentId } = await aReceiptWaiting(store);

    assert.equal((await review(paymentId, "approve")).status, 200, "the money is accepted all the same");

    const page = await pageOf(buyer, order.id);
    assert.equal(page.status, "paid");
    assert.equal(page.subscription, null, "the page can tell it is waiting for staff");
    const [alert] = await alertsAbout(order.id);
    assert.equal(alert?.subject, "Order paid, but its service was not made");
    assert.match(alert!.text, /full \(customers\/capacity: 1\/1\)/, "says which servers and how full");

    const [server] = (await store.staff.client.get(`${STAFF}/servers`)).data.filter((s: { id: string }) => s.id === store.serverIds[0]);
    await store.staff.client.put(`${STAFF}/servers/${server.id}`, { ...server, capacityUsers: 2 });
    assert.equal((await store.staff.client.post(`${STAFF}/orders/${order.id}/fulfil`)).status, 200);
    assert.equal((await pageOf(buyer, order.id)).subscription?.status, "provisioning");
  });

  it("When the plan's panel is switched off, then the alert says so instead of 'no room'", async () => {
    const store = await aStore();
    const { buyer, order, paymentId } = await aReceiptWaiting(store);
    const [panel] = (await store.staff.client.get(`${STAFF}/panels`)).data.filter((p: { id: string }) => p.id === store.panelId);
    await store.staff.client.put(`${STAFF}/panels/${store.panelId}`, {
      name: panel.name,
      driver: "pasarguard",
      baseUrl: panel.baseUrl,
      isActive: false,
    });

    await review(paymentId, "approve");

    assert.equal((await pageOf(buyer, order.id)).status, "paid");
    const [alert] = await alertsAbout(order.id);
    assert.match(alert!.text, /panel is switched off/);
  });

  it("When staff press 'Make subscription' before fixing the cause, then they are told exactly why, and it works once fixed", async () => {
    const store = await aStore();
    const { buyer, order, paymentId } = await aReceiptWaiting(store);
    const [panel] = (await store.staff.client.get(`${STAFF}/panels`)).data.filter((p: { id: string }) => p.id === store.panelId);
    const setPanel = (isActive: boolean) =>
      store.staff.client.put(`${STAFF}/panels/${store.panelId}`, { name: panel.name, driver: "pasarguard", baseUrl: panel.baseUrl, isActive });
    await setPanel(false);
    await review(paymentId, "approve");

    const waiting = (await store.staff.client.get(`${STAFF}/orders?status=paid`)).data as { id: string }[];
    assert.ok(waiting.some((row) => row.id === order.id), "listed among the paid orders waiting for a service");

    const early = await store.staff.client.post(`${STAFF}/orders/${order.id}/fulfil`);
    assert.equal(early.status, 409);
    assert.equal(early.data.error.code, "NO_SERVER_AVAILABLE");
    assert.match(early.data.error.message, /panel is switched off/);

    await setPanel(true);
    const made = await store.staff.client.post(`${STAFF}/orders/${order.id}/fulfil`);
    assert.equal(made.status, 200, JSON.stringify(made.data));
    assert.equal(made.data.status, "fulfilled");
    assert.equal((await pageOf(buyer, order.id)).subscription?.status, "provisioning");
  });

  it("When the plan's servers are archived, then the alert says the panel has no server", async () => {
    const store = await aStore();
    const { order, paymentId } = await aReceiptWaiting(store);
    const archived = await store.staff.client.post(`${STAFF}/servers/${store.serverIds[0]}/archive`);
    assert.equal(archived.status, 200, JSON.stringify(archived.data));

    await review(paymentId, "approve");

    const [alert] = await alertsAbout(order.id);
    assert.match(alert!.text, /has no server/);
  });
});

// ------------------------------------------------------ free and lapsed

describe("Orders with nothing to pay, and orders left unpaid", () => {
  it("When the plan is free, then the order is paid and fulfilled at once, with no payment", async () => {
    const store = await aStore();
    const free = await store.staff.client.post(`${STAFF}/plans`, {
      slug: `free-${randomBytes(3).toString("hex")}`,
      name: "آزمایشی رایگان",
      dataLimitGb: 1,
      durationDays: 1,
      deviceLimit: 1,
      priceToman: 0,
      panels: [{ panelId: store.panelId, groupIds: [] }],
    });
    assert.equal(free.status, 201, JSON.stringify(free.data));
    const buyer = await signedInCustomer(emails);

    const order = await anOrder(buyer, free.data.id);

    assert.equal(order.status, "fulfilled");
    assert.equal((await paymentsOf(order.id)).length, 0);
    assert.equal((await subscriptionsOf(buyer.id)).length, 1);
  });

  it("When an order lapses unpaid, then it and its unfinished payment expire, and it cannot be paid", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store.planId);
    await database().insert(payments).values({
      orderId: order.id,
      userId: buyer.id,
      method: "zarinpal",
      status: "initiated",
      amountToman: PRICE,
    });
    await database().update(orders).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, order.id));

    assert.ok((await expireLapsedOrders(database())) >= 1);

    const page = await pageOf(buyer, order.id);
    assert.equal(page.status, "expired");
    assert.equal(page.payment?.status, "expired");
    const late = await sendReceipt(buyer, order.id);
    assert.equal(late.status, 409);
    assert.equal(late.data.error.code, "ORDER_NOT_PAYABLE");
  });

  it("When an order has a receipt waiting, then it does not lapse however late it is", async () => {
    const store = await aStore();
    const { order } = await aReceiptWaiting(store);
    await database().update(orders).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, order.id));

    await expireLapsedOrders(database());

    assert.equal((await orderRow(order.id)).status, "pending");
    const [payment] = await database()
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.status, "pending_review")));
    assert.ok(payment, "the receipt still waits for review");
  });
});

// ------------------------------------------------------- renewing, deleting

describe("Renewing and deleting a service", () => {
  it("When a renewal is paid by card, then the order waits for the panel, and is done once the worker applies it", async () => {
    const store = await aStore();
    const { buyer, subscriptionId } = await aCustomerWithService(store);
    const response = await buyer.client.post(
      `${SHOP}/orders`,
      { planId: store.planId, renewSubscriptionId: subscriptionId },
      { headers: { "idempotency-key": randomUUID() } },
    );
    assert.equal(response.status, 201, JSON.stringify(response.data));
    const renewal = response.data as { id: string };
    const sent = await sendReceipt(buyer, renewal.id);
    assert.equal(sent.status, 201, JSON.stringify(sent.data));
    const [payment] = await paymentsOf(renewal.id);

    assert.equal((await review(payment!.id, "approve")).status, 200);
    assert.equal((await pageOf(buyer, renewal.id)).status, "paid", "until the panel has it");

    await runRenewalJob(database(), { data: { aggregateId: renewal.id }, attemptsMade: 0, opts: { attempts: 12 } });
    const done = await pageOf(buyer, renewal.id);
    assert.equal(done.status, "fulfilled");
    assert.equal((await subscriptionsOf(buyer.id)).length, 1, "the same service, renewed");
  });

  it("When the panel refuses a paid renewal, then the order stays paid for staff to apply", async () => {
    const store = await aStore();
    const { buyer, subscriptionId } = await aCustomerWithService(store);
    const response = await buyer.client.post(
      `${SHOP}/orders`,
      { planId: store.planId, renewSubscriptionId: subscriptionId },
      { headers: { "idempotency-key": randomUUID() } },
    );
    const renewal = response.data as { id: string };
    await sendReceipt(buyer, renewal.id);
    const [payment] = await paymentsOf(renewal.id);
    await review(payment!.id, "approve");
    store.fake.refuse = true;

    await assert.rejects(
      runRenewalJob(database(), { data: { aggregateId: renewal.id }, attemptsMade: 0, opts: { attempts: 12 } }),
      { name: "UnrecoverableError" },
    );

    assert.equal((await orderRow(renewal.id)).status, "paid", "the money is kept");
    store.fake.refuse = false;
    const again = await store.staff.client.post(`${STAFF}/orders/${renewal.id}/fulfil`);
    assert.equal(again.status, 200, JSON.stringify(again.data));
  });

  it("When staff delete a service, then it leaves the panel, its link stops, and it cannot be renewed", async () => {
    const store = await aStore();
    const { buyer, subscriptionId } = await aCustomerWithService(store);
    const [row] = await subscriptionsOf(buyer.id);

    const deleted = await store.staff.client.post(`${STAFF}/subscriptions/${subscriptionId}/actions/delete`);

    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.equal(deleted.data.status, "deleted");
    assert.equal(store.fake.users.has(row!.panelUsername), false, "gone from the panel");
    const link = await fetch(`${getBaseUrl()}/s/${row!.accessToken}`);
    assert.equal(link.status, 404);
    const renew = await buyer.client.post(
      `${SHOP}/orders`,
      { planId: store.planId, renewSubscriptionId: subscriptionId },
      { headers: { "idempotency-key": randomUUID() } },
    );
    assert.equal(renew.status, 409, JSON.stringify(renew.data));
  });

  it("When the panel is down at a delete, then nothing changes here", async () => {
    const store = await aStore();
    const { subscriptionId } = await aCustomerWithService(store);
    store.fake.down = true;

    const deleted = await store.staff.client.post(`${STAFF}/subscriptions/${subscriptionId}/actions/delete`);

    assert.equal(deleted.status, 503);
    const [row] = await database().select().from(subscriptions).where(eq(subscriptions.id, subscriptionId));
    assert.equal(row!.status, "on_hold");
  });
});
