import { api } from "@/lib/api";
import type {
  AnalyticsSummary,
  PlanBreakdown,
  RevenueSeries,
  SalesFunnel,
  TopCustomer,
} from "@/types/api";

/**
 * Sales reporting. Every endpoint is behind a staff role on the server, so an
 * ordinary customer gets 403 no matter what the client asks for.
 *
 * All five take the same date range, which is why they share one argument
 * type: the dashboard scopes the whole page at once and it would be confusing
 * if one panel silently covered a different window from the rest.
 */
export type ReportRange = {
  from?: string;
  to?: string;
};

const withRange = (path: string, range?: ReportRange, extra?: Record<string, string>) => {
  const query = new URLSearchParams();
  if (range?.from) query.set("from", range.from);
  if (range?.to) query.set("to", range.to);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) query.set(key, value);
  }

  const search = query.toString();
  return search ? `${path}?${search}` : path;
};

export const analyticsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getSalesSummary: builder.query<AnalyticsSummary, ReportRange | void>({
      query: (range) => withRange("/analytics/summary", range ?? undefined),
      providesTags: ["Analytics"],
    }),

    getRevenueSeries: builder.query<
      RevenueSeries,
      (ReportRange & { interval?: "day" | "week" | "month" }) | void
    >({
      query: (params) =>
        withRange("/analytics/revenue", params ?? undefined, {
          interval: params?.interval ?? "",
        }),
      providesTags: ["Analytics"],
    }),

    getPlanBreakdown: builder.query<PlanBreakdown, ReportRange | void>({
      query: (range) => withRange("/analytics/plans", range ?? undefined),
      providesTags: ["Analytics"],
    }),

    getSalesFunnel: builder.query<SalesFunnel, ReportRange | void>({
      query: (range) => withRange("/analytics/funnel", range ?? undefined),
      providesTags: ["Analytics"],
    }),

    getTopCustomers: builder.query<
      TopCustomer[],
      (ReportRange & { limit?: number }) | void
    >({
      query: (params) =>
        withRange("/analytics/top-customers", params ?? undefined, {
          limit: params?.limit ? String(params.limit) : "",
        }),
      providesTags: ["Analytics"],
    }),
  }),
});

export const {
  useGetSalesSummaryQuery,
  useGetRevenueSeriesQuery,
  useGetPlanBreakdownQuery,
  useGetSalesFunnelQuery,
  useGetTopCustomersQuery,
} = analyticsApi;
