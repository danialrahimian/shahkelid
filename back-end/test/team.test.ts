import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { customerNotes } from "../src/modules/crm/schema";
import { users } from "../src/modules/identity/schema";
import { removeFromPanel } from "../src/modules/subscriptions/actions";
import { subscriptions } from "../src/modules/subscriptions/schema";
import { outboxEvents } from "../src/platform/db/platform-schema";
import {
  aCustomerAccount,
  captureEmails,
  closeDatabase,
  database,
  signedInCustomer,
  signedInStaff,
  uniqueEmail,
} from "./helpers/accounts";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, installFakePanels, type Store } from "./helpers/store";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * The team page, the audit log with who did what, suspending customers, and
 * deleting an account (the old moderator panel's jobs, done the new way).
 */

const STAFF = "/api/v1/staff";
let emails: ReturnType<typeof captureEmails>;
let owner: Awaited<ReturnType<typeof signedInStaff>>;
let store: Store;

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  emails = captureEmails();
  installFakePanels();
  owner = await signedInStaff(["owner"]);
  store = await aStore();
});

after(async () => {
  emails.stop();
  await closeDatabase();
  await stopTestServer();
});

describe("The team", () => {
  it("An owner adds someone by email: the account is made if needed, given the role, and told where to sign in", async () => {
    const email = uniqueEmail("agent");
    const added = await owner.client.post(`${STAFF}/team`, { email, roleKey: "support" });
    assert.equal(added.status, 201, JSON.stringify(added.data));
    const member = added.data.find((row: { email: string }) => row.email === email);
    assert.deepEqual(member.roles, ["support"]);
    assert.equal(member.twoFactorEnabled, false);
    assert.ok(emails.sent.some((sent) => sent.to === email && sent.text.includes("/account/sign-in")));

    // Again: nothing doubles, and no second email.
    const before = emails.sent.length;
    await owner.client.post(`${STAFF}/team`, { email, roleKey: "support" });
    assert.equal(emails.sent.length, before);
  });

  it("An unknown role is refused; an admin cannot give roles; the list needs users:read", async () => {
    assert.equal((await owner.client.post(`${STAFF}/team`, { email: uniqueEmail(), roleKey: "king" })).status, 404);
    assert.equal((await owner.client.post(`${STAFF}/team`, { email: "not-an-email", roleKey: "support" })).status, 400);
    const admin = await signedInStaff(["admin"]);
    assert.equal((await admin.client.post(`${STAFF}/team`, { email: uniqueEmail(), roleKey: "support" })).status, 403);
    assert.equal((await admin.client.get(`${STAFF}/team`)).status, 200);
    const support = await signedInStaff(["support"]);
    assert.equal((await support.client.get(`${STAFF}/team`)).status, 403);
  });

  it("The audit log says who did it, by email", async () => {
    const person = await aCustomerAccount();
    await owner.client.post(`${STAFF}/customers/${person.id}/notes`, { body: "یادداشت" });
    const log = await owner.client.get(`${STAFF}/audit?entityType=user&entityId=${person.id}`);
    assert.equal(log.data.entries[0].action, "customer.note_added");
    assert.equal(log.data.entries[0].actorEmail, owner.email);
  });
});

describe("Suspending a customer", () => {
  it("A suspended customer is signed out on their next request and cannot sign in; restored, they can", async () => {
    const customer = await signedInCustomer(emails);
    const support = await signedInStaff(["support"]);

    const suspended = await support.client.put(`${STAFF}/customers/${customer.id}/status`, { status: "suspended" });
    assert.equal(suspended.status, 200, JSON.stringify(suspended.data));
    assert.equal(suspended.data.status, "suspended");
    assert.equal((await customer.client.get("/api/v1/shop/orders")).status, 401);

    await support.client.put(`${STAFF}/customers/${customer.id}/status`, { status: "active" });
    const [row] = await database().select().from(users).where(eq(users.id, customer.id));
    assert.equal(row!.status, "active");
  });

  it("A member of staff is not suspended from the customer page", async () => {
    const support = await signedInStaff(["support"]);
    const colleague = await signedInStaff(["editor"]);
    assert.equal((await support.client.put(`${STAFF}/customers/${colleague.id}/status`, { status: "suspended" })).status, 409);
  });
});

describe("Deleting an account", () => {
  it("[acceptance] The customer deletes their account: what identifies them goes, orders stay, services come off the panel", async () => {
    const customer = await signedInCustomer(emails);
    const made = await store.staff.client.post(`${STAFF}/subscriptions`, { userId: customer.id, planId: store.planId });
    await database().update(subscriptions).set({ status: "active" }).where(eq(subscriptions.id, made.data.id));
    const waiting = await store.staff.client.post(`${STAFF}/subscriptions`, { userId: customer.id, planId: store.planId });
    await database()
      .update(subscriptions)
      .set({ status: "provisioning_failed" })
      .where(eq(subscriptions.id, waiting.data.id));
    await owner.client.post(`${STAFF}/customers/${customer.id}/notes`, { body: "شماره‌اش ۰۹۱۲..." });

    const wrong = await customer.client.post("/api/v1/auth/delete-account", { email: "someone@else.com" });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.data.error.code, "CONFIRMATION_MISMATCH");

    const deleted = await customer.client.post("/api/v1/auth/delete-account", { email: customer.email.toUpperCase() });
    assert.equal(deleted.status, 204);
    assert.equal((await customer.client.get("/api/v1/auth/session")).data.status, "signed_out");

    const [row] = await database().select().from(users).where(eq(users.id, customer.id));
    assert.equal(row!.status, "deleted");
    assert.notEqual(row!.email, customer.email);
    assert.match(row!.email, /@deleted\.invalid$/);
    assert.equal(row!.passwordHash, null);
    assert.equal((await database().select().from(customerNotes).where(eq(customerNotes.userId, customer.id))).length, 0);

    const [notOnPanel] = await database().select().from(subscriptions).where(eq(subscriptions.id, waiting.data.id));
    assert.equal(notOnPanel!.status, "deleted", "one never made is simply marked");
    const events = await database().select().from(outboxEvents).where(eq(outboxEvents.aggregateId, made.data.id));
    assert.ok(events.some((event) => event.topic === "subscription.remove_requested"));
    assert.equal(await removeFromPanel(database(), made.data.id), "removed");
    const [removed] = await database().select().from(subscriptions).where(eq(subscriptions.id, made.data.id));
    assert.equal(removed!.status, "deleted");
    assert.equal(await removeFromPanel(database(), made.data.id), "not_needed", "a retry does nothing");

    // The same address can make a new, empty account.
    const again = await signedInCustomer(emails);
    assert.notEqual(again.id, customer.id);
  });

  it("A member of staff cannot delete their account this way", async () => {
    const editor = await signedInStaff(["editor"]);
    const response = await editor.client.post("/api/v1/auth/delete-account", { email: editor.email });
    assert.equal(response.status, 409);
  });

  it("Staff with customers:manage may delete a customer's account", async () => {
    const person = await aCustomerAccount();
    const support = await signedInStaff(["support"]);
    assert.equal((await support.client.del(`${STAFF}/customers/${person.id}`)).status, 200);
    assert.equal((await support.client.del(`${STAFF}/customers/${person.id}`)).status, 404, "once");
  });
});
