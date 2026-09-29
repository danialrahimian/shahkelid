import { z } from "zod";

/**
 * Sign-in and account rules, shared by the API and the forms.
 *
 * The forms validate with exactly these schemas, so a person is told about a
 * problem before submitting, for the same reason the server would refuse it.
 */

/**
 * Persian (۰-۹) and Arabic-Indic (٠-٩) digits to 0-9.
 *
 * Someone on a Persian keyboard types a code as ۴۸۲۱۹۰. Without this, the
 * form would reject the right code because it was typed in the reader's own
 * script.
 */
export const toLatinDigits = (value: string): string =>
  value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));

export const emailSchema = z
  .string()
  .trim()
  .min(3, "EMAIL_INVALID")
  .max(254, "EMAIL_INVALID")
  .email("EMAIL_INVALID");

/**
 * Following NIST SP 800-63B: a minimum length and nothing else. Rules such as
 * "one uppercase and one symbol" push people to Password1! and do not make
 * passwords harder to guess.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, "PASSWORD_TOO_SHORT")
  .max(PASSWORD_MAX, "PASSWORD_TOO_LONG");

/** An emailed code: six digits, in any script. */
export const signInCodeSchema = z
  .string()
  .transform((value) => toLatinDigits(value).replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "CODE_INVALID"));

/** An authenticator code (six digits) or a recovery code (XXXX-XXXX). */
export const secondFactorCodeSchema = z
  .string()
  .transform((value) => toLatinDigits(value).replace(/\s+/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^(\d{6}|[A-Z2-7]{4}-?[A-Z2-7]{4})$/, "CODE_INVALID"),
  );

export const requestCodeInput = z.object({ email: emailSchema });
export type RequestCodeInput = z.infer<typeof requestCodeInput>;

export const verifyCodeInput = z.object({ email: emailSchema, code: signInCodeSchema });
export type VerifyCodeInput = z.infer<typeof verifyCodeInput>;

export const passwordSignInInput = z.object({
  email: emailSchema,
  // Not held to the length rule: an old password that predates it must still
  // be accepted, and the answer should be "wrong password", not "too short".
  password: z.string().min(1, "PASSWORD_REQUIRED").max(PASSWORD_MAX, "PASSWORD_TOO_LONG"),
});
export type PasswordSignInInput = z.infer<typeof passwordSignInInput>;

export const resetPasswordInput = z.object({
  email: emailSchema,
  code: signInCodeSchema,
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>;

export const setPasswordInput = z.object({ newPassword: passwordSchema });
export type SetPasswordInput = z.infer<typeof setPasswordInput>;

export const secondFactorInput = z.object({ code: secondFactorCodeSchema });
export type SecondFactorInput = z.infer<typeof secondFactorInput>;

/**
 * Every error code the account endpoints can return.
 *
 * The API answers with a code, never with prose meant for the reader; the web
 * app and the bot each show their own Persian text for it.
 */
export const AUTH_ERROR_CODES = [
  "VALIDATION_FAILED",
  "EMAIL_INVALID",
  "PASSWORD_TOO_SHORT",
  "PASSWORD_TOO_LONG",
  "PASSWORD_REQUIRED",
  "CODE_INVALID",
  "CODE_EXPIRED",
  "CODE_WRONG",
  "TOO_MANY_CODES",
  "WRONG_CREDENTIALS",
  "ACCOUNT_LOCKED",
  "ACCOUNT_SUSPENDED",
  "SIGN_IN_REQUIRED",
  "TWO_FACTOR_REQUIRED",
  "TWO_FACTOR_SETUP_REQUIRED",
  "TWO_FACTOR_ALREADY_ENABLED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "CROSS_ORIGIN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL",
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** What the API says about the signed-in account. */
export type AccountView = {
  id: string;
  email: string;
  displayName: string;
  locale: "fa" | "en";
  emailVerified: boolean;
  hasPassword: boolean;
  isStaff: boolean;
  permissions: string[];
  twoFactor: {
    enabled: boolean;
    /** This account must use it (every staff account does). */
    required: boolean;
  };
};

/** The state of the session, as the sign-in screens need it. */
export type SessionView =
  | { status: "signed_out" }
  /** Password or code accepted; the authenticator code is still to come. */
  | { status: "two_factor_pending" }
  /** Staff without an authenticator yet: may only set one up. */
  | { status: "two_factor_setup_required"; account: AccountView }
  | { status: "signed_in"; account: AccountView };
