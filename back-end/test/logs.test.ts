import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { orders, payments } from "../src/modules/billing/schema";
import { captureEmails, closeDatabase, database, signedInCustomer, signedInStaff } from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, installFakePanels, owner } from "./helpers/store";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * The owner's log of everything (/api/v1/staff/logs): one timeline across
 * staff actions, orders, payments, subscriptions, alerts, emails, support
 * and accounts, for the owner alone.
 */

const LOGS = "/api/v1/staff/logs";
const logs = (query: Record<string, string | number> = {}) =>
  `${LOGS}?${new URLSearchParams(Object.entries(query).map(([key, value]): [string, string] => [key, String(value)]))}`;
let emails: ReturnType<typeof captureEmails>;

type Entry = {
  key: string;
  at: string;
  source: string;
  kind: string;
  actor: string | null;
  entity: { type: string; id: string } | null;
  summary: string;
  problem: boolean;
};

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

/** A card-to-card sale approved once its only server is archived: a paid order, a payment, an alert. */
const aStuckSale = async () => {
  const store = await aStore();
  const staff = await owner();
  const card = await staff.client.post("/api/v1/staff/payment-cards", {
    label: `card-${randomBytes(2).toString("hex")}`,
    bankName: "بانک ملت",
    cardNumber: "6104337812345678",
    holderName: "شاه‌کلید",
  });
  const buyer = await signedInCustomer(emails);
  const order = await buyer.client.post("/api/v1/shop/orders", { planId: store.planId }, { headers: { "idempotency-key": randomUUID() } });
  const form = new FormData();
  form.set("destinationCardId", card.data.id);
  form.set("trackingNumber", `${Date.now()}`);
  form.set("claimedAmountToman", "150000");
  form.set("payerCardLast4", "1234");
  form.set(
    "receipt",
    new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), randomBytes(8)], { type: "image/png" }),
    "receipt.png",
  );
  assert.equal((await buyer.client.post(`/api/v1/shop/orders/${order.data.id}/pay/card`, form)).status, 201);
  const [payment] = await database().select().from(payments).where(eq(payments.orderId, order.data.id));
  assert.equal((await staff.client.post(`/api/v1/staff/servers/${store.serverIds[0]}/archive`)).status, 200);
  assert.equal((await staff.client.post(`/api/v1/staff/receipts/${payment!.id}/review`, { decision: "approve" })).status, 200);
  return { orderId: order.data.id as string, paymentId: payment!.id, buyer };
};

describe("The owner's log", () => {
  it("When the owner opens it, then a sale shows up from every side: the order, the payment, the review and the alert", async () => {
    const { orderId, paymentId } = await aStuckSale();
    const staff = await owner();

    const response = await staff.client.get(LOGS);

    assert.equal(response.status, 200, JSON.stringify(response.data));
    const entries = response.data.entries as Entry[];
    const about = (id: string) => entries.filter((entry) => entry.entity?.id === id).map((entry) => entry.kind);
    assert.ok(about(orderId).includes("order.placed"));
    assert.ok(about(orderId).includes("order.paid"));
    assert.ok(about(paymentId).includes("payment.started"));
    assert.ok(about(paymentId).includes("payment.succeeded"));
    assert.ok(about(paymentId).includes("payment.receipt_approved"), "the accountant's decision, from the audit log");
    const alert = entries.find((entry) => entry.source === "alert" && entry.entity?.id === orderId);
    assert.equal(alert?.summary, "Order paid, but its service was not made");
    assert.equal(alert?.problem, true);
    assert.ok(entries.some((entry) => entry.source === "account"));
    const times = entries.map((entry) => Date.parse(entry.at));
    assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first");
  });

  it("When it is filtered by section, by problems or by a search, then only those entries come back", async () => {
    const { orderId } = await aStuckSale();
    const [order] = await database().select().from(orders).where(eq(orders.id, orderId));
    const staff = await owner();

    const alerts = (await staff.client.get(logs({ source: "alert" }))).data.entries as Entry[];
    assert.ok(alerts.length > 0);
    assert.ok(alerts.every((entry) => entry.source === "alert"));

    const problems = (await staff.client.get(logs({ problems: "1" }))).data.entries as Entry[];
    assert.ok(problems.length > 0);
    assert.ok(problems.every((entry) => entry.problem));

    const found = (await staff.client.get(logs({ q: `Order ${order!.number}` }))).data.entries as Entry[];
    assert.ok(found.length > 0);
    assert.ok(found.every((entry) => entry.summary.toLowerCase().includes(`order ${order!.number}`)));

    assert.equal((await staff.client.get(logs({ source: "nonsense" }))).status, 400);
  });

  it("When there is more than a page, then the pages follow on without gaps or repeats", async () => {
    await aStuckSale();
    const staff = await owner();
    const all = (await staff.client.get(logs({ limit: 200 }))).data.entries as Entry[];

    const first = (await staff.client.get(logs({ limit: 5 }))).data;
    const second = (
      await staff.client.get(logs({ limit: 5, beforeAt: first.next.beforeAt, beforeKey: first.next.beforeKey }))
    ).data;

    assert.deepEqual(
      [...first.entries, ...second.entries].map((entry: Entry) => entry.key),
      all.slice(0, 10).map((entry) => entry.key),
    );
  });

  it("When an admin or anyone but the owner asks, then it is forbidden", async () => {
    const admin = await signedInStaff(["admin"]);
    const support = await signedInStaff(["support"]);
    const customer = await signedInCustomer(emails);

    assert.equal((await admin.client.get(LOGS)).status, 403);
    assert.equal((await support.client.get(LOGS)).status, 403);
    assert.equal((await customer.client.get(LOGS)).status, 403);
  });
});
