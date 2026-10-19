import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { accountApi } from "@/api/account";
import { env } from "@/config/env";
import { normalizeError } from "@/lib/api-client";
import { errorText } from "@/lib/error-text";
import {
  createTestStore,
  installCookieJar,
  resetSession,
  uniqueCredentials,
  type TestStore,
} from "@/testing/test-store";

/**
 * The account endpoints (/api/v1/auth), against a real backend.
 *
 * What is checked is the contract between this client and the server: the
 * paths, the bodies, and that the error codes the server sends arrive intact
 * and become Persian sentences. Signing in all the way needs the emailed
 * code, which only the server's own tests can read; they cover that.
 */

const isBackendUp = async () => {
  try {
    const response = await fetch(`${env.API_URL}/api/v1/auth/session`);
    return response.ok;
  } catch {
    return false;
  }
};

const backendUp = await isBackendUp();

describe.skipIf(!backendUp)("Account API against the live backend", () => {
  let restoreFetch: () => void;
  let store: TestStore;

  beforeAll(() => {
    restoreFetch = installCookieJar();
  });

  afterAll(() => {
    restoreFetch();
  });

  beforeEach(() => {
    resetSession();
    store = createTestStore();
  });

  it("When nobody has signed in, then the session is signed out", async () => {
    const session = await store
      .dispatch(accountApi.endpoints.accountSession.initiate())
      .unwrap();

    expect(session).toEqual({ status: "signed_out" });
  });

  it("When a code is asked for, then the server accepts the request", async () => {
    const { email } = uniqueCredentials();

    await expect(
      store.dispatch(accountApi.endpoints.accountRequestCode.initiate({ email })).unwrap(),
    ).resolves.not.toThrow();
  });

  it("When a wrong code is entered, then the error code arrives and reads in Persian", async () => {
    const { email } = uniqueCredentials();
    await store.dispatch(accountApi.endpoints.accountRequestCode.initiate({ email })).unwrap();

    const failure = await store
      .dispatch(accountApi.endpoints.accountVerifyCode.initiate({ email, code: "000000" }))
      .unwrap()
      .catch((error: unknown) => error);

    // One in a million, the real code is 000000: then this test signs in.
    expect(normalizeError(failure).code).toBe("CODE_WRONG");
    expect(errorText(failure)).toMatch(/کد درست نیست/);
  });

  it("When a password is wrong, then the answer does not say whether the account exists", async () => {
    const { email } = uniqueCredentials();

    const failure = await store
      .dispatch(
        accountApi.endpoints.accountPasswordSignIn.initiate({ login: email, password: "not the password" }),
      )
      .unwrap()
      .catch((error: unknown) => error);

    expect(normalizeError(failure).code).toBe("WRONG_CREDENTIALS");
  });

  it("When the second step is tried without a first, then it asks for a sign-in", async () => {
    const failure = await store
      .dispatch(accountApi.endpoints.accountTwoFactorVerify.initiate({ code: "123456" }))
      .unwrap()
      .catch((error: unknown) => error);

    expect(normalizeError(failure)).toMatchObject({ status: 401, code: "SIGN_IN_REQUIRED" });
  });
});
