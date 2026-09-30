import * as React from "react";

import i18n from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Horizontal bars for magnitude by category.
 *
 * Horizontal rather than vertical because the categories are names, and names
 * read along a line instead of rotated forty-five degrees under an axis.
 *
 * Every bar carries its own value as a direct label. That is the opposite of
 * the rule for lines -- a number on every point of a series is noise -- but a
 * bar chart has few enough marks that labelling them removes the need to
 * measure anything against an axis at all.
 */

export type BarDatum = {
  key: string;
  label: string;
  value: number;
  color: string;
  /** The second line in the tooltip, e.g. how many units that revenue was. */
  detail?: string;
};

type BarChartProps = {
  data: BarDatum[];
  formatValue?: (value: number) => string;
  /** Bars are drawn against this, so several charts can share one scale. */
  max?: number;
  emptyMessage?: string;
  className?: string;
};

export const BarChart = ({
  data,
  formatValue = (value) => String(value),
  max,
  emptyMessage = i18n.t("charts.empty"),
  className,
}: BarChartProps) => {
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [pointerX, setPointerX] = React.useState(0);

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  // Bars are drawn against the largest value rather than the total, so the
  // shape of the comparison survives a range where one plan sold very little.
  const ceiling = Math.max(max ?? 0, ...data.map((row) => row.value), 1);

  return (
    <ul className={cn("space-y-3.5", className)}>
      {data.map((row) => {
        const share = Math.max((row.value / ceiling) * 100, row.value > 0 ? 1.5 : 0);
        const isHovered = hovered === row.key;

        return (
          <li
            key={row.key}
            className="relative"
            onPointerMove={(event) => {
              setHovered(row.key);
              setPointerX(
                event.clientX - event.currentTarget.getBoundingClientRect().left,
              );
            }}
            onPointerLeave={() => setHovered(null)}
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums">
                {formatValue(row.value)}
              </span>
            </div>

            {/* A hit target taller than the bar, so hovering it is easy. */}
            <div className="flex h-4 items-center rounded-md">
              <div className="h-2.5 w-full overflow-hidden rounded-md bg-muted">
                <div
                  className="h-full rounded-r-[4px] transition-[width] duration-500 ease-out"
                  style={{
                    width: share + "%",
                    backgroundColor: row.color,
                    opacity: hovered && !isHovered ? 0.55 : 1,
                  }}
                />
              </div>
            </div>

            {isHovered && row.detail ? (
              <div
                role="status"
                className="pointer-events-none absolute -top-1 z-10 -translate-y-full rounded-lg border border-border bg-popover/95 px-2.5 py-1.5 text-xs shadow-md backdrop-blur"
                style={{
                  left: pointerX,
                  transform: "translate(-50%, -100%)",
                }}
              >
                <span className="font-medium">{row.label}</span>
                <span className="ml-2 text-muted-foreground">{row.detail}</span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};
