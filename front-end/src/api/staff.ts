import type {
  CreateSubscriptionInput,
  OrderView,
  PaymentCardInput,
  PaymentCardView,
  ReceiptReviewView,
  ReviewReceiptInput,
  CustomerDetail,
  CustomerSummary,
  LocationInput,
  LocationView,
  PanelGroup,
  PanelInput,
  PanelUpdateInput,
  PanelView,
  PlanInput,
  PlanView,
  ServerInput,
  ServerView,
  SubscriptionAction,
  SubscriptionEventView,
  SubscriptionStatus,
  SubscriptionView,
} from "@shah-kelid/contracts";

import { api } from "@/lib/api";

/**
 * The staff area's requests (/api/v1/staff): panels, servers, plans,
 * customers and subscriptions.
 *
 * Every endpoint name starts with "staff". Like the account endpoints, their
 * 401s are left to the staff area's own guard rather than the old redirect.
 */

const STAFF = "/api/v1/staff";

export type StaffOrderView = OrderView & { customer: { id: string; email: string } };
export type StaffPaymentCard = PaymentCardView & { isActive: boolean; sortOrder: number };

export type SubscriptionDetail = {
  subscription: SubscriptionView;
  history: SubscriptionEventView[];
};

export const staffApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // ------------------------------------------------------------ panels
    staffPanels: builder.query<PanelView[], void>({
      query: () => `${STAFF}/panels`,
      providesTags: ["StaffPanel"],
    }),
    staffCreatePanel: builder.mutation<PanelView, PanelInput>({
      query: (body) => ({ url: `${STAFF}/panels`, method: "POST", body }),
      invalidatesTags: ["StaffPanel"],
    }),
    staffUpdatePanel: builder.mutation<PanelView, { id: string; body: PanelUpdateInput }>({
      query: ({ id, body }) => ({ url: `${STAFF}/panels/${id}`, method: "PUT", body }),
      invalidatesTags: ["StaffPanel", "StaffServer", "StaffPlan"],
    }),
    staffCheckPanel: builder.mutation<PanelView, string>({
      query: (id) => ({ url: `${STAFF}/panels/${id}/check`, method: "POST" }),
      invalidatesTags: ["StaffPanel"],
    }),
    staffPanelGroups: builder.query<PanelGroup[], string>({
      query: (id) => `${STAFF}/panels/${id}/groups`,
    }),

    // --------------------------------------------------------- locations
    staffLocations: builder.query<LocationView[], void>({
      query: () => `${STAFF}/locations`,
      providesTags: ["StaffLocation"],
    }),
    staffSaveLocation: builder.mutation<LocationView, { id?: string; body: LocationInput }>({
      query: ({ id, body }) => ({
        url: id ? `${STAFF}/locations/${id}` : `${STAFF}/locations`,
        method: id ? "PUT" : "POST",
        body,
      }),
      invalidatesTags: ["StaffLocation", "StaffServer"],
    }),

    // ----------------------------------------------------------- servers
    staffServers: builder.query<ServerView[], void>({
      query: () => `${STAFF}/servers`,
      providesTags: ["StaffServer"],
    }),
    staffSaveServer: builder.mutation<ServerView, { id?: string; body: ServerInput }>({
      query: ({ id, body }) => ({
        url: id ? `${STAFF}/servers/${id}` : `${STAFF}/servers`,
        method: id ? "PUT" : "POST",
        body,
      }),
      invalidatesTags: ["StaffServer"],
    }),
    staffArchiveServer: builder.mutation<ServerView, string>({
      query: (id) => ({ url: `${STAFF}/servers/${id}/archive`, method: "POST" }),
      invalidatesTags: ["StaffServer"],
    }),

    // ------------------------------------------------------------- plans
    staffPlans: builder.query<PlanView[], void>({
      query: () => `${STAFF}/plans`,
      providesTags: ["StaffPlan"],
    }),
    staffSavePlan: builder.mutation<PlanView, { id?: string; body: PlanInput }>({
      query: ({ id, body }) => ({
        url: id ? `${STAFF}/plans/${id}` : `${STAFF}/plans`,
        method: id ? "PUT" : "POST",
        body,
      }),
      invalidatesTags: ["StaffPlan"],
    }),
    staffArchivePlan: builder.mutation<PlanView, string>({
      query: (id) => ({ url: `${STAFF}/plans/${id}/archive`, method: "POST" }),
      invalidatesTags: ["StaffPlan"],
    }),

    // --------------------------------------------------------- customers
    staffCustomers: builder.query<CustomerSummary[], { search?: string }>({
      query: ({ search }) => ({ url: `${STAFF}/customers`, params: search ? { search } : {} }),
      providesTags: ["StaffCustomer"],
    }),
    staffCustomer: builder.query<CustomerDetail, string>({
      query: (id) => `${STAFF}/customers/${id}`,
      providesTags: (_result, _error, id) => [{ type: "StaffCustomer", id }, "StaffSubscription"],
    }),

    // ----------------------------------------------------- subscriptions
    staffSubscriptions: builder.query<SubscriptionView[], { status?: SubscriptionStatus }>({
      query: ({ status }) => ({ url: `${STAFF}/subscriptions`, params: status ? { status } : {} }),
      providesTags: ["StaffSubscription"],
    }),
    staffSubscription: builder.query<SubscriptionDetail, string>({
      query: (id) => `${STAFF}/subscriptions/${id}`,
      providesTags: ["StaffSubscription"],
    }),
    staffCreateSubscription: builder.mutation<SubscriptionView, CreateSubscriptionInput>({
      query: (body) => ({ url: `${STAFF}/subscriptions`, method: "POST", body }),
      invalidatesTags: ["StaffSubscription", "StaffCustomer", "StaffServer"],
    }),
    staffSubscriptionAction: builder.mutation<
      SubscriptionView,
      { id: string; action: SubscriptionAction }
    >({
      query: ({ id, action }) => ({
        url: `${STAFF}/subscriptions/${id}/actions/${action}`,
        method: "POST",
      }),
      invalidatesTags: ["StaffSubscription", "StaffCustomer", "StaffServer"],
    }),

    // ---------------------------------------------------------- payments
    staffReceipts: builder.query<ReceiptReviewView[], "waiting" | "decided">({
      query: (which) => ({ url: `${STAFF}/receipts`, params: { which } }),
      providesTags: ["StaffReceipt"],
    }),
    staffReviewReceipt: builder.mutation<ReceiptReviewView, { paymentId: string; body: ReviewReceiptInput }>({
      query: ({ paymentId, body }) => ({ url: `${STAFF}/receipts/${paymentId}/review`, method: "POST", body }),
      invalidatesTags: ["StaffReceipt", "StaffOrder", "StaffCustomer", "StaffSubscription"],
    }),
    staffPaymentCards: builder.query<StaffPaymentCard[], void>({
      query: () => `${STAFF}/payment-cards`,
      providesTags: ["StaffPaymentCard"],
    }),
    staffSavePaymentCard: builder.mutation<StaffPaymentCard, { id?: string; body: PaymentCardInput }>({
      query: ({ id, body }) => ({
        url: id ? `${STAFF}/payment-cards/${id}` : `${STAFF}/payment-cards`,
        method: id ? "PUT" : "POST",
        body,
      }),
      invalidatesTags: ["StaffPaymentCard"],
    }),
    staffOrders: builder.query<StaffOrderView[], { userId?: string }>({
      query: ({ userId }) => ({ url: `${STAFF}/orders`, params: userId ? { userId } : {} }),
      providesTags: ["StaffOrder"],
    }),
    staffFulfilOrder: builder.mutation<OrderView, string>({
      query: (id) => ({ url: `${STAFF}/orders/${id}/fulfil`, method: "POST" }),
      invalidatesTags: ["StaffOrder", "StaffCustomer", "StaffSubscription", "StaffServer"],
    }),
  }),
});

/** A receipt image, fetched with the staff member's session (never a public URL). */
export const receiptImageUrl = (apiUrl: string, paymentId: string) =>
  `${apiUrl}${STAFF}/receipts/${paymentId}/image`;

export const {
  useStaffPanelsQuery,
  useStaffCreatePanelMutation,
  useStaffUpdatePanelMutation,
  useStaffCheckPanelMutation,
  useStaffPanelGroupsQuery,
  useStaffLocationsQuery,
  useStaffSaveLocationMutation,
  useStaffServersQuery,
  useStaffSaveServerMutation,
  useStaffArchiveServerMutation,
  useStaffPlansQuery,
  useStaffSavePlanMutation,
  useStaffArchivePlanMutation,
  useStaffCustomersQuery,
  useStaffCustomerQuery,
  useStaffSubscriptionsQuery,
  useStaffSubscriptionQuery,
  useStaffCreateSubscriptionMutation,
  useStaffSubscriptionActionMutation,
  useStaffReceiptsQuery,
  useStaffReviewReceiptMutation,
  useStaffPaymentCardsQuery,
  useStaffSavePaymentCardMutation,
  useStaffOrdersQuery,
  useStaffFulfilOrderMutation,
} = staffApi;
