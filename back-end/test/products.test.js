"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  startTestServer,
  stopTestServer,
  clearDatabase,
} = require("./helpers/test-server");
const { createClient } = require("./helpers/api-client");
const { aProductInDb } = require("./helpers/test-data");

describe("Product catalogue", () => {
  before(async () => startTestServer());
  after(async () => stopTestServer());
  beforeEach(async () => clearDatabase());

  describe("GET /products", () => {
    it("When products exist, then it returns the first page and the total", async () => {
      // Arrange
      const client = createClient();
      await aProductInDb({ name: "alpha plan" });
      await aProductInDb({ name: "beta plan" });

      // Act
      const response = await client.get("/products");

      // Assert
      assert.equal(response.status, 200);
      assert.equal(response.data.products.length, 2);
      assert.equal(response.data.totalProductsLength, 2);
    });

    it("When the catalogue is browsed anonymously, then it is still readable", async () => {
      // The storefront lists plans before anyone signs in, so this route must
      // stay open while every write route is locked down.
      const client = createClient();
      await aProductInDb();

      const response = await client.get("/products");

      assert.equal(response.status, 200);
    });

    it("When a page is requested, then only that slice comes back", async () => {
      const client = createClient();
      for (const name of ["one", "two", "three", "four", "five"]) {
        await aProductInDb({ name: `plan ${name}` });
      }

      const response = await client.get("/products?page=2&limit=2");

      assert.equal(response.data.products.length, 2);
      assert.equal(response.data.totalProductsLength, 5);
      assert.equal(response.data.limit, 2);
    });

    it("When a huge page size is asked for, then it is capped", async () => {
      // Without a cap one request could pull the whole collection into memory.
      const client = createClient();
      await aProductInDb();

      const response = await client.get("/products?limit=100000");

      assert.equal(response.data.limit, 60);
    });

    it("When a search term is given, then only matching names come back", async () => {
      const client = createClient();
      await aProductInDb({ name: "gold plan" });
      await aProductInDb({ name: "silver plan" });

      const response = await client.get("/products?search=gold");

      assert.equal(response.data.products.length, 1);
      assert.equal(response.data.products[0].name, "gold plan");
    });

    it("When the search term contains regex characters, then they are treated as text", async () => {
      // An unescaped term would either match everything or blow up the query.
      const client = createClient();
      await aProductInDb({ name: "gold plan" });

      const response = await client.get("/products?search=.*");

      assert.equal(response.status, 200);
      assert.equal(response.data.products.length, 0);
    });

    it("When a price range is given, then products outside it are excluded", async () => {
      const client = createClient();
      await aProductInDb({ name: "cheap plan", price: 5 });
      await aProductInDb({ name: "pricey plan", price: 500 });

      const response = await client.get("/products?minPrice=100");

      assert.equal(response.data.products.length, 1);
      assert.equal(response.data.products[0].name, "pricey plan");
    });

    it("When sorting by price descending, then the most expensive comes first", async () => {
      const client = createClient();
      await aProductInDb({ name: "cheap plan", price: 5 });
      await aProductInDb({ name: "pricey plan", price: 500 });

      const response = await client.get("/products?sort=-price");

      assert.equal(response.data.products[0].name, "pricey plan");
    });

    it("When an unknown sort field is given, then it falls back instead of failing", async () => {
      const client = createClient();
      await aProductInDb();

      const response = await client.get("/products?sort=__proto__");

      assert.equal(response.status, 200);
      assert.equal(response.data.products.length, 1);
    });
  });

  describe("GET /product/:productId", () => {
    it("When the product exists, then it is returned", async () => {
      const client = createClient();
      const product = await aProductInDb({ name: "gold plan" });

      const response = await client.get(`/product/${product._id}`);

      assert.equal(response.status, 200);
      assert.equal(response.data.name, "gold plan");
    });

    it("When the id is well-formed but unknown, then it responds 404", async () => {
      const client = createClient();

      const response = await client.get("/product/64b7f0d2f0d2f0d2f0d2f0d2");

      assert.equal(response.status, 404);
    });

    it("When the id is not an object id, then it responds 400 rather than 500", async () => {
      // Mongoose throws a CastError here; unhandled it surfaced as a 500.
      const client = createClient();

      const response = await client.get("/product/not-an-id");

      assert.equal(response.status, 400);
    });
  });

  describe("Unknown routes", () => {
    it("When a route does not exist, then it responds 404 in the shared error shape", async () => {
      const client = createClient();

      const response = await client.get("/no-such-route");

      assert.equal(response.status, 404);
      assert.ok(Array.isArray(response.data.errors));
    });
  });
});
