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

  // buying and paying (M4)
  /** The plan is not on sale (archived, inactive, or not public). */
  "PLAN_NOT_ON_SALE",
  /** The order can no longer be paid: already paid, expired or cancelled. */
  "ORDER_NOT_PAYABLE",
  /** The payment gateway did not answer. Nothing was charged; try again. */
  "GATEWAY_UNREACHABLE",
  /** The payment gateway refused to start the payment. */
  "GATEWAY_REJECTED",
  "TRACKING_NUMBER_INVALID",
  "LAST4_INVALID",
  "CARD_NUMBER_INVALID",
  /** The receipt is missing, not an image, or too large. */
  "RECEIPT_INVALID",
  /** This payment was already reviewed. */
  "ALREADY_REVIEWED",

  // crypto (M5)
  /** No fresh USDT rate: crypto checkout waits until one arrives. */
  "RATE_UNAVAILABLE",
  /** That payment method is not set up (or not available right now). */
  "METHOD_UNAVAILABLE",

  // the customer panel (M6)
  /** The subscription cannot be renewed now (still being made, deleted, or disabled by staff). */
  "NOT_RENEWABLE",

  // notifications (M7)
  /** A template uses a {{variable}} it does not have. */
  "TEMPLATE_VARIABLE_UNKNOWN",

  // support (M8)
  "TOO_SHORT",
  /** An attachment is not an image, too large, or one too many. */
  "ATTACHMENT_INVALID",
  /** The ticket is closed; the customer opens a new one. */
  "TICKET_CLOSED",

  // the journal (M9)
  /** A post's cover is not a JPEG, PNG or WebP picture, or is over 5 MB. */
  "COVER_INVALID",

  // reports (M9)
  /** A report's range is not two days, is back to front, or is over a year. */
  "RANGE_INVALID",

  // accounts (M9)
  /** The email typed to confirm deleting an account is not the account's. */
  "CONFIRMATION_MISMATCH",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const isApiErrorCode = (value: unknown): value is ApiErrorCode =>
  typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value);
