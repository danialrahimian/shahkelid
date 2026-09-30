import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { postComments, posts } from "../src/modules/content/schema";
import { captureEmails, closeDatabase, database, signedInCustomer, signedInStaff } from "./helpers/accounts";
import { createClient } from "./helpers/api-client";
import { resetTestDatabase } from "./helpers/postgres";
import { startTestServer, stopTestServer } from "./helpers/test-server";

/**
 * The journal on PostgreSQL: the old journal's behaviour (feed, tags, likes,
 * comments, writing posts), with comments now shown only once staff approve
 * them.
 */

const JOURNAL = "/api/v1/posts";
const STAFF = "/api/v1/staff";
let emails: ReturnType<typeof captureEmails>;
let editor: Awaited<ReturnType<typeof signedInStaff>>;

before(async () => {
  await resetTestDatabase();
  await startTestServer();
  emails = captureEmails();
  editor = await signedInStaff(["editor"]);
});

after(async () => {
  emails.stop();
  await closeDatabase();
  await stopTestServer();
});

const BODY = "این یک متن آزمایشی است که باید دست‌کم پنجاه نویسه داشته باشد تا پذیرفته شود. ".repeat(3);

/** A post written through the API, published unless told otherwise. */
const aPost = async (fields: Record<string, unknown> = {}) => {
  const response = await editor.client.post(`${STAFF}/posts`, {
    title: `نوشته‌ی آزمایشی ${randomBytes(3).toString("hex")}`,
    excerpt: "خلاصه‌ای برای کارت نوشته در فهرست.",
    body: BODY,
    tags: [],
    status: "published",
    ...fields,
  });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data as { id: string; slug: string; title: string; status: string };
};

const aPicture = () =>
  new Blob([
    Buffer.concat([
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
      randomBytes(8),
    ]),
  ]);

// -------------------------------------------------------------------- feed

describe("Reading the journal", () => {
  it("When posts are published, then the feed lists them newest first, without bodies, for anyone", async () => {
    const first = await aPost();
    const second = await aPost();
    const draft = await aPost({ status: "draft" });

    const feed = await createClient().get(JOURNAL);
    assert.equal(feed.status, 200);
    const ids = feed.data.posts.map((post: { id: string }) => post.id);
    assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id), "newest first");
    assert.ok(!ids.includes(draft.id), "a draft is not in the feed");
    assert.equal(feed.data.posts[0].body, undefined, "the card leaves the body out");
    assert.equal(feed.data.posts[0].likes, undefined, "likers are never listed");

    assert.equal((await createClient().get(`${JOURNAL}/${draft.slug}`)).status, 404, "nor can a draft be read");
  });

  it("When a tag or a search is given, then only matching posts come back; search text is not a pattern", async () => {
    const tagged = await aPost({ tags: ["Privacy Tips", "vpn"], title: "حریم خصوصی در اینترنت" });
    await aPost();

    const byTag = await createClient().get(`${JOURNAL}?tag=privacy-tips`);
    assert.deepEqual(
      byTag.data.posts.map((post: { id: string }) => post.id),
      [tagged.id],
    );
    const bySearch = await createClient().get(`${JOURNAL}?search=${encodeURIComponent("حریم خصوصی")}`);
    assert.deepEqual(
      bySearch.data.posts.map((post: { id: string }) => post.id),
      [tagged.id],
    );
    const wild = await createClient().get(`${JOURNAL}?search=${encodeURIComponent("%")}`);
    assert.equal(wild.data.total, 0, "% is a character, not a wildcard");

    const tags = (await createClient().get(`${JOURNAL}/tags`)).data as string[];
    assert.ok(tags.includes("privacy-tips") && tags.includes("vpn"));
    assert.equal(new Set(tags).size, tags.length, "each tag once");
  });

  it("A post is read by its address, which keeps Persian letters; two titles alike get two addresses", async () => {
    const one = await aPost({ title: "چرا رمزنگاری مهم است" });
    const two = await aPost({ title: "چرا رمزنگاری مهم است" });
    assert.equal(one.slug, "چرا-رمزنگاری-مهم-است");
    assert.equal(two.slug, "چرا-رمزنگاری-مهم-است-2");

    const read = await createClient().get(`${JOURNAL}/${encodeURIComponent(one.slug)}`);
    assert.equal(read.status, 200);
    assert.equal(read.data.body, BODY.trim());
    assert.ok(read.data.readingMinutes >= 1);
    assert.equal((await createClient().get(`${JOURNAL}/no-such-post`)).status, 404);
  });
});

// ------------------------------------------------------------------- likes

describe("Likes", () => {
  it("A like needs a sign-in, a second press takes it back, and two readers count once each", async () => {
    const post = await aPost();
    assert.equal((await createClient().post(`${JOURNAL}/${post.id}/like`)).status, 401);

    const reader = await signedInCustomer(emails);
    const other = await signedInCustomer(emails);
    assert.deepEqual((await reader.client.post(`${JOURNAL}/${post.id}/like`)).data, { likeCount: 1, likedByMe: true });
    assert.deepEqual((await other.client.post(`${JOURNAL}/${post.id}/like`)).data, { likeCount: 2, likedByMe: true });
    assert.deepEqual((await reader.client.post(`${JOURNAL}/${post.id}/like`)).data, { likeCount: 1, likedByMe: false });

    assert.equal((await other.client.get(`${JOURNAL}/${encodeURIComponent(post.slug)}`)).data.likedByMe, true);
    assert.equal((await reader.client.get(`${JOURNAL}/${encodeURIComponent(post.slug)}`)).data.likedByMe, false);
    assert.equal((await reader.client.post(`${JOURNAL}/not-an-id/like`)).status, 400);
  });
});

// ---------------------------------------------------------------- comments

describe("Comments", () => {
  it("[acceptance] A comment waits for approval: only its author sees it until staff approve it", async () => {
    const post = await aPost();
    const author = await signedInCustomer(emails);
    const stranger = await signedInCustomer(emails);

    assert.equal((await createClient().post(`${JOURNAL}/${post.id}/comments`, { body: "سلام" })).status, 401);
    const written = await author.client.post(`${JOURNAL}/${post.id}/comments`, { body: "نوشته‌ی خوبی بود" });
    assert.equal(written.status, 201);
    assert.equal(written.data.status, "pending");

    const mine = (await author.client.get(`${JOURNAL}/${post.id}/comments`)).data;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].mine, true);
    assert.equal((await stranger.client.get(`${JOURNAL}/${post.id}/comments`)).data.length, 0, "not shown to others yet");
    assert.equal((await createClient().get(`${JOURNAL}/${post.id}/comments`)).data.length, 0);

    const queue = (await editor.client.get(`${STAFF}/comments`)).data as { id: string }[];
    assert.ok(queue.some((comment) => comment.id === written.data.id));
    assert.equal(
      (await editor.client.post(`${STAFF}/comments/${written.data.id}/moderate`, { decision: "approve" })).status,
      204,
    );

    const seen = (await createClient().get(`${JOURNAL}/${post.id}/comments`)).data;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].mine, false);
    assert.equal((await createClient().get(`${JOURNAL}/${encodeURIComponent(post.slug)}`)).data.commentCount, 1);
  });

  it("A rejected comment is never shown, and does not count", async () => {
    const post = await aPost();
    const author = await signedInCustomer(emails);
    const written = await author.client.post(`${JOURNAL}/${post.id}/comments`, { body: "تبلیغ" });
    await editor.client.post(`${STAFF}/comments/${written.data.id}/moderate`, { decision: "reject" });

    assert.equal((await createClient().get(`${JOURNAL}/${post.id}/comments`)).data.length, 0);
    assert.equal((await author.client.get(`${JOURNAL}/${post.id}/comments`)).data.length, 0);
    const [row] = await database().select().from(posts).where(eq(posts.id, post.id));
    assert.equal(row!.commentCount, 0);
  });

  it("An empty or too long comment is refused; a comment on a missing post is not found", async () => {
    const post = await aPost();
    const author = await signedInCustomer(emails);
    assert.equal((await author.client.post(`${JOURNAL}/${post.id}/comments`, { body: "  " })).status, 400);
    assert.equal((await author.client.post(`${JOURNAL}/${post.id}/comments`, { body: "x".repeat(1001) })).status, 400);
    assert.equal(
      (await author.client.post(`${JOURNAL}/0190a0a0-0000-7000-8000-000000000000/comments`, { body: "سلام" })).status,
      404,
    );
  });

  it("The author may take back their comment; nobody else may; the count never goes below zero", async () => {
    const post = await aPost();
    const author = await signedInCustomer(emails);
    const stranger = await signedInCustomer(emails);
    const written = await author.client.post(`${JOURNAL}/${post.id}/comments`, { body: "نظر من" });
    await editor.client.post(`${STAFF}/comments/${written.data.id}/moderate`, { decision: "approve" });

    assert.equal((await stranger.client.del(`${JOURNAL}/comments/${written.data.id}`)).status, 404);
    assert.equal((await author.client.del(`${JOURNAL}/comments/${written.data.id}`)).status, 204);
    assert.equal((await author.client.del(`${JOURNAL}/comments/${written.data.id}`)).status, 404);
    const [row] = await database().select().from(posts).where(eq(posts.id, post.id));
    assert.equal(row!.commentCount, 0);
  });

  it("Staff may delete any comment", async () => {
    const post = await aPost();
    const author = await signedInCustomer(emails);
    const written = await author.client.post(`${JOURNAL}/${post.id}/comments`, { body: "نظر" });
    assert.equal((await editor.client.del(`${STAFF}/comments/${written.data.id}`)).status, 204);
    assert.equal((await database().select().from(postComments).where(eq(postComments.id, written.data.id))).length, 0);
  });
});

// ----------------------------------------------------------- writing posts

describe("Writing posts", () => {
  it("Only staff with content:manage may write; a customer or an accountant is refused", async () => {
    const customer = await signedInCustomer(emails);
    const accountant = await signedInStaff(["accountant"]);
    const input = { title: "عنوان", excerpt: "خلاصه‌ای کافی و بلند", body: BODY };
    assert.equal((await createClient().post(`${STAFF}/posts`, input)).status, 401);
    assert.equal((await customer.client.post(`${STAFF}/posts`, input)).status, 403);
    assert.equal((await accountant.client.post(`${STAFF}/posts`, input)).status, 403);
    assert.equal((await accountant.client.get(`${STAFF}/posts`)).status, 403);
  });

  it("A post carries its author; tags are tidied; too many tags or a short body are refused", async () => {
    const post = await aPost({ tags: ["VPN", "vpn", "Privacy Tips"] });
    const full = (await editor.client.get(`${STAFF}/posts/${post.id}`)).data;
    assert.deepEqual(full.tags, ["vpn", "privacy-tips"]);
    assert.ok(full.authorName);

    const tooMany = await editor.client.post(`${STAFF}/posts`, {
      title: "عنوان کافی",
      excerpt: "خلاصه‌ای کافی و بلند",
      body: BODY,
      tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
    });
    assert.equal(tooMany.status, 400);
    const short = await editor.client.post(`${STAFF}/posts`, { title: "عنوان", excerpt: "خلاصه‌ای کافی و بلند", body: "کوتاه" });
    assert.equal(short.status, 400);
    assert.equal(short.data.error.fields[0].code, "TOO_SHORT");
  });

  it("A draft's address follows its title; once published, it stays", async () => {
    const draft = await aPost({ title: "پیش‌نویس اول", status: "draft" });
    const retitled = await editor.client.put(`${STAFF}/posts/${draft.id}`, {
      title: "عنوان تازه",
      excerpt: "خلاصه‌ای کافی و بلند",
      body: BODY,
      status: "published",
    });
    assert.equal(retitled.data.slug, "عنوان-تازه");
    assert.ok(retitled.data.publishedAt);

    const again = await editor.client.put(`${STAFF}/posts/${draft.id}`, {
      title: "عنوانی دیگر",
      excerpt: "خلاصه‌ای کافی و بلند",
      body: BODY,
      status: "published",
    });
    assert.equal(again.data.slug, "عنوان-تازه", "links already out there keep working");
    assert.equal(again.data.publishedAt, retitled.data.publishedAt);
  });

  it("A cover must be a picture; it is served publicly, and a new one replaces it", async () => {
    const post = await aPost();
    const refused = new FormData();
    refused.set("cover", new Blob([Buffer.from("%PDF-1.7")]), "cover.pdf");
    assert.equal((await editor.client.post(`${STAFF}/posts/${post.id}/cover`, refused)).status, 400);

    const form = new FormData();
    form.set("cover", aPicture(), "cover.png");
    const saved = await editor.client.post(`${STAFF}/posts/${post.id}/cover`, form);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.match(saved.data.coverUrl, /^\/api\/v1\/posts\/covers\//);

    const picture = await createClient().get(saved.data.coverUrl);
    assert.equal(picture.status, 200);
    assert.equal(picture.headers.get("content-type"), "image/png");

    const removed = await editor.client.del(`${STAFF}/posts/${post.id}/cover`);
    assert.equal(removed.data.coverUrl, null);
  });

  it("A private file is never served as a cover", async () => {
    // A ticket screenshot's id put in a cover's address.
    const customer = await signedInCustomer(emails);
    const categories = (await customer.client.get("/api/v1/support/categories")).data;
    const form = new FormData();
    form.set("subject", "موضوع");
    form.set("categoryId", categories[0].id);
    form.set("body", "متن");
    form.append("attachments", aPicture(), "shot.png");
    const ticket = (await customer.client.post("/api/v1/support/tickets", form)).data;
    const fileId = ticket.messages[0].attachments[0].id;
    assert.equal((await createClient().get(`${JOURNAL}/covers/${fileId}`)).status, 404);
  });
});
