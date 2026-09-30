import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { orders } from "../src/modules/billing/schema";
import { customerProfiles } from "../src/modules/crm/schema";
import { subscriptions } from "../src/modules/subscriptions/schema";
import { aCustomerAccount, closeDatabase, database, signedInStaff } from "./helpers/accounts";
import { createClient } from "./helpers/api-client";
import { resetTestDatabase } from "./helpers/postgres";
import { aStore, installFakePanels, type Store } from "./helpers/store";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * The customer book on PostgreSQL: the old CRM's behaviour (value, stage,
 * notes, tags, segments), with the stage now read from the customer's
 * services rather than from how long ago they last bought.
 */

const STAFF = "/api/v1/staff";
const DAY = 86_400_000;
let support: Awaited<ReturnType<typeof signedInStaff>>;
let store: Store;

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  installFakePanels();
  support = await signedInStaff(["support"]);
  store = await aStore();
});

after(async () => {
  await closeDatabase();
  await stopTestServer();
});

// ----------------------------------------------------------------- arrange

const anOrder = (userId: string, totalToman: number, status: "paid" | "pending" | "failed" = "paid") =>
  database()
    .insert(orders)
    .values({
      userId,
      kind: "new",
      status,
      subtotalToman: totalToman,
      totalToman,
      expiresAt: new Date(Date.now() + DAY),
      paidAt: status === "paid" ? new Date() : null,
    });

/** A service in this state, made by staff and then set as the panel sync would. */
const aService = async (userId: string, change: { status: "active" | "expired" | "limited"; expiresAt?: Date }) => {
  const made = await store.staff.client.post(`${STAFF}/subscriptions`, { userId, planId: store.planId });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  await database().update(subscriptions).set(change).where(eq(subscriptions.id, made.data.id));
};

const customer = async (id: string) => {
  const response = await support.client.get(`${STAFF}/customers/${id}`);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
};

// ------------------------------------------------------------------- value

describe("Value and stage", () => {
  it("Lifetime value counts only paid orders, and is zero rather than missing for someone who never bought", async () => {
    const buyer = await aCustomerAccount();
    await anOrder(buyer.id, 150_000);
    await anOrder(buyer.id, 90_000);
    await anOrder(buyer.id, 500_000, "pending");
    await anOrder(buyer.id, 500_000, "failed");
    const idle = await aCustomerAccount();

    const bought = await customer(buyer.id);
    assert.equal(bought.lifetimeValueToman, 240_000);
    assert.equal(bought.paidOrders, 2);
    assert.ok(bought.lastPaidAt);
    assert.equal((await customer(idle.id)).lifetimeValueToman, 0);
  });

  it("Never paid is a lead; a live service is active; ending within a week or out of volume is at risk; none left is churned", async () => {
    const lead = await aCustomerAccount();
    assert.equal((await customer(lead.id)).stage, "lead");

    const active = await aCustomerAccount();
    await anOrder(active.id, 100_000);
    await aService(active.id, { status: "active", expiresAt: new Date(Date.now() + 20 * DAY) });
    assert.equal((await customer(active.id)).stage, "active");

    const ending = await aCustomerAccount();
    await anOrder(ending.id, 100_000);
    await aService(ending.id, { status: "active", expiresAt: new Date(Date.now() + 3 * DAY) });
    assert.equal((await customer(ending.id)).stage, "at-risk");

    const empty = await aCustomerAccount();
    await anOrder(empty.id, 100_000);
    await aService(empty.id, { status: "limited" });
    assert.equal((await customer(empty.id)).stage, "at-risk");

    const gone = await aCustomerAccount();
    await anOrder(gone.id, 100_000);
    await aService(gone.id, { status: "expired" });
    assert.equal((await customer(gone.id)).stage, "churned");
  });

  it("A stage set by hand wins, the computed one still shows, and clearing it returns to the data", async () => {
    const person = await aCustomerAccount();
    const set = await support.client.put(`${STAFF}/customers/${person.id}/stage`, { stage: "vip" });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.equal(set.data.stage, "vip");
    assert.equal(set.data.computedStage, "lead");
    assert.equal(set.data.stageOverride, "vip");

    const cleared = await support.client.put(`${STAFF}/customers/${person.id}/stage`, { stage: null });
    assert.equal(cleared.data.stage, "lead");
    assert.equal(cleared.data.stageOverride, null);

    assert.equal((await support.client.put(`${STAFF}/customers/${person.id}/stage`, { stage: "king" })).status, 400);
  });

  it("Reading a customer creates no record of them", async () => {
    const person = await aCustomerAccount();
    await customer(person.id);
    assert.equal(
      (await database().select().from(customerProfiles).where(eq(customerProfiles.userId, person.id))).length,
      0,
    );
  });
});

// -------------------------------------------------------------------- list

describe("The list", () => {
  it("Sorted by value, the highest comes first; a stage filter returns that segment, valued as a whole", async () => {
    const small = await aCustomerAccount();
    const big = await aCustomerAccount();
    await anOrder(small.id, 1_000);
    await anOrder(big.id, 9_000_000);
    await support.client.put(`${STAFF}/customers/${small.id}/stage`, { stage: "blocked" });
    await support.client.put(`${STAFF}/customers/${big.id}/stage`, { stage: "blocked" });

    const byValue = (await support.client.get(`${STAFF}/customers?sort=value&limit=1`)).data;
    assert.equal(byValue.customers[0].id, big.id);

    const blocked = (await support.client.get(`${STAFF}/customers?stage=blocked&limit=1`)).data;
    assert.equal(blocked.total, 2);
    assert.equal(blocked.customers.length, 1, "one page");
    assert.equal(blocked.segmentValueToman, 9_001_000, "the whole segment's value, not the page's");
  });

  it("Search matches the name or the email, and its text is not a pattern", async () => {
    const person = await aCustomerAccount();
    const found = (await support.client.get(`${STAFF}/customers?search=${encodeURIComponent(person.email)}`)).data;
    assert.deepEqual(
      found.customers.map((row: { id: string }) => row.id),
      [person.id],
    );
    assert.equal((await support.client.get(`${STAFF}/customers?search=%25%25`)).data.total, 0);
  });

  it("Segments list every stage in use with its value, and each tag with its count", async () => {
    const segments = (await support.client.get(`${STAFF}/customers/segments`)).data;
    const blocked = segments.stages.find((row: { stage: string }) => row.stage === "blocked");
    assert.ok(blocked.customers >= 2);
    assert.ok(Array.isArray(segments.tags));
  });

  it("Nobody signed out, and no customer, reads the list", async () => {
    assert.equal((await createClient().get(`${STAFF}/customers`)).status, 401);
    const accountantless = await signedInStaff(["editor"]);
    assert.equal((await accountantless.client.get(`${STAFF}/customers`)).status, 403);
  });
});

// ------------------------------------------------------------- notes, tags

describe("Notes and tags", () => {
  it("Notes are kept newest first, an empty one is refused, and a deleted one is gone", async () => {
    const person = await aCustomerAccount();
    await support.client.post(`${STAFF}/customers/${person.id}/notes`, { body: "تماس گرفت، مشکل اتصال" });
    const second = await support.client.post(`${STAFF}/customers/${person.id}/notes`, { body: "حل شد" });
    assert.equal(second.status, 201);
    assert.deepEqual(
      second.data.notes.map((note: { body: string }) => note.body),
      ["حل شد", "تماس گرفت، مشکل اتصال"],
    );
    assert.ok(second.data.notes[0].authorName);
    assert.equal((await support.client.post(`${STAFF}/customers/${person.id}/notes`, { body: " " })).status, 400);

    const after = await support.client.del(`${STAFF}/customers/${person.id}/notes/${second.data.notes[0].id}`);
    assert.equal(after.data.notes.length, 1);
  });

  it("Tags are one per name whatever the case, and filter the list", async () => {
    const person = await aCustomerAccount();
    const other = await aCustomerAccount();
    const tagged = await support.client.put(`${STAFF}/customers/${person.id}/tags`, { tags: ["Reseller", "reseller", "تلگرام"] });
    assert.equal(tagged.status, 200, JSON.stringify(tagged.data));
    assert.equal(tagged.data.tags.length, 2);
    await support.client.put(`${STAFF}/customers/${other.id}/tags`, { tags: ["RESELLER"] });
    const otherTags = (await customer(other.id)).tags;
    assert.equal(otherTags[0].id, tagged.data.tags.find((tag: { name: string }) => tag.name === "Reseller").id);

    const filtered = (await support.client.get(`${STAFF}/customers?tagId=${otherTags[0].id}`)).data;
    assert.deepEqual(
      filtered.customers.map((row: { id: string }) => row.id).sort(),
      [person.id, other.id].sort(),
    );

    const untagged = await support.client.put(`${STAFF}/customers/${person.id}/tags`, { tags: [] });
    assert.deepEqual(untagged.data.tags, []);
  });

  it("Writing needs customers:manage; an unknown customer is not found; a malformed id is a 400", async () => {
    const accountant = await signedInStaff(["accountant"]);
    const person = await aCustomerAccount();
    assert.equal((await accountant.client.post(`${STAFF}/customers/${person.id}/notes`, { body: "x" })).status, 403);
    assert.equal((await support.client.get(`${STAFF}/customers/0190a0a0-0000-7000-8000-000000000000`)).status, 404);
    assert.equal((await support.client.get(`${STAFF}/customers/nope`)).status, 400);
  });
});
