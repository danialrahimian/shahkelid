import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authApi } from "@/api/auth";
import { cartApi } from "@/api/cart";
import { ordersApi } from "@/api/orders";
import { productsApi } from "@/api/products";
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
 * The cart and the total it adds up to.
 *
 * The interesting part is not that the server can add: it is whether the
 * client notices. The order total comes from the checkout preview, which is a
 * separate request from the cart itself, so changing the cart has to make that
 * preview stale. When it did not, the total simply stopped moving.
 */

const isBackendUp = async () => {
  try {
    const response = await fetch(`${env.API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const backendUp = await isBackendUp();

describe.skipIf(!backendUp)("Cart totals against the live backend", () => {
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
    const result = await store.dispatch(
      authApi.endpoints.register.initiate(uniqueCredentials()),
    );

    if ("error" in result && result.error) {
      throw new Error(
        `Sign-up failed: ${normalizeError(result.error).message}`,
      );
    }
  };

  const aProduct = async () => {
    const catalogue = await store.dispatch(
      productsApi.endpoints.getProducts.initiate({ limit: 60 }),
    );
    const product = catalogue.data?.products[0];
    if (!product) throw new Error("No products. Run `npm run seed:plans`.");
    return product;
  };

  /** Reads the total the way the cart page does: from the cache, no forcing. */
  const cachedTotal = async () => {
    const preview = await store.dispatch(
      ordersApi.endpoints.getCheckout.initiate(),
    );
    return preview.data?.totalPrice;
  };

  it("When one plan is added, then the total is that plan's price", async () => {
    await registerAndSignIn();
    const product = await aProduct();

    await store.dispatch(cartApi.endpoints.addToCart.initiate(product._id));

    expect(await cachedTotal()).toBe(product.price);
  });

  it("When a second unit is added, then the total goes up without being forced", async () => {
    // This is the regression. The cart page reads the total from a cached
    // query, so adding an item has to invalidate it. Before, only the cart
    // itself was patched and the total stayed at whatever it was first read
    // as: two items, one item's price.
    await registerAndSignIn();
    const product = await aProduct();

    await store.dispatch(cartApi.endpoints.addToCart.initiate(product._id));
    expect(await cachedTotal()).toBe(product.price);

    await store.dispatch(cartApi.endpoints.addToCart.initiate(product._id));

    expect(await cachedTotal()).toBe(product.price * 2);
  });

  it("When two different plans are in the cart, then the total is their sum", async () => {
    await registerAndSignIn();
    const catalogue = await store.dispatch(
      productsApi.endpoints.getProducts.initiate({ limit: 60 }),
    );
    const products = catalogue.data?.products ?? [];
    if (products.length < 2) return;

    const [first, second] = products;
    await store.dispatch(cartApi.endpoints.addToCart.initiate(first._id));
    await store.dispatch(cartApi.endpoints.addToCart.initiate(second._id));

    expect(await cachedTotal()).toBe(first.price + second.price);
  });

  it("When a unit is removed, then the total comes back down", async () => {
    await registerAndSignIn();
    const product = await aProduct();
    await store.dispatch(cartApi.endpoints.addToCart.initiate(product._id));
    await store.dispatch(cartApi.endpoints.addToCart.initiate(product._id));

    await store.dispatch(
      cartApi.endpoints.removeFromCart.initiate(product._id),
    );

    expect(await cachedTotal()).toBe(product.price);
  });

  it("When the cart is emptied, then the preview reports it rather than a zero total", async () => {
    // An empty cart is a 400 from the server, which the cart page renders as
    // an empty state. A total of zero would be a different, wrong story.
    await registerAndSignIn();
    const product = await aProduct();
    await store.dispatch(cartApi.endpoints.addToCart.initiate(product._id));

    await store.dispatch(
      cartApi.endpoints.removeFromCart.initiate(product._id),
    );

    const preview = await store.dispatch(
      ordersApi.endpoints.getCheckout.initiate(),
    );
    expect(normalizeError(preview.error).status).toBe(400);
  });

  it("When the cart changes, then the session's copy of it keeps up", async () => {
    // The navigation badge counts from the session, not from the cart query.
    await registerAndSignIn();
    const product = await aProduct();

    await store.dispatch(cartApi.endpoints.addToCart.initiate(product._id));

    const session = await store.dispatch(
      authApi.endpoints.getSession.initiate(),
    );
    const items =
      session.data && "cart" in session.data ? session.data.cart.items : [];
    expect(items).toHaveLength(1);
  });
});
