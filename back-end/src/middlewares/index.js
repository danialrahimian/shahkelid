"use strict";

const { validationResult } = require("express-validator");
const multer = require("multer");
const path = require("node:path");
const crypto = require("node:crypto");

const config = require("../config");
const { badRequest, unauthorized, forbidden, notFound } =
  require("../libraries/errors/app-error");

/**
 * Wraps an async handler so a rejected promise reaches the centralized error
 * middleware instead of hanging the request (best practices 2.1, 2.4). Express
 * 5 forwards rejections on its own, but being explicit keeps the intent clear
 * and works the same if the app is downgraded.
 */
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/**
 * Loads the session's user onto the request. Never rejects: routes decide
 * whether a user is required.
 */
const loadUser = (User) =>
  asyncHandler(async (req, res, next) => {
    const sessionUserId = req.session?.user?.id;
    if (!sessionUserId) return next();

    const user = await User.findById(sessionUserId);
    if (user) {
      req.user = user;
    }
    return next();
  });

/** Requires a logged-in user. */
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return next(unauthorized());
  }
  return next();
};

/**
 * Requires one of the given roles. Always used after requireAuth.
 *
 * The previous version had no equivalent: every admin and moderator endpoint
 * was reachable by anyone, and the only checks lived inside two handlers.
 */
const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return next(unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(forbidden());
    }
    return next();
  };

/**
 * Turns express-validator failures into a 400 (best practice 2.11).
 * Kept as one middleware so every validator chain ends the same way.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }
  return next(
    badRequest(
      "Invalid input",
      errors.array().map(({ msg, path: field }) => ({ msg, path: field })),
    ),
  );
};

/** 404 for anything no route matched. */
const notFoundHandler = (req, res, next) =>
  next(notFound(`Cannot ${req.method} ${req.originalUrl}`));

// --------------------------------------------------------------- file upload

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, config.uploads.directory),
  filename: (req, file, callback) => {
    // randomUUID rather than Math.random: predictable upload names let one
    // user guess another's freshly written file.
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const upload = multer({
  storage,
  fileFilter: (req, file, callback) => {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return callback(null, true);
    }
    return callback(badRequest("Only PNG, JPEG, WEBP or GIF images are allowed"));
  },
  limits: { fileSize: config.uploads.maxFileSizeBytes, files: 1 },
});

module.exports = {
  asyncHandler,
  loadUser,
  requireAuth,
  requireRole,
  validate,
  notFoundHandler,
  upload,
};
