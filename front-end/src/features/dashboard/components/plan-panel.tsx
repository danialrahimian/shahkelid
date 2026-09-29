import * as React from "react";

import { BarChart } from "@/components/charts/bar-chart";
import { ChartFrame } from "@/components/charts/chart-frame";
import { colorForKey } from "@/components/charts/palette";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetPlanBreakdownQuery } from "@/api/analytics";
import { BILLING_PERIODS } from "@/utils/billing-periods";
import { formatCount, formatPercent, formatPrice } from "@/utils/format";

/**
 * Where the money came from: by plan, and by how long the plan runs for.
 *
 * Both read the order lines rather than the catalogue, so a plan that has been
 * withdrawn still shows the revenue it made. A breakdown that lost its history
 * whenever somebody retired a product would quietly stop adding up to the
 * headline total.
 */

type Split = "plans" | "terms";

/**
 * The colour order, fixed independently of the data.
 *
 * Sorting the names alphabetically rather than by revenue means a plan keeps
 * its colour when the range changes and the ranking with it. Colour follows
 * the entity, never its position in the list.
 */
const stableOrder = (names: string[]) => [...new Set(names)].sort();

const TERM_ORDER = [...BILLING_PERIODS, "unknown"];

export const PlanPanel = ({
  from,
  to,
}: {
  from: string;
  to: string;
}) => {
  const [split, setSplit] = React.useState<Split>("plans");
  const { data, isFetching, isError, error, refetch } = useGetPlanBreakdownQuery(
    { from, to },
  );

  // Memoised so the fallback empty array is not a new value on every render,
  // which would rebuild the colour order and repaint the bars mid-hover.
  const plans = React.useMemo(() => data?.plans ?? [], [data]);
  const terms = React.useMemo(() => data?.terms ?? [], [data]);

  const planOrder = React.useMemo(
    () => stableOrder(plans.map((row) => row.name)),
    [plans],
  );

  const bars =
    split === "plans"
      ? plans.map((row) => ({
          key: row.name,
          label: row.name,
          value: row.revenue,
          color: colorForKey(row.name, planOrder),
          detail: `${formatCount(row.units)} sold · ${formatPercent(row.share)} of revenue`,
        }))
      : terms.map((row) => ({
          key: row.period,
          label: row.period === "unknown" ? "No term recorded" : row.period,
          value: row.revenue,
          color: colorForKey(row.period, TERM_ORDER),
          detail: `${formatCount(row.units)} sold · ${formatPercent(row.share)} of revenue`,
        }));

  const table =
    split === "plans"
      ? {
          columns: ["Plan", "Revenue", "Units", "Share"],
          rows: plans.map((row) => [
            row.name,
            formatPrice(row.revenue),
            formatCount(row.units),
            formatPercent(row.share),
          ]),
        }
      : {
          columns: ["Billing term", "Revenue", "Units", "Share"],
          rows: terms.map((row) => [
            row.period === "unknown" ? "No term recorded" : row.period,
            formatPrice(row.revenue),
            formatCount(row.units),
            formatPercent(row.share),
          ]),
        };

  const toggle = (
    <div
      role="group"
      aria-label="Break revenue down by"
      className="flex items-center rounded-lg border border-border p-0.5"
    >
      {(
        [
          ["plans", "By plan"],
          ["terms", "By term"],
        ] as const
      ).map(([option, label]) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={split === option ? "secondary" : "ghost"}
          aria-pressed={split === option}
          className="h-7 px-2.5 text-xs"
          onClick={() => setSplit(option)}
        >
          {label}
        </Button>
      ))}
    </div>
  );

  if (isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        title="We could not load the plan breakdown"
      />
    );
  }

  return (
    <ChartFrame
      title="Where the revenue came from"
      description={
        data
          ? `${formatPrice(data.total)} across ${plans.length} ${plans.length === 1 ? "plan" : "plans"} in this range.`
          : undefined
      }
      action={toggle}
      table={table}
    >
      {isFetching && bars.length === 0 ? (
        <div className="space-y-4">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <BarChart data={bars} formatValue={formatPrice} />
      )}
    </ChartFrame>
  );
};
