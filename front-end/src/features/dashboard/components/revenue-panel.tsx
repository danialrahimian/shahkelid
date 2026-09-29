import * as React from "react";

import { ChartFrame } from "@/components/charts/chart-frame";
import { LineChart } from "@/components/charts/line-chart";
import { SERIES_COLORS } from "@/components/charts/palette";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetRevenueSeriesQuery } from "@/api/analytics";
import {
  formatCompactPrice,
  formatCount,
  formatPrice,
} from "@/utils/format";
import type { RevenueSeries } from "@/types/api";

/**
 * Revenue over time.
 *
 * Revenue and order count are shown one at a time behind a toggle rather than
 * together on two y-axes. A dual-axis chart lets whoever drew it decide where
 * the two lines cross by choosing the scales, which means the reader is
 * looking at a composition rather than at the data.
 */

type Measure = "revenue" | "orders";

/**
 * Bucket labels, formatted in UTC.
 *
 * The server cuts its buckets on UTC day boundaries. Rendering them in the
 * reader's local time would shift a label onto the wrong day for anybody west
 * of Greenwich and put a day's takings under yesterday's heading.
 */
const bucketLabels = (
  bucket: string,
  interval: RevenueSeries["interval"],
) => {
  const date = new Date(bucket + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return { short: bucket, full: bucket };

  const format = (options: Intl.DateTimeFormatOptions) =>
    date.toLocaleDateString("en-US", { ...options, timeZone: "UTC" });

  if (interval === "month") {
    return {
      short: format({ month: "short" }),
      full: format({ month: "long", year: "numeric" }),
    };
  }

  const short = format({ month: "short", day: "numeric" });
  return {
    short,
    full:
      interval === "week"
        ? `Week of ${format({ month: "long", day: "numeric" })}`
        : format({ weekday: "short", month: "long", day: "numeric" }),
  };
};

export const RevenuePanel = ({
  from,
  to,
  interval,
  comparisonLabel,
}: {
  from: string;
  to: string;
  interval: "day" | "week" | "month";
  comparisonLabel: string;
}) => {
  const [measure, setMeasure] = React.useState<Measure>("revenue");
  const { data, isFetching, isError, error, refetch } = useGetRevenueSeriesQuery(
    { from, to, interval },
  );

  const points = data?.points ?? [];
  const labels = points.map(
    (point) => bucketLabels(point.bucket, data?.interval ?? interval).short,
  );
  const tooltipLabels = points.map(
    (point) => bucketLabels(point.bucket, data?.interval ?? interval).full,
  );

  const table = {
    columns: ["Period", "Revenue", "Orders"],
    rows: points.map((point, index) => [
      tooltipLabels[index],
      formatPrice(point.revenue),
      formatCount(point.orders),
    ]),
  };

  const toggle = (
    <div
      role="group"
      aria-label="Measure"
      className="flex items-center rounded-lg border border-border p-0.5"
    >
      {(["revenue", "orders"] as const).map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={measure === option ? "secondary" : "ghost"}
          aria-pressed={measure === option}
          className="h-7 px-2.5 text-xs capitalize"
          onClick={() => setMeasure(option)}
        >
          {option}
        </Button>
      ))}
    </div>
  );

  if (isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        title="We could not load the revenue history"
      />
    );
  }

  return (
    <ChartFrame
      title={measure === "revenue" ? "Revenue over time" : "Orders over time"}
      description={`Paid orders only, dated by when the payment landed. ${comparisonLabel}`}
      action={toggle}
      table={table}
    >
      {isFetching && points.length === 0 ? (
        <Skeleton className="h-65 w-full rounded-lg" />
      ) : (
        <LineChart
          labels={labels}
          tooltipLabels={tooltipLabels}
          formatValue={
            measure === "revenue"
              ? formatCompactPrice
              : (value) => String(Math.round(value))
          }
          series={[
            measure === "revenue"
              ? {
                  key: "revenue",
                  label: "Revenue",
                  color: SERIES_COLORS[0],
                  values: points.map((point) => point.revenue),
                  format: formatPrice,
                }
              : {
                  key: "orders",
                  label: "Orders",
                  color: SERIES_COLORS[1],
                  values: points.map((point) => point.orders),
                  format: formatCount,
                },
          ]}
        />
      )}
    </ChartFrame>
  );
};
