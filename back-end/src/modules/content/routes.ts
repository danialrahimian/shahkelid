import {
  COMMENT_STATUSES,
  commentInput,
  moderateCommentInput,
  POST_COVER_MAX_BYTES,
  POST_STATUSES,
  postInput,
  type CommentStatus,
  type PostStatus,
} from "@shah-kelid/contracts";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Redis } from "ioredis";
import multer from "multer";

import type { Db } from "../../platform/db/client";
import { requirePermission, requireSignedIn } from "../../platform/http/account-session";
import { staffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { limitPerIp } from "../../platform/http/rate-limit";
import { parseBody, parseId } from "../../platform/http/validate";
import { imageTypeOf, readPublicFile } from "../files/storage";
import {
  addComment,
  createPost,
  deleteComment,
  deleteOwnComment,
  moderateComment,
  publicComments,
  publicPost,
  publicPosts,
  publicTags,
  setCover,
  staffComments,
  staffPost,
  staffPosts,
  toggleLike,
  updatePost,
} from "./service";

/**
 * /api/v1/posts: the journal, for everyone.
 *
 *   GET    /posts?page=&tag=&search=       published posts, newest first
 *   GET    /posts/tags
 *   GET    /posts/covers/:fileId            a cover picture
 *   GET    /posts/:slug
 *   POST   /posts/:id/like                  signed in; a toggle
 *   GET    /posts/:id/comments              approved, plus the viewer's own waiting ones
 *   POST   /posts/:id/comments              signed in; waits for approval
 *   DELETE /posts/comments/:commentId       signed in; one's own
 *
 * /api/v1/staff (content:manage): writing and moderating.
 *
 *   GET  /posts?status=&search=     POST /posts     GET|PUT /posts/:id
 *   POST /posts/:id/cover (multipart "cover")      DELETE /posts/:id/cover
 *   GET  /comments?status=pending|approved|rejected
 *   POST /comments/:id/moderate { decision }       DELETE /comments/:id
 */

const PAGE_SIZE = 9;

/** The viewer, when fully signed in: likes and one's own comments are shown to them. */
const viewerOf = (req: Request) => (req.account?.status === "signed_in" ? req.account.user.id : null);

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : undefined);

export const journalRouter = ({ db, redis }: { db: Db; redis: Redis }) => {
  const router = Router();
  // Comments are the one place a customer writes what others read.
  const commentLimit = limitPerIp({ redis, name: "comments", windowMs: 10 * 60_000, max: 20 });

  router.get("/", async (req, res) => {
    const page = Math.min(Math.max(Number.parseInt(String(req.query.page), 10) || 1, 1), 1000);
    res.json(
      await publicPosts(db, { page, pageSize: PAGE_SIZE, tag: text(req.query.tag), search: text(req.query.search) }),
    );
  });

  router.get("/tags", async (_req, res) => {
    res.json(await publicTags(db));
  });

  router.get("/covers/:fileId", async (req, res) => {
    const file = await readPublicFile(db, parseId(req.params.fileId));
    if (!file) throw notFound("No such picture");
    res.setHeader("content-type", file.mimeType);
    // A cover never changes under its id: a new cover is a new file.
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.setHeader("x-content-type-options", "nosniff");
    res.send(file.bytes);
  });

  router.delete("/comments/:commentId", requireSignedIn, async (req, res) => {
    await deleteOwnComment(db, parseId(req.params.commentId), req.account!.user.id);
    res.status(204).end();
  });

  router.get("/:slug", async (req, res) => {
    res.json(await publicPost(db, String(req.params.slug), viewerOf(req)));
  });

  router.post("/:id/like", requireSignedIn, async (req, res) => {
    res.json(await toggleLike(db, parseId(req.params.id), req.account!.user.id));
  });

  router.get("/:id/comments", async (req, res) => {
    res.json(await publicComments(db, parseId(req.params.id), viewerOf(req)));
  });

  router.post("/:id/comments", requireSignedIn, commentLimit, async (req, res) => {
    const { body } = parseBody(commentInput, req.body);
    res.status(201).json(await addComment(db, parseId(req.params.id), req.account!.user.id, body));
  });

  return router;
};

const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: POST_COVER_MAX_BYTES, files: 1, fields: 5 },
}).single("cover");

const coverInvalid = (message: string) =>
  new ApiError(400, "COVER_INVALID", message, { fields: [{ path: "cover", code: "COVER_INVALID" }] });

const withCover = (req: Request, res: Response, next: NextFunction) =>
  coverUpload(req, res, (error: unknown) => (error ? next(coverInvalid((error as Error).message)) : next()));

const oneOf = <T extends string>(values: readonly T[], value: unknown) =>
  (values as readonly unknown[]).includes(value) ? (value as T) : undefined;

export const contentStaffRouter = ({ db }: { db: Db }) => {
  const router = Router();
  const editor = requirePermission("content:manage");

  router.get("/posts", editor, async (req, res) => {
    res.json(
      await staffPosts(db, {
        status: oneOf<PostStatus>(POST_STATUSES, req.query.status),
        search: text(req.query.search),
      }),
    );
  });

  router.post("/posts", editor, async (req, res) => {
    res.status(201).json(await createPost(db, staffActor(req), parseBody(postInput, req.body)));
  });

  router.get("/posts/:id", editor, async (req, res) => {
    res.json(await staffPost(db, parseId(req.params.id)));
  });

  router.put("/posts/:id", editor, async (req, res) => {
    res.json(await updatePost(db, staffActor(req), parseId(req.params.id), parseBody(postInput, req.body)));
  });

  router.post("/posts/:id/cover", editor, withCover, async (req, res) => {
    const file = req.file;
    if (!file || !imageTypeOf(file.buffer)) throw coverInvalid("Attach a JPEG, PNG or WebP picture");
    res.json(
      await setCover(db, staffActor(req), parseId(req.params.id), {
        bytes: file.buffer,
        originalName: file.originalname,
      }),
    );
  });

  router.delete("/posts/:id/cover", editor, async (req, res) => {
    res.json(await setCover(db, staffActor(req), parseId(req.params.id), null));
  });

  router.get("/comments", editor, async (req, res) => {
    res.json(await staffComments(db, { status: oneOf<CommentStatus>(COMMENT_STATUSES, req.query.status) ?? "pending" }));
  });

  router.post("/comments/:id/moderate", editor, async (req, res) => {
    const { decision } = parseBody(moderateCommentInput, req.body);
    await moderateComment(db, staffActor(req), parseId(req.params.id), decision);
    res.status(204).end();
  });

  router.delete("/comments/:id", editor, async (req, res) => {
    await deleteComment(db, staffActor(req), parseId(req.params.id));
    res.status(204).end();
  });

  return router;
};
