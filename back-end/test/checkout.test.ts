import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import config from "../src/config";
import { invoices, orders, payments } from "../src/modules/billing/schema";
import { billingTick } from "../src/modules/billing/worker";
import { setZarinpal } from "../src/modules/billing/zarinpal";
import { balanceOf } from "../src/modules/ledger/ledger";
import { ledgerTransactions } from "../src/modules/ledger/schema";
import { deliverAlert, setTelegramSender } from "../src/modules/notifications/alerts";
import { provisionSubscription } from "../src/modules/provisioning/provision";
import { runProvisionJob } from "../src/modules/provisioning/worker";
import { subscriptions } from "../src/modules/subscriptions/schema";
import { outboxEvents } from "../src/platform/db/platform-schema";
import { createClient } from "./helpers/api-client";
import { captureEmails, closeDatabase, database, signedInCustomer, signedInStaff } from "./helpers/accounts";
import { FakeZarinpal } from "./helpers/fake-zarinpal";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, installFakePanels, owner, type Store } from "./helpers/store";
import { getBaseUrl, startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * Buying and paying: /api/v1/shop, the Zarinpal callback, card-to-card
 * review, and what happens to the money and the service when things fail.
 *
 * Zarinpal and the panel are fakes that behave as the real ones were seen
 * to (test/zarinpal.contract.test.ts, test/pasarguard.contract.test.ts).
 */

const SHOP = "/api/v1/shop";
const STAFF = "/api/v1/staff";
const PRICE = 150_000;
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

const anOrder = async (buyer: Buyer, store: Store, key = randomUUID()) => {
  const response = await buyer.client.post(`${SHOP}/orders`, { planId: store.planId }, { headers: { "idempotency-key": key } });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data as { id: string; number: number; status: string; totalToman: number };
};

/** Zarinpal sends the customer's browser back; we follow no further than our redirect. */
const zarinpalReturns = async (authority: string, status: "OK" | "NOK") =>
  fetch(`${getBaseUrl()}/api/v1/payments/zarinpal/callback?Authority=${authority}&Status=${status}`, {
    redirect: "manual",
  });

/** Order, Zarinpal, pay at the bank, come back. */
const buyWithZarinpal = async (buyer: Buyer, store: Store) => {
  const order = await anOrder(buyer, store);
  const started = await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`);
  assert.equal(started.status, 200, JSON.stringify(started.data));
  const authority = gateway.lastAuthority;
  gateway.pay(authority);
  const back = await zarinpalReturns(authority, "OK");
  return { order, authority, back };
};

const orderRow = async (id: string) => (await database().select().from(orders).where(eq(orders.id, id)))[0]!;

const alertsAbout = async (id: string) =>
  database()
    .select()
    .from(outboxEvents)
    .where(and(eq(outboxEvents.topic, "admin.alert"), eq(outboxEvents.aggregateId, id)));

/** A small real PNG, with random bytes after it so each is a different file. */
const aReceiptImage = () =>
  new Blob([
    Buffer.concat([
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
      randomBytes(8),
    ]),
  ], { type: "image/png" });

const aCard = async () => {
  const staff = await owner();
  const card = await staff.client.post(`${STAFF}/payment-cards`, {
    label: "ملت",
    bankName: "بانک ملت",
    cardNumber: "۶۱۰۴ ۳۳۷۸ ۱۲۳۴ ۵۶۷۸",
    holderName: "شاه‌کلید",
  });
  assert.equal(card.status, 201, JSON.stringify(card.data));
  return card.data as { id: string; cardNumber: string };
};

const sendReceipt = async (
  buyer: Buyer,
  orderId: string,
  fields: Record<string, string>,
  image: Blob | null = aReceiptImage(),
) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (image) form.set("receipt", image, "receipt.png");
  return buyer.client.post(`${SHOP}/orders/${orderId}/pay/card`, form);
};

// ------------------------------------------------------------------ plans

describe("The storefront", () => {
  it("When plans are listed, then only those on sale appear, without their panel details", async () => {
    const store = await aStore();
    const staff = await owner();
    const hidden = await staff.client.post(`${STAFF}/plans`, {
      slug: `hidden-${randomBytes(3).toString("hex")}`,
      name: "فقط برای نماینده",
      dataLimitGb: 10,
      durationDays: 30,
      deviceLimit: 1,
      priceToman: 1000,
      isPublic: false,
      panels: [{ panelId: store.panelId, groupIds: [] }],
    });

    const plans = await createClient().get(`${SHOP}/plans`);

    assert.equal(plans.status, 200);
    const ids = plans.data.map((plan: { id: string }) => plan.id);
    assert.ok(ids.includes(store.planId));
    assert.ok(!ids.includes(hidden.data.id));
    assert.equal(plans.data[0].panels, undefined);
  });

  it("When a visitor who is not signed in tries to order, then they are asked to sign in", async () => {
    const store = await aStore();

    const response = await createClient().post(`${SHOP}/orders`, { planId: store.planId });

    assert.equal(response.status, 401);
    assert.equal(response.data.error.code, "SIGN_IN_REQUIRED");
  });
});

// ----------------------------------------------------------------- ordering

describe("Ordering", () => {
  it("When the same order is sent twice with one idempotency key, then there is one order", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const key = randomUUID();

    const [first, second] = await Promise.all([anOrder(buyer, store, key), anOrder(buyer, store, key)]);
    const third = await anOrder(buyer, store);

    assert.equal(first.id, second.id);
    assert.notEqual(third.id, first.id);
    assert.equal(first.totalToman, PRICE);
  });

  it("When someone else asks for my order, then it does not exist for them", async () => {
    const store = await aStore();
    const order = await anOrder(await signedInCustomer(emails), store);
    const stranger = await signedInCustomer(emails);

    assert.equal((await stranger.client.get(`${SHOP}/orders/${order.id}`)).status, 404);
    assert.equal((await stranger.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`)).status, 404);
  });
});

// ----------------------------------------------------------------- zarinpal

describe("Paying with Zarinpal", () => {
  it("[acceptance] When the customer pays, then the money is on the books, an invoice is issued, and the service is made", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const revenueBefore = await balanceOf(database(), "revenue");

    const { order, back } = await buyWithZarinpal(buyer, store);

    assert.equal(back.status, 303);
    assert.equal(back.headers.get("location"), `${config.cors.origin}/orders/${order.id}`);

    const view = (await buyer.client.get(`${SHOP}/orders/${order.id}`)).data;
    assert.equal(view.status, "fulfilled");
    assert.equal(view.payment.status, "succeeded");
    assert.ok(view.payment.refId);
    assert.ok(view.invoiceNumber);
    assert.equal(view.subscription.status, "provisioning");
    assert.equal(view.subscription.link, null, "the link is shown once it is on the panel");

    assert.equal((await balanceOf(database(), "revenue")) - revenueBefore, PRICE);

    // The worker puts it on the panel; the order page then has the link.
    await provisionSubscription(database(), view.subscription.id);
    const ready = (await buyer.client.get(`${SHOP}/orders/${order.id}`)).data;
    assert.equal(ready.subscription.status, "on_hold");
    assert.match(ready.subscription.link, /\/s\/[A-Za-z0-9_-]+$/);
  });

  it("[acceptance] When Zarinpal calls back twice, then there is one payment, one ledger posting and one subscription", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const { order, authority } = await buyWithZarinpal(buyer, store);

    await Promise.all([zarinpalReturns(authority, "OK"), zarinpalReturns(authority, "OK")]);

    const subs = await database().select().from(subscriptions).where(eq(subscriptions.userId, buyer.id));
    assert.equal(subs.length, 1);
    const [payment] = await database().select().from(payments).where(eq(payments.orderId, order.id));
    const postings = await database()
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.referenceId, payment!.id));
    assert.equal(postings.length, 1);
    const issued = await database().select().from(invoices).where(eq(invoices.orderId, order.id));
    assert.equal(issued.length, 1);
  });

  it("When the customer cancels at the bank, then the order is still payable and they can try again", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`);

    await zarinpalReturns(gateway.lastAuthority, "NOK");

    const view = (await buyer.client.get(`${SHOP}/orders/${order.id}`)).data;
    assert.equal(view.status, "pending");
    assert.equal(view.payment.status, "failed");
    const again = await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`);
    assert.equal(again.status, 200);
  });

  it("When the bank took the money but sent the customer back as cancelled, then the reconcile job still settles it", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`);
    const authority = gateway.lastAuthority;
    gateway.pay(authority);

    await zarinpalReturns(authority, "NOK");
    assert.equal((await orderRow(order.id)).status, "pending", "the customer is told it was cancelled");

    await billingTick(database());
    assert.equal((await orderRow(order.id)).status, "fulfilled", "Zarinpal's own word settles it");
  });

  it("When a cancelled payment really was cancelled, then it is checked once and left alone", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`);
    await zarinpalReturns(gateway.lastAuthority, "NOK");

    await billingTick(database());
    const [payment] = await database().select().from(payments).where(eq(payments.orderId, order.id));
    assert.equal(payment!.status, "failed");
    assert.equal(payment!.failureReason, "cancelled_checked");
    assert.equal((await billingTick(database())).zarinpal[payment!.id], undefined, "not asked again");
  });

  it("When money arrives for an order that was cancelled, then it is not settled and staff are told to return it", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`);
    const authority = gateway.lastAuthority;
    await database().update(orders).set({ status: "cancelled", cancelledAt: new Date() }).where(eq(orders.id, order.id));
    gateway.pay(authority);

    await zarinpalReturns(authority, "OK");

    const [payment] = await database().select().from(payments).where(eq(payments.orderId, order.id));
    assert.equal(payment!.status, "failed");
    assert.equal(payment!.failureReason, "order_cancelled");
    const [alert] = await alertsAbout(payment!.id);
    assert.match((alert!.payload as { subject: string }).subject, /دیگر باز نیست/);
  });

  it("When Zarinpal holds a different amount, then nothing is settled and staff are told", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`);
    const authority = gateway.lastAuthority;
    gateway.changeAmount(authority, 1000);
    gateway.pay(authority);

    await zarinpalReturns(authority, "OK");

    const [payment] = await database().select().from(payments).where(eq(payments.orderId, order.id));
    assert.equal(payment!.status, "failed");
    assert.equal(payment!.failureReason, "amount_mismatch");
    assert.equal((await orderRow(order.id)).status, "pending");
    assert.equal((await alertsAbout(payment!.id)).length, 1);
  });

  it("When the customer pays and closes the tab (no callback), then the reconcile job settles it", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`);
    gateway.pay(gateway.lastAuthority);
    // A minute passes.
    await database()
      .update(payments)
      .set({ createdAt: new Date(Date.now() - 2 * 60_000) })
      .where(eq(payments.orderId, order.id));

    await billingTick(database());

    assert.equal((await orderRow(order.id)).status, "fulfilled");
  });

  it("When Zarinpal is down at the callback, then the payment waits, and settles once Zarinpal is back", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`);
    const authority = gateway.lastAuthority;
    gateway.pay(authority);
    gateway.down = true;

    try {
      const back = await zarinpalReturns(authority, "OK");
      assert.equal(back.status, 303, "the customer still lands on their order page");
      assert.equal((await orderRow(order.id)).status, "pending");
    } finally {
      gateway.down = false;
    }

    await database().update(payments).set({ createdAt: new Date(Date.now() - 2 * 60_000) }).where(eq(payments.orderId, order.id));
    await billingTick(database());
    assert.equal((await orderRow(order.id)).status, "fulfilled");
  });

  it("When a payment arrives after the order lapsed, then the money is still recorded and the service made", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`);
    const authority = gateway.lastAuthority;
    await database().update(orders).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, order.id));
    await billingTick(database());
    assert.equal((await orderRow(order.id)).status, "expired");

    // The bank took its time; the money did move.
    gateway.pay(authority);
    await zarinpalReturns(authority, "OK");

    assert.equal((await orderRow(order.id)).status, "fulfilled");
  });

  it("When Zarinpal cannot be reached to start a payment, then the customer is told and nothing is charged", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    gateway.down = true;
    try {
      const response = await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`);
      assert.equal(response.status, 503);
      assert.equal(response.data.error.code, "GATEWAY_UNREACHABLE");
    } finally {
      gateway.down = false;
    }
  });
});

// ------------------------------------------------ when delivery goes wrong

describe("When the service cannot be delivered at once", () => {
  it("[acceptance] When the panel is down, then the money is kept, staff are told, and the service is made once it is back", async () => {
    const store = await aStore();
    const buyer = await signedInCustomer(emails);
    store.fake.down = true;

    const { order } = await buyWithZarinpal(buyer, store);
    const subscriptionId = (await orderRow(order.id)).subscriptionId!;

    // The worker's attempts fail; after about a minute staff hear of it.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await assert.rejects(
        runProvisionJob(database(), { data: { aggregateId: subscriptionId }, attemptsMade: attempt, opts: { attempts: 12 } }),
      );
    }
    assert.equal((await alertsAbout(subscriptionId)).length, 1, "one alert, not one per attempt");
    const waiting = (await buyer.client.get(`${SHOP}/orders/${order.id}`)).data;
    assert.equal(waiting.payment.status, "succeeded", "the money is recorded");
    assert.equal(waiting.subscription.status, "provisioning", "the customer sees it being prepared");

    store.fake.down = false;
    await runProvisionJob(database(), { data: { aggregateId: subscriptionId }, attemptsMade: 6, opts: { attempts: 12 } });
    const ready = (await buyer.client.get(`${SHOP}/orders/${order.id}`)).data;
    assert.equal(ready.subscription.status, "on_hold");
    assert.ok(ready.subscription.link);
  });

  it("When no server has room, then the order is paid but waits, staff are told, and can make it once there is room", async () => {
    const store = await aStore({ servers: [{ capacity: 1, priority: 0 }] });
    const first = await signedInCustomer(emails);
    await buyWithZarinpal(first, store);
    const second = await signedInCustomer(emails);

    const { order } = await buyWithZarinpal(second, store);

    const row = await orderRow(order.id);
    assert.equal(row.status, "paid");
    assert.equal(row.subscriptionId, null);
    assert.equal((await alertsAbout(order.id)).length, 1);

    const [server] = (await store.staff.client.get(`${STAFF}/servers`)).data.filter((s: { id: string }) => s.id === store.serverIds[0]);
    await store.staff.client.put(`${STAFF}/servers/${server.id}`, { ...server, capacityUsers: 2 });
    const fulfilled = await store.staff.client.post(`${STAFF}/orders/${order.id}/fulfil`);
    assert.equal(fulfilled.status, 200, JSON.stringify(fulfilled.data));
    assert.equal(fulfilled.data.status, "fulfilled");

    const again = await store.staff.client.post(`${STAFF}/orders/${order.id}/fulfil`);
    assert.equal(again.status, 409, "no second subscription for the same order");
  });
});

// ------------------------------------------------------------ card-to-card

describe("Paying card to card", () => {
  it("[acceptance] When a customer sends a receipt and the accountant approves it, then the order is fulfilled", async () => {
    const store = await aStore();
    const card = await aCard();
    assert.equal(card.cardNumber, "6104337812345678", "digits in any script, spaces dropped");
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);

    const sent = await sendReceipt(buyer, order.id, {
      destinationCardId: card.id,
      trackingNumber: `${Date.now()}`,
      claimedAmountToman: "۱۵۰,۰۰۰",
      payerCardLast4: "۱۲۳۴",
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.data));
    assert.equal(sent.data.payment.status, "pending_review");

    const accountant = await signedInStaff(["accountant"]);
    const queue = await accountant.client.get(`${STAFF}/receipts`);
    const mine = queue.data.find((receipt: { orderId: string }) => receipt.orderId === order.id);
    assert.deepEqual(mine.flags, []);
    const image = await fetch(`${getBaseUrl()}${STAFF}/receipts/${mine.paymentId}/image`);
    assert.equal(image.status, 401, "not without signing in");

    const approved = await accountant.client.post(`${STAFF}/receipts/${mine.paymentId}/review`, { decision: "approve" });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.status, "succeeded");
    assert.equal((await orderRow(order.id)).status, "fulfilled");

    const twice = await accountant.client.post(`${STAFF}/receipts/${mine.paymentId}/review`, { decision: "approve" });
    assert.equal(twice.status, 409);
    assert.equal(twice.data.error.code, "ALREADY_REVIEWED");
  });

  it("When a receipt repeats an earlier picture or tracking number, or the amount differs, then it is flagged", async () => {
    const store = await aStore();
    const card = await aCard();
    const buyer = await signedInCustomer(emails);
    const image = aReceiptImage();
    const tracking = `${Date.now()}9`;
    const firstOrder = await anOrder(buyer, store);
    await sendReceipt(buyer, firstOrder.id, {
      destinationCardId: card.id,
      trackingNumber: tracking,
      claimedAmountToman: String(PRICE),
      payerCardLast4: "1234",
    }, image);

    const secondOrder = await anOrder(buyer, store);
    const second = await sendReceipt(buyer, secondOrder.id, {
      destinationCardId: card.id,
      trackingNumber: tracking,
      claimedAmountToman: "100000",
      payerCardLast4: "1234",
    }, image);
    assert.equal(second.status, 201, "flagged, not refused: the accountant decides");

    const staff = await owner();
    const queue = await staff.client.get(`${STAFF}/receipts`);
    const flagged = queue.data.find((receipt: { orderId: string }) => receipt.orderId === secondOrder.id);
    assert.deepEqual([...flagged.flags].sort(), ["amount_mismatch", "duplicate_image", "duplicate_tracking"]);
  });

  it("When the accountant rejects a receipt, then the customer sees why and can pay again", async () => {
    const store = await aStore();
    const card = await aCard();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await sendReceipt(buyer, order.id, {
      destinationCardId: card.id,
      trackingNumber: `${Date.now()}7`,
      claimedAmountToman: String(PRICE),
      payerCardLast4: "1234",
    });
    const staff = await owner();
    const [receipt] = (await staff.client.get(`${STAFF}/receipts`)).data.filter((r: { orderId: string }) => r.orderId === order.id);

    const refusal = await staff.client.post(`${STAFF}/receipts/${receipt.paymentId}/review`, { decision: "reject" });
    assert.equal(refusal.status, 400, "a rejection must say why");
    await staff.client.post(`${STAFF}/receipts/${receipt.paymentId}/review`, {
      decision: "reject",
      note: "مبلغی به حساب نرسیده است.",
    });

    const view = (await buyer.client.get(`${SHOP}/orders/${order.id}`)).data;
    assert.equal(view.status, "pending");
    assert.equal(view.payment.failureReason, "مبلغی به حساب نرسیده است.");
    assert.equal((await buyer.client.post(`${SHOP}/orders/${order.id}/pay/zarinpal`)).status, 200);
  });

  it("When the file is not an image, then it is refused, whatever its name says", async () => {
    const store = await aStore();
    const card = await aCard();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);

    const response = await sendReceipt(
      buyer,
      order.id,
      { destinationCardId: card.id, trackingNumber: "12345678", claimedAmountToman: String(PRICE), payerCardLast4: "1234" },
      new Blob(["%PDF-1.7 not an image"], { type: "image/png" }),
    );

    assert.equal(response.status, 400);
    assert.equal(response.data.error.code, "RECEIPT_INVALID");
  });

  it("When a customer tries the review queue, then it is forbidden", async () => {
    const buyer = await signedInCustomer(emails);

    assert.equal((await buyer.client.get(`${STAFF}/receipts`)).status, 403);
  });

  it("When a lapsed order's receipt is waiting for review, then the order does not lapse under it", async () => {
    const store = await aStore();
    const card = await aCard();
    const buyer = await signedInCustomer(emails);
    const order = await anOrder(buyer, store);
    await sendReceipt(buyer, order.id, {
      destinationCardId: card.id,
      trackingNumber: `${Date.now()}5`,
      claimedAmountToman: String(PRICE),
      payerCardLast4: "1234",
    });
    await database().update(orders).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(orders.id, order.id));

    await billingTick(database());

    assert.equal((await orderRow(order.id)).status, "pending");
  });
});

// ------------------------------------------------------------------ alerts

describe("Alerts to staff", () => {
  it("When an alert is delivered, then owners and admins get an email, and Telegram gets it when configured", async () => {
    const theOwner = await owner();
    const admin = await signedInStaff(["admin"]);
    const support = await signedInStaff(["support"]);
    const sentToTelegram: string[] = [];
    setTelegramSender(async (chatId, text) => {
      sentToTelegram.push(`${chatId}:${text}`);
    });
    const saved = { ...config.alerts };
    Object.assign(config.alerts, { telegramBotToken: "123:test", telegramChatIds: ["-100200"] });
    try {
      await deliverAlert(database(), { subject: "آزمایش", text: "متن هشدار" });
    } finally {
      Object.assign(config.alerts, saved);
      setTelegramSender(null);
    }

    const to = emails.sent.filter((email) => email.subject.includes("آزمایش")).map((email) => email.to);
    assert.ok(to.includes(theOwner.email));
    assert.ok(to.includes(admin.email));
    assert.ok(!to.includes(support.email), "support staff are not paged");
    assert.equal(sentToTelegram.length, 1);
    assert.match(sentToTelegram[0]!, /^-100200:.*آزمایش/s);
  });

  it("When Telegram is unreachable, then the emails still go and the alert counts as delivered", async () => {
    await owner();
    setTelegramSender(async () => {
      throw new Error("Telegram is filtered");
    });
    const saved = { ...config.alerts };
    Object.assign(config.alerts, { telegramBotToken: "123:test", telegramChatIds: ["-100200"] });
    try {
      const result = await deliverAlert(database(), { subject: "بدون تلگرام", text: "..." });
      assert.ok(result.delivered >= 1);
    } finally {
      Object.assign(config.alerts, saved);
      setTelegramSender(null);
    }
  });
});
