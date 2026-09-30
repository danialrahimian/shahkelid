import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { and, eq } from "drizzle-orm";

import { orders } from "../src/modules/billing/schema";
import { setZarinpal } from "../src/modules/billing/zarinpal";
import { users } from "../src/modules/identity/schema";
import { deliverNotification } from "../src/modules/notifications/notify";
import { scanReminders } from "../src/modules/notifications/reminders";
import { notifications } from "../src/modules/notifications/schema";
import { asHtml } from "../src/modules/notifications/templates";
import { provisionSubscription } from "../src/modules/provisioning/provision";
import { applyRenewal } from "../src/modules/subscriptions/renewal";
import { subscriptions } from "../src/modules/subscriptions/schema";
import { captureEmails, closeDatabase, database, signedInCustomer, signedInStaff } from "./helpers/accounts";
import { FakeZarinpal } from "./helpers/fake-zarinpal";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, installFakePanels, owner, type Store } from "./helpers/store";
import { getBaseUrl, startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * Emails to customers: the templates, sending, and the reminders (three
 * days and one day before the end, 80% and 100% of the volume), each once
 * per cycle and again after a renewal.
 */

const GB = 1024 ** 3;
const DAY = 86_400_000;
const STAFF = "/api/v1/staff";
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

const pay = async (buyer: Buyer, body: Record<string, unknown>) => {
  const order = await buyer.client.post("/api/v1/shop/orders", body, { headers: { "idempotency-key": randomUUID() } });
  await buyer.client.post(`/api/v1/shop/orders/${order.data.id}/pay/zarinpal`);
  gateway.pay(gateway.lastAuthority);
  await fetch(`${getBaseUrl()}/api/v1/payments/zarinpal/callback?Authority=${gateway.lastAuthority}&Status=OK`, {
    redirect: "manual",
  });
  return order.data.id as string;
};

const aLiveService = async (store: Store) => {
  const buyer = await signedInCustomer(emails);
  const orderId = await pay(buyer, { planId: store.planId });
  const [order] = await database().select().from(orders).where(eq(orders.id, orderId));
  await provisionSubscription(database(), order!.subscriptionId!);
  return { buyer, subscriptionId: order!.subscriptionId! };
};

/** What was queued for a customer, by template. */
const sentTo = async (userId: string, key: string) =>
  (
    await database()
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.templateKey, key)))
  ).length;

/** Sets what the panel sync would have copied: the expiry and usage. */
const panelSays = (id: string, change: { expiresAt?: Date; usedBytes?: number; status?: "active" | "limited" }) =>
  database().update(subscriptions).set(change).where(eq(subscriptions.id, id));

// ---------------------------------------------------------------- reminders

describe("Reminders", () => {
  it("[acceptance] With the clock moved on, each reminder is queued exactly once, and again after a renewal", async () => {
    const store = await aStore();
    const { buyer, subscriptionId } = await aLiveService(store);
    const start = Date.parse("2027-01-01T00:00:00Z");
    await panelSays(subscriptionId, { status: "active", expiresAt: new Date(start + 10 * DAY), usedBytes: 0 });

    // Ten days left: nothing yet.
    await scanReminders(database(), new Date(start));
    assert.equal(await sentTo(buyer.id, "expiry_3d"), 0);

    // Two and a half days left: the three-day reminder, once, however often the scan runs.
    for (let scan = 0; scan < 3; scan += 1) await scanReminders(database(), new Date(start + 7.5 * DAY));
    assert.equal(await sentTo(buyer.id, "expiry_3d"), 1);

    // Twelve hours left: the one-day reminder, once.
    await scanReminders(database(), new Date(start + 9.5 * DAY));
    await scanReminders(database(), new Date(start + 9.6 * DAY));
    assert.equal(await sentTo(buyer.id, "expiry_1d"), 1);
    assert.equal(await sentTo(buyer.id, "expiry_3d"), 1, "the three-day one is not sent again");

    // 41 of 50 GB: 80%, once. 50 of 50: 100%, once.
    await panelSays(subscriptionId, { usedBytes: 41 * GB });
    await scanReminders(database(), new Date(start + 9.6 * DAY));
    await scanReminders(database(), new Date(start + 9.7 * DAY));
    await panelSays(subscriptionId, { usedBytes: 50 * GB, status: "limited" });
    await scanReminders(database(), new Date(start + 9.7 * DAY));
    await scanReminders(database(), new Date(start + 9.8 * DAY));
    assert.equal(await sentTo(buyer.id, "usage_80"), 1);
    assert.equal(await sentTo(buyer.id, "usage_100"), 1);

    // A renewal: a new expiry and a new limit, so a new cycle.
    const fakeUser = store.fake.users.get([...store.fake.users.keys()][0]!)!;
    Object.assign(fakeUser, { status: "limited", usedBytes: 50 * GB, expiresAt: new Date(start + 10 * DAY) });
    const renewal = await pay(buyer, { planId: store.planId, renewSubscriptionId: subscriptionId });
    assert.equal(await applyRenewal(database(), renewal), "renewed");
    const [renewed] = await database().select().from(subscriptions).where(eq(subscriptions.id, subscriptionId));
    assert.equal(renewed!.expiresAt!.getTime(), start + 40 * DAY);

    await scanReminders(database(), new Date(start + 37.5 * DAY));
    assert.equal(await sentTo(buyer.id, "expiry_3d"), 2, "armed again by the renewal");
    assert.equal(await sentTo(buyer.id, "subscription_renewed"), 1);
  });

  it("When a service is on hold (not started), then no expiry reminder is sent", async () => {
    const store = await aStore();
    const { buyer } = await aLiveService(store);

    await scanReminders(database(), new Date(Date.now() + 365 * DAY));

    assert.equal(await sentTo(buyer.id, "expiry_1d"), 0);
    assert.equal(await sentTo(buyer.id, "expiry_3d"), 0);
  });
});

// ------------------------------------------------------------------ sending

describe("Sending", () => {
  it("When a customer pays and the service is made, then both emails are queued and go out in Persian, right to left", async () => {
    const store = await aStore();
    const { buyer, subscriptionId } = await aLiveService(store);

    const queued = await database().select().from(notifications).where(eq(notifications.userId, buyer.id));
    assert.deepEqual(queued.map((row) => row.templateKey).sort(), ["payment_received", "subscription_ready"]);

    const ready = queued.find((row) => row.templateKey === "subscription_ready")!;
    assert.equal(await deliverNotification(database(), ready.id), "sent");
    const email = emails.sent.findLast((sent) => sent.to === buyer.email)!;
    assert.match(email.subject, /سرویس شما آماده است/);
    assert.match(email.text, /\/s\//, "the link is in it");
    assert.match(email.html ?? "", /dir="rtl"/);
    const [subscription] = await database().select().from(subscriptions).where(eq(subscriptions.id, subscriptionId));
    assert.ok(email.text.includes(subscription!.accessToken));

    assert.equal(await deliverNotification(database(), ready.id), "not_waiting", "sent once");
  });

  it("When staff rewrite a template, then the next email uses their text; switched off, it is skipped", async () => {
    const staff = await owner();
    const store = await aStore();
    const { buyer } = await aLiveService(store);

    const saved = await staff.client.put(`${STAFF}/notification-templates/payment_received`, {
      subject: "دریافت شد: {{amount}}",
      body: "{{name}} عزیز، سفارش {{order_number}} پرداخت شد.",
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.custom, true);

    const [row] = await database()
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, buyer.id), eq(notifications.templateKey, "payment_received")));
    await deliverNotification(database(), row!.id);
    const email = emails.sent.findLast((sent) => sent.to === buyer.email)!;
    assert.match(email.subject, /^دریافت شد: ۱۵۰٬۰۰۰ تومان$/);

    await staff.client.put(`${STAFF}/notification-templates/subscription_ready`, {
      subject: "x",
      body: "y",
      isActive: false,
    });
    const [ready] = await database()
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, buyer.id), eq(notifications.templateKey, "subscription_ready")));
    assert.equal(await deliverNotification(database(), ready!.id), "skipped");

    const reset = await staff.client.del(`${STAFF}/notification-templates/subscription_ready`);
    assert.equal(reset.data.custom, false);
    assert.equal(reset.data.isActive, true);
  });

  it("When a suspended customer's email comes up, then it is skipped", async () => {
    const store = await aStore();
    const { buyer } = await aLiveService(store);
    await database().update(users).set({ status: "suspended" }).where(eq(users.id, buyer.id));
    const [row] = await database().select().from(notifications).where(eq(notifications.userId, buyer.id));

    assert.equal(await deliverNotification(database(), row!.id), "skipped");
  });

  it("When a template's text carries markup, then the HTML email shows it as text, and links are clickable", () => {
    const html = asHtml("<script>alert(1)</script>\nhttps://example.com/s/abc");
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /<a href="https:\/\/example.com\/s\/abc"/);
  });
});

// ---------------------------------------------------------------- templates

describe("Editing templates", () => {
  it("When a template uses a variable it does not have, then it is refused on that field", async () => {
    const staff = await owner();

    const response = await staff.client.put(`${STAFF}/notification-templates/expiry_3d`, {
      subject: "{{plan_name}}",
      body: "سلام {{plan_nmae}}",
    });

    assert.equal(response.status, 400);
    assert.equal(response.data.error.code, "TEMPLATE_VARIABLE_UNKNOWN");
    assert.deepEqual(response.data.error.fields.map((field: { path: string }) => field.path), ["body"]);
  });

  it("When staff preview a template, then it reads like a real email", async () => {
    const staff = await owner();

    const preview = await staff.client.post(`${STAFF}/notification-templates/expiry_1d/preview`, {
      subject: "فردا {{plan_name}} تمام می‌شود",
      body: "سلام {{name}}",
    });

    assert.equal(preview.data.subject, "فردا ماهانه ۵۰ گیگ تمام می‌شود");
    assert.equal(preview.data.body, "سلام علی");
  });

  it("When support staff (no settings:manage) open the templates, then it is forbidden; they can read a customer's messages", async () => {
    const support = await signedInStaff(["support"]);
    const store = await aStore();
    const { buyer } = await aLiveService(store);

    assert.equal((await support.client.get(`${STAFF}/notification-templates`)).status, 403);
    const log = await support.client.get(`${STAFF}/customers/${buyer.id}/notifications`);
    assert.equal(log.status, 200);
    assert.equal(log.data.length, 2);
  });
});
