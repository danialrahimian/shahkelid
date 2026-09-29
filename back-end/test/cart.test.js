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
const { Product } = require("../src/components/products/product.model");

describe("Shopping cart", () => {
  before(async () => startTestServer());
  after(async () => stopTestServer());
  beforeEach(async () => clearDatabase());

  describe("Access control", () => {
    it("When nobody is signed in, then reading the cart responds 401", async () => {
      // Every cart route used to dereference req.user without checking, so an
      // anonymous call crashed the handler instead of being turned away.
      const client = createClient();

      const response = await client.get("/cart");

      assert.equal(response.status, 401);
    });

    it("When nobody is signed in, then adding to the cart responds 401", async () => {
      const client = createClient();
      const product = await aProductInDb();

      const response = await client.post(`/cart/${product._id}`);

      assert.equal(response.status, 401);
    });
  });

  describe("POST /cart/:productId", () => {
    it("When a product is added, then it appears in the cart with quantity one", async () => {
      // Arrange
      const client = createClient();
      await loginAs(client);
      const product = await aProductInDb();

      // Act
      const response = await client.post(`/cart/${product._id}`);

      // Assert - the response
      assert.equal(response.status, 200);
      assert.equal(response.data.length, 1);
      assert.equal(response.data[0].quantity, 1);

      // Assert - the new state, read back through the API
      const cart = await client.get("/cart");
      assert.equal(cart.data.length, 1);
      assert.equal(String(cart.data[0].productId), String(product._id));
    });

    it("When the same product is added twice, then the quantity rises instead of duplicating", async () => {
      const client = createClient();
      await loginAs(client);
      const product = await aProductInDb();

      await client.post(`/cart/${product._id}`);
      const response = await client.post(`/cart/${product._id}`);

      assert.equal(response.data.length, 1);
      assert.equal(response.data[0].quantity, 2);
    });

    it("When two different products are added, then both are kept", async () => {
      const client = createClient();
      await loginAs(client);
      const first = await aProductInDb();
      const second = await aProductInDb();

      await client.post(`/cart/${first._id}`);
      const response = await client.post(`/cart/${second._id}`);

      assert.equal(response.data.length, 2);
    });

    it("When the product does not exist, then it responds 404", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.post("/cart/64b7f0d2f0d2f0d2f0d2f0d2");

      assert.equal(response.status, 404);
    });

    it("When the id is malformed, then it responds 400 rather than 500", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.post("/cart/not-an-id");

      assert.equal(response.status, 400);
    });

    it("When one user fills their cart, then another user's cart stays empty", async () => {
      // Carts hang off the session, so a leak here would be visible to anyone.
      const shopper = createClient();
      const bystander = createClient();
      await loginAs(shopper);
      await loginAs(bystander);
      const product = await aProductInDb();

      await shopper.post(`/cart/${product._id}`);

      const otherCart = await bystander.get("/cart");
      assert.equal(otherCart.data.length, 0);
    });
  });

  describe("POST /cart/remove/:productId", () => {
    it("When a line has two units, then removing takes one off", async () => {
      const client = createClient();
      await loginAs(client);
      const product = await aProductInDb();
      await client.post(`/cart/${product._id}`);
      await client.post(`/cart/${product._id}`);

      const response = await client.post(`/cart/remove/${product._id}`);

      assert.equal(response.status, 200);
      assert.equal(response.data[0].quantity, 1);
    });

    it("When the last unit is removed, then the line disappears", async () => {
      const client = createClient();
      await loginAs(client);
      const product = await aProductInDb();
      await client.post(`/cart/${product._id}`);

      const response = await client.post(`/cart/remove/${product._id}`);

      assert.equal(response.data.length, 0);
    });

    it("When the product was deleted, then it can still be taken out of the cart", async () => {
      // Removal used to look the product up first and fail if it was gone, so
      // a plan withdrawn from the catalogue stayed in the cart forever with no
      // way to clear it.
      const client = createClient();
      await loginAs(client);
      const product = await aProductInDb();
      await client.post(`/cart/${product._id}`);

      await Product.findByIdAndDelete(product._id);

      const response = await client.post(`/cart/remove/${product._id}`);

      assert.equal(response.status, 200);
      assert.equal(response.data.length, 0);
    });

    it("When the product is not in the cart, then it responds 200 and changes nothing", async () => {
      // Removing something absent is a no-op, not a crash: the old helper
      // indexed into the items array with -1.
      const client = createClient();
      await loginAs(client);
      const inCart = await aProductInDb();
      const neverAdded = await aProductInDb();
      await client.post(`/cart/${inCart._id}`);

      const response = await client.post(`/cart/remove/${neverAdded._id}`);

      assert.equal(response.status, 200);
      assert.equal(response.data.length, 1);
    });
  });
});
