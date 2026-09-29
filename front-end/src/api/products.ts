import { api } from "@/lib/api";
import type { Product, ProductsPage, ProductsQuery } from "@/types/api";

/**
 * The public catalogue. Both endpoints are readable without a session, which
 * is why the storefront can render before anyone signs in.
 */
export const productsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getProducts: builder.query<ProductsPage, ProductsQuery | void>({
      query: (params) => {
        const query = new URLSearchParams();
        const { page, limit, search, period, minPrice, maxPrice, sort } =
          params ?? {};

        if (page) query.set("page", String(page));
        if (limit) query.set("limit", String(limit));
        if (search) query.set("search", search);
        if (period) query.set("period", period);
        // Guard against NaN reaching the server, which answers 400 for it.
        if (Number.isFinite(minPrice)) query.set("minPrice", String(minPrice));
        if (Number.isFinite(maxPrice)) query.set("maxPrice", String(maxPrice));
        if (sort) query.set("sort", sort);

        const queryString = query.toString();
        return queryString ? `/products?${queryString}` : "/products";
      },
      providesTags: (result) =>
        result
          ? [
              ...result.products.map(({ _id }) => ({
                type: "Product" as const,
                id: _id,
              })),
              { type: "Product" as const, id: "LIST" },
            ]
          : [{ type: "Product" as const, id: "LIST" }],
    }),

    getProduct: builder.query<Product, string>({
      query: (productId) => `/product/${productId}`,
      providesTags: (_result, _error, productId) => [
        { type: "Product", id: productId },
      ],
    }),
  }),
});

export const { useGetProductsQuery, useGetProductQuery } = productsApi;
