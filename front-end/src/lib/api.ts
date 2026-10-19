import { createApi } from "@reduxjs/toolkit/query/react";

import { baseQueryWithErrorHandling } from "@/lib/api-client";

/**
 * The empty root API. Each domain injects its own endpoints into it from
 * `src/api/*`, so a request declaration is written once while the cache, the
 * tags and the transport stay shared.
 *
 * The declarations sit above the features rather than inside them because
 * most are needed by several: the catalogue alone is read by the storefront,
 * the cart, the moderator panel and the landing page.
 *
 * This is the server cache, kept deliberately separate from application state:
 * remote data is fetched, cached and invalidated here, and the Redux slices
 * hold only what the client itself owns.
 */
export const api = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithErrorHandling,
  // Declared up front so a feature can invalidate another feature's data
  // without importing it.
  tagTypes: [
    "AccountSession",
    "StaffSettings",
    "StaffPanel",
    "StaffLocation",
    "StaffServer",
    "StaffPlan",
    "StaffCustomer",
    "StaffSubscription",
    "StaffReceipt",
    "StaffPaymentCard",
    "StaffOrder",
    "StaffTemplate",
    "StaffTicket",
    "StaffTicketCategory",
    "SupportTicket",
    "StaffReport",
    "StaffTeam",
    "StaffPost",
    "StaffComment",
    "ShopPlan",
    "ShopOrder",
    "ShopSubscription",
    "Post",
    "Comment",
  ],
  endpoints: () => ({}),
});
