import { randomBytes } from "node:crypto";

import type {
  CommentStatus,
  CommentView,
  PostPage,
  PostStatus,
  PostSummary,
  PostView,
  StaffCommentView,
  StaffPostSummary,
  StaffPostView,
  postInput,
} from "@shah-kelid/contracts";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";

import type { Db, Executor } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { notFound } from "../../platform/http/api-error";
import { writeAudit } from "../access/audit";
import { savePublicImage } from "../files/storage";
import { users } from "../identity/schema";
import { postComments, postLikes, posts } from "./schema";

/**
 * The journal.
 *
 * Staff with content:manage write posts; everyone reads the published ones.
 * Signed-in customers like them and comment. A comment waits for a member of
 * staff to approve it: until then only its author sees it, marked as
 * waiting. The like and comment counts on a post are recounted from their
 * tables whenever they change, never incremented, so they cannot drift.
 */

const LOCALE = "fa";
const WORDS_PER_MINUTE = 200;
const MAX_SLUG_LENGTH = 80;

type PostRow = typeof posts.$inferSelect;

export const coverUrl = (fileId: string | null) => (fileId ? `/api/v1/posts/covers/${fileId}` : null);

const readingMinutes = (body: string) =>
  Math.max(1, Math.round(body.trim().split(/\s+/u).filter(Boolean).length / WORDS_PER_MINUTE));

/**
 * The address for a title. Letters stay in their own script: an ASCII-only
 * slug would turn every Persian title into an empty string.
 */
export const slugFromTitle = (title: string) =>
  title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "") || "post";

/** The first free address for a title: the title, then -2, -3, … */
const freeSlug = async (executor: Executor, title: string, exceptId?: string) => {
  const base = slugFromTitle(title);
  const taken = new Set(
    (
      await executor
        .select({ slug: posts.slug, id: posts.id })
        .from(posts)
        .where(and(eq(posts.locale, LOCALE), or(eq(posts.slug, base), ilike(posts.slug, `${base}-%`))))
    )
      .filter((row) => row.id !== exceptId)
      .map((row) => row.slug),
  );
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    if (!taken.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
  }
  return `${base}-${randomBytes(3).toString("hex")}`;
};

const summaryOf = (row: PostRow): PostSummary => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  excerpt: row.excerpt,
  tags: row.tags,
  coverUrl: coverUrl(row.coverFileId),
  authorName: row.authorName,
  publishedAt: row.publishedAt!.toISOString(),
  readingMinutes: readingMinutes(row.body),
  likeCount: row.likeCount,
  commentCount: row.commentCount,
});

const published = and(eq(posts.status, "published"), eq(posts.locale, LOCALE));

// ------------------------------------------------------------------ reading

export const publicPosts = async (
  db: Db,
  { page, pageSize, tag, search }: { page: number; pageSize: number; tag?: string; search?: string },
): Promise<PostPage> => {
  const conditions: (SQL | undefined)[] = [published];
  if (tag) conditions.push(sql`${tag} = any(${posts.tags})`);
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    conditions.push(or(ilike(posts.title, pattern), ilike(posts.excerpt, pattern)));
  }
  const where = and(...conditions);
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(posts)
      .where(where)
      .orderBy(desc(posts.publishedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(posts).where(where),
  ]);
  return { posts: rows.map(summaryOf), total: total?.value ?? 0, page, pageSize };
};

/** Every tag on a published post, for the feed's filters. */
export const publicTags = async (db: Db) =>
  (
    await db.execute<{ tag: string }>(
      sql`select distinct unnest(${posts.tags}) as tag from ${posts} where ${posts.status} = 'published' and ${posts.locale} = ${LOCALE} order by 1`,
    )
  ).rows.map((row) => row.tag);

export const publicPost = async (db: Db, slug: string, viewerId: string | null): Promise<PostView> => {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(published, eq(posts.slug, slug.toLowerCase())));
  if (!row) throw notFound("No such post");
  const [liked] = viewerId
    ? await db
        .select({ postId: postLikes.postId })
        .from(postLikes)
        .where(and(eq(postLikes.postId, row.id), eq(postLikes.userId, viewerId)))
    : [];
  return {
    ...summaryOf(row),
    body: row.body,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    likedByMe: Boolean(liked),
  };
};

const publishedPost = async (executor: Executor, postId: string) => {
  const [row] = await executor
    .select({ id: posts.id })
    .from(posts)
    .where(and(published, eq(posts.id, postId)));
  if (!row) throw notFound("No such post");
  return row;
};

// ----------------------------------------------------------- likes, comments

const recountLikes = (executor: Executor, postId: string) =>
  executor
    .update(posts)
    .set({ likeCount: sql`(select count(*) from ${postLikes} where ${postLikes.postId} = ${postId})` })
    .where(eq(posts.id, postId))
    .returning({ likeCount: posts.likeCount });

const recountComments = (executor: Executor, postId: string) =>
  executor
    .update(posts)
    .set({
      commentCount: sql`(select count(*) from ${postComments} where ${postComments.postId} = ${postId} and ${postComments.status} = 'approved')`,
    })
    .where(eq(posts.id, postId));

/** One endpoint for on and off: the button is a toggle, and a double click must not like twice. */
export const toggleLike = async (db: Db, postId: string, userId: string) =>
  db.transaction(async (tx) => {
    await publishedPost(tx, postId);
    const removed = await tx
      .delete(postLikes)
      .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)))
      .returning();
    if (!removed.length) await tx.insert(postLikes).values({ postId, userId }).onConflictDoNothing();
    const [counted] = await recountLikes(tx, postId);
    return { likeCount: counted!.likeCount, likedByMe: !removed.length };
  });

const commentOf = (row: typeof postComments.$inferSelect, viewerId: string | null): CommentView => ({
  id: row.id,
  authorName: row.authorName,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
  mine: viewerId !== null && row.userId === viewerId,
  status: row.status,
});

/** The approved comments, and the viewer's own that still wait. Newest first. */
export const publicComments = async (db: Db, postId: string, viewerId: string | null) => {
  await publishedPost(db, postId);
  const visible = viewerId
    ? or(eq(postComments.status, "approved"), and(eq(postComments.status, "pending"), eq(postComments.userId, viewerId)))
    : eq(postComments.status, "approved");
  const rows = await db
    .select()
    .from(postComments)
    .where(and(eq(postComments.postId, postId), visible))
    .orderBy(desc(postComments.createdAt))
    .limit(200);
  return rows.map((row) => commentOf(row, viewerId));
};

export const addComment = async (db: Db, postId: string, userId: string, body: string) => {
  await publishedPost(db, postId);
  const [user] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId));
  const [row] = await db
    .insert(postComments)
    .values({
      postId,
      userId,
      // Copied, not joined: the comment reads the same if the name changes later.
      authorName: user?.displayName || "کاربر",
      body,
    })
    .returning();
  return commentOf(row!, userId);
};

/** A person may take back their own comment. */
export const deleteOwnComment = async (db: Db, commentId: string, userId: string) =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .delete(postComments)
      .where(and(eq(postComments.id, commentId), eq(postComments.userId, userId)))
      .returning();
    if (!row) throw notFound("No such comment");
    await recountComments(tx, row.postId);
  });

// -------------------------------------------------------------------- staff

const staffSummaryOf = (row: PostRow): StaffPostSummary => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  status: row.status,
  authorName: row.authorName,
  publishedAt: row.publishedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
  commentCount: row.commentCount,
  likeCount: row.likeCount,
});

const staffViewOf = (row: PostRow): StaffPostView => ({
  ...staffSummaryOf(row),
  excerpt: row.excerpt,
  body: row.body,
  tags: row.tags,
  coverUrl: coverUrl(row.coverFileId),
  seoTitle: row.seoTitle,
  seoDescription: row.seoDescription,
});

export const staffPosts = async (db: Db, { status, search }: { status?: PostStatus; search?: string }) => {
  const conditions: (SQL | undefined)[] = [eq(posts.locale, LOCALE)];
  if (status) conditions.push(eq(posts.status, status));
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    conditions.push(or(ilike(posts.title, pattern), ilike(posts.slug, pattern)));
  }
  return (
    await db
      .select()
      .from(posts)
      .where(and(...conditions))
      .orderBy(desc(posts.updatedAt))
      .limit(200)
  ).map(staffSummaryOf);
};

const postRow = async (executor: Executor, postId: string, { lock = false } = {}) => {
  const query = executor.select().from(posts).where(eq(posts.id, postId));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw notFound("No such post");
  return row;
};

export const staffPost = async (db: Db, postId: string) => staffViewOf(await postRow(db, postId));

const authorNameOf = async (executor: Executor, userId: string) => {
  const [user] = await executor
    .select({ displayName: users.displayName, email: users.email, username: users.username })
    .from(users)
    .where(eq(users.id, userId));
  return user?.displayName || user?.email?.split("@")[0] || user?.username || "شاه‌کلید";
};

export const createPost = async (db: Db, actor: StaffActor, input: z.output<typeof postInput>) =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .insert(posts)
      .values({
        ...input,
        locale: LOCALE,
        slug: await freeSlug(tx, input.title),
        authorUserId: actor.userId,
        authorName: await authorNameOf(tx, actor.userId),
        publishedAt: input.status === "published" ? new Date() : null,
      })
      .returning();
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "post.created",
      entityType: "post",
      entityId: row!.id,
      after: { title: row!.title, slug: row!.slug, status: row!.status },
    });
    return staffViewOf(row!);
  });

/**
 * Saves a post. Its address follows the title only until it is first
 * published; from then on it is fixed, whatever the title becomes.
 */
export const updatePost = async (db: Db, actor: StaffActor, postId: string, input: z.output<typeof postInput>) =>
  db.transaction(async (tx) => {
    const before = await postRow(tx, postId, { lock: true });
    const slug =
      before.publishedAt === null && input.title !== before.title ? await freeSlug(tx, input.title, postId) : before.slug;
    const [row] = await tx
      .update(posts)
      .set({
        ...input,
        slug,
        publishedAt: before.publishedAt ?? (input.status === "published" ? new Date() : null),
      })
      .where(eq(posts.id, postId))
      .returning();
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "post.updated",
      entityType: "post",
      entityId: postId,
      before: { title: before.title, slug: before.slug, status: before.status },
      after: { title: row!.title, slug: row!.slug, status: row!.status },
    });
    return staffViewOf(row!);
  });

export const setCover = async (
  db: Db,
  actor: StaffActor,
  postId: string,
  upload: { bytes: Buffer; originalName: string } | null,
) =>
  db.transaction(async (tx) => {
    await postRow(tx, postId, { lock: true });
    const file = upload
      ? await savePublicImage(tx, { ...upload, purpose: "post_cover", uploadedBy: actor.userId })
      : null;
    const [row] = await tx
      .update(posts)
      .set({ coverFileId: file?.id ?? null })
      .where(eq(posts.id, postId))
      .returning();
    return staffViewOf(row!);
  });

// ---------------------------------------------------------------- moderation

export const staffComments = async (db: Db, { status }: { status: CommentStatus }) =>
  (
    await db
      .select({ comment: postComments, post: posts, email: users.email })
      .from(postComments)
      .innerJoin(posts, eq(posts.id, postComments.postId))
      .leftJoin(users, eq(users.id, postComments.userId))
      .where(eq(postComments.status, status))
      // What waits, oldest first; what was decided, newest first.
      .orderBy(status === "pending" ? asc(postComments.createdAt) : desc(postComments.createdAt))
      .limit(200)
  ).map(
    ({ comment, post, email }): StaffCommentView => ({
      id: comment.id,
      post: { id: post.id, slug: post.slug, title: post.title },
      authorName: comment.authorName,
      authorEmail: email,
      body: comment.body,
      status: comment.status,
      createdAt: comment.createdAt.toISOString(),
    }),
  );

export const moderateComment = async (
  db: Db,
  actor: StaffActor,
  commentId: string,
  decision: "approve" | "reject",
) =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .update(postComments)
      .set({
        status: decision === "approve" ? "approved" : "rejected",
        moderatedBy: actor.userId,
        moderatedAt: new Date(),
      })
      .where(eq(postComments.id, commentId))
      .returning();
    if (!row) throw notFound("No such comment");
    await recountComments(tx, row.postId);
    await writeAudit(tx, {
      ...auditBy(actor),
      action: decision === "approve" ? "comment.approved" : "comment.rejected",
      entityType: "post_comment",
      entityId: commentId,
      after: { postId: row.postId, body: row.body },
    });
  });

export const deleteComment = async (db: Db, actor: StaffActor, commentId: string) =>
  db.transaction(async (tx) => {
    const [row] = await tx.delete(postComments).where(eq(postComments.id, commentId)).returning();
    if (!row) throw notFound("No such comment");
    await recountComments(tx, row.postId);
    await writeAudit(tx, {
      ...auditBy(actor),
      action: "comment.deleted",
      entityType: "post_comment",
      entityId: commentId,
      before: { postId: row.postId, authorName: row.authorName, body: row.body },
    });
  });
