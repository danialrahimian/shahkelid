import { AUTH_ERROR_CODES, type AuthErrorCode } from "@shah-kelid/contracts";

import { normalizeError } from "@/lib/api-client";
import i18n from "@/lib/i18n";

/**
 * What an error from the new API (/api/v1) says, in the reader's language.
 *
 * The API answers with a stable code (ACCOUNT_LOCKED, CODE_WRONG, …) and an
 * English sentence meant for developers. The sentence is never shown: the
 * code is looked up in the translation table instead, so the wording is ours
 * to change without touching the server.
 */

export const isErrorCode = (value: unknown): value is AuthErrorCode =>
  typeof value === "string" && (AUTH_ERROR_CODES as readonly string[]).includes(value);

/** "۱۴ دقیقه", "۴۰ ثانیه": how long to wait, in the reader's digits. */
export const waitText = (seconds: number | undefined) => {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return i18n.t("errors.wait.unknown");
  }
  const digits = new Intl.NumberFormat(i18n.language);
  return seconds < 60
    ? i18n.t("errors.wait.seconds", { amount: digits.format(Math.ceil(seconds)) })
    : i18n.t("errors.wait.minutes", { amount: digits.format(Math.ceil(seconds / 60)) });
};

export const codeText = (code: AuthErrorCode, retryAfterSeconds?: number) =>
  i18n.t(`errors.codes.${code}`, { wait: waitText(retryAfterSeconds) });

/** The sentence to show for anything a request threw. */
export const errorText = (error: unknown) => {
  const normalized = normalizeError(error);
  if (normalized.status === 0) return i18n.t("errors.offline");
  if (isErrorCode(normalized.code)) {
    return codeText(normalized.code, normalized.retryAfterSeconds);
  }
  return i18n.t("errors.generic");
};

/**
 * A form field's message. The shared schemas carry codes as their messages
 * ("EMAIL_INVALID"); older forms carry sentences, which pass through as they
 * are.
 */
export const fieldErrorText = (message: string) =>
  isErrorCode(message) ? codeText(message) : message;
