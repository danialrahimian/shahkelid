"use strict";

/**
 * Extends the built-in Error (best practice 2.2) and marks errors as
 * operational or not (2.3).
 *
 * Operational: an expected, handled situation - bad input, missing record,
 * wrong password. The process is healthy and keeps serving.
 *
 * Non-operational: a bug or a broken dependency. The centralized handler
 * decides whether the process can carry on.
 */
class AppError extends Error {
  constructor(message, { status = 500, code, details, isOperational = true } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 - the request itself is malformed or fails validation. */
const badRequest = (message, details) =>
  new AppError(message, { status: 400, code: "BAD_REQUEST", details });

/** 401 - no usable session. */
const unauthorized = (message = "Please log in to continue") =>
  new AppError(message, { status: 401, code: "UNAUTHORIZED" });

/** 403 - logged in, but not allowed to do this. */
const forbidden = (message = "You are not allowed to do that") =>
  new AppError(message, { status: 403, code: "FORBIDDEN" });

/** 404 - the addressed resource does not exist. */
const notFound = (message = "Not found") =>
  new AppError(message, { status: 404, code: "NOT_FOUND" });

/** 409 - the request conflicts with existing state. */
const conflict = (message) =>
  new AppError(message, { status: 409, code: "CONFLICT" });

/** 502 - an upstream dependency failed. */
const badGateway = (message = "An upstream service failed") =>
  new AppError(message, { status: 502, code: "BAD_GATEWAY" });

module.exports = {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  badGateway,
};
