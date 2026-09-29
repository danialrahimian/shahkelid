import { Info } from "lucide-react";

import { BarChart } from "@/components/charts/bar-chart";
import { ChartFrame } from "@/components/charts/chart-frame";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetCrmSegmentsQuery } from "@/api/crm";
import { formatCount, formatPrice } from "@/utils/format";
import { STAGE_META, stageMetaFor } from "@/utils/lifecycle-stages";
import type { LifecycleStage } from "@/types/api";

/**
 * How the book splits by stage, and what each segment is worth.
 *
 * Measured over every account rather than the page currently on screen. A
 * segment total that only added up one page would shrink every time somebody
 * changed the page size, which is the sort of number that gets quoted in a
 * meeting and then cannot be reproduced.
 *
 * The thresholds behind the labels come from the server and are printed
 * underneath, so "at risk" is a rule anyone can check rather than a mood.
 */

export const SegmentsPanel = ({
  activeStage,
  onPickStage,
}: {
  activeStage?: LifecycleStage;
  onPickStage: (stage: LifecycleStage | undefined) => void;
}) => {
  const { data, isLoading, isError, error, refetch } = useGetCrmSegmentsQuery();

  if (isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        title="We could not load the segments"
      />
    );
  }

  const segments = data?.segments ?? [];
  // Empty stages are dropped from the chart but kept in the table, so the
  // chart stays readable without the table quietly losing a category.
  const populated = segments.filter((segment) => segment.customers > 0);

  return (
    <ChartFrame
      title="The book by stage"
      description={
        data
          ? `${formatCount(data.totalCustomers)} accounts, worth ${formatPrice(
              segments.reduce((sum, segment) => sum + segment.value, 0),
            )} in lifetime payments.`
          : undefined
      }
      legend={populated.map((segment) => ({
        label: stageMetaFor(segment.stage).label,
        color: STAGE_META[segment.stage].color,
      }))}
      table={{
        columns: ["Stage", "Customers", "Lifetime value"],
        rows: segments.map((segment) => [
          stageMetaFor(segment.stage).label,
          formatCount(segment.customers),
          formatPrice(segment.value),
        ]),
      }}
      action={
        activeStage ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2.5 text-xs"
            onClick={() => onPickStage(undefined)}
          >
            Show all stages
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <BarChart
            data={populated.map((segment) => ({
              key: segment.stage,
              label: stageMetaFor(segment.stage).label,
              value: segment.customers,
              color: STAGE_META[segment.stage].color,
              detail: `${formatPrice(segment.value)} in lifetime payments`,
            }))}
            formatValue={formatCount}
            emptyMessage="No accounts yet."
          />

          <div className="mt-5 flex flex-wrap gap-2 border-t border-border/60 pt-4">
            {populated.map((segment) => (
              <Button
                key={segment.stage}
                type="button"
                size="sm"
                variant={activeStage === segment.stage ? "secondary" : "outline"}
                aria-pressed={activeStage === segment.stage}
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={() =>
                  onPickStage(
                    activeStage === segment.stage ? undefined : segment.stage,
                  )
                }
              >
                {stageMetaFor(segment.stage).label}
                <span className="tabular-nums text-muted-foreground">
                  {formatCount(segment.customers)}
                </span>
              </Button>
            ))}
          </div>

          {data ? (
            <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              An account is at risk after {data.rules.atRiskAfterDays} days
              without a purchase and churned after{" "}
              {data.rules.churnedAfterDays}. VIP and blocked are only ever set
              by hand.
            </p>
          ) : null}
        </>
      )}
    </ChartFrame>
  );
};
