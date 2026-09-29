import type { CheckoutMethodView, OrderView, PaymentCardView, PublicPlan } from "@shah-kelid/contracts";

import { api } from "@/lib/api";

/**
 * Buying (/api/v1/shop). Endpoint names start with "shop", so the shared
 * client leaves their 401s alone: a signed-out buyer is shown the sign-in
 * step in place, not bounced to the old sign-in page.
 */

const SHOP = "/api/v1/shop";

export const shopApi = api.injectEndpoints({
  endpoints: (builder) => ({
    shopPlans: builder.query<PublicPlan[], void>({
      query: () => `${SHOP}/plans`,
      providesTags: ["ShopPlan"],
    }),
    shopCards: builder.query<PaymentCardView[], void>({
      query: () => `${SHOP}/cards`,
    }),
    shopPaymentMethods: builder.query<CheckoutMethodView[], void>({
      query: () => `${SHOP}/payment-methods`,
    }),
    shopCreateOrder: builder.mutation<OrderView, { planId: string; idempotencyKey: string }>({
      query: ({ planId, idempotencyKey }) => ({
        url: `${SHOP}/orders`,
        method: "POST",
        body: { planId },
        headers: { "idempotency-key": idempotencyKey },
      }),
      invalidatesTags: ["ShopOrder"],
    }),
    shopOrders: builder.query<OrderView[], void>({
      query: () => `${SHOP}/orders`,
      providesTags: ["ShopOrder"],
    }),
    shopOrder: builder.query<OrderView, string>({
      query: (id) => `${SHOP}/orders/${id}`,
      providesTags: (_result, _error, id) => [{ type: "ShopOrder", id }],
    }),
    shopPayZarinpal: builder.mutation<{ payUrl: string }, string>({
      query: (orderId) => ({ url: `${SHOP}/orders/${orderId}/pay/zarinpal`, method: "POST" }),
    }),
    shopPayCard: builder.mutation<OrderView, { orderId: string; form: FormData }>({
      query: ({ orderId, form }) => ({ url: `${SHOP}/orders/${orderId}/pay/card`, method: "POST", body: form }),
      invalidatesTags: (_result, _error, { orderId }) => ["ShopOrder", { type: "ShopOrder", id: orderId }],
    }),
    shopPayUsdt: builder.mutation<OrderView, string>({
      query: (orderId) => ({ url: `${SHOP}/orders/${orderId}/pay/usdt`, method: "POST" }),
      invalidatesTags: (_result, _error, orderId) => ["ShopOrder", { type: "ShopOrder", id: orderId }],
    }),
    shopPayNowPayments: builder.mutation<{ payUrl: string }, string>({
      query: (orderId) => ({ url: `${SHOP}/orders/${orderId}/pay/nowpayments`, method: "POST" }),
    }),
  }),
});

export const {
  useShopPlansQuery,
  useShopPaymentMethodsQuery,
  useShopPayUsdtMutation,
  useShopPayNowPaymentsMutation,
  useShopCardsQuery,
  useShopCreateOrderMutation,
  useShopOrdersQuery,
  useShopOrderQuery,
  useShopPayZarinpalMutation,
  useShopPayCardMutation,
} = shopApi;
