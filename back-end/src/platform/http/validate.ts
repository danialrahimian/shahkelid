import type { z } from "zod";

import { ApiError } from "./api-error";

/**
 * Parses a request body with a shared contract schema.
 *
 * The same schema the form used, so the server refuses exactly what the form
 * would have warned about. Each field problem comes back with its path and a
 * code (the schemas' messages are codes: "PASSWORD_TOO_SHORT").
 */
export const parseBody = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;

  throw new ApiError(400, "VALIDATION_FAILED", "The request did not pass validation", {
    fields: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.message,
    })),
  });
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route's id parameter; a malformed one is a 400, never a database error. */
export const parseId = (value: unknown): string => {
  if (typeof value === "string" && uuidPattern.test(value)) return value.toLowerCase();
  throw new ApiError(400, "VALIDATION_FAILED", "Not a valid id");
};
