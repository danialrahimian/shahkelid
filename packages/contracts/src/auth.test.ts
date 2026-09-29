import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  passwordSchema,
  secondFactorCodeSchema,
  signInCodeSchema,
  toLatinDigits,
  verifyCodeInput,
} from "./auth.ts";

describe("Codes typed in Persian", () => {
  it("When a code is typed with Persian digits, then it reads as the same code", () => {
    assert.equal(toLatinDigits("۴۸۲۱۹۰"), "482190");
  });

  it("When a code is typed with Arabic-Indic digits, then it reads as the same code", () => {
    assert.equal(toLatinDigits("٤٨٢١٩٠"), "482190");
  });

  it("When an emailed code is pasted in Persian with spaces, then it is accepted as six digits", () => {
    assert.equal(signInCodeSchema.parse("۴۸۲ ۱۹۰"), "482190");
  });

  it("When the code is five digits, then it is refused as invalid", () => {
    const result = signInCodeSchema.safeParse("48219");
    assert.equal(result.success, false);
    assert.equal(result.error?.issues[0]?.message, "CODE_INVALID");
  });
});

describe("Second-factor codes", () => {
  it("When an authenticator code is given, then it is accepted", () => {
    assert.equal(secondFactorCodeSchema.parse("۱۲۳۴۵۶"), "123456");
  });

  it("When a recovery code is given in lower case, then it is accepted in upper case", () => {
    assert.equal(secondFactorCodeSchema.parse("abcd-2345"), "ABCD-2345");
  });
});

describe("Passwords", () => {
  it("When a password is shorter than eight characters, then it is refused", () => {
    assert.equal(passwordSchema.safeParse("short").error?.issues[0]?.message, "PASSWORD_TOO_SHORT");
  });

  it("When a password is long and plain, then it is accepted: length is the only rule", () => {
    assert.equal(passwordSchema.safeParse("correct horse battery staple").success, true);
  });
});

describe("Email", () => {
  it("When an email has spaces around it, then they are trimmed", () => {
    assert.equal(verifyCodeInput.parse({ email: "  ali@example.com ", code: "123456" }).email, "ali@example.com");
  });
});
