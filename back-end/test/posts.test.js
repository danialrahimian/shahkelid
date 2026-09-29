"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  startTestServer,
  stopTestServer,
  clearDatabase,
} = require("./helpers/test-server");
const { createClient } = require("./helpers/api-client");
const { aPostInDb, aUserInDb, loginAs, unique } = require("./helpers/test-data");
const { Post, Comment } = require("../src/components/posts/post.model");

describe("Posts", () => {
  before(async () => startTestServer());
  after(async () => stopTestServer());
  beforeEach(async () => clearDatabase());

  describe("GET /posts", () => {
    it("When posts exist, then a page and a total come back", async () => {
      // Arrange
      const client = createClient();
      await aPostInDb({ title: "First article" });
      await aPostInDb({ title: "Second article" });

      // Act
      const response = await client.get("/posts");

      // Assert
      assert.equal(response.status, 200);
      assert.equal(response.data.posts.length, 2);
      assert.equal(response.data.totalPostsLength, 2);
    });

    it("When the feed is read anonymously, then it is still readable", async () => {
      // Reading is open so the feed renders before anyone signs in.
      const client = createClient();
      await aPostInDb();

      const response = await client.get("/posts");

      assert.equal(response.status, 200);
      assert.equal(response.data.posts[0].likedByMe, false);
    });

    it("When a card is listed, then the article body is left out", async () => {
      // The grid shows ten cards; sending ten full articles to draw them
      // would be a great deal of text nobody reads.
      const client = createClient();
      await aPostInDb();

      const response = await client.get("/posts");

      assert.equal(response.data.posts[0].content, undefined);
      assert.ok(response.data.posts[0].excerpt);
    });

    it("When posts are listed, then the people who liked them are not named", async () => {
      const client = createClient();
      const { user } = await aUserInDb();
      await aPostInDb({ likes: [user._id] });

      const response = await client.get("/posts");

      assert.equal(response.data.posts[0].likes, undefined);
      assert.equal(response.data.posts[0].likeCount, 1);
    });

    it("When a tag is given, then only posts carrying it come back", async () => {
      const client = createClient();
      await aPostInDb({ title: "Tagged", tags: ["privacy"] });
      await aPostInDb({ title: "Untagged", tags: ["speed"] });

      const response = await client.get("/posts?tag=privacy");

      assert.equal(response.data.posts.length, 1);
      assert.equal(response.data.posts[0].title, "Tagged");
    });

    it("When a search term is given, then titles and excerpts are matched", async () => {
      const client = createClient();
      await aPostInDb({ title: "Encryption explained" });
      await aPostInDb({ title: "Something else" });

      const response = await client.get("/posts?search=encryption");

      assert.equal(response.data.posts.length, 1);
    });

    it("When the search term contains regex characters, then they are treated as text", async () => {
      const client = createClient();
      await aPostInDb({ title: "Encryption explained" });

      const response = await client.get("/posts?search=.*");

      assert.equal(response.status, 200);
      assert.equal(response.data.posts.length, 0);
    });

    it("When a huge page size is asked for, then it is capped", async () => {
      const client = createClient();
      await aPostInDb();

      const response = await client.get("/posts?limit=100000");

      assert.equal(response.data.limit, 30);
    });

    it("When posts are listed, then the newest is first", async () => {
      const client = createClient();
      await aPostInDb({
        title: "Older",
        createdAt: new Date("2024-01-01"),
      });
      await aPostInDb({
        title: "Newer",
        createdAt: new Date("2025-01-01"),
      });

      const response = await client.get("/posts");

      assert.equal(response.data.posts[0].title, "Newer");
    });
  });

  describe("GET /posts/tags", () => {
    it("When posts carry tags, then every tag is listed once, sorted", async () => {
      const client = createClient();
      await aPostInDb({ tags: ["privacy", "basics"] });
      await aPostInDb({ tags: ["privacy", "speed"] });

      const response = await client.get("/posts/tags");

      assert.equal(response.status, 200);
      assert.deepEqual(response.data, ["basics", "privacy", "speed"]);
    });
  });

  describe("GET /posts/:slug", () => {
    it("When the slug exists, then the whole article comes back", async () => {
      const client = createClient();
      const post = await aPostInDb({ content: "The full body text." });

      const response = await client.get(`/posts/${post.slug}`);

      assert.equal(response.status, 200);
      assert.equal(response.data.content, "The full body text.");
    });

    it("When the slug is unknown, then it responds 404", async () => {
      const client = createClient();

      const response = await client.get("/posts/no-such-article");

      assert.equal(response.status, 404);
    });

    it("When the literal tags path is requested, then it is not read as a slug", async () => {
      // "/posts/tags" has to win over "/posts/:slug", or the tag list becomes
      // a 404 for an article nobody wrote.
      const client = createClient();
      await aPostInDb({ tags: ["privacy"] });

      const response = await client.get("/posts/tags");

      assert.equal(response.status, 200);
      assert.ok(Array.isArray(response.data));
    });
  });

  describe("POST /posts/:postId/like", () => {
    it("When nobody is signed in, then liking responds 401", async () => {
      const client = createClient();
      const post = await aPostInDb();

      const response = await client.post(`/posts/${post._id}/like`);

      assert.equal(response.status, 401);
    });

    it("When a signed-in reader likes a post, then the count rises", async () => {
      const client = createClient();
      await loginAs(client);
      const post = await aPostInDb();

      const response = await client.post(`/posts/${post._id}/like`);

      assert.equal(response.status, 200);
      assert.deepEqual(response.data, { likeCount: 1, likedByMe: true });
    });

    it("When the same reader likes twice, then the second press removes it", async () => {
      // One toggle rather than a like and an unlike, so the button and the
      // server cannot disagree about which state it is in.
      const client = createClient();
      await loginAs(client);
      const post = await aPostInDb();
      await client.post(`/posts/${post._id}/like`);

      const response = await client.post(`/posts/${post._id}/like`);

      assert.deepEqual(response.data, { likeCount: 0, likedByMe: false });
    });

    it("When two readers like the same post, then both are counted once", async () => {
      const first = createClient();
      const second = createClient();
      await loginAs(first);
      await loginAs(second);
      const post = await aPostInDb();

      await first.post(`/posts/${post._id}/like`);
      const response = await second.post(`/posts/${post._id}/like`);

      assert.equal(response.data.likeCount, 2);
    });

    it("When a reader who liked a post reads it back, then it says so", async () => {
      const client = createClient();
      await loginAs(client);
      const post = await aPostInDb();
      await client.post(`/posts/${post._id}/like`);

      const response = await client.get(`/posts/${post.slug}`);

      assert.equal(response.data.likedByMe, true);
      assert.equal(response.data.likeCount, 1);
    });

    it("When somebody else liked it, then it does not say I did", async () => {
      const owner = createClient();
      const stranger = createClient();
      await loginAs(owner);
      await loginAs(stranger);
      const post = await aPostInDb();
      await owner.post(`/posts/${post._id}/like`);

      const response = await stranger.get(`/posts/${post.slug}`);

      assert.equal(response.data.likeCount, 1);
      assert.equal(response.data.likedByMe, false);
    });

    it("When the id is malformed, then it responds 400 rather than 500", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.post("/posts/not-an-id/like");

      assert.equal(response.status, 400);
    });
  });

  describe("POST /posts/:postId/comments", () => {
    it("When nobody is signed in, then commenting responds 401", async () => {
      const client = createClient();
      const post = await aPostInDb();

      const response = await client.post(`/posts/${post._id}/comments`, {
        body: "Nice article",
      });

      assert.equal(response.status, 401);
    });

    it("When a reader comments, then it is stored and the count rises", async () => {
      // Arrange
      const client = createClient();
      const { user } = await loginAs(client);
      const post = await aPostInDb();

      // Act
      const response = await client.post(`/posts/${post._id}/comments`, {
        body: "This cleared something up for me.",
      });

      // Assert - the response
      assert.equal(response.status, 201);
      assert.equal(response.data.body, "This cleared something up for me.");
      assert.equal(response.data.author.name, user.username);
      assert.equal(response.data.mine, true);

      // Assert - the new state
      const stored = await Post.findById(post._id);
      assert.equal(stored.commentCount, 1);
      assert.equal(await Comment.countDocuments({ postId: post._id }), 1);
    });

    it("When the comment is empty, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client);
      const post = await aPostInDb();

      const response = await client.post(`/posts/${post._id}/comments`, {
        body: "   ",
      });

      assert.equal(response.status, 400);
    });

    it("When the comment is too long, then it responds 400", async () => {
      const client = createClient();
      await loginAs(client);
      const post = await aPostInDb();

      const response = await client.post(`/posts/${post._id}/comments`, {
        body: "x".repeat(1001),
      });

      assert.equal(response.status, 400);
    });

    it("When the post does not exist, then it responds 404", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.post(
        "/posts/64b7f0d2f0d2f0d2f0d2f0d2/comments",
        { body: "Hello" },
      );

      assert.equal(response.status, 404);
    });
  });

  describe("GET /posts/:postId/comments", () => {
    it("When comments exist, then they come back newest first", async () => {
      const client = createClient();
      await loginAs(client);
      const post = await aPostInDb();
      await client.post(`/posts/${post._id}/comments`, { body: "First" });
      await client.post(`/posts/${post._id}/comments`, { body: "Second" });

      const response = await client.get(`/posts/${post._id}/comments`);

      assert.equal(response.status, 200);
      assert.equal(response.data.totalCommentsLength, 2);
      assert.equal(response.data.comments[0].body, "Second");
    });

    it("When read anonymously, then no comment is marked as mine", async () => {
      const author = createClient();
      await loginAs(author);
      const post = await aPostInDb();
      await author.post(`/posts/${post._id}/comments`, { body: "Hello" });

      const anonymous = createClient();
      const response = await anonymous.get(`/posts/${post._id}/comments`);

      assert.equal(response.data.comments[0].mine, false);
    });

    it("When somebody else wrote it, then it is not marked as mine", async () => {
      const author = createClient();
      const reader = createClient();
      await loginAs(author);
      await loginAs(reader);
      const post = await aPostInDb();
      await author.post(`/posts/${post._id}/comments`, { body: "Hello" });

      const response = await reader.get(`/posts/${post._id}/comments`);

      assert.equal(response.data.comments[0].mine, false);
    });
  });

  describe("DELETE /comments/:commentId", () => {
    it("When the author deletes their own comment, then it is removed", async () => {
      const client = createClient();
      await loginAs(client);
      const post = await aPostInDb();
      const created = await client.post(`/posts/${post._id}/comments`, {
        body: "Never mind",
      });

      const response = await client.del(`/comments/${created.data._id}`);

      assert.equal(response.status, 200);
      assert.equal(await Comment.countDocuments({ postId: post._id }), 0);

      const stored = await Post.findById(post._id);
      assert.equal(stored.commentCount, 0);
    });

    it("When somebody else tries to delete it, then it responds 403", async () => {
      const author = createClient();
      const stranger = createClient();
      await loginAs(author);
      await loginAs(stranger, "user");
      const post = await aPostInDb();
      const created = await author.post(`/posts/${post._id}/comments`, {
        body: "Mine",
      });

      const response = await stranger.del(`/comments/${created.data._id}`);

      assert.equal(response.status, 403);
      assert.equal(await Comment.countDocuments({}), 1);
    });

    it("When a moderator deletes somebody else's comment, then it is removed", async () => {
      const author = createClient();
      const moderator = createClient();
      await loginAs(author);
      await loginAs(moderator, "moderator");
      const post = await aPostInDb();
      const created = await author.post(`/posts/${post._id}/comments`, {
        body: "Something to moderate",
      });

      const response = await moderator.del(`/comments/${created.data._id}`);

      assert.equal(response.status, 200);
      assert.equal(await Comment.countDocuments({}), 0);
    });

    it("When the comment does not exist, then it responds 404", async () => {
      const client = createClient();
      await loginAs(client);

      const response = await client.del(
        "/comments/64b7f0d2f0d2f0d2f0d2f0d2",
      );

      assert.equal(response.status, 404);
    });

    it("When a comment is deleted twice, then the count never goes negative", async () => {
      const client = createClient();
      await loginAs(client, "moderator");
      const post = await aPostInDb();
      const created = await client.post(`/posts/${post._id}/comments`, {
        body: "Once",
      });

      await client.del(`/comments/${created.data._id}`);
      await client.del(`/comments/${created.data._id}`);

      const stored = await Post.findById(post._id);
      assert.equal(stored.commentCount, 0);
    });
  });

  describe("The seeded articles", () => {
    it("When the seed data is read, then it holds ten complete articles", async () => {
      // The feed ships with sample content, and an article missing a slug or a
      // body would surface as a broken card rather than a failing test.
      const { POSTS } = require("../scripts/seed-posts.data");

      assert.equal(POSTS.length, 10);

      const slugs = new Set();
      for (const article of POSTS) {
        assert.match(article.slug, /^[a-z0-9-]+$/);
        assert.equal(slugs.has(article.slug), false, "slugs must be unique");
        slugs.add(article.slug);

        assert.ok(article.title.length > 0 && article.title.length <= 160);
        assert.ok(article.excerpt.length > 0 && article.excerpt.length <= 300);
        assert.ok(article.content.length > 400);
        assert.ok(article.tags.length > 0);
        assert.equal(article.palette.length, 2);
      }
    });
  });

  describe("Unique slugs", () => {
    it("When two posts share a slug, then the second is refused", async () => {
      const slug = `article-${unique()}`;
      await aPostInDb({ slug });

      await assert.rejects(() => aPostInDb({ slug }));
    });
  });
});
