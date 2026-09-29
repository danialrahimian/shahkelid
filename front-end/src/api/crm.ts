import * as z from "zod";

import { api } from "@/lib/api";
import type {
  CrmSegments,
  CustomerDetail,
  CustomersPage,
  CustomersQuery,
  LifecycleStage,
} from "@/types/api";

/**
 * The customer book. Staff only, on the server as well as here.
 *
 * Nothing in this file is ever shown to the customer it describes: lifetime
 * value, lifecycle stage and internal notes all belong to the business.
 */

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  "lead",
  "active",
  "at-risk",
  "churned",
  "vip",
  "blocked",
];

export const noteInputSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write something first")
    .max(2000, "A note must be 2000 characters or fewer"),
});
export type NoteInput = z.infer<typeof noteInputSchema>;

export const crmApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getCustomers: builder.query<CustomersPage, CustomersQuery | void>({
      query: (params) => {
        const query = new URLSearchParams();
        const { page, limit, search, stage, tag, sort } = params ?? {};

        if (page) query.set("page", String(page));
        if (limit) query.set("limit", String(limit));
        if (search) query.set("search", search);
        if (stage) query.set("stage", stage);
        if (tag) query.set("tag", tag);
        if (sort) query.set("sort", sort);

        const search_ = query.toString();
        return search_ ? `/crm/customers?${search_}` : "/crm/customers";
      },
      providesTags: ["Customer"],
    }),

    getCrmSegments: builder.query<CrmSegments, void>({
      query: () => "/crm/segments",
      providesTags: ["Customer"],
    }),

    getCustomer: builder.query<CustomerDetail, string>({
      query: (userId) => `/crm/customers/${userId}`,
      providesTags: (_result, _error, userId) => [
        { type: "Customer", id: userId },
      ],
    }),

    updateCustomer: builder.mutation<
      CustomerDetail,
      { userId: string; stage?: LifecycleStage | ""; tags?: string[] }
    >({
      query: ({ userId, ...body }) => ({
        url: `/crm/customers/${userId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (_result, _error, { userId }) => [
        "Customer",
        { type: "Customer", id: userId },
      ],
    }),

    addCustomerNote: builder.mutation<
      CustomerDetail,
      { userId: string; body: string }
    >({
      query: ({ userId, body }) => ({
        url: `/crm/customers/${userId}/notes`,
        method: "POST",
        body: { body },
      }),
      invalidatesTags: (_result, _error, { userId }) => [
        "Customer",
        { type: "Customer", id: userId },
      ],
    }),

    deleteCustomerNote: builder.mutation<
      CustomerDetail,
      { userId: string; noteId: string }
    >({
      query: ({ userId, noteId }) => ({
        url: `/crm/customers/${userId}/notes/${noteId}`,
        method: "DELETE",
      }),
      invalidatesTags: (_result, _error, { userId }) => [
        "Customer",
        { type: "Customer", id: userId },
      ],
    }),
  }),
});

export const {
  useGetCustomersQuery,
  useGetCrmSegmentsQuery,
  useGetCustomerQuery,
  useUpdateCustomerMutation,
  useAddCustomerNoteMutation,
  useDeleteCustomerNoteMutation,
} = crmApi;
