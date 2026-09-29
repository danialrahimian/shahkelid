"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const {
  startTestServer,
  stopTestServer,
  clearDatabase,
} = require("./helpers/test-server");
const { createClient } = require("./helpers/api-client");
const { aUserInDb, aProductInDb, loginAs } = require("./helpers/test-data");
const { User } = require("../src/components/users/user.model");
const { Product } = require("../src/components/products/product.model");

describe("User administration", () => {
  before(async () => startTestServer());
  after(async () => stopTestServer());
  beforeEach(async () => clearDatabase());

  describe("Access control", () => {
    it("When nobody is signed in, then the user list responds 401", async () => {
      // Every one of these endpoints used to be open to anonymous callers,
      // including the one that can change any user's password.
      const client = createClient();

      const response = await client.get("/mod/users");

      assert.equal(response.status, 401);
    });

    it("When an ordinary user asks for the user list, then it responds 403", async () => {
      const client = createClient();
      await loginAs(client, "user");

      const response = await client.get("/mod/users");

      assert.equal(response.status, 403);
    });

    it("When an ordinary user tries to change someone's password, then nothing changes", async () => {
      const client = createClient();
      await loginAs(client, "user");
      const { user: victim } = await aUserInDb();
      const before = await User.findById(victim._id).select("+password");

      const response = await client.post("/mod/user/edit-user", {
        _id: String(victim._id),
        password: "hijacked123",
      });

      assert.equal(response.status, 403);
      const after = await User.findById(victim._id).select("+password");
      assert.equal(after.password, before.password);
    });

    it("When an ordinary user tries to delete an account, then it survives", async () => {
      const client = createClient();
      await loginAs(client, "user");
      const { user: victim } = await aUserInDb();

      const response = await client.post(
        `/mod/users/delete-user/${victim._id}`,
      );

      assert.equal(response.status, 403);
      assert.ok(await User.findById(victim._id));
    });
  });

  describe("GET /mod/users", () => {
    it("When a moderator asks, then every user comes back", async () => {
      const client = createClient();
      await loginAs(client, "moderator");
      await aUserInDb();
      await aUserInDb();

      const response = await client.get("/mod/users");

      assert.equal(response.status, 200);
      assert.equal(response.data.length, 3);
    });

    it("When users are listed, then no password hash is included", async () => {
      // The old endpoint returned the raw documents, hashes and all.
      const client = createClient();
      await loginAs(client, "moderator");
      await aUserInDb();

      const response = await client.get("/mod/users");

      for (const user of response.data) {
        assert.equal(user.password, undefined);
        assert.equal(user.resetPasswordToken, undefined);
      }
    });

    it("When users are listed, then each carries the fields the panel renders", async () => {
      const client = createClient();
      await loginAs(client, "moderator");

      const response = await client.get("/mod/users");

      const [user] = response.data;
      assert.ok(user._id);
      assert.ok(user.username);
      assert.ok(user.email);
      assert.ok(user.role);
      assert.ok(Array.isArray(user.cart.items));
    });
  });

  describe("POST /mod/users/delete-user/:userId", () => {
    it("When a moderator deletes a user, then the account is gone", async () => {
      // The client always called this route, but it was never registered, so
      // deleting a user answered 404.
      const client = createClient();
      await loginAs(client, "moderator");
      const { user: victim } = await aUserInDb();

      const response = await client.post(
        `/mod/users/delete-user/${victim._id}`,
      );

      assert.equal(response.status, 200);
      assert.equal(await User.findById(victim._id), null);
      assert.equal(response.data.length, 1);
    });

    it("When a moderator deletes their own account, then it is refused", async () => {
      const client = createClient();
      const { user: moderator } = await loginAs(client, "moderator");

      const response = await client.post(
        `/mod/users/delete-user/${moderator._id}`,
      );

      assert.equal(response.status, 400);
      assert.ok(await User.findById(moderator._id));
    });

    it("When the user does not exist, then it responds 404", async () => {
      const client = createClient();
      await loginAs(client, "moderator");

      const response = await client.post(
        "/mod/users/delete-user/64b7f0d2f0d2f0d2f0d2f0d2",
      );

      assert.equal(response.status, 404);
    });

    it("When the id is malformed, then it responds 400 rather than 500", async () => {
      const client = createClient();
      await loginAs(client, "moderator");

      const response = await client.post("/mod/users/delete-user/not-an-id");

      assert.equal(response.status, 400);
    });
  });

  describe("POST /mod/user/edit-user", () => {
    it("When the profile fields change, then they are saved", async () => {
      // Arrange
      const client = createClient();
      await loginAs(client, "moderator");
      const { user: target } = await aUserInDb();

      // Act
      const response = await client.post("/mod/user/edit-user", {
        _id: String(target._id),
        username: "renamed_user",
        email: "renamed@example.com",
      });

      // Assert
      assert.equal(response.status, 200);
      const stored = await User.findById(target._id);
      assert.equal(stored.username, "renamed_user");
      assert.equal(stored.email, "renamed@example.com");
    });

    it("When a new password is sent, then it is stored hashed and works for login", async () => {
      const client = createClient();
      await loginAs(client, "moderator");
      const { user: target } = await aUserInDb();

      await client.post("/mod/user/edit-user", {
        _id: String(target._id),
        password: "FreshPass!9",
      });

      const stored = await User.findById(target._id).select("+password");
      assert.notEqual(stored.password, "FreshPass!9");
      assert.ok(await bcrypt.compare("FreshPass!9", stored.password));
    });

    it("When the password field is left blank, then the current password is kept", async () => {
      // The panel submits the whole form, so an empty box must mean no change.
      const client = createClient();
      await loginAs(client, "moderator");
      const { user: target } = await aUserInDb();
      const before = await User.findById(target._id).select("+password");

      const response = await client.post("/mod/user/edit-user", {
        _id: String(target._id),
        username: "still_here",
        password: "",
      });

      assert.equal(response.status, 200);
      const after = await User.findById(target._id).select("+password");
      assert.equal(after.password, before.password);
    });

    it("When a moderator tries to change a role, then it responds 403", async () => {
      // Otherwise any moderator could promote themselves to owner.
      const client = createClient();
      await loginAs(client, "moderator");
      const { user: target } = await aUserInDb();

      const response = await client.post("/mod/user/edit-user", {
        _id: String(target._id),
        role: "admin",
      });

      assert.equal(response.status, 403);
      const stored = await User.findById(target._id);
      assert.equal(stored.role, "user");
    });

    it("When an owner changes a role, then it is applied", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user: target } = await aUserInDb();

      const response = await client.post("/mod/user/edit-user", {
        _id: String(target._id),
        role: "admin",
      });

      assert.equal(response.status, 200);
      const stored = await User.findById(target._id);
      assert.equal(stored.role, "admin");
    });

    it("When an owner sends an unknown role, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client, "owner");
      const { user: target } = await aUserInDb();

      const response = await client.post("/mod/user/edit-user", {
        _id: String(target._id),
        role: "superuser",
      });

      assert.equal(response.status, 400);
    });

    it("When the email is malformed, then it responds 400 with a field error", async () => {
      const client = createClient();
      await loginAs(client, "moderator");
      const { user: target } = await aUserInDb();

      const response = await client.post("/mod/user/edit-user", {
        _id: String(target._id),
        email: "not-an-email",
      });

      assert.equal(response.status, 400);
      assert.ok(response.data.errors.some((error) => error.path === "email"));
    });

    it("When no user id is sent, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client, "moderator");

      const response = await client.post("/mod/user/edit-user", {
        username: "nobody",
      });

      assert.equal(response.status, 400);
    });

    it("When the user does not exist, then it responds 404", async () => {
      const client = createClient();
      await loginAs(client, "moderator");

      const response = await client.post("/mod/user/edit-user", {
        _id: "64b7f0d2f0d2f0d2f0d2f0d2",
        username: "ghost_user",
      });

      assert.equal(response.status, 404);
    });
  });

  describe("POST /mod/user-cart/add and /remove", () => {
    it("When a moderator adds a product, then it appears in that user's cart", async () => {
      const client = createClient();
      await loginAs(client, "moderator");
      const { user: target } = await aUserInDb();
      const product = await aProductInDb();

      const response = await client.post("/mod/user-cart/add", {
        userId: String(target._id),
        productId: String(product._id),
      });

      assert.equal(response.status, 200);
      const stored = await User.findById(target._id);
      assert.equal(stored.cart.items.length, 1);
      assert.equal(stored.cart.items[0].quantity, 1);
    });

    it("When a moderator removes a product, then the quantity drops", async () => {
      const client = createClient();
      await loginAs(client, "moderator");
      const { user: target } = await aUserInDb();
      const product = await aProductInDb();
      const payload = {
        userId: String(target._id),
        productId: String(product._id),
      };
      await client.post("/mod/user-cart/add", payload);
      await client.post("/mod/user-cart/add", payload);

      const response = await client.post("/mod/user-cart/remove", payload);

      assert.equal(response.status, 200);
      const stored = await User.findById(target._id);
      assert.equal(stored.cart.items[0].quantity, 1);
    });

    it("When the product does not exist, then adding responds 404", async () => {
      const client = createClient();
      await loginAs(client, "moderator");
      const { user: target } = await aUserInDb();

      const response = await client.post("/mod/user-cart/add", {
        userId: String(target._id),
        productId: "64b7f0d2f0d2f0d2f0d2f0d2",
      });

      assert.equal(response.status, 404);
    });

    it("When a deleted product is stuck in a cart, then a moderator can clear it", async () => {
      // Clearing out a withdrawn plan is exactly when this is needed, so it
      // cannot depend on the plan still being there.
      const client = createClient();
      await loginAs(client, "moderator");
      const { user: target } = await aUserInDb();
      const product = await aProductInDb();
      const payload = {
        userId: String(target._id),
        productId: String(product._id),
      };
      await client.post("/mod/user-cart/add", payload);
      await Product.findByIdAndDelete(product._id);

      const response = await client.post("/mod/user-cart/remove", payload);

      assert.equal(response.status, 200);
      const stored = await User.findById(target._id);
      assert.equal(stored.cart.items.length, 0);
    });

    it("When the ids are missing, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client, "moderator");

      const response = await client.post("/mod/user-cart/add", {});

      assert.equal(response.status, 400);
    });
  });
});
