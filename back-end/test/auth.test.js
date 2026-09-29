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
const { aSignUpPayload, aUserInDb } = require("./helpers/test-data");
const { User } = require("../src/components/users/user.model");
const authService = require("../src/components/auth/auth.service");

// Tests are grouped by route, then by story, so the file reads like the API
// documentation (testing practice 4.5).
describe("Authentication", () => {
  before(async () => startTestServer());
  after(async () => stopTestServer());
  beforeEach(async () => clearDatabase());

  describe("POST /sign-up", () => {
    it("When the payload is valid, then it creates the user and opens a session", async () => {
      // Arrange
      const client = createClient();
      const payload = aSignUpPayload();

      // Act
      const response = await client.post("/sign-up", payload);

      // Assert - the response itself
      assert.equal(response.status, 201);
      assert.partialDeepStrictEqual(response.data, {
        username: payload.username,
        email: payload.email,
        role: "user",
        isLoggedIn: true,
      });

      // Assert - the new state, read back through the public API
      const status = await client.get("/login-status");
      assert.equal(status.data.isLoggedIn, true);
    });

    it("When signing up, then the password hash is never returned", async () => {
      const client = createClient();

      const response = await client.post("/sign-up", aSignUpPayload());

      assert.equal(response.status, 201);
      assert.equal(response.data.password, undefined);
    });

    it("When signing up, then the password is stored hashed, not in clear text", async () => {
      const client = createClient();
      const payload = aSignUpPayload();

      await client.post("/sign-up", payload);

      const stored = await User.findOne({ username: payload.username }).select(
        "+password",
      );
      assert.notEqual(stored.password, payload.password);
      assert.match(stored.password, /^\$2[aby]\$/);
    });

    it("When the username is already taken, then it responds 409", async () => {
      const client = createClient();
      const payload = aSignUpPayload();
      await client.post("/sign-up", payload);

      const response = await client.post(
        "/sign-up",
        aSignUpPayload({ username: payload.username }),
      );

      assert.equal(response.status, 409);
    });

    it("When the email is malformed, then it responds 400 with a field error", async () => {
      const client = createClient();

      const response = await client.post(
        "/sign-up",
        aSignUpPayload({ email: "not-an-email" }),
      );

      assert.equal(response.status, 400);
      assert.ok(response.data.errors.some((e) => e.path === "email"));
    });

    it("When the address has dots, then it is stored as typed and still logs in", async () => {
      // Sign-up used to run the address through normalizeEmail, which strips
      // dots from gmail addresses. Login did not, so anyone who signed up as
      // "first.last@gmail.com" could never sign in with the address they typed.
      const client = createClient();
      const email = "First.Last@gmail.com";

      const signUp = await client.post(
        "/sign-up",
        aSignUpPayload({ email, username: "dotted_user" }),
      );

      assert.equal(signUp.status, 201);
      assert.equal(signUp.data.email, "first.last@gmail.com");

      const returning = createClient();
      const login = await returning.post("/login", {
        username: email,
        email,
        password: "Str0ng!Pass",
      });
      assert.equal(login.status, 200);
    });

    it("When the address is padded with spaces, then it is accepted and trimmed", async () => {
      // Phone keyboards add a trailing space often enough that rejecting it
      // as "email is not valid" is a bug report waiting to happen.
      const client = createClient();

      const response = await client.post(
        "/sign-up",
        aSignUpPayload({ email: "  padded@example.com  " }),
      );

      assert.equal(response.status, 201);
      assert.equal(response.data.email, "padded@example.com");
    });

    it("When the address differs only in case, then it is treated as the same account", async () => {
      const client = createClient();
      const payload = aSignUpPayload({ email: "Casey@Example.com" });
      await client.post("/sign-up", payload);

      const response = await createClient().post(
        "/sign-up",
        aSignUpPayload({ email: "casey@example.com" }),
      );

      assert.equal(response.status, 409);
    });

    it("When the password is too short, then it responds 400", async () => {
      const client = createClient();

      const response = await client.post(
        "/sign-up",
        aSignUpPayload({ password: "abc" }),
      );

      assert.equal(response.status, 400);
    });
  });

  describe("POST /login", () => {
    it("When the credentials are right, then it responds 200 and opens a session", async () => {
      const client = createClient();
      const { user, password } = await aUserInDb();

      const response = await client.post("/login", {
        username: user.username,
        email: user.username,
        password,
      });

      assert.equal(response.status, 200);
      assert.partialDeepStrictEqual(response.data, {
        username: user.username,
        isLoggedIn: true,
      });
      assert.equal(response.data.password, undefined);
    });

    it("When the email is used instead of the username, then it still signs in", async () => {
      const client = createClient();
      const { user, password } = await aUserInDb();

      const response = await client.post("/login", {
        username: user.email,
        email: user.email,
        password,
      });

      assert.equal(response.status, 200);
    });

    it("When the password is wrong, then it responds 401", async () => {
      const client = createClient();
      const { user } = await aUserInDb();

      const response = await client.post("/login", {
        username: user.username,
        email: user.email,
        password: "definitely-wrong",
      });

      assert.equal(response.status, 401);
    });

    it("When the account does not exist, then the message matches a wrong password", async () => {
      // Guards against user enumeration: both paths must look identical.
      const client = createClient();
      const { user } = await aUserInDb();

      const unknown = await client.post("/login", {
        username: "no_such_user",
        email: "no_such_user@example.com",
        password: "whatever123",
      });
      const wrongPassword = await client.post("/login", {
        username: user.username,
        email: user.email,
        password: "whatever123",
      });

      assert.equal(unknown.status, wrongPassword.status);
      assert.deepEqual(unknown.data, wrongPassword.data);
    });

    it("When the account does not exist, then the wasted comparison is against a real hash", async () => {
      // Matching messages are not enough on their own: rejecting an unknown
      // account also has to cost what a genuine check costs. The placeholder
      // this used to compare against was not a valid bcrypt hash, so bcrypt
      // refused it in microseconds instead of running the cost factor, and the
      // response time still said which usernames are registered.
      const dummy = authService.DUMMY_PASSWORD_HASH;

      // A bcrypt hash is 60 characters: the algorithm, the cost, and a 53
      // character salt-and-digest tail.
      assert.equal(dummy.length, 60);
      assert.match(dummy, /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/);

      // And it really does compare, rather than erroring out to false.
      const started = process.hrtime.bigint();
      assert.equal(await bcrypt.compare("whatever123", dummy), false);
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      assert.ok(elapsedMs > 0.5, `comparison took only ${elapsedMs}ms`);
    });
  });

  describe("GET /login-status", () => {
    it("When nobody is signed in, then it reports isLoggedIn false", async () => {
      const client = createClient();

      const response = await client.get("/login-status");

      assert.equal(response.status, 200);
      assert.equal(response.data.isLoggedIn, false);
    });

    it("When signed in, then it carries the same profile fields login returned", async () => {
      // A client that reloads the page rebuilds its session from here, so an
      // answer of only an id and a role left it with no username or cart.
      const client = createClient();
      const { user } = await aUserInDb();
      await client.post("/login", {
        username: user.username,
        email: user.email,
        password: "Str0ng!Pass",
      });

      const response = await client.get("/login-status");

      assert.partialDeepStrictEqual(response.data, {
        isLoggedIn: true,
        _id: String(user._id),
        username: user.username,
        email: user.email,
        role: "user",
      });
      assert.ok(Array.isArray(response.data.cart.items));
      assert.equal(response.data.password, undefined);
    });

    it("When the role changed since login, then the new role is reported", async () => {
      // The role used to be whatever the session captured at login, so a
      // promotion was invisible until the user signed out and back in.
      const client = createClient();
      const { user } = await aUserInDb();
      await client.post("/login", {
        username: user.username,
        email: user.email,
        password: "Str0ng!Pass",
      });
      await User.findByIdAndUpdate(user._id, { role: "admin" });

      const response = await client.get("/login-status");

      assert.equal(response.data.role, "admin");
    });

    it("When the account was deleted, then the session no longer counts as signed in", async () => {
      // Otherwise the client believes it is signed in while every guarded
      // route answers 401.
      const client = createClient();
      const { user } = await aUserInDb();
      await client.post("/login", {
        username: user.username,
        email: user.email,
        password: "Str0ng!Pass",
      });
      await User.findByIdAndDelete(user._id);

      const response = await client.get("/login-status");

      assert.equal(response.data.isLoggedIn, false);
    });
  });

  describe("POST /logout", () => {
    it("When a signed-in user logs out, then the session no longer works", async () => {
      const client = createClient();
      const { user, password } = await aUserInDb();
      await client.post("/login", {
        username: user.username,
        email: user.email,
        password,
      });

      const response = await client.post("/logout");

      assert.equal(response.status, 200);
      const status = await client.get("/login-status");
      assert.equal(status.data.isLoggedIn, false);
    });
  });

  describe("POST /reset-password", () => {
    it("When the email exists, then a reset token is stored", async () => {
      // This route used to be registered as "/reset-passwor " with a trailing
      // space, so every request 404'd and no token was ever issued.
      const client = createClient();
      const { user } = await aUserInDb();

      const response = await client.post("/reset-password", {
        email: user.email,
      });

      assert.equal(response.status, 200);
      const stored = await User.findById(user._id).select(
        "+resetPasswordToken",
      );
      assert.ok(stored.resetPasswordToken);
    });

    it("When the email is unknown, then it still responds 200 and stores nothing", async () => {
      const client = createClient();

      const response = await client.post("/reset-password", {
        email: "nobody@example.com",
      });

      assert.equal(response.status, 200);
      assert.equal(await User.countDocuments({}), 0);
    });
  });

  describe("POST /reset-password/:resetToken", () => {
    it("When the token is valid, then the password changes and the token is burned", async () => {
      const client = createClient();
      const { user } = await aUserInDb();
      await client.post("/reset-password", { email: user.email });
      const withToken = await User.findById(user._id).select(
        "+resetPasswordToken",
      );

      const response = await client.post(
        `/reset-password/${withToken.resetPasswordToken}`,
        { newPassword: "BrandNew!1" },
      );

      assert.equal(response.status, 200);

      // The new password works...
      const fresh = createClient();
      const login = await fresh.post("/login", {
        username: user.username,
        email: user.email,
        password: "BrandNew!1",
      });
      assert.equal(login.status, 200);

      // ...and the link cannot be replayed.
      const replay = await client.post(
        `/reset-password/${withToken.resetPasswordToken}`,
        { newPassword: "Another!1" },
      );
      assert.equal(replay.status, 400);
    });

    it("When the token is unknown, then it responds 400", async () => {
      const client = createClient();

      const response = await client.post("/reset-password/not-a-real-token", {
        newPassword: "BrandNew!1",
      });

      assert.equal(response.status, 400);
    });
  });
});
