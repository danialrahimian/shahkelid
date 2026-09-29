"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  startTestServer,
  stopTestServer,
  clearDatabase,
} = require("./helpers/test-server");
const { createClient } = require("./helpers/api-client");
const { aProductInDb, loginAs, unique } = require("./helpers/test-data");
const {
  Product,
  BILLING_PERIODS,
} = require("../src/components/products/product.model");
const config = require("../src/config");
const { Order } = require("../src/components/orders/order.model");

// A one-pixel PNG, small enough to inline and a genuinely valid image.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Builds the multipart body the product form sends. */
const aProductForm = ({
  name = `plan ${unique()}`,
  period = "1 month",
  price = 120,
  perks = ["fast", "secure"],
  withImage = true,
  mimeType = "image/png",
  fileName = "plan.png",
} = {}) => {
  const form = new FormData();
  form.set("name", name);
  form.set("period", period);
  form.set("price", String(price));
  form.set("perks", JSON.stringify(perks));
  if (withImage) {
    form.set("image", new Blob([PNG_BYTES], { type: mimeType }), fileName);
  }
  return form;
};

// Uploads land on the real disk, so the suite removes what it wrote.
const writtenFiles = new Set();
const trackImage = (publicPath) => {
  if (publicPath) writtenFiles.add(path.basename(publicPath));
};
const removeWrittenFiles = async () => {
  await Promise.all(
    [...writtenFiles].map((name) =>
      fs.rm(path.join(config.uploads.directory, name), { force: true }),
    ),
  );
  writtenFiles.clear();
};

describe("Product administration", () => {
  before(async () => startTestServer());
  after(async () => {
    await removeWrittenFiles();
    await stopTestServer();
  });
  beforeEach(async () => clearDatabase());

  describe("Access control", () => {
    it("When nobody is signed in, then creating a product responds 401", async () => {
      // These endpoints shipped with no authentication at all: anyone on the
      // network could create, edit or delete products.
      const client = createClient();

      const response = await client.post("/admin", aProductForm());

      assert.equal(response.status, 401);
      assert.equal(await Product.countDocuments({}), 0);
    });

    it("When an ordinary user tries to create a product, then it responds 403", async () => {
      const client = createClient();
      await loginAs(client, "user");

      const response = await client.post("/admin", aProductForm());

      assert.equal(response.status, 403);
      assert.equal(await Product.countDocuments({}), 0);
    });

    it("When an ordinary user asks for the admin product list, then it responds 403", async () => {
      const client = createClient();
      await loginAs(client, "user");

      const response = await client.get("/admin-products");

      assert.equal(response.status, 403);
    });

    it("When an ordinary user tries to delete a product, then the product survives", async () => {
      const client = createClient();
      await loginAs(client, "user");
      const product = await aProductInDb();

      const response = await client.post(`/product/${product._id}`);

      assert.equal(response.status, 403);
      assert.ok(await Product.findById(product._id));
    });
  });

  describe("POST /admin", () => {
    it("When an admin posts a valid form, then the product is created and listed against them", async () => {
      // Arrange
      const client = createClient();
      await loginAs(client, "admin");

      // Act
      const response = await client.post(
        "/admin",
        aProductForm({ name: "gold plan", price: 250 }),
      );
      trackImage(response.data?.product?.image);

      // Assert - the response
      assert.equal(response.status, 201);
      assert.equal(response.data.product.name, "gold plan");
      assert.equal(response.data.product.price, 250);
      assert.equal(response.data.adminProducts.length, 1);

      // Assert - the new state
      const stored = await Product.findById(response.data.product._id);
      assert.equal(stored.name, "gold plan");

      // Assert - the file actually landed in the uploads directory
      const onDisk = path.join(
        config.uploads.directory,
        path.basename(stored.image),
      );
      assert.ok(await fs.stat(onDisk));
    });

    it("When a moderator posts a valid form, then it is allowed too", async () => {
      const client = createClient();
      await loginAs(client, "moderator");

      const response = await client.post("/admin", aProductForm());
      trackImage(response.data?.product?.image);

      assert.equal(response.status, 201);
    });

    it("When the image is missing, then it responds 400 rather than crashing", async () => {
      // The old handler read req.file.filename unguarded, so a request with no
      // image threw a TypeError and the client got no response at all.
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.post(
        "/admin",
        aProductForm({ withImage: false }),
      );

      assert.equal(response.status, 400);
    });

    it("When the upload is not an image, then it is refused", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.post(
        "/admin",
        aProductForm({ mimeType: "application/x-msdownload", fileName: "x.exe" }),
      );

      assert.equal(response.status, 400);
      assert.equal(await Product.countDocuments({}), 0);
    });

    it("When the name is too short, then it responds 400 with a field error", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.post("/admin", aProductForm({ name: "a" }));

      assert.equal(response.status, 400);
      assert.ok(response.data.errors.some((error) => error.path === "name"));
    });

    it("When the period is not one of the three terms, then it responds 400", async () => {
      // The period used to be free text, and the catalogue filled with
      // "/ mo", "/ 6 mo" and "6 mounth". None of those could be grouped or
      // priced, so the server now accepts exactly three values.
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.post(
        "/admin",
        aProductForm({ period: "6 months" }),
      );

      assert.equal(response.status, 400);
      assert.ok(response.data.errors.some((error) => error.path === "period"));
      assert.equal(await Product.countDocuments({}), 0);
    });

    it("When the period is one of the three terms, then it is accepted", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      for (const period of BILLING_PERIODS) {
        const response = await client.post(
          "/admin",
          aProductForm({ period, name: `plan ${period.replace(/s/g, "")}` }),
        );
        trackImage(response.data?.product?.image);

        assert.equal(response.status, 201, `${period} should be accepted`);
        assert.equal(response.data.product.period, period);
      }
    });

    it("When the price is negative, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.post("/admin", aProductForm({ price: -5 }));

      assert.equal(response.status, 400);
    });

    it("When perks is not a JSON array, then it responds 400 rather than 500", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      const form = aProductForm();
      form.set("perks", "not json at all");

      const response = await client.post("/admin", form);

      assert.equal(response.status, 400);
    });

    it("When the form is rejected, then the uploaded file is not left on disk", async () => {
      // Multer writes the file before the validators run, so every failed
      // attempt used to leave an image nothing would ever reference again.
      const client = createClient();
      await loginAs(client, "admin");
      const before = await fs.readdir(config.uploads.directory);

      const response = await client.post("/admin", aProductForm({ name: "a" }));

      assert.equal(response.status, 400);
      const after = await fs.readdir(config.uploads.directory);
      assert.deepEqual(after.sort(), before.sort());
    });

    it("When the image name is reused, then the stored file name is still unique", async () => {
      // Predictable upload names would let one admin overwrite another's file.
      const client = createClient();
      await loginAs(client, "admin");

      const first = await client.post("/admin", aProductForm());
      const second = await client.post("/admin", aProductForm());
      trackImage(first.data?.product?.image);
      trackImage(second.data?.product?.image);

      assert.notEqual(first.data.product.image, second.data.product.image);
    });
  });

  describe("PUT /admin/:productId", () => {
    it("When the fields change, then the product is updated", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      const created = await client.post("/admin", aProductForm());
      trackImage(created.data?.product?.image);

      const response = await client.put(
        `/admin/${created.data.product._id}`,
        aProductForm({ name: "renamed plan", price: 999, withImage: false }),
      );

      assert.equal(response.status, 200);
      assert.equal(response.data.product.name, "renamed plan");
      const stored = await Product.findById(created.data.product._id);
      assert.equal(stored.price, 999);
    });

    it("When no new image is sent, then the existing one is kept", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      const created = await client.post("/admin", aProductForm());
      trackImage(created.data?.product?.image);

      const response = await client.put(
        `/admin/${created.data.product._id}`,
        aProductForm({ withImage: false }),
      );

      assert.equal(response.data.product.image, created.data.product.image);
    });

    it("When a new image is sent, then the old file is removed from disk", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      const created = await client.post("/admin", aProductForm());
      const oldFile = path.join(
        config.uploads.directory,
        path.basename(created.data.product.image),
      );

      const response = await client.put(
        `/admin/${created.data.product._id}`,
        aProductForm(),
      );
      trackImage(response.data?.product?.image);

      assert.notEqual(response.data.product.image, created.data.product.image);
      await assert.rejects(() => fs.stat(oldFile));
    });

    it("When the product does not exist, then it responds 404", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.put(
        "/admin/64b7f0d2f0d2f0d2f0d2f0d2",
        aProductForm({ withImage: false }),
      );

      assert.equal(response.status, 404);
    });
  });

  describe("POST /product/:productId (delete)", () => {
    it("When an admin deletes a product, then it is gone and removed from every cart", async () => {
      // Arrange - a shopper holds the product an admin is about to delete.
      const admin = createClient();
      await loginAs(admin, "admin");
      const created = await admin.post("/admin", aProductForm());
      const productId = created.data.product._id;

      const shopper = createClient();
      await loginAs(shopper, "user");
      await shopper.post(`/cart/${productId}`);

      // Act
      const response = await admin.post(`/product/${productId}`);

      // Assert - the product is gone
      assert.equal(response.status, 200);
      assert.equal(await Product.findById(productId), null);

      // Assert - and so is the dangling cart line
      const cart = await shopper.get("/cart");
      assert.equal(cart.data.length, 0);
    });

    it("When the product is deleted, then its image is removed from disk", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      const created = await client.post("/admin", aProductForm());
      const onDisk = path.join(
        config.uploads.directory,
        path.basename(created.data.product.image),
      );

      await client.post(`/product/${created.data.product._id}`);

      await assert.rejects(() => fs.stat(onDisk));
    });

    it("When a past order still shows the image, then the file is kept", async () => {
      // An invoice keeps its own copy of each line, image path included, and
      // those receipts have to keep rendering. Deleting the file when the plan
      // is withdrawn would break every invoice that ever contained it, with no
      // way to get it back.
      const client = createClient();
      const { user } = await loginAs(client, "admin");
      const created = await client.post("/admin", aProductForm());
      const image = created.data.product.image;
      trackImage(image);

      await Order.create({
        user: {
          userId: user._id,
          username: user.username,
          email: user.email,
        },
        items: [
          {
            productId: created.data.product._id,
            name: created.data.product.name,
            price: created.data.product.price,
            quantity: 1,
            image,
          },
        ],
        totalPrice: created.data.product.price,
        status: "paid",
      });

      await client.post(`/product/${created.data.product._id}`);

      const onDisk = path.join(config.uploads.directory, path.basename(image));
      assert.ok(await fs.stat(onDisk), "the invoice still needs this file");
    });

    it("When the product does not exist, then it responds 404", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.post("/product/64b7f0d2f0d2f0d2f0d2f0d2");

      assert.equal(response.status, 404);
    });
  });

  describe("GET /admin-product/:adminProductId", () => {
    it("When the id is valid, then the product comes back", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      const product = await aProductInDb({ name: "gold plan" });

      const response = await client.get(`/admin-product/${product._id}`);

      assert.equal(response.status, 200);
      assert.equal(response.data.name, "gold plan");
    });

    it("When the id is malformed, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.get("/admin-product/not-an-id");

      assert.equal(response.status, 400);
    });
  });
});
