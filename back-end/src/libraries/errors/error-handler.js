"use strict";

const logger = require("../logger");
const { AppError } = require("./app-error");
const config = require("../../config");
const { deleteUpload } = require("../storage/file-store");

/**
 * One place decides what an error means (best practice 2.4). Route handlers
 * never format an error response; they throw and this module answers.
 */

/** Translates known third-party error shapes into an AppError. */
const normalize = (error) => {
  if (error instanceof AppError) {
    return error;
  }

  // Mongoose: bad ObjectId in a path we did not pre-validate.
  if (error?.name === "CastError") {
    return new AppError("Invalid identifier", {
      status: 400,
      code: "BAD_REQUEST",
    });
  }

  // Mongoose: schema validation.
  if (error?.name === "ValidationError") {
    return new AppError("Invalid input", {
      status: 400,
      code: "BAD_REQUEST",
      details: Object.values(error.errors ?? {}).map((e) => ({
        msg: e.message,
        path: e.path,
      })),
    });
  }

  // Mongo: unique index violation.
  if (error?.code === 11000) {
    return new AppError("That value is already taken", {
      status: 409,
      code: "CONFLICT",
      details: Object.keys(error.keyPattern ?? {}).map((path) => ({
        msg: `${path} is already taken`,
        path,
      })),
    });
  }

  // Multer: upload rejected.
  if (error?.name === "MulterError") {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "The image is too large"
        : "The upload was rejected";
    return new AppError(message, { status: 400, code: "BAD_REQUEST" });
  }

  // Body parser: payload over the configured limit, or malformed JSON.
  if (error?.type === "entity.too.large") {
    return new AppError("The request body is too large", {
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  }
  if (error?.type === "entity.parse.failed") {
    return new AppError("The request body is not valid JSON", {
      status: 400,
      code: "BAD_REQUEST",
    });
  }

  // Anything else is a bug until proven otherwise.
  return new AppError(error?.message || "Something went wrong", {
    status: error?.status || error?.statusCode || 500,
    isOperational: false,
  });
};

/**
 * Express error middleware. Its only job is to answer the client; deciding
 * whether the process survives belongs to `handleFatal` below.
 */
// eslint-disable-next-line no-unused-vars -- express detects arity of 4
const errorMiddleware = (error, req, res, next) => {
  const appError = normalize(error);

  // Multer writes the upload to disk before the validators run, so a rejected
  // product form would otherwise leave an orphaned image behind on every
  // failed attempt. Nothing references it, so it is safe to drop here.
  if (req.file?.filename) {
    deleteUpload(req.file.filename);
  }

  const logPayload = {
    err: appError,
    status: appError.status,
    method: req.method,
    url: req.originalUrl,
    requestId: req.id,
  };

  if (appError.status >= 500) {
    logger.error(logPayload, appError.message);
  } else {
    logger.warn(logPayload, appError.message);
  }

  // Never leak internals of an unexpected failure to the client (6.20).
  const isServerFault = appError.status >= 500;
  const message =
    isServerFault && config.isProduction
      ? "Something went wrong"
      : appError.message;

  // The existing clients read `errors: [{ msg }]`, so that shape is kept.
  const body = { errors: [{ msg: message }] };
  if (appError.details) {
    body.errors = Array.isArray(appError.details)
      ? appError.details
      : body.errors;
  }
  if (appError.code) {
    body.code = appError.code;
  }

  return res.status(appError.status).json(body);
};

/**
 * Last line of defence for errors that escape the request lifecycle
 * (best practices 2.6, 2.10). An operational error is logged and life goes on;
 * anything else means the process is in an unknown state, so it is drained and
 * restarted by the process manager.
 */
const handleFatal = ({ onFatal } = {}) => {
  const handle = (reason, origin) => {
    const appError = normalize(reason);
    logger.error({ err: appError, origin }, "Unhandled error");

    if (!appError.isOperational) {
      logger.fatal("Non-operational error, shutting down");
      if (typeof onFatal === "function") {
        onFatal(appError);
      }
    }
  };

  process.on("unhandledRejection", (reason) =>
    handle(reason, "unhandledRejection"),
  );
  process.on("uncaughtException", (error) =>
    handle(error, "uncaughtException"),
  );
};

module.exports = { errorMiddleware, handleFatal, normalize };
