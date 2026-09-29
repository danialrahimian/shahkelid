import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authApi } from "@/api/auth";
import { profileApi } from "@/api/profile";
import { env } from "@/config/env";
import { normalizeError } from "@/lib/api-client";
import {
  createTestStore,
  installCookieJar,
  resetSession,
  uniqueCredentials,
  type TestStore,
} from "@/testing/test-store";

/**
 * The profile endpoints, against a real backend.
 *
 * The avatar is exercised with a genuine PNG rather than a stub, because the
 * upload path is multipart and the server checks the MIME type: a fake blob
 * would pass the client and be refused by the server, which is exactly the
 * disagreement these tests exist to catch.
 */

const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

const aPngFile = () =>
  new File([PNG_BYTES], "avatar.png", { type: "image/png" });

const isBackendUp = async () => {
  try {
    const response = await fetch(`${env.API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const backendUp = await isBackendUp();

describe.skipIf(!backendUp)("Profile API against the live backend", () => {
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

  const registerAndSignIn = async () => {
    const credentials = uniqueCredentials();
    const result = await store.dispatch(
      authApi.endpoints.register.initiate(credentials),
    );

    if ("error" in result && result.error) {
      throw new Error(
        `Sign-up failed: ${normalizeError(result.error).message}`,
      );
    }

    return credentials;
  };

  it("When nobody is signed in, then the profile is refused", async () => {
    const result = await store.dispatch(
      profileApi.endpoints.getProfile.initiate(),
    );

    expect(normalizeError(result.error).status).toBe(401);
  });

  it("When signed in, then the profile carries the account and its blank fields", async () => {
    const credentials = await registerAndSignIn();

    const result = await store.dispatch(
      profileApi.endpoints.getProfile.initiate(),
    );

    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({
      username: credentials.username,
      email: credentials.email,
      avatar: null,
      displayName: "",
      bio: "",
    });
  });

  it("When details are saved, then reading the profile back shows them", async () => {
    await registerAndSignIn();

    const saved = await store.dispatch(
      profileApi.endpoints.updateProfile.initiate({
        displayName: "Ada Lovelace",
        bio: "First programmer.",
        country: "United Kingdom",
      }),
    );
    expect("error" in saved && saved.error).toBeFalsy();

    const reread = await store.dispatch(
      profileApi.endpoints.getProfile.initiate(undefined, {
        forceRefetch: true,
      }),
    );
    expect(reread.data).toMatchObject({
      displayName: "Ada Lovelace",
      bio: "First programmer.",
      country: "United Kingdom",
    });
  });

  it("When the username is taken, then the conflict is reported as 409", async () => {
    const first = await registerAndSignIn();
    resetSession();
    const second = createTestStore();
    await second.dispatch(
      authApi.endpoints.register.initiate(uniqueCredentials()),
    );

    const result = await second.dispatch(
      profileApi.endpoints.updateProfile.initiate({
        username: first.username,
      }),
    );

    const error = normalizeError("error" in result ? result.error : undefined);
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/taken/i);
  });

  it("When an avatar is uploaded, then the profile and the session both carry it", async () => {
    await registerAndSignIn();

    const uploaded = await store.dispatch(
      profileApi.endpoints.updateAvatar.initiate(aPngFile()),
    );

    expect("error" in uploaded && uploaded.error).toBeFalsy();
    const avatar =
      "data" in uploaded && uploaded.data ? uploaded.data.avatar : null;
    expect(avatar).toMatch(/^\/uploads\//);

    // The navigation reads the avatar from the session, not from the profile,
    // so the two have to agree.
    const session = await store.dispatch(
      authApi.endpoints.getSession.initiate(undefined, { forceRefetch: true }),
    );
    expect(
      session.data && "avatar" in session.data ? session.data.avatar : null,
    ).toBe(avatar);

    // Clean up the file this test wrote to the server's uploads folder.
    await store.dispatch(profileApi.endpoints.removeAvatar.initiate());
  });

  it("When the avatar is removed, then it goes back to null", async () => {
    await registerAndSignIn();
    await store.dispatch(profileApi.endpoints.updateAvatar.initiate(aPngFile()));

    const removed = await store.dispatch(
      profileApi.endpoints.removeAvatar.initiate(),
    );

    expect("data" in removed && removed.data?.avatar).toBeNull();
  });

  it("When the current password is wrong, then the change is refused", async () => {
    await registerAndSignIn();

    const result = await store.dispatch(
      profileApi.endpoints.changePassword.initiate({
        currentPassword: "not-my-password",
        newPassword: "Even!Str0nger",
      }),
    );

    expect(normalizeError("error" in result ? result.error : undefined).status).toBe(
      401,
    );
  });

  it("When the password is changed, then the new one signs in", async () => {
    const credentials = await registerAndSignIn();

    const changed = await store.dispatch(
      profileApi.endpoints.changePassword.initiate({
        currentPassword: credentials.password,
        newPassword: "Even!Str0nger",
      }),
    );
    expect("error" in changed && changed.error).toBeFalsy();

    resetSession();
    const returning = createTestStore();
    const login = await returning.dispatch(
      authApi.endpoints.login.initiate({
        identifier: credentials.username,
        password: "Even!Str0nger",
      }),
    );
    expect("error" in login && login.error).toBeFalsy();
  });

  it("When the account is deleted, then the session ends with it", async () => {
    const credentials = await registerAndSignIn();

    const deleted = await store.dispatch(
      profileApi.endpoints.deleteAccount.initiate({
        password: credentials.password,
      }),
    );
    expect("error" in deleted && deleted.error).toBeFalsy();

    const session = await store.dispatch(
      authApi.endpoints.getSession.initiate(undefined, { forceRefetch: true }),
    );
    expect(session.data?.isLoggedIn).toBe(false);
  });

  it("When the password is wrong, then the account is not deleted", async () => {
    await registerAndSignIn();

    const result = await store.dispatch(
      profileApi.endpoints.deleteAccount.initiate({ password: "wrong" }),
    );

    expect(normalizeError("error" in result ? result.error : undefined).status).toBe(
      401,
    );

    const session = await store.dispatch(
      authApi.endpoints.getSession.initiate(undefined, { forceRefetch: true }),
    );
    expect(session.data?.isLoggedIn).toBe(true);
  });
});
