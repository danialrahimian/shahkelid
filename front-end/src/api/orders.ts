import { api } from "@/lib/api";
import type {
  Order,
  OrderPreview,
  PaymentTicket,
  VerifiedPayment,
} from "@/types/api";

/**
 * Checkout, payment and invoices.
 *
 * Note what is absent: nothing here sends a price. The server rebuilds the
 * order from its own copy of the cart and verifies against the stored total,
 * so a client that named its own amount would simply be ignored.
 */
export const ordersApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getCheckout: builder.query<OrderPreview, void>({
      query: () => "/checkout",
      providesTags: ["Cart"],
    }),

    startPayment: builder.mutation<PaymentTicket, void>({
      query: () => ({ url: "/payment", method: "POST" }),
      invalidatesTags: ["Order"],
    }),

    verifyPayment: builder.mutation<
      VerifiedPayment,
      { Authority: string; Status: string | null }
    >({
      query: (body) => ({ url: "/verify-payment", method: "POST", body }),
      // A confirmed payment empties the cart and adds an invoice.
      invalidatesTags: ["Order", "Cart", "Session"],
    }),

    getInvoices: builder.query<Order[], void>({
      query: () => "/get-invoices",
      providesTags: ["Order"],
    }),
  }),
});

export const {
  useGetCheckoutQuery,
  useStartPaymentMutation,
  useVerifyPaymentMutation,
  useGetInvoicesQuery,
} = ordersApi;
