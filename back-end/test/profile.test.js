"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const fs = require("node:fs/promises");
const path = require("node:path");

const {
  startTestServer,
  stopTestServer,
  clearDatabase,
} = require("./helpers/test-server");
const { createClient } = require("./helpers/api-client");
const { aUserInDb, loginAs } = require("./helpers/test-data");
const { User } = require("../src/components/users/user.model");
const config = require("../src/config");

// A one-pixel PNG, small enough to inline and a genuinely valid image.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const anAvatarUpload = (mimeType = "image/png", fileName = "me.png") => {
  const form = new FormData();
  form.set("avatar", new Blob([PNG_BYTES], { type: mimeType }), fileName);
  return form;
};

// Avatars land on the real disk, so the suite removes what it wrote.
const writtenFiles = new Set();
const trackAvatar = (publicPath) => {
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

describe("Your own profile", () => {
  before(async () => startTestServer());
  after(async () => {
    await removeWrittenFiles();
    await stopTestServer();
  });
  beforeEach(async () => clearDatabase());

  describe("Access control", () => {
    it("When nobody is signed in, then the profile responds 401", async () => {
      const client = createClient();

      const response = await client.get("/profile");

      assert.equal(response.status, 401);
    });

    it("When nobody is signed in, then updating a profile responds 401", async () => {
      const client = createClient();

      const response = await client.put("/profile", { displayName: "Nobody" });

      assert.equal(response.status, 401);
    });
  });

  describe("GET /profile", () => {
    it("When signed in, then it returns the account with its profile fields", async () => {
      const client = createClient();
      const { user } = await loginAs(client);

      const response = await client.get("/profile");

      assert.equal(response.status, 200);
      assert.partialDeepStrictEqual(response.data, {
        _id: String(user._id),
        username: user.username,
        email: user.email,
        role: "user",
        avatar: null,
        displayName: "",
        bio: "",
      });
      assert.equal(response.data.password, undefined);
    });
  });

  describe("PUT /profile", () => {
    it("When the fields change, then they are saved and returned", async () => {
      // Arrange
      const client = createClient();
      const { user } = await loginAs(client);

      // Act
      const response = await client.put("/profile", {
        displayName: "Ada Lovelace",
        bio: "First programmer.",
        country: "United Kingdom",
        phone: "+44 20 7946 0958",
      });

      // Assert - the response
      assert.equal(response.status, 200);
      assert.equal(response.data.displayName, "Ada Lovelace");

      // Assert - the new state
      const stored = await User.findById(user._id);
      assert.equal(stored.bio, "First programmer.");
      assert.equal(stored.country, "United Kingdom");
    });

    it("When the username changes, then signing in with the new one works", async () => {
      const client = createClient();
      await loginAs(client);

      await client.put("/profile", { username: "renamed_person" });

      const returning = createClient();
      const login = await returning.post("/login", {
        username: "renamed_person",
        email: "renamed_person",
        password: "Str0ng!Pass",
      });
      assert.equal(login.status, 200);
    });

    it("When the username is taken, then it responds 409 and nothing changes", async () => {
      const client = createClient();
      const { user } = await loginAs(client);
      const { user: other } = await aUserInDb();

      const response = await client.put("/profile", {
        username: other.username,
      });

      assert.equal(response.status, 409);
      const stored = await User.findById(user._id);
      assert.equal(stored.username, user.username);
    });

    it("When the email is taken, then it responds 409", async () => {
      const client = createClient();
      await loginAs(client);
      const { user: other } = await aUserInDb();

      const response = await client.put("/profile", { email: other.email });

      assert.equal(response.status, 409);
    });

    it("When the email is malformed, then it responds 400 with a field error", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.put("/profile", { email: "not-an-email" });

      assert.equal(response.status, 400);
      assert.ok(response.data.errors.some((error) => error.path === "email"));
    });

    it("When a role is sent, then it is ignored", async () => {
      // Nobody edits their own role here. The moderator endpoint is the only
      // place a role changes, and only an owner may use it.
      const client = createClient();
      const { user } = await loginAs(client, "user");

      const response = await client.put("/profile", {
        displayName: "Sneaky",
        role: "owner",
      });

      assert.equal(response.status, 200);
      const stored = await User.findById(user._id);
      assert.equal(stored.role, "user");
    });

    it("When a field is cleared, then the empty value is saved", async () => {
      const client = createClient();
      const { user } = await loginAs(client);
      await client.put("/profile", { bio: "Something" });

      await client.put("/profile", { bio: "" });

      const stored = await User.findById(user._id);
      assert.equal(stored.bio, "");
    });
  });

  describe("PUT /profile/password", () => {
    it("When the current password is right, then it is replaced", async () => {
      const client = createClient();
      const { user } = await loginAs(client);

      const response = await client.put("/profile/password", {
        currentPassword: "Str0ng!Pass",
        newPassword: "Even!Str0nger",
      });

      assert.equal(response.status, 200);
      const stored = await User.findById(user._id).select("+password");
      assert.ok(await bcrypt.compare("Even!Str0nger", stored.password));
    });

    it("When the current password is wrong, then it responds 401 and keeps the old one", async () => {
      // Otherwise an unattended signed-in browser is enough to lock the owner
      // out of their own account.
      const client = createClient();
      const { user } = await loginAs(client);
      const before = await User.findById(user._id).select("+password");

      const response = await client.put("/profile/password", {
        currentPassword: "not-my-password",
        newPassword: "Even!Str0nger",
      });

      assert.equal(response.status, 401);
      const after = await User.findById(user._id).select("+password");
      assert.equal(after.password, before.password);
    });

    it("When the new password matches the old one, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.put("/profile/password", {
        currentPassword: "Str0ng!Pass",
        newPassword: "Str0ng!Pass",
      });

      assert.equal(response.status, 400);
    });

    it("When the new password is too short, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.put("/profile/password", {
        currentPassword: "Str0ng!Pass",
        newPassword: "abc",
      });

      assert.equal(response.status, 400);
    });
  });

  describe("PUT /profile/avatar", () => {
    it("When an image is uploaded, then the profile points at it and the file exists", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.put("/profile/avatar", anAvatarUpload());
      trackAvatar(response.data?.avatar);

      assert.equal(response.status, 200);
      assert.match(response.data.avatar, /^\/uploads\//);

      const onDisk = path.join(
        config.uploads.directory,
        path.basename(response.data.avatar),
      );
      assert.ok(await fs.stat(onDisk));
    });

    it("When a second image is uploaded, then the first is removed from disk", async () => {
      const client = createClient();
      await loginAs(client);
      const first = await client.put("/profile/avatar", anAvatarUpload());
      const firstFile = path.join(
        config.uploads.directory,
        path.basename(first.data.avatar),
      );

      const second = await client.put("/profile/avatar", anAvatarUpload());
      trackAvatar(second.data?.avatar);

      assert.notEqual(second.data.avatar, first.data.avatar);
      await assert.rejects(() => fs.stat(firstFile));
    });

    it("When the upload is not an image, then it is refused", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.put(
        "/profile/avatar",
        anAvatarUpload("application/x-msdownload", "x.exe"),
      );

      assert.equal(response.status, 400);
    });

    it("When no file is sent, then it responds 400 rather than crashing", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.put("/profile/avatar", new FormData());

      assert.equal(response.status, 400);
    });
  });

  describe("DELETE /profile/avatar", () => {
    it("When the avatar is removed, then the field is cleared and the file deleted", async () => {
      const client = createClient();
      await loginAs(client);
      const uploaded = await client.put("/profile/avatar", anAvatarUpload());
      const onDisk = path.join(
        config.uploads.directory,
        path.basename(uploaded.data.avatar),
      );

      const response = await client.del("/profile/avatar");

      assert.equal(response.status, 200);
      assert.equal(response.data.avatar, null);
      await assert.rejects(() => fs.stat(onDisk));
    });
  });

  describe("POST /profile/delete", () => {
    it("When the password is right, then the account and the session are gone", async () => {
      const client = createClient();
      const { user } = await loginAs(client);

      const response = await client.post("/profile/delete", {
        password: "Str0ng!Pass",
      });

      assert.equal(response.status, 200);
      assert.equal(await User.findById(user._id), null);

      const status = await client.get("/login-status");
      assert.equal(status.data.isLoggedIn, false);
    });

    it("When the password is wrong, then the account survives", async () => {
      const client = createClient();
      const { user } = await loginAs(client);

      const response = await client.post("/profile/delete", {
        password: "not-my-password",
      });

      assert.equal(response.status, 401);
      assert.ok(await User.findById(user._id));
    });

    it("When the account is deleted, then its avatar is removed from disk", async () => {
      const client = createClient();
      await loginAs(client);
      const uploaded = await client.put("/profile/avatar", anAvatarUpload());
      const onDisk = path.join(
        config.uploads.directory,
        path.basename(uploaded.data.avatar),
      );

      await client.post("/profile/delete", { password: "Str0ng!Pass" });

      await assert.rejects(() => fs.stat(onDisk));
    });
  });

  describe("Profile fields elsewhere", () => {
    it("When the session is read, then it carries the avatar too", async () => {
      // The navigation shows the avatar, and it reads the session rather than
      // making a second request for it.
      const client = createClient();
      await loginAs(client);
      const uploaded = await client.put("/profile/avatar", anAvatarUpload());
      trackAvatar(uploaded.data?.avatar);

      const status = await client.get("/login-status");

      assert.equal(status.data.avatar, uploaded.data.avatar);
    });
  });
});
