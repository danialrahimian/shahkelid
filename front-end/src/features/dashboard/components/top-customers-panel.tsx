import { ArrowUpRight, Crown } from "lucide-react";
import { Link } from "react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetTopCustomersQuery } from "@/api/analytics";
import { paths } from "@/config/paths";
import { formatCount, formatDate, formatPrice } from "@/utils/format";

/**
 * The largest customers by what they actually paid.
 *
 * A list rather than a chart. Eight names ranked by one measure is a table's
 * job: the reader wants the names and the exact figures, and a bar chart of
 * eight bars would give them neither faster.
 */

export const TopCustomersPanel = ({
  from,
  to,
}: {
  from: string;
  to: string;
}) => {
  const { data, isFetching, isError, error, refetch } = useGetTopCustomersQuery({
    from,
    to,
    limit: 8,
  });

  const customers = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Crown className="size-4 text-muted-foreground" />
          Largest customers
        </CardTitle>
        <CardDescription>
          Ranked by what they paid in this range, not by what they ordered.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isError ? (
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            title="We could not load the customer ranking"
          />
        ) : isFetching && customers.length === 0 ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : customers.length === 0 ? (
          <EmptyState
            title="Nobody bought anything in this range"
            description="Widen the range, or check that payments are completing."
          />
        ) : (
          <ol className="divide-y divide-border/60">
            {customers.map((customer, index) => (
              <li key={customer.userId}>
                <Link
                  to={paths.dashboardCustomer.getHref(customer.userId)}
                  className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 truncate text-sm font-medium">
                      {customer.username}
                      <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatCount(customer.orders)}{" "}
                      {customer.orders === 1 ? "order" : "orders"}
                      {customer.lastOrderAt
                        ? ` · last on ${formatDate(customer.lastOrderAt)}`
                        : ""}
                    </span>
                  </span>

                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatPrice(customer.revenue)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
};
