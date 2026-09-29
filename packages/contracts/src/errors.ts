import { AUTH_ERROR_CODES } from "./auth.ts";

/**
 * Every error code the API can answer with, and every code a shared schema
 * uses as its message.
 *
 * The API never sends prose meant for the reader. It sends one of these, and
 * each client (the web app, later the bot) shows its own sentence for it. A
 * code missing from a client's table is caught by that client's tests.
 */
export const API_ERROR_CODES = [
  ...AUTH_ERROR_CODES,

  // form fields (M3)
  "REQUIRED",
  "TOO_LONG",
  "URL_INVALID",
  "SLUG_INVALID",
  "LOCATION_CODE_INVALID",
  "NUMBER_OUT_OF_RANGE",
  "GROUPS_REQUIRED",

  // panels and provisioning (M3)
  /** The panel did not answer, or answered with a server error. Worth retrying. */
  "PANEL_UNREACHABLE",
  /** The panel answered, and refused: wrong credentials, missing permission, bad data. */
  "PANEL_REJECTED",
  /** No server that sells this plan has room for another customer. */
  "NO_SERVER_AVAILABLE",
  /** The subscription is not on the panel yet (still being made, or failed). */
  "NOT_PROVISIONED",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const isApiErrorCode = (value: unknown): value is ApiErrorCode =>
  typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value);
