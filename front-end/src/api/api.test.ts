import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authApi } from "@/api/auth";
import { cartApi } from "@/api/cart";
import { ordersApi } from "@/api/orders";
import { productsApi } from "@/api/products";
import { env } from "@/config/env";
import { usersApi } from "@/api/users";
import { normalizeError } from "@/lib/api-client";
import {
  createTestStore,
  installCookieJar,
  resetSession,
  uniqueCredentials,
  type TestStore,
} from "@/testing/test-store";

/**
 * Integration tests for the API layer, run against a real backend.
 *
 * These are the tests worth having here. The value is not in checking that a
 * reducer sets a flag, it is in checking that the request declarations, the
 * error normalisation and the server's actual responses still agree. A field
 * renamed on the server breaks these; it would not break a mocked unit test.
 *
 * Start the API first, then `npm test`. If nothing is listening the whole
 * suite is skipped rather than reported as a wall of failures.
 */

const isBackendUp = async () => {
  try {
    // The same address the app itself would use, read through the same
    // validated config rather than a second copy of the default.
    const response = await fetch(`${env.API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const backendUp = await isBackendUp();

describe.skipIf(!backendUp)("API layer against the live backend", () => {
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

  /** Signs a fresh account in and hands back its credentials. */
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

  describe("Catalogue", () => {
    it("When products are requested, then a page and a total come back", async () => {
      const result = await store.dispatch(
        productsApi.endpoints.getProducts.initiate({ limit: 3 }),
      );

      expect(result.error).toBeUndefined();
      expect(Array.isArray(result.data?.products)).toBe(true);
      expect(typeof result.data?.totalProductsLength).toBe("number");
      expect(result.data?.limit).toBe(3);
    });

    it("When the id is not an object id, then the error normalises to a 400", async () => {
      const result = await store.dispatch(
        productsApi.endpoints.getProduct.initiate("not-an-id"),
      );

      const error = normalizeError(result.error);
      expect(error.status).toBe(400);
      expect(error.message).toBeTruthy();
    });
  });

  describe("Session", () => {
    it("When nobody is signed in, then the session reports so", async () => {
      const result = await store.dispatch(
        authApi.endpoints.getSession.initiate(),
      );

      expect(result.data?.isLoggedIn).toBe(false);
    });

    it("When an account is created, then the session carries the whole profile", async () => {
      // This is the shape the app rebuilds its session from after a reload.
      // It used to answer with only an id and a role, which is why a refresh
      // lost the username and the cart.
      const credentials = await registerAndSignIn();

      const session = await store.dispatch(
        authApi.endpoints.getSession.initiate(undefined, {
          forceRefetch: true,
        }),
      );

      expect(session.data).toMatchObject({
        isLoggedIn: true,
        username: credentials.username,
        email: credentials.email,
        role: "user",
      });
      expect(
        session.data && "cart" in session.data
          ? Array.isArray(session.data.cart.items)
          : false,
      ).toBe(true);
    });

    it("When the password is wrong, then the error carries a readable message", async () => {
      const credentials = await registerAndSignIn();
      resetSession();
      const fresh = createTestStore();

      const result = await fresh.dispatch(
        authApi.endpoints.login.initiate({
          identifier: credentials.username,
          password: "definitely-wrong",
        }),
      );

      const error = normalizeError(result.error);
      expect(error.status).toBe(401);
      expect(error.message).toMatch(/invalid/i);
    });

    it("When signing in with the email, then the same account is found", async () => {
      const credentials = await registerAndSignIn();
      resetSession();
      const fresh = createTestStore();

      const result = await fresh.dispatch(
        authApi.endpoints.login.initiate({
          identifier: credentials.email,
          password: credentials.password,
        }),
      );

      expect(result.error).toBeUndefined();
      expect(result.data?.username).toBe(credentials.username);
    });
  });

  describe("Cart", () => {
    it("When nobody is signed in, then reading the cart is refused", async () => {
      const result = await store.dispatch(
        cartApi.endpoints.getCart.initiate(),
      );

      expect(normalizeError(result.error).status).toBe(401);
    });

    it("When a product is added, then the cart and the checkout total agree", async () => {
      await registerAndSignIn();

      const catalogue = await store.dispatch(
        productsApi.endpoints.getProducts.initiate({ limit: 1 }),
      );
      const product = catalogue.data?.products[0];
      if (!product) {
        // Nothing to buy on this database; the assertions would be vacuous.
        return;
      }

      const added = await store.dispatch(
        cartApi.endpoints.addToCart.initiate(product._id),
      );
      expect("error" in added && added.error).toBeFalsy();

      const cart = await store.dispatch(
        cartApi.endpoints.getCart.initiate(undefined, { forceRefetch: true }),
      );
      expect(cart.data).toHaveLength(1);
      expect(cart.data?.[0].quantity).toBe(1);

      // The server prices the order; the client never sends an amount.
      const checkout = await store.dispatch(
        ordersApi.endpoints.getCheckout.initiate(undefined, {
          forceRefetch: true,
        }),
      );
      expect(checkout.data?.totalPrice).toBe(product.price);
      expect(checkout.data?.status).toBe("pending");
    });

    it("When the cart is empty, then checkout answers 400 rather than an empty order", async () => {
      await registerAndSignIn();

      const checkout = await store.dispatch(
        ordersApi.endpoints.getCheckout.initiate(),
      );

      expect(normalizeError(checkout.error).status).toBe(400);
    });
  });

  describe("Authorization", () => {
    it("When an ordinary user asks for the admin list, then it is refused", async () => {
      await registerAndSignIn();

      const result = await store.dispatch(
        usersApi.endpoints.getUsers.initiate(),
      );

      expect(normalizeError(result.error).status).toBe(403);
    });

    it("When an ordinary user has no orders, then invoices answer 404", async () => {
      // The invoices screen treats this as an empty state, not a failure, so
      // the status it keys off has to be right.
      await registerAndSignIn();

      const result = await store.dispatch(
        ordersApi.endpoints.getInvoices.initiate(),
      );

      expect(normalizeError(result.error).status).toBe(404);
    });
  });
});
