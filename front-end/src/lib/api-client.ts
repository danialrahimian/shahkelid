import {
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from "@reduxjs/toolkit/query";
import { toast } from "sonner";

import { env } from "@/config/env";
import { paths } from "@/config/paths";

/**
 * The one configured API client the whole application talks through.
 *
 * Everything that reaches the server goes through here, so the base URL,
 * cookie credentials and error handling are decided once. Before this, every
 * thunk called `fetch` with the host typed out by hand and invented its own
 * error shape.
 */

/** The API always reports problems as a list of messages. */
export type ApiFieldError = { msg: string; path?: string };

export type ApiError = {
  status: number;
  errors: ApiFieldError[];
  /** The first message, which is what most callers want to show. */
  message: string;
  code?: string;
  /** From /api/v1: how long until trying again can work (a lock, a limit). */
  retryAfterSeconds?: number;
};

const NETWORK_ERROR_MESSAGE = "Could not reach the server. Check your connection.";

/**
 * Normalises everything the server (or the network) can throw at us into one
 * shape. The API answers `{ errors: [{ msg }] }`, but a proxy, an offline
 * browser or a crash can produce a bare string, plain text, or nothing at all.
 */
/** Has this already been through here once? */
const isApiError = (value: unknown): value is ApiError =>
  typeof value === "object" &&
  value !== null &&
  "message" in value &&
  "errors" in value &&
  Array.isArray((value as ApiError).errors);

export const normalizeError = (error: unknown): ApiError => {
  // The base query normalises before handing an error to a component, and
  // components pass that straight back here. Without this guard the second
  // pass found no raw body to read and replaced a perfectly good message with
  // the generic fallback.
  if (isApiError(error)) return error;

  const raw = error as FetchBaseQueryError | undefined;

  if (!raw) {
    return {
      status: 0,
      errors: [{ msg: NETWORK_ERROR_MESSAGE }],
      message: NETWORK_ERROR_MESSAGE,
    };
  }

  // A transport failure: no response ever arrived.
  if (typeof raw.status === "string") {
    const message =
      raw.status === "PARSING_ERROR"
        ? "The server sent a response we could not read."
        : NETWORK_ERROR_MESSAGE;
    return { status: 0, errors: [{ msg: message }], message };
  }

  const status = raw.status;
  const body = raw.data;

  // Some proxies answer with plain text rather than the API's JSON envelope.
  if (typeof body === "string" && body.trim() !== "") {
    return { status, errors: [{ msg: body }], message: body };
  }

  // /api/v1 answers { error: { code, message, fields?, retryAfterSeconds? } }.
  // The code is what a screen translates; the message is for developers.
  const v1 =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: unknown }).error
      : undefined;
  if (v1 && typeof v1 === "object" && typeof (v1 as { code?: unknown }).code === "string") {
    const { code, message, fields, retryAfterSeconds } = v1 as {
      code: string;
      message?: unknown;
      fields?: { path?: unknown; code?: unknown }[];
      retryAfterSeconds?: unknown;
    };
    const text = typeof message === "string" ? message : code;
    return {
      status,
      errors: Array.isArray(fields)
        ? fields.map((field) => ({ msg: String(field.code), path: String(field.path) }))
        : [{ msg: text }],
      message: text,
      code,
      retryAfterSeconds: typeof retryAfterSeconds === "number" ? retryAfterSeconds : undefined,
    };
  }

  const envelope =
    body && typeof body === "object"
      ? (body as { errors?: unknown; message?: unknown; code?: unknown })
      : undefined;

  const listed = Array.isArray(envelope?.errors)
    ? (envelope.errors as ApiFieldError[]).filter((entry) =>
        Boolean(entry?.msg),
      )
    : [];

  const fallback =
    typeof envelope?.message === "string"
      ? envelope.message
      : "Something went wrong. Please try again.";

  const errors = listed.length > 0 ? listed : [{ msg: fallback }];

  return {
    status,
    errors,
    message: errors[0].msg,
    code: typeof envelope?.code === "string" ? envelope.code : undefined,
  };
};

const rawBaseQuery = fetchBaseQuery({
  baseUrl: env.API_URL,
  // The session lives in an HttpOnly cookie, so every request has to carry it.
  credentials: "include",
});

/** Requests that are expected to 401 for a signed-out visitor, and so must not bounce them. */
const SILENT_401_ENDPOINTS = new Set(["getSession", "logout"]);

/**
 * Wraps the transport with the two things every response needs: a readable
 * error, and one reaction to an expired session.
 */
export const baseQueryWithErrorHandling: BaseQueryFn<
  string | FetchArgs,
  unknown,
  ApiError
> = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);

  if (result.error) {
    const error = normalizeError(result.error);

    // A session that expired mid-visit should send the user to sign in again,
    // remembering where they were so they land back on the same page.
    //
    // Guarded on `window` because this module also runs outside a browser:
    // reaching for `window.location` unguarded threw inside the base query,
    // which turned every 401 into an unrecognisable error instead of a 401.
    //
    // The new API's endpoints (account*, staff*) are left alone: a 401 there
    // is part of signing in ("authenticator code still to come"), and those
    // screens send the reader to the new sign-in page themselves.
    if (
      error.status === 401 &&
      !SILENT_401_ENDPOINTS.has(api.endpoint) &&
      !api.endpoint.startsWith("account") &&
      !api.endpoint.startsWith("staff") &&
      typeof window !== "undefined"
    ) {
      const redirectTo = `${window.location.pathname}${window.location.search}`;
      if (!window.location.pathname.startsWith(paths.auth.path)) {
        toast.error("Your session has expired. Please sign in again.");
        window.location.href = paths.auth.getHref(redirectTo);
      }
    }

    return { error };
  }

  return result;
};

/**
 * Shows an API failure as a toast. Mutations call this from the component that
 * triggered them, so the message appears next to the action that caused it
 * rather than from a global handler with no context.
 */
export const notifyApiError = (error: unknown, fallback?: string) => {
  const normalized = normalizeError(error);
  toast.error(fallback ?? normalized.message, {
    description:
      normalized.errors.length > 1
        ? normalized.errors
            .slice(1)
            .map((entry) => entry.msg)
            .join(" · ")
        : undefined,
  });
  return normalized;
};
