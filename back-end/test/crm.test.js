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
const { CustomerRecord } = require("../src/components/crm/crm.model");

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);

const anOrder = async ({
  user,
  status = "paid",
  price = 100,
  paidAt = daysAgo(1),
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
        name: "Basic",
        period: "1 month",
        price,
        quantity: 1,
      },
    ],
    totalPrice: price,
    status,
    createdAt: paidAt,
    ...(status === "paid" ? { paidAt } : {}),
  });

describe("CRM", () => {
  before(async () => startTestServer());
  after(async () => stopTestServer());
  beforeEach(async () => clearDatabase());

  describe("Access control", () => {
    it("When nobody is signed in, then the customer list responds 401", async () => {
      const client = createClient();

      const response = await client.get("/crm/customers");

      assert.equal(response.status, 401);
    });

    it("When an ordinary customer asks, then it responds 403", async () => {
      // Purchase histories and internal notes are not the customer's to read.
      const client = createClient();
      await loginAs(client, "user");

      const response = await client.get("/crm/customers");

      assert.equal(response.status, 403);
    });
  });

  describe("Customer metrics", () => {
    it("When a customer has paid, then lifetime value counts only paid orders", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await anOrder({ user, price: 100 });
      await anOrder({ user, price: 200 });
      await anOrder({ user, status: "failed", price: 900 });
      await anOrder({ user, status: "pending", price: 500 });

      const response = await client.get(`/crm/customers/${user._id}`);

      assert.equal(response.data.lifetimeValue, 300);
      assert.equal(response.data.paidOrders, 2);
      assert.equal(response.data.failedOrders, 1);
      assert.equal(response.data.pendingOrders, 1);
      assert.equal(response.data.averageOrderValue, 150);
    });

    it("When a customer has never bought, then their value is zero, not missing", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      const response = await client.get(`/crm/customers/${user._id}`);

      assert.equal(response.data.lifetimeValue, 0);
      assert.equal(response.data.paidOrders, 0);
      assert.equal(response.data.lastOrderAt, null);
    });
  });

  describe("Lifecycle stages", () => {
    it("When somebody has never bought, then they are a lead", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      const response = await client.get(`/crm/customers/${user._id}`);

      assert.equal(response.data.computedStage, "lead");
      assert.equal(response.data.stage, "lead");
    });

    it("When somebody bought recently, then they are active", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();
      await anOrder({ user, paidAt: daysAgo(5) });

      const response = await client.get(`/crm/customers/${user._id}`);

      assert.equal(response.data.stage, "active");
    });

    it("When the last purchase was months ago, then they are at risk", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();
      await anOrder({ user, paidAt: daysAgo(90) });

      const response = await client.get(`/crm/customers/${user._id}`);

      assert.equal(response.data.stage, "at-risk");
      assert.equal(response.data.daysSinceLastOrder, 90);
    });

    it("When the last purchase was over half a year ago, then they have churned", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();
      await anOrder({ user, paidAt: daysAgo(300) });

      const response = await client.get(`/crm/customers/${user._id}`);

      assert.equal(response.data.stage, "churned");
    });

    it("When a stage is set by hand, then it wins but the computed one still shows", async () => {
      // Staff knowledge beats a rule of thumb, and the rule stays visible so
      // nobody has to guess why the two disagree.
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();
      await anOrder({ user, paidAt: daysAgo(300) });

      const response = await client.put(`/crm/customers/${user._id}`, {
        stage: "vip",
      });

      assert.equal(response.status, 200);
      assert.equal(response.data.stage, "vip");
      assert.equal(response.data.stageOverride, "vip");
      assert.equal(response.data.computedStage, "churned");
    });

    it("When the override is cleared, then the stage returns to the data", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();
      await anOrder({ user, paidAt: daysAgo(300) });
      await client.put(`/crm/customers/${user._id}`, { stage: "vip" });

      const response = await client.put(`/crm/customers/${user._id}`, {
        stage: "",
      });

      assert.equal(response.data.stageOverride, null);
      assert.equal(response.data.stage, "churned");
    });

    it("When an unknown stage is sent, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      const response = await client.put(`/crm/customers/${user._id}`, {
        stage: "prospect",
      });

      assert.equal(response.status, 400);
    });
  });

  describe("The customer list", () => {
    it("When customers are listed, then the highest value comes first", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user: small } = await aUserInDb();
      const { user: large } = await aUserInDb();
      await anOrder({ user: small, price: 20 });
      await anOrder({ user: large, price: 400 });

      const response = await client.get("/crm/customers");

      assert.equal(response.data.customers[0].username, large.username);
      assert.equal(response.data.customers[0].lifetimeValue, 400);
    });

    it("When a search term is given, then it matches name or email", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb({ username: "findable_person" });
      await aUserInDb();

      const response = await client.get("/crm/customers?search=findable");

      assert.equal(response.data.totalCustomersLength, 1);
      assert.equal(response.data.customers[0].username, user.username);
    });

    it("When filtered by stage, then only that segment is returned", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user: buyer } = await aUserInDb();
      await aUserInDb();
      await anOrder({ user: buyer, paidAt: daysAgo(2) });

      const response = await client.get("/crm/customers?stage=active");

      assert.equal(response.data.customers.length, 1);
      assert.equal(response.data.customers[0].username, buyer.username);
    });

    it("When a segment is returned, then its value covers the whole segment", async () => {
      // Not just the page. A segment total that only added up one page would
      // be smaller every time somebody changed the page size.
      const client = createClient();
      await loginAs(client, "owner");
      const { user: first } = await aUserInDb();
      const { user: second } = await aUserInDb();
      await anOrder({ user: first, price: 100 });
      await anOrder({ user: second, price: 250 });

      const response = await client.get("/crm/customers?limit=1");

      assert.equal(response.data.customers.length, 1);
      assert.equal(response.data.segmentValue, 350);
    });

    it("When the search term contains regex characters, then they are treated as text", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      await aUserInDb();

      const response = await client.get("/crm/customers?search=.*");

      assert.equal(response.status, 200);
      assert.equal(response.data.totalCustomersLength, 0);
    });
  });

  describe("Notes", () => {
    it("When a note is added, then it is stored against the customer", async () => {
      const client = createClient();
      const { user: staff } = await loginAs(client, "owner");
      const { user } = await aUserInDb();

      const response = await client.post(`/crm/customers/${user._id}/notes`, {
        body: "Asked about invoicing in euros.",
      });

      assert.equal(response.status, 201);
      assert.equal(response.data.notes.length, 1);
      assert.equal(response.data.notes[0].body, "Asked about invoicing in euros.");
      assert.equal(response.data.notes[0].author.name, staff.username);
    });

    it("When a note is empty, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      const response = await client.post(`/crm/customers/${user._id}/notes`, {
        body: "   ",
      });

      assert.equal(response.status, 400);
    });

    it("When a note is deleted, then it is gone", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();
      const created = await client.post(`/crm/customers/${user._id}/notes`, {
        body: "Never mind",
      });
      const noteId = created.data.notes[0]._id;

      const response = await client.del(
        `/crm/customers/${user._id}/notes/${noteId}`,
      );

      assert.equal(response.status, 200);
      assert.equal(response.data.notes.length, 0);
    });

    it("When notes exist, then the newest is first", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();
      await client.post(`/crm/customers/${user._id}/notes`, { body: "First" });
      await client.post(`/crm/customers/${user._id}/notes`, { body: "Second" });

      const response = await client.get(`/crm/customers/${user._id}`);

      assert.equal(response.data.notes[0].body, "Second");
    });
  });

  describe("Tags", () => {
    it("When tags are set, then they are lowercased and de-duplicated", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      const response = await client.put(`/crm/customers/${user._id}`, {
        tags: ["Enterprise", "enterprise", "  Referral  ", ""],
      });

      assert.deepEqual(response.data.tags, ["enterprise", "referral"]);
    });

    it("When filtered by tag, then only tagged customers come back", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();
      await aUserInDb();
      await client.put(`/crm/customers/${user._id}`, { tags: ["enterprise"] });

      const response = await client.get("/crm/customers?tag=enterprise");

      assert.equal(response.data.customers.length, 1);
    });
  });

  describe("The customer record", () => {
    it("When nothing has been written, then no record is created just by reading", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user } = await aUserInDb();

      await client.get(`/crm/customers/${user._id}`);

      assert.equal(await CustomerRecord.countDocuments({}), 0);
    });

    it("When the customer does not exist, then it responds 404", async () => {
      const client = createClient();
      await loginAs(client, "owner");

      const response = await client.get(
        "/crm/customers/64b7f0d2f0d2f0d2f0d2f0d2",
      );

      assert.equal(response.status, 404);
    });

    it("When the id is malformed, then it responds 400 rather than 500", async () => {
      const client = createClient();
      await loginAs(client, "owner");

      const response = await client.get("/crm/customers/not-an-id");

      assert.equal(response.status, 400);
    });
  });

  describe("Segments", () => {
    it("When the book is summarised, then every stage is present with its value", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user: active } = await aUserInDb();
      const { user: gone } = await aUserInDb();
      await aUserInDb();
      await anOrder({ user: active, price: 100, paidAt: daysAgo(3) });
      await anOrder({ user: gone, price: 50, paidAt: daysAgo(300) });

      const response = await client.get("/crm/segments");

      const bucket = (stage) =>
        response.data.segments.find((row) => row.stage === stage);

      assert.equal(bucket("active").customers, 1);
      assert.equal(bucket("active").value, 100);
      assert.equal(bucket("churned").customers, 1);
      // The signed-in owner has never bought either, so two leads.
      assert.equal(bucket("lead").customers, 2);
      // The thresholds travel with the numbers so the labels can be explained.
      assert.equal(response.data.rules.atRiskAfterDays, 60);
    });
  });
});
