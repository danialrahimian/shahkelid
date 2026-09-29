import type { ApiErrorCode } from "@shah-kelid/contracts";

/**
 * An error the v1 API answers with on purpose.
 *
 * Every response error carries a stable `code` that clients translate into
 * their own words (the web app and the bot both speak Persian); `message` is
 * for developers reading logs and is never shown to customers.
 *
 *   { "error": { "code": "ACCOUNT_LOCKED", "message": "...", "retryAfterSeconds": 840 } }
 */

export type FieldIssue = { path: string; code: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fields: FieldIssue[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    extra: { fields?: FieldIssue[]; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = extra.fields;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }
}

export const signInRequired = () =>
  new ApiError(401, "SIGN_IN_REQUIRED", "Sign in to continue");

export const forbidden = (message = "Your account is not allowed to do that") =>
  new ApiError(403, "FORBIDDEN", message);

export const notFound = (message = "Not found") => new ApiError(404, "NOT_FOUND", message);

export const conflict = (message: string) => new ApiError(409, "CONFLICT", message);
