"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { body } = require("express-validator");

const config = require("../../config");
const {
  asyncHandler,
  requireAuth,
  requireRole,
  upload,
  validate,
} = require("../../middlewares");
const postService = require("./post.service");

const router = express.Router();

/**
 * Reading is open to everyone; liking and commenting need a session; writing
 * a post needs a staff role.
 *
 * The guards are per route rather than router-wide because this router is
 * mounted at "/", so a router-wide guard would answer for paths it does not
 * define.
 */

/**
 * Comments are the one place a signed-in person can write text that others
 * read, which makes it the one place worth rate limiting.
 */
const commentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.isProduction ? 20 : 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    errors: [{ msg: "You are commenting too quickly. Try again shortly." }],
  },
});

const commentValidator = [
  body("body")
    .exists({ values: "falsy" })
    .withMessage("write something first")
    .bail()
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage("a comment must be between 1 and 1000 characters"),
  validate,
];

router.get(
  "/posts",
  asyncHandler(async (req, res) =>
    res.status(200).json(await postService.listPosts(req.query, req.user?._id)),
  ),
);

// Declared before "/posts/:slug" so the literal wins over the parameter.
router.get(
  "/posts/tags",
  asyncHandler(async (_req, res) =>
    res.status(200).json(await postService.listTags()),
  ),
);

router.get(
  "/posts/:slug",
  asyncHandler(async (req, res) =>
    res
      .status(200)
      .json(await postService.getPostBySlug(req.params.slug, req.user?._id)),
  ),
);

router.post(
  "/posts/:postId/like",
  requireAuth,
  asyncHandler(async (req, res) =>
    res
      .status(200)
      .json(await postService.toggleLike(req.params.postId, req.user._id)),
  ),
);

router.get(
  "/posts/:postId/comments",
  asyncHandler(async (req, res) =>
    res
      .status(200)
      .json(
        await postService.listComments(
          req.params.postId,
          req.query,
          req.user?._id,
        ),
      ),
  ),
);

router.post(
  "/posts/:postId/comments",
  requireAuth,
  commentLimiter,
  commentValidator,
  asyncHandler(async (req, res) =>
    res
      .status(201)
      .json(
        await postService.addComment(
          req.params.postId,
          req.user,
          req.body.body,
        ),
      ),
  ),
);

// ------------------------------------------------------------ writing posts

/**
 * Any member of staff may publish, and each may edit only their own posts.
 *
 * The role guard runs before the upload so a request that is going to be
 * refused never writes a file to disk. The ownership check lives in the
 * service, where no second caller can skip it; if it refuses, the central
 * error handler removes the file the request uploaded.
 */
const staffOnly = requireRole("admin", "moderator", "owner");

const postValidator = [
  body("title")
    .exists({ values: "falsy" })
    .withMessage("title is required")
    .bail()
    .trim()
    .isLength({ min: 3, max: 160 })
    .withMessage("title must be between 3 and 160 characters"),
  body("excerpt")
    .exists({ values: "falsy" })
    .withMessage("excerpt is required")
    .bail()
    .trim()
    .isLength({ min: 10, max: 300 })
    .withMessage("excerpt must be between 10 and 300 characters"),
  body("content")
    .exists({ values: "falsy" })
    .withMessage("content is required")
    .bail()
    .trim()
    .isLength({ min: 50, max: 50_000 })
    .withMessage("the article must be between 50 and 50000 characters"),
  validate,
];

router.get(
  "/staff/posts",
  staffOnly,
  asyncHandler(async (req, res) =>
    res.status(200).json(await postService.listStaffPosts(req.query, req.user)),
  ),
);

router.get(
  "/staff/posts/:postId",
  staffOnly,
  asyncHandler(async (req, res) =>
    res
      .status(200)
      .json(await postService.getStaffPost(req.params.postId, req.user)),
  ),
);

router.post(
  "/staff/posts",
  staffOnly,
  upload.single("cover"),
  postValidator,
  asyncHandler(async (req, res) =>
    res.status(201).json(
      await postService.createPost(req.user, {
        body: req.body,
        file: req.file,
      }),
    ),
  ),
);

router.put(
  "/staff/posts/:postId",
  staffOnly,
  upload.single("cover"),
  postValidator,
  asyncHandler(async (req, res) =>
    res.status(200).json(
      await postService.updatePost(req.user, req.params.postId, {
        body: req.body,
        file: req.file,
      }),
    ),
  ),
);

router.delete(
  "/comments/:commentId",
  requireAuth,
  asyncHandler(async (req, res) =>
    res
      .status(200)
      .json(await postService.deleteComment(req.params.commentId, req.user)),
  ),
);

module.exports = { postRouter: router };
