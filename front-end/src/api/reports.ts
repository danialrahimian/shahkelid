import type { ReportBreakdown, ReportRange, ReportSummary, RevenuePoint, TopCustomer } from "@shah-kelid/contracts";

import { api } from "@/lib/api";

/** Sales reports (/api/v1/staff/reports), for staff with analytics:read. */

const REPORTS = "/api/v1/staff/reports";

export const reportsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    staffReportSummary: builder.query<ReportSummary, ReportRange>({
      query: (range) => ({ url: `${REPORTS}/summary`, params: range }),
      providesTags: ["StaffReport"],
    }),
    staffReportRevenue: builder.query<RevenuePoint[], ReportRange>({
      query: (range) => ({ url: `${REPORTS}/revenue`, params: range }),
      providesTags: ["StaffReport"],
    }),
    staffReportBreakdown: builder.query<ReportBreakdown, ReportRange>({
      query: (range) => ({ url: `${REPORTS}/breakdown`, params: range }),
      providesTags: ["StaffReport"],
    }),
    staffReportCustomers: builder.query<TopCustomer[], ReportRange>({
      query: (range) => ({ url: `${REPORTS}/customers`, params: range }),
      providesTags: ["StaffReport"],
    }),
  }),
});

export const {
  useStaffReportSummaryQuery,
  useStaffReportRevenueQuery,
  useStaffReportBreakdownQuery,
  useStaffReportCustomersQuery,
} = reportsApi;
