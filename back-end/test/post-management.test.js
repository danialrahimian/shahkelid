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
const { aPostInDb, loginAs, unique } = require("./helpers/test-data");
const { Post } = require("../src/components/posts/post.model");
const config = require("../src/config");

// A one-pixel PNG, small enough to inline and a genuinely valid image.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const LONG_ENOUGH =
  "A body long enough to pass the minimum, which is there so an article cannot be published as a single line.";

/** Builds the multipart body the post form sends. */
const aPostForm = ({
  title = `Article ${unique()}`,
  excerpt = "A short summary of the article.",
  content = LONG_ENOUGH,
  tags = ["privacy"],
  withCover = true,
} = {}) => {
  const form = new FormData();
  form.set("title", title);
  form.set("excerpt", excerpt);
  form.set("content", content);
  form.set("tags", JSON.stringify(tags));
  if (withCover) {
    form.set("cover", new Blob([PNG_BYTES], { type: "image/png" }), "cover.png");
  }
  return form;
};

// Uploads land on the real disk, so the suite removes what it wrote.
const writtenFiles = new Set();
const track = (publicPath) => {
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

const fileExists = async (publicPath) =>
  fs
    .access(path.join(config.uploads.directory, path.basename(publicPath)))
    .then(() => true)
    .catch(() => false);

/** Publishes through the API, as the signed-in client, and tracks the file. */
const publish = async (client, overrides) => {
  const response = await client.post("/staff/posts", aPostForm(overrides));
  track(response.data?.coverImage);
  return response;
};

describe("Writing posts", () => {
  before(async () => startTestServer());
  after(async () => {
    await removeWrittenFiles();
    await stopTestServer();
  });
  beforeEach(async () => clearDatabase());

  describe("Who may write", () => {
    it("When nobody is signed in, then publishing responds 401", async () => {
      const client = createClient();

      const response = await client.post("/staff/posts", aPostForm());

      assert.equal(response.status, 401);
    });

    it("When an ordinary customer tries, then it responds 403 and writes no file", async () => {
      // The role guard runs before the upload, so a refused request never
      // touches the disk at all.
      const client = createClient();
      await loginAs(client, "user");
      const before = await fs.readdir(config.uploads.directory);

      const response = await client.post("/staff/posts", aPostForm());

      assert.equal(response.status, 403);
      const after = await fs.readdir(config.uploads.directory);
      assert.deepEqual(after.sort(), before.sort());
    });

    for (const role of ["admin", "moderator", "owner"]) {
      it(`When a ${role} publishes, then it is allowed`, async () => {
        const client = createClient();
        await loginAs(client, role);

        const response = await publish(client);

        assert.equal(response.status, 201);
      });
    }
  });

  describe("Publishing", () => {
    it("When a post is published, then it carries its author and shows in the journal", async () => {
      const client = createClient();
      const { user } = await loginAs(client, "admin");

      const created = await publish(client, { title: "Why DNS leaks matter" });
      const feed = await createClient().get("/posts");

      assert.equal(created.data.author.name, user.username);
      assert.equal(created.data.canEdit, true);
      assert.equal(feed.data.posts[0].title, "Why DNS leaks matter");
    });

    it("When a post is published, then its address comes from the title", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await publish(client, {
        title: "  Kill Switch: Not Optional!  ",
      });

      assert.equal(response.data.slug, "kill-switch-not-optional");
    });

    it("When the title is Persian, then the address keeps its letters", async () => {
      // An ASCII-only slug would reduce this to nothing, and every Persian
      // article would be called "article-2", "article-3" and so on.
      const client = createClient();
      await loginAs(client, "admin");

      const created = await publish(client, { title: "امنیت در شبکه عمومی" });
      const read = await createClient().get(
        `/posts/${encodeURIComponent(created.data.slug)}`,
      );

      assert.equal(created.data.slug, "امنیت-در-شبکه-عمومی");
      assert.equal(read.status, 200);
      assert.equal(read.data.title, "امنیت در شبکه عمومی");
    });

    it("When two posts share a title, then each gets its own address", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const first = await publish(client, { title: "Weekly notes" });
      const second = await publish(client, { title: "Weekly notes" });

      assert.equal(first.data.slug, "weekly-notes");
      assert.equal(second.data.slug, "weekly-notes-2");
    });

    it("When a post is published, then the reading time is worked out from its length", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      // 600 words at 200 a minute.
      const response = await publish(client, {
        content: Array.from({ length: 600 }, () => "word").join(" "),
      });

      assert.equal(response.data.readingMinutes, 3);
      assert.equal(response.data.wordCount, 600);
    });

    it("When tags are sent, then they are tidied into filters", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await publish(client, {
        tags: ["Privacy", "privacy", "  Public Wi-Fi ", ""],
      });

      assert.deepEqual(response.data.tags, ["privacy", "public-wi-fi"]);
    });

    it("When there is no cover image, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.post(
        "/staff/posts",
        aPostForm({ withCover: false }),
      );

      assert.equal(response.status, 400);
    });

    it("When the form is rejected, then the uploaded cover is not left on disk", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      const before = await fs.readdir(config.uploads.directory);

      const response = await client.post(
        "/staff/posts",
        aPostForm({ title: "a" }),
      );

      assert.equal(response.status, 400);
      // The error handler removes the file without waiting on it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const after = await fs.readdir(config.uploads.directory);
      assert.deepEqual(after.sort(), before.sort());
    });

    it("When there are too many tags, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.post(
        "/staff/posts",
        aPostForm({ tags: Array.from({ length: 9 }, (_, i) => `tag${i}`) }),
      );

      assert.equal(response.status, 400);
    });
  });

  describe("Editing", () => {
    it("When the author edits their post, then the changes are saved", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      const created = await publish(client, { title: "First draft" });

      const response = await client.put(
        `/staff/posts/${created.data._id}`,
        aPostForm({ title: "Second draft", withCover: false }),
      );

      assert.equal(response.status, 200);
      assert.equal(response.data.title, "Second draft");
    });

    it("When the title changes, then the address does not", async () => {
      // The address has already been shared. Changing it with the title would
      // break every link to the article that is out in the world.
      const client = createClient();
      await loginAs(client, "admin");
      const created = await publish(client, { title: "Original title" });

      const response = await client.put(
        `/staff/posts/${created.data._id}`,
        aPostForm({ title: "A completely new title", withCover: false }),
      );

      assert.equal(response.data.slug, "original-title");
    });

    it("When the cover is left out of an edit, then the old one is kept", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      const created = await publish(client);

      const response = await client.put(
        `/staff/posts/${created.data._id}`,
        aPostForm({ withCover: false }),
      );

      assert.equal(response.data.coverImage, created.data.coverImage);
      assert.equal(await fileExists(created.data.coverImage), true);
    });

    it("When a new cover is uploaded, then the old file is removed", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      const created = await publish(client);

      const response = await client.put(
        `/staff/posts/${created.data._id}`,
        aPostForm(),
      );
      track(response.data.coverImage);

      assert.notEqual(response.data.coverImage, created.data.coverImage);
      assert.equal(await fileExists(created.data.coverImage), false);
      assert.equal(await fileExists(response.data.coverImage), true);
    });

    it("When a different member of staff edits it, then it responds 403 and nothing changes", async () => {
      const author = createClient();
      await loginAs(author, "admin");
      const created = await publish(author, { title: "Mine" });

      const other = createClient();
      await loginAs(other, "owner");
      const before = await fs.readdir(config.uploads.directory);

      const response = await other.put(
        `/staff/posts/${created.data._id}`,
        aPostForm({ title: "Not yours" }),
      );

      assert.equal(response.status, 403);
      const stored = await Post.findById(created.data._id).lean();
      assert.equal(stored.title, "Mine");
      // The cover the refused request uploaded is cleaned up.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const after = await fs.readdir(config.uploads.directory);
      assert.deepEqual(after.sort(), before.sort());
    });

    it("When a post has no recorded author, then nobody can edit it", async () => {
      // Seeded or legacy posts without an author id are not anybody's, so
      // they are not everybody's either.
      const client = createClient();
      await loginAs(client, "owner");
      const post = await aPostInDb();

      const response = await client.put(
        `/staff/posts/${post._id}`,
        aPostForm({ withCover: false }),
      );

      assert.equal(response.status, 403);
    });

    it("When the post does not exist, then it responds 404", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.put(
        "/staff/posts/64b7f0d2f0d2f0d2f0d2f0d2",
        aPostForm({ withCover: false }),
      );

      assert.equal(response.status, 404);
    });

    it("When the id is malformed, then it responds 400 rather than 500", async () => {
      const client = createClient();
      await loginAs(client, "admin");

      const response = await client.put(
        "/staff/posts/not-an-id",
        aPostForm({ withCover: false }),
      );

      assert.equal(response.status, 400);
    });
  });

  describe("The staff list and details", () => {
    it("When staff list posts, then they see everyone's, marked by who may edit", async () => {
      const mine = createClient();
      await loginAs(mine, "admin");
      await publish(mine, { title: "Mine" });
      await aPostInDb({ title: "Somebody else's" });

      const response = await mine.get("/staff/posts");

      assert.equal(response.status, 200);
      assert.equal(response.data.totalPostsLength, 2);
      const byTitle = Object.fromEntries(
        response.data.posts.map((post) => [post.title, post.canEdit]),
      );
      assert.deepEqual(byTitle, { Mine: true, "Somebody else's": false });
    });

    it("When only their own are asked for, then only those come back", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      await publish(client, { title: "Mine" });
      await aPostInDb({ title: "Somebody else's" });

      const response = await client.get("/staff/posts?mine=true");

      assert.equal(response.data.totalPostsLength, 1);
      assert.equal(response.data.posts[0].title, "Mine");
    });

    it("When the list is read, then the article bodies are left out", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      await aPostInDb();

      const response = await client.get("/staff/posts");

      assert.equal(response.data.posts[0].content, undefined);
    });

    it("When one post is read, then everything about it comes back", async () => {
      const client = createClient();
      await loginAs(client, "admin");
      const post = await aPostInDb({
        content: "one two three four five",
        tags: ["dns"],
      });

      const response = await client.get(`/staff/posts/${post._id}`);

      assert.equal(response.status, 200);
      assert.equal(response.data.content, "one two three four five");
      assert.equal(response.data.wordCount, 5);
      assert.equal(response.data.slug, post.slug);
      assert.deepEqual(response.data.tags, ["dns"]);
      assert.equal(response.data.likeCount, 0);
      assert.equal(response.data.commentCount, 0);
      assert.ok(response.data.createdAt);
      assert.ok(response.data.updatedAt);
    });

    it("When a customer asks for the staff list, then it responds 403", async () => {
      const client = createClient();
      await loginAs(client, "user");

      const response = await client.get("/staff/posts");

      assert.equal(response.status, 403);
    });
  });
});
