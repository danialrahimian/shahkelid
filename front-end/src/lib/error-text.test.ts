import { API_ERROR_CODES } from "@shah-kelid/contracts";
import { describe, expect, it } from "vitest";

import { errorText, fieldErrorText, waitText } from "@/lib/error-text";
import { en } from "@/locales/en";
import { fa } from "@/locales/fa";

/**
 * API error codes into Persian sentences.
 *
 * A code without a sentence would put "ACCOUNT_LOCKED" on a customer's
 * screen, so every code the API can send is checked here, not just the ones
 * a screen happens to meet today.
 */

/** A response from /api/v1, the way fetchBaseQuery hands it over. */
const v1Error = (status: number, code: string, retryAfterSeconds?: number) => ({
  status,
  data: { error: { code, message: "developer text", retryAfterSeconds } },
});

describe("Every API error code has words", () => {
  it.each(API_ERROR_CODES)("When the API answers %s, then there is a sentence in Persian and English", (code) => {
    expect(fa.errors.codes[code]).toBeTruthy();
    expect(en.errors.codes[code]).toBeTruthy();
  });
});

describe("Showing an API error", () => {
  it("When the password is locked, then the sentence says how long, in Persian digits", () => {
    const text = errorText(v1Error(423, "ACCOUNT_LOCKED", 840));

    expect(text).toContain("۱۴ دقیقه");
    expect(text).not.toContain("developer text");
  });

  it("When the wait is under a minute, then it is counted in seconds", () => {
    expect(waitText(40)).toBe("۴۰ ثانیه");
  });

  it("When the server does not say how long, then it says a few minutes", () => {
    expect(errorText(v1Error(429, "RATE_LIMITED"))).toContain("چند دقیقه");
  });

  it("When no response arrives at all, then it says the connection is down", () => {
    expect(errorText({ status: "FETCH_ERROR", error: "TypeError" })).toBe(fa.errors.offline);
  });

  it("When the code is one this app does not know, then the generic sentence is shown", () => {
    expect(errorText(v1Error(500, "SOMETHING_NEW"))).toBe(fa.errors.generic);
  });
});

describe("Form field messages", () => {
  it("When a shared schema fails with a code, then the field shows its sentence", () => {
    expect(fieldErrorText("EMAIL_INVALID")).toBe(fa.errors.codes.EMAIL_INVALID);
  });

  it("When an older form has its own sentence, then it is shown unchanged", () => {
    expect(fieldErrorText("Enter your password")).toBe("Enter your password");
  });
});
