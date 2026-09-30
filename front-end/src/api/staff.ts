import type {
  CreateSubscriptionInput,
  NotificationLogView,
  NotificationTemplateInput,
  NotificationTemplateKey,
  NotificationTemplateView,
  CryptoTransferView,
  ReviewCryptoTransferInput,
  OrderView,
  PaymentCardInput,
  PaymentCardView,
  ReceiptReviewView,
  ReviewReceiptInput,
  CustomerDetail,
  CustomerPage,
  CustomerSegments,
  CustomerSort,
  CustomerStage,
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
  StaffTicketSummary,
  StaffTicketView,
  TicketCategoryInput,
  TicketCategoryView,
  TicketStatus,
  UpdateTicketInput,
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

/** Customers per page of the list. */
export const CUSTOMERS_PAGE = 50;

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
    staffCustomers: builder.query<
      CustomerPage,
      { search?: string; stage?: CustomerStage; tagId?: string; sort: CustomerSort; offset: number }
    >({
      query: ({ search, stage, tagId, sort, offset }) => ({
        url: `${STAFF}/customers`,
        params: {
          sort,
          offset,
          limit: CUSTOMERS_PAGE,
          ...(search ? { search } : {}),
          ...(stage ? { stage } : {}),
          ...(tagId ? { tagId } : {}),
        },
      }),
      providesTags: ["StaffCustomer"],
    }),
    staffCustomerSegments: builder.query<CustomerSegments, void>({
      query: () => `${STAFF}/customers/segments`,
      providesTags: ["StaffCustomer"],
    }),
    staffCustomer: builder.query<CustomerDetail, string>({
      query: (id) => `${STAFF}/customers/${id}`,
      providesTags: (_result, _error, id) => [{ type: "StaffCustomer", id }, "StaffSubscription"],
    }),
    staffAddCustomerNote: builder.mutation<CustomerDetail, { id: string; body: string }>({
      query: ({ id, body }) => ({ url: `${STAFF}/customers/${id}/notes`, method: "POST", body: { body } }),
      invalidatesTags: (_result, _error, { id }) => [{ type: "StaffCustomer", id }],
    }),
    staffDeleteCustomerNote: builder.mutation<CustomerDetail, { id: string; noteId: string }>({
      query: ({ id, noteId }) => ({ url: `${STAFF}/customers/${id}/notes/${noteId}`, method: "DELETE" }),
      invalidatesTags: (_result, _error, { id }) => [{ type: "StaffCustomer", id }],
    }),
    staffSetCustomerStage: builder.mutation<CustomerDetail, { id: string; stage: CustomerStage | null }>({
      query: ({ id, stage }) => ({ url: `${STAFF}/customers/${id}/stage`, method: "PUT", body: { stage } }),
      invalidatesTags: ["StaffCustomer"],
    }),
    staffSetCustomerTags: builder.mutation<CustomerDetail, { id: string; tags: string[] }>({
      query: ({ id, tags }) => ({ url: `${STAFF}/customers/${id}/tags`, method: "PUT", body: { tags } }),
      invalidatesTags: ["StaffCustomer"],
    }),
    staffSetCustomerStatus: builder.mutation<CustomerDetail, { id: string; status: "active" | "suspended" }>({
      query: ({ id, status }) => ({ url: `${STAFF}/customers/${id}/status`, method: "PUT", body: { status } }),
      invalidatesTags: ["StaffCustomer"],
    }),
    staffDeleteCustomer: builder.mutation<{ services: number }, string>({
      query: (id) => ({ url: `${STAFF}/customers/${id}`, method: "DELETE" }),
      invalidatesTags: ["StaffCustomer", "StaffSubscription"],
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
    staffCryptoTransfers: builder.query<CryptoTransferView[], "waiting" | "decided">({
      query: (which) => ({ url: `${STAFF}/crypto-transfers`, params: { which } }),
      providesTags: ["StaffReceipt"],
    }),
    staffReviewCryptoTransfer: builder.mutation<CryptoTransferView, { id: string; body: ReviewCryptoTransferInput }>({
      query: ({ id, body }) => ({ url: `${STAFF}/crypto-transfers/${id}/review`, method: "POST", body }),
      invalidatesTags: ["StaffReceipt", "StaffOrder", "StaffCustomer", "StaffSubscription"],
    }),
    staffTemplates: builder.query<NotificationTemplateView[], void>({
      query: () => `${STAFF}/notification-templates`,
      providesTags: ["StaffTemplate"],
    }),
    staffSaveTemplate: builder.mutation<NotificationTemplateView, { key: NotificationTemplateKey; body: NotificationTemplateInput }>({
      query: ({ key, body }) => ({ url: `${STAFF}/notification-templates/${key}`, method: "PUT", body }),
      invalidatesTags: ["StaffTemplate"],
    }),
    staffResetTemplate: builder.mutation<NotificationTemplateView, NotificationTemplateKey>({
      query: (key) => ({ url: `${STAFF}/notification-templates/${key}`, method: "DELETE" }),
      invalidatesTags: ["StaffTemplate"],
    }),
    staffPreviewTemplate: builder.mutation<{ subject: string; body: string }, { key: NotificationTemplateKey; body: NotificationTemplateInput }>({
      query: ({ key, body }) => ({ url: `${STAFF}/notification-templates/${key}/preview`, method: "POST", body }),
    }),
    staffCustomerNotifications: builder.query<NotificationLogView[], string>({
      query: (customerId) => `${STAFF}/customers/${customerId}/notifications`,
      providesTags: ["StaffCustomer"],
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
    staffTickets: builder.query<StaffTicketSummary[], { status?: TicketStatus; assignee: "me" | "none" | "all" }>({
      query: ({ status, assignee }) => ({ url: `${STAFF}/tickets`, params: status ? { status, assignee } : { assignee } }),
      providesTags: ["StaffTicket"],
    }),
    staffTicket: builder.query<StaffTicketView, string>({
      query: (id) => `${STAFF}/tickets/${id}`,
      providesTags: (_result, _error, id) => [{ type: "StaffTicket", id }],
    }),
    staffTicketReply: builder.mutation<StaffTicketView, { ticketId: string; form: FormData }>({
      query: ({ ticketId, form }) => ({ url: `${STAFF}/tickets/${ticketId}/messages`, method: "POST", body: form }),
      invalidatesTags: (_result, _error, { ticketId }) => ["StaffTicket", { type: "StaffTicket", id: ticketId }],
    }),
    staffUpdateTicket: builder.mutation<StaffTicketView, { ticketId: string; body: UpdateTicketInput }>({
      query: ({ ticketId, body }) => ({ url: `${STAFF}/tickets/${ticketId}`, method: "PATCH", body }),
      invalidatesTags: (_result, _error, { ticketId }) => ["StaffTicket", { type: "StaffTicket", id: ticketId }],
    }),
    staffTicketAgents: builder.query<{ id: string; email: string }[], void>({
      query: () => `${STAFF}/ticket-agents`,
    }),
    staffTicketCategories: builder.query<TicketCategoryView[], void>({
      query: () => `${STAFF}/ticket-categories`,
      providesTags: ["StaffTicketCategory"],
    }),
    staffSaveTicketCategory: builder.mutation<TicketCategoryView, { id?: string; body: TicketCategoryInput }>({
      query: ({ id, body }) => ({
        url: id ? `${STAFF}/ticket-categories/${id}` : `${STAFF}/ticket-categories`,
        method: id ? "PUT" : "POST",
        body,
      }),
      invalidatesTags: ["StaffTicketCategory"],
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
  useStaffCustomerSegmentsQuery,
  useStaffCustomerQuery,
  useStaffAddCustomerNoteMutation,
  useStaffDeleteCustomerNoteMutation,
  useStaffSetCustomerStageMutation,
  useStaffSetCustomerTagsMutation,
  useStaffSetCustomerStatusMutation,
  useStaffDeleteCustomerMutation,
  useStaffSubscriptionsQuery,
  useStaffSubscriptionQuery,
  useStaffCreateSubscriptionMutation,
  useStaffSubscriptionActionMutation,
  useStaffReceiptsQuery,
  useStaffCryptoTransfersQuery,
  useStaffReviewCryptoTransferMutation,
  useStaffReviewReceiptMutation,
  useStaffPaymentCardsQuery,
  useStaffTemplatesQuery,
  useStaffSaveTemplateMutation,
  useStaffResetTemplateMutation,
  useStaffPreviewTemplateMutation,
  useStaffCustomerNotificationsQuery,
  useStaffSavePaymentCardMutation,
  useStaffOrdersQuery,
  useStaffFulfilOrderMutation,
  useStaffTicketsQuery,
  useStaffTicketQuery,
  useStaffTicketReplyMutation,
  useStaffUpdateTicketMutation,
  useStaffTicketAgentsQuery,
  useStaffTicketCategoriesQuery,
  useStaffSaveTicketCategoryMutation,
} = staffApi;
