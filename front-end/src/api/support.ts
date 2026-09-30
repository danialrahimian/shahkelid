import type { TicketCategoryView, TicketSummary, TicketView } from "@shah-kelid/contracts";

import { api } from "@/lib/api";

/**
 * The customer's tickets (/api/v1/support). New tickets and replies are sent
 * as FormData, because they can carry screenshots.
 */

const SUPPORT = "/api/v1/support";

export const supportApi = api.injectEndpoints({
  endpoints: (builder) => ({
    supportCategories: builder.query<TicketCategoryView[], void>({
      query: () => `${SUPPORT}/categories`,
    }),
    supportTickets: builder.query<TicketSummary[], void>({
      query: () => `${SUPPORT}/tickets`,
      providesTags: ["SupportTicket"],
    }),
    supportTicket: builder.query<TicketView, string>({
      query: (id) => `${SUPPORT}/tickets/${id}`,
      providesTags: (_result, _error, id) => [{ type: "SupportTicket", id }],
    }),
    supportOpenTicket: builder.mutation<TicketView, FormData>({
      query: (form) => ({ url: `${SUPPORT}/tickets`, method: "POST", body: form }),
      invalidatesTags: ["SupportTicket"],
    }),
    supportReply: builder.mutation<TicketView, { ticketId: string; form: FormData }>({
      query: ({ ticketId, form }) => ({ url: `${SUPPORT}/tickets/${ticketId}/messages`, method: "POST", body: form }),
      invalidatesTags: (_result, _error, { ticketId }) => ["SupportTicket", { type: "SupportTicket", id: ticketId }],
    }),
    supportCloseTicket: builder.mutation<TicketView, string>({
      query: (ticketId) => ({ url: `${SUPPORT}/tickets/${ticketId}/close`, method: "POST" }),
      invalidatesTags: (_result, _error, ticketId) => ["SupportTicket", { type: "SupportTicket", id: ticketId }],
    }),
  }),
});

/** An attachment, read with the viewer's session: the ticket's owner, or an agent. */
export const ticketFileUrl = (apiUrl: string, fileId: string) => `${apiUrl}${SUPPORT}/files/${fileId}`;

export const {
  useSupportCategoriesQuery,
  useSupportTicketsQuery,
  useSupportTicketQuery,
  useSupportOpenTicketMutation,
  useSupportReplyMutation,
  useSupportCloseTicketMutation,
} = supportApi;
