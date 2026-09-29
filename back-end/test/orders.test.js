"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  startTestServer,
  stopTestServer,
  clearDatabase,
} = require("./helpers/test-server");
const { createClient } = require("./helpers/api-client");
const { aProductInDb, loginAs } = require("./helpers/test-data");
const { payments } = require("./helpers/fakes");
const { Order } = require("../src/components/orders/order.model");

/** Signs a client in and puts one product in its cart. */
const aShopperWithACart = async ({ price = 25, quantity = 1 } = {}) => {
  const client = createClient();
  const { user } = await loginAs(client);
  const product = await aProductInDb({ price });
  for (let index = 0; index < quantity; index += 1) {
    await client.post(`/cart/${product._id}`);
  }
  return { client, user, product };
};

describe("Orders and payment", () => {
  before(async () => startTestServer());
  after(async () => stopTestServer());
  beforeEach(async () => {
    await clearDatabase();
    payments.reset();
  });

  describe("Access control", () => {
    it("When nobody is signed in, then starting a payment responds 401", async () => {
      const client = createClient();

      const response = await client.post("/payment");

      assert.equal(response.status, 401);
    });

    it("When nobody is signed in, then the invoice list responds 401", async () => {
      const client = createClient();

      const response = await client.get("/get-invoices");

      assert.equal(response.status, 401);
    });
  });

  describe("GET /checkout", () => {
    it("When the cart has items, then it previews the order without saving one", async () => {
      // Arrange
      const { client } = await aShopperWithACart({ price: 25, quantity: 2 });

      // Act
      const response = await client.get("/checkout");

      // Assert - the response
      assert.equal(response.status, 200);
      assert.equal(response.data.totalPrice, 50);
      assert.equal(response.data.items.length, 1);

      // Assert - a preview must not create a record
      assert.equal(await Order.countDocuments({}), 0);
    });

    it("When the cart is empty, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.get("/checkout");

      assert.equal(response.status, 400);
    });
  });

  describe("POST /payment", () => {
    it("When the cart has items, then a pending order is stored and a redirect returned", async () => {
      const { client, product } = await aShopperWithACart({ price: 40 });

      const response = await client.post("/payment");

      assert.equal(response.status, 200);
      assert.ok(response.data.url);
      assert.ok(response.data.authority);

      const stored = await Order.findById(response.data.orderId);
      assert.equal(stored.status, "pending");
      assert.equal(stored.totalPrice, 40);
      assert.equal(String(stored.items[0].productId), String(product._id));
    });

    it("When the payment opens, then the provider is charged the server-side total", async () => {
      // The old handler took the amount from the request body, so a caller
      // could pay one toman for anything. This asserts the outgoing call.
      const { client } = await aShopperWithACart({ price: 99, quantity: 3 });

      await client.post("/payment");

      assert.equal(payments.requests.length, 1);
      assert.equal(payments.requests[0].Amount, 297);
    });

    it("When the client sends its own price, then the server ignores it", async () => {
      const { client } = await aShopperWithACart({ price: 99 });

      await client.post("/payment", {
        order: { totalPrice: 1, items: [] },
        Amount: 1,
      });

      assert.equal(payments.requests[0].Amount, 99);
    });

    it("When the cart is empty, then no payment is opened", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.post("/payment");

      assert.equal(response.status, 400);
      assert.equal(payments.requests.length, 0);
    });

    it("When the provider refuses, then it responds 502 and the order is marked failed", async () => {
      // The old code checked for status 100 and otherwise simply never
      // responded, leaving the browser waiting until it timed out.
      //
      // The order is written before the provider is called, so one exists even
      // when the call fails. That is deliberate: the alternative is a customer
      // holding a live payment link for an order that was never recorded. What
      // matters is that nothing is left pending, so it cannot later be settled.
      const { client } = await aShopperWithACart();
      payments.respondToRequestWith({ status: -11 });

      const response = await client.post("/payment");

      assert.equal(response.status, 502);
      assert.equal(await Order.countDocuments({ status: "pending" }), 0);
      assert.equal(await Order.countDocuments({ status: "failed" }), 1);
    });

    it("When the provider refuses, then the order carries no authority to settle against", async () => {
      // An authority is what a callback is matched on. Without one, a stray
      // callback cannot attach itself to this order at all.
      const { client } = await aShopperWithACart();
      payments.respondToRequestWith({ status: -11 });

      await client.post("/payment");

      const order = await Order.findOne({});
      assert.equal(order.authority, undefined);
    });

    it("When the provider is unreachable, then it responds 502 rather than 500", async () => {
      const { client } = await aShopperWithACart();
      payments.respondToRequestWith(new Error("socket hang up"));

      const response = await client.post("/payment");

      assert.equal(response.status, 502);
    });
  });

  describe("POST /verify-payment", () => {
    it("When the provider confirms, then the order is paid and the cart emptied", async () => {
      // Arrange
      const { client } = await aShopperWithACart({ price: 30 });
      const started = await client.post("/payment");
      payments.respondToVerificationWith({ status: 100, RefID: 987654 });

      // Act
      const response = await client.post("/verify-payment", {
        Authority: started.data.authority,
        Status: "OK",
      });

      // Assert - the response
      assert.equal(response.status, 200);
      assert.equal(response.data.status, "paid");
      assert.equal(response.data.refId, "987654");

      // Assert - the new state
      const cart = await client.get("/cart");
      assert.equal(cart.data.length, 0);
    });

    it("When verifying, then the stored order total is sent, not the current cart", async () => {
      // The cart changes after the order is opened; the amount must not.
      const { client } = await aShopperWithACart({ price: 30 });
      const started = await client.post("/payment");
      const extra = await aProductInDb({ price: 500 });
      await client.post(`/cart/${extra._id}`);

      await client.post("/verify-payment", {
        Authority: started.data.authority,
        Status: "OK",
      });

      assert.equal(payments.verifications[0].Amount, 30);
    });

    it("When the callback arrives twice, then the second is reported as already paid", async () => {
      const { client } = await aShopperWithACart();
      const started = await client.post("/payment");
      await client.post("/verify-payment", {
        Authority: started.data.authority,
        Status: "OK",
      });

      const replay = await client.post("/verify-payment", {
        Authority: started.data.authority,
        Status: "OK",
      });

      assert.equal(replay.status, 200);
      assert.ok(replay.data.refId);
      // Only the first callback reached the provider.
      assert.equal(payments.verifications.length, 1);
    });

    it("When the user cancelled at the gateway, then the order is marked failed", async () => {
      const { client } = await aShopperWithACart();
      const started = await client.post("/payment");

      const response = await client.post("/verify-payment", {
        Authority: started.data.authority,
        Status: "NOK",
      });

      assert.equal(response.status, 400);
      const stored = await Order.findOne({ authority: started.data.authority });
      assert.equal(stored.status, "failed");
      assert.equal(payments.verifications.length, 0);
    });

    it("When the provider declines the verification, then nothing is marked paid", async () => {
      const { client } = await aShopperWithACart();
      const started = await client.post("/payment");
      payments.respondToVerificationWith({ status: -21 });

      const response = await client.post("/verify-payment", {
        Authority: started.data.authority,
        Status: "OK",
      });

      assert.equal(response.status, 400);
      const stored = await Order.findOne({ authority: started.data.authority });
      assert.equal(stored.status, "failed");
      assert.equal(stored.paidAt, undefined);
    });

    it("When the Authority is missing, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.post("/verify-payment", { Status: "OK" });

      assert.equal(response.status, 400);
    });

    it("When the authority belongs to another user, then it responds 404", async () => {
      // Orders are looked up by authority AND owner, so a leaked callback URL
      // cannot be used to settle an order that is not yours.
      const { client } = await aShopperWithACart();
      const started = await client.post("/payment");
      const stranger = createClient();
      await loginAs(stranger);

      const response = await stranger.post("/verify-payment", {
        Authority: started.data.authority,
        Status: "OK",
      });

      assert.equal(response.status, 404);
    });
  });

  describe("GET /get-invoices", () => {
    it("When the user has orders, then they come back newest first", async () => {
      const { client } = await aShopperWithACart({ price: 10 });
      await client.post("/payment");
      payments.respondToRequestWith({
        status: 100,
        authority: "A00000000000000000000000000000000002",
        url: "https://sandbox.zarinpal.com/pg/StartPay/second",
      });
      const second = await aProductInDb({ price: 70 });
      await client.post(`/cart/${second._id}`);
      await client.post("/payment");

      const response = await client.get("/get-invoices");

      assert.equal(response.status, 200);
      assert.equal(response.data.length, 2);
      assert.ok(
        new Date(response.data[0].createdAt) >=
          new Date(response.data[1].createdAt),
      );
    });

    it("When the user has no orders, then it responds 404", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.get("/get-invoices");

      assert.equal(response.status, 404);
    });

    it("When another user has orders, then they are not listed here", async () => {
      const { client } = await aShopperWithACart();
      await client.post("/payment");
      const stranger = createClient();
      await loginAs(stranger);

      const response = await stranger.get("/get-invoices");

      assert.equal(response.status, 404);
    });
  });
});
