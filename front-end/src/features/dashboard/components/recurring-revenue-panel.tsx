import { Info, Repeat, TriangleAlert } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatPercent, formatPrice } from "@/utils/format";
import type { AnalyticsSummary } from "@/types/api";

/**
 * The run rate, with the coverage it was computed from.
 *
 * A two-year plan sold for $96 is $4 a month, not $96, so every order is
 * spread over its own billing term before anything is added up. Orders written
 * before the term was recorded on the line are left out rather than assumed to
 * be monthly -- assuming would count a two-year sale twenty-four times over.
 *
 * How many were left out is shown next to the figure. A run rate whose
 * coverage is hidden is a number nobody downstream can check.
 */

export const RecurringRevenuePanel = ({
  summary,
  isLoading,
}: {
  summary?: AnalyticsSummary;
  isLoading?: boolean;
}) => {
  const coverage = summary?.mrrCoverage;
  const isPartial = coverage !== undefined && coverage.percent < 100;
  const excluded = coverage ? coverage.totalOrders - coverage.countedOrders : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Repeat className="size-4 text-muted-foreground" />
          Recurring revenue
        </CardTitle>
        <CardDescription>
          Every paid plan spread over its own billing term. Not scoped to the
          date range: a run rate describes now, not a window.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {isLoading || !summary ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Monthly
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatPrice(summary.mrr)}
                </p>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Annualised
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatPrice(summary.arr)}
                </p>
              </div>
            </div>

            {isPartial ? (
              <p
                role="note"
                className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400"
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Computed from {formatPercent(coverage.percent)} of paid
                  orders. {formatCount(excluded)}{" "}
                  {excluded === 1 ? "order carries" : "orders carry"} no billing
                  term and{" "}
                  {excluded === 1 ? "was" : "were"} left out rather than guessed
                  at, so the true run rate is higher than the figure above.
                </span>
              </p>
            ) : coverage?.totalOrders ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Computed from every one of the{" "}
                {formatCount(coverage.totalOrders)} paid orders on record.
              </p>
            ) : (
              // "Computed from every one of the 0 orders" is technically true
              // and reads as a boast. Nothing has sold yet, so say that.
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Nothing has been paid for yet, so there is no run rate to
                report.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
