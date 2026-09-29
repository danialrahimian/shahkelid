import type { ErrorRequestHandler, RequestHandler } from "express";

import logger from "../../libraries/logger";
import { ApiError, notFound } from "./api-error";

/** Anything under /api/v1 that no route answered. */
export const v1NotFound: RequestHandler = (req, _res, next) =>
  next(notFound(`No route for ${req.method} ${req.originalUrl}`));

/**
 * Turns every error under /api/v1 into the one response shape.
 *
 * An unexpected error is logged with its stack and answered as INTERNAL,
 * without the message: internals are for the log, not for whoever sent the
 * request.
 */
export const v1ErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ApiError) {
    if (error.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
        ...(error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      },
    });
    return;
  }

  // Malformed JSON and oversized bodies, as reported by express.json().
  const type = (error as { type?: string } | undefined)?.type;
  if (type === "entity.parse.failed" || type === "entity.too.large") {
    res.status(type === "entity.too.large" ? 413 : 400).json({
      error: { code: "VALIDATION_FAILED", message: "The request body could not be read" },
    });
    return;
  }

  logger.error({ err: error, requestId: (req as { id?: string }).id }, "Unhandled error in /api/v1");
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
};
