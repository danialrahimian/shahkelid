import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Metric } from "@/types/api";

/**
 * One headline figure.
 *
 * A number on its own is decoration, so the tile always carries the same
 * measure over the preceding span of equal length and the change between them.
 * Where there is no baseline the change is absent rather than shown as 0% or
 * as a triumphant 100%: a first month of trading has not grown by anything.
 *
 * Whether up is good is a property of the measure, not of the arithmetic --
 * more failed checkouts is not an improvement -- so the caller says which.
 */

type StatTileProps = {
  label: string;
  value: string;
  icon: LucideIcon;
  metric?: Metric;
  /** What the comparison figure means, e.g. "vs previous 30 days". */
  comparisonLabel?: string;
  /** Shown under the value when there is no comparison to make. */
  hint?: string;
  direction?: "up-is-good" | "down-is-good" | "neutral";
  isLoading?: boolean;
  className?: string;
};

const toneFor = (
  change: number,
  direction: NonNullable<StatTileProps["direction"]>,
) => {
  if (change === 0 || direction === "neutral") {
    return "text-muted-foreground bg-muted";
  }

  const good = direction === "up-is-good" ? change > 0 : change < 0;
  return good
    ? "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400"
    : "text-rose-600 bg-rose-500/10 dark:text-rose-400";
};

export const StatTile = ({
  label,
  value,
  icon: Icon,
  metric,
  comparisonLabel,
  hint,
  direction = "up-is-good",
  isLoading,
  className,
}: StatTileProps) => {
  const change = metric?.change ?? null;
  const ChangeIcon =
    change === null || change === 0
      ? ArrowRight
      : change > 0
        ? ArrowUpRight
        : ArrowDownRight;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </span>
        </div>

        {isLoading ? (
          <>
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-4 w-36" />
          </>
        ) : (
          <>
            <motion.p
              key={value}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="text-2xl font-semibold tabular-nums"
            >
              {value}
            </motion.p>

            {change !== null ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium tabular-nums",
                    toneFor(change, direction),
                  )}
                >
                  <ChangeIcon className="size-3" />
                  {change > 0 ? "+" : ""}
                  {change}%
                </span>
                {comparisonLabel ? (
                  <span className="text-muted-foreground">
                    {comparisonLabel}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {hint ?? "No earlier period to compare with"}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
