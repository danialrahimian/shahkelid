import { configureStore } from "@reduxjs/toolkit";

import { api } from "@/lib/api";
import { uiReducer } from "@/stores/ui-store";

/**
 * A store built the same way the application builds its own, but fresh per
 * test so no cached response leaks from one case into the next.
 *
 * Node's fetch does not keep cookies between calls the way a browser does, so
 * the session cookie is captured from each response and replayed on the next
 * request. That is what lets a test sign in and then act as that user.
 */
let cookie = "";

export const resetSession = () => {
  cookie = "";
};

/**
 * Installs a fetch that carries cookies. Called once, before any store is
 * created, so every request the API layer makes goes through it.
 */
export const installCookieJar = () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    // The client hands fetch a fully built Request, not a URL and an init.
    // Passing a fresh `headers` alongside it replaces the Request's own
    // headers rather than adding to them, which silently drops the content
    // type and leaves the server parsing an empty body. Rebuilding from the
    // Request keeps everything and only adds the cookie.
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    if (cookie) headers.set("cookie", cookie);

    const response = await originalFetch(new Request(request, { headers }));

    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      cookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");
    }

    return response;
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
};

export const createTestStore = () =>
  configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
      ui: uiReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(api.middleware),
  });

export type TestStore = ReturnType<typeof createTestStore>;

/** A username and email nothing else will collide with. */
export const uniqueCredentials = () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  return {
    username: `t_${suffix}`,
    email: `t_${suffix}@example.com`,
    password: "Str0ng!Pass",
  };
};

/**
 * Credentials for a staff account, when the machine running the tests has
 * been given some.
 *
 * The reporting and CRM endpoints are staff-only, so a test that registers a
 * fresh account can prove it is refused but cannot prove the figures are
 * right. Rather than shipping a privileged account in the repository, those
 * cases are skipped unless credentials are supplied:
 *
 *   VITE_APP_TEST_STAFF_IDENTIFIER=owner
 *   VITE_APP_TEST_STAFF_PASSWORD=...
 *
 * This is the one place outside `config/env.ts` that reads the environment
 * directly, and it is test-only scaffolding rather than application code.
 */
export const staffCredentials = () => {
  const source = import.meta.env as Record<string, string | undefined>;
  const identifier = source.VITE_APP_TEST_STAFF_IDENTIFIER;
  const password = source.VITE_APP_TEST_STAFF_PASSWORD;

  if (!identifier || !password) return null;
  return { identifier, password };
};
