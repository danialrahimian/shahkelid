import { api } from "@/lib/api";
import type { CartItem } from "@/types/api";

/**
 * The signed-in visitor's cart. Every one of these needs a session; the server
 * answers 401 otherwise and the client is bounced to sign in.
 */
export const cartApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getCart: builder.query<CartItem[], void>({
      query: () => "/cart",
      providesTags: ["Cart"],
    }),

    addToCart: builder.mutation<CartItem[], string>({
      query: (productId) => ({ url: `/cart/${productId}`, method: "POST" }),
      // The server answers with the new lines, so the cache is updated from
      // the response instead of costing a second round trip.
      onQueryStarted: async (_productId, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            cartApi.util.updateQueryData("getCart", undefined, () => data),
          );
        } catch {
          // The caller reports the failure; there is nothing to patch.
        }
      },
      /**
       * The patch above only touches `getCart`. Everything else derived from
       * the cart still has to be refetched, and the checkout preview is the
       * one that matters: it is where the order total comes from. Without the
       * "Cart" tag here it kept showing whatever it said when the page first
       * loaded, so adding a second item left the total unchanged.
       *
       * The session carries a copy of the cart too, so it is stale as well.
       */
      invalidatesTags: ["Cart", "Session"],
    }),

    removeFromCart: builder.mutation<CartItem[], string>({
      query: (productId) => ({
        url: `/cart/remove/${productId}`,
        method: "POST",
      }),
      onQueryStarted: async (_productId, { dispatch, queryFulfilled }) => {
        try {
          const { data } = await queryFulfilled;
          dispatch(
            cartApi.util.updateQueryData("getCart", undefined, () => data),
          );
        } catch {
          // Handled by the caller.
        }
      },
      // Same reasoning as adding: the total is derived, so it must refetch.
      invalidatesTags: ["Cart", "Session"],
    }),
  }),
});

export const {
  useGetCartQuery,
  useAddToCartMutation,
  useRemoveFromCartMutation,
} = cartApi;
