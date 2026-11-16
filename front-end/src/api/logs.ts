import type { LogPage, LogSource } from "@shah-kelid/contracts";

import { api } from "@/lib/api";

/** The owner's log of everything (/api/v1/staff/logs). */

export type LogFilter = { source?: LogSource; q?: string; problems?: boolean };

export const logsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    staffLogs: builder.query<LogPage, LogFilter & { beforeAt?: string; beforeKey?: string }>({
      query: ({ source, q, problems, beforeAt, beforeKey }) => ({
        url: "/api/v1/staff/logs",
        params: {
          limit: 100,
          ...(source ? { source } : {}),
          ...(q ? { q } : {}),
          ...(problems ? { problems: "1" } : {}),
          ...(beforeAt && beforeKey ? { beforeAt, beforeKey } : {}),
        },
      }),
      // A log is read as it is now: nothing cached across visits.
      keepUnusedDataFor: 0,
    }),
  }),
});

export const { useStaffLogsQuery } = logsApi;
