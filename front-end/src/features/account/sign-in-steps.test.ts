import type { AccountView } from "@shah-kelid/contracts";
import { describe, expect, it } from "vitest";

import { isolated, safeRedirect, stepAfter } from "./sign-in-steps";

const account: AccountView = {
  id: "0190a0b4-0000-7000-8000-000000000000",
  email: "staff@example.com",
  username: null,
  displayName: "",
  locale: "fa",
  emailVerified: true,
  hasPassword: true,
  isStaff: true,
  permissions: [],
  twoFactor: { enabled: false, required: true },
};

describe("Which step comes next", () => {
  it("When the password was right but an authenticator code is due, then the code is asked for", () => {
    expect(stepAfter({ status: "two_factor_pending" })).toEqual({ kind: "second-factor" });
  });

  it("When staff have no authenticator yet, then setting one up is the only way on", () => {
    expect(stepAfter({ status: "two_factor_setup_required", account })).toEqual({ kind: "setup" });
  });

  it("When signed in, then signing in is done", () => {
    expect(stepAfter({ status: "signed_in", account })).toEqual({ kind: "done" });
  });

  it("When signed out, then it starts from the email", () => {
    expect(stepAfter({ status: "signed_out" })).toEqual({ kind: "email" });
  });
});

describe("Where to go after signing in", () => {
  it("When the redirect is a path on this site, then it is followed", () => {
    expect(safeRedirect("/account?tab=orders", "/")).toBe("/account?tab=orders");
  });

  it.each(["//evil.example/login", "/\\evil.example", "https://evil.example", "javascript:alert(1)"])(
    "When the redirect is %s, then it goes to the fallback instead",
    (target) => {
      expect(safeRedirect(target, "/account")).toBe("/account");
    },
  );

  it("When there is no redirect, then it goes to the fallback", () => {
    expect(safeRedirect(null, "/account")).toBe("/account");
  });
});

describe("An email address inside a Persian sentence", () => {
  it("When wrapped, then it is isolated so it keeps its left-to-right order", () => {
    expect(isolated("ali@example.com")).toBe("⁨ali@example.com⁩");
  });
});
