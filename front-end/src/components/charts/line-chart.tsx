import * as React from "react";

import { useElementWidth } from "@/hooks/use-element-width";
import { cn } from "@/lib/utils";

/**
 * A line chart with a crosshair.
 *
 * An SVG chart in a browser is an interactive thing whether or not anybody
 * builds the interaction, so the hover layer ships by default: a chart you
 * cannot read exact values off is a picture of some data, not a report of it.
 *
 * Every point is drawn, including the zeroes. A series that skips its quiet
 * days draws a straight line across them, which reads as steady trade rather
 * than none.
 */

export type LineSeries = {
  key: string;
  label: string;
  /** A CSS colour, taken from the validated chart tokens. */
  color: string;
  /** One value per x position, the same length as `labels`. */
  values: number[];
  format?: (value: number) => string;
};

type LineChartProps = {
  labels: string[];
  /** A fuller label for the tooltip, where there is room for one. */
  tooltipLabels?: string[];
  series: LineSeries[];
  height?: number;
  /** Formats the y axis. Series may override it for their own tooltip line. */
  formatValue?: (value: number) => string;
  className?: string;
};

const PADDING = { top: 16, right: 16, bottom: 30, left: 60 };
const TICKS = 4;

/** A round number at or above the peak, so the axis reads in whole steps. */
const niceCeiling = (max: number) => {
  if (!Number.isFinite(max) || max <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(max));
  const scaled = max / magnitude;
  const step =
    scaled <= 1
      ? 1
      : scaled <= 2
        ? 2
        : scaled <= 2.5
          ? 2.5
          : scaled <= 5
            ? 5
            : 10;

  return step * magnitude;
};

export const LineChart = ({
  labels,
  tooltipLabels,
  series,
  height = 260,
  formatValue = (value) => String(value),
  className,
}: LineChartProps) => {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const gradientId = React.useId();
  const [active, setActive] = React.useState<number | null>(null);

  const count = labels.length;
  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 10);
  const plotHeight = Math.max(height - PADDING.top - PADDING.bottom, 10);

  const peak = Math.max(
    0,
    ...series.flatMap((entry) => entry.values.filter(Number.isFinite)),
  );
  const top = niceCeiling(peak);

  // A lone point sits in the middle rather than hard against the y axis.
  const xFor = (index: number) =>
    count <= 1
      ? PADDING.left + plotWidth / 2
      : PADDING.left + (index / (count - 1)) * plotWidth;

  const yFor = (value: number) =>
    PADDING.top + plotHeight * (1 - Math.min(value, top) / top);

  const pathFor = (values: number[]) =>
    values
      .map(
        (value, index) =>
          (index === 0 ? "M" : "L") +
          xFor(index).toFixed(2) +
          "," +
          yFor(value).toFixed(2),
      )
      .join(" ");

  const baseline = (PADDING.top + plotHeight).toFixed(2);
  const areaFor = (values: number[]) =>
    pathFor(values) +
    " L" +
    xFor(count - 1).toFixed(2) +
    "," +
    baseline +
    " L" +
    xFor(0).toFixed(2) +
    "," +
    baseline +
    " Z";

  // Only as many x labels as will fit without colliding.
  const labelStep = Math.max(
    1,
    Math.ceil(count / Math.max(2, Math.floor(plotWidth / 78))),
  );

  const indexAt = (clientX: number, element: SVGSVGElement) => {
    if (count <= 1) return 0;

    const box = element.getBoundingClientRect();
    const x = clientX - box.left - PADDING.left;
    const step = plotWidth / (count - 1);

    return Math.min(count - 1, Math.max(0, Math.round(x / step)));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();

    const delta = event.key === "ArrowRight" ? 1 : -1;
    setActive((current) => {
      const next = (current ?? 0) + delta;
      return Math.min(count - 1, Math.max(0, next));
    });
  };

  if (count === 0) {
    return (
      <p className="py-14 text-center text-sm text-muted-foreground">
        Nothing to plot for this range.
      </p>
    );
  }

  const crosshairX = active === null ? 0 : xFor(active);
  // Kept inside the card: the tooltip flips to the other side of the crosshair
  // once the crosshair is past the midpoint.
  const flip = crosshairX > width / 2;

  return (
    <div ref={ref} className={cn("relative w-full", className)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={
          series.map((entry) => entry.label).join(" and ") +
          " over time. The table view lists every value."
        }
        tabIndex={0}
        className="touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        onPointerMove={(event) =>
          setActive(indexAt(event.clientX, event.currentTarget))
        }
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <defs>
          {series.map((entry) => (
            <linearGradient
              key={entry.key}
              id={gradientId + "-" + entry.key}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={entry.color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={entry.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {/* Grid and axis labels, deliberately recessive. */}
        {Array.from({ length: TICKS + 1 }, (_, index) => {
          const value = (top / TICKS) * index;
          const y = yFor(value);

          return (
            <g key={index}>
              <line
                x1={PADDING.left}
                x2={PADDING.left + plotWidth}
                y1={y}
                y2={y}
                stroke="var(--color-chart-grid)"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {formatValue(value)}
              </text>
            </g>
          );
        })}

        {labels.map((label, index) =>
          index % labelStep === 0 || index === count - 1 ? (
            <text
              key={label + index}
              x={xFor(index)}
              y={height - 8}
              textAnchor={
                index === 0 ? "start" : index === count - 1 ? "end" : "middle"
              }
              className="fill-muted-foreground text-[11px]"
            >
              {label}
            </text>
          ) : null,
        )}

        {series.map((entry) => (
          <g key={entry.key}>
            <path
              d={areaFor(entry.values)}
              fill={"url(#" + gradientId + "-" + entry.key + ")"}
            />
            <path
              d={pathFor(entry.values)}
              fill="none"
              stroke={entry.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {/* A single point has no line to look at, so it is always marked. */}
            {count === 1 ? (
              <circle
                cx={xFor(0)}
                cy={yFor(entry.values[0] ?? 0)}
                r={4}
                fill={entry.color}
                stroke="var(--color-card)"
                strokeWidth={2}
              />
            ) : null}
          </g>
        ))}

        {active !== null ? (
          <g pointerEvents="none">
            <line
              x1={crosshairX}
              x2={crosshairX}
              y1={PADDING.top}
              y2={PADDING.top + plotHeight}
              stroke="var(--color-chart-axis)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            {series.map((entry) => (
              <circle
                key={entry.key}
                cx={crosshairX}
                cy={yFor(entry.values[active] ?? 0)}
                r={4}
                fill={entry.color}
                // A 2px surface ring, so overlapping markers stay separable.
                stroke="var(--color-card)"
                strokeWidth={2}
              />
            ))}
          </g>
        ) : null}
      </svg>

      {active !== null ? (
        <div
          role="status"
          className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border border-border bg-popover/95 p-2.5 text-xs shadow-md backdrop-blur"
          style={{
            left: crosshairX,
            transform: "translateX(" + (flip ? "calc(-100% - 12px)" : "12px") + ")",
          }}
        >
          <p className="mb-1.5 font-medium">
            {tooltipLabels?.[active] ?? labels[active]}
          </p>
          <ul className="space-y-1">
            {series.map((entry) => (
              <li key={entry.key} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-muted-foreground">{entry.label}</span>
                <span className="ml-auto font-medium tabular-nums">
                  {(entry.format ?? formatValue)(entry.values[active] ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
