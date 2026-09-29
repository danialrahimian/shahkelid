import { ShoppingCart } from "lucide-react";

import { BarChart } from "@/components/charts/bar-chart";
import { ChartFrame } from "@/components/charts/chart-frame";
import { SERIES_COLORS } from "@/components/charts/palette";
import { ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetSalesFunnelQuery } from "@/api/analytics";
import { formatCount, formatPercent } from "@/utils/format";

/**
 * How many checkouts finish.
 *
 * Open carts are shown beneath the funnel rather than as its first stage. A
 * cart carries no record of when it was filled, so the figure is a snapshot of
 * right now while the two stages above it are counted over the range. Stacking
 * them in one funnel would invite a conversion rate computed from two
 * different time windows.
 */

export const FunnelPanel = ({ from, to }: { from: string; to: string }) => {
  const { data, isFetching, isError, error, refetch } = useGetSalesFunnelQuery({
    from,
    to,
  });

  if (isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        title="We could not load the checkout funnel"
      />
    );
  }

  const started = data?.ordersStarted ?? 0;
  const paid = data?.ordersPaid ?? 0;
  const failed = data?.ordersFailed ?? 0;
  const pending = Math.max(started - paid - failed, 0);

  const stages = [
    {
      key: "started",
      label: "Checkouts started",
      value: started,
      color: SERIES_COLORS[0],
      detail: "every order opened in this range",
    },
    {
      key: "paid",
      label: "Paid",
      value: paid,
      color: SERIES_COLORS[2],
      detail: started > 0 ? formatPercent((paid / started) * 100) + " of those started" : "nothing started",
    },
    {
      key: "failed",
      label: "Failed at the gateway",
      value: failed,
      color: SERIES_COLORS[1],
      detail: started > 0 ? formatPercent((failed / started) * 100) + " of those started" : "nothing started",
    },
    {
      key: "pending",
      label: "Still open",
      value: pending,
      color: SERIES_COLORS[3],
      detail: "started but neither paid nor refused",
    },
  ];

  return (
    <ChartFrame
      title="Checkout funnel"
      description={
        data
          ? `${formatPercent(data.checkoutCompletion)} of the checkouts started in this range were paid.`
          : undefined
      }
      table={{
        columns: ["Stage", "Orders", "Share of started"],
        rows: stages.map((stage) => [
          stage.label,
          formatCount(stage.value),
          started > 0 ? formatPercent((stage.value / started) * 100) : "—",
        ]),
      }}
    >
      {isFetching && !data ? (
        <div className="space-y-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <BarChart
            // Four bars of zero width are harder to read than one sentence
            // saying nothing was started.
            data={started > 0 ? stages : []}
            formatValue={formatCount}
            // Every stage is measured against the top of the funnel, so the
            // bars show attrition rather than each filling its own row.
            max={started}
            emptyMessage="No checkouts were started in this range."
          />

          <p className="mt-5 flex items-center gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
            <ShoppingCart className="size-3.5 shrink-0" />
            <span>
              <span className="font-medium text-foreground tabular-nums">
                {formatCount(data?.openCarts ?? 0)}
              </span>{" "}
              carts have something in them right now. This is a snapshot, not a
              count over the range, so it is kept out of the funnel above.
            </span>
          </p>
        </>
      )}
    </ChartFrame>
  );
};
