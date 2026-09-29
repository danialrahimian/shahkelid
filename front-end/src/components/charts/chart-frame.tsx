import { Table2, TrendingUp } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The frame every chart sits in: a title, a legend, and a table of the same
 * numbers.
 *
 * The table is a required prop rather than an option. One of the series hues
 * sits below 3:1 against the light surface, which means colour alone is not
 * enough to read the chart; the exact figures have to be reachable some other
 * way. Making it required is the only version of that rule which cannot be
 * forgotten on the next chart somebody adds.
 */

export type ChartLegendEntry = { label: string; color: string };

export type ChartTable = {
  columns: string[];
  rows: (string | number)[][];
};

type ChartFrameProps = {
  title: string;
  description?: string;
  /**
   * Shown whenever there are two or more series. A single series needs no
   * legend box because the title already names it.
   */
  legend?: ChartLegendEntry[];
  table: ChartTable;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export const ChartFrame = ({
  title,
  description,
  legend,
  table,
  action,
  className,
  children,
}: ChartFrameProps) => {
  const [view, setView] = React.useState<"chart" | "table">("chart");
  const showLegend = (legend?.length ?? 0) >= 2;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            {description ? (
              <CardDescription className="mt-1">{description}</CardDescription>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {action}
            <div
              role="group"
              aria-label={`${title} view`}
              className="flex items-center rounded-lg border border-border p-0.5"
            >
              <Button
                type="button"
                size="sm"
                variant={view === "chart" ? "secondary" : "ghost"}
                className="h-7 gap-1.5 px-2 text-xs"
                aria-pressed={view === "chart"}
                onClick={() => setView("chart")}
              >
                <TrendingUp className="size-3.5" />
                Chart
              </Button>
              <Button
                type="button"
                size="sm"
                variant={view === "table" ? "secondary" : "ghost"}
                className="h-7 gap-1.5 px-2 text-xs"
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
              >
                <Table2 className="size-3.5" />
                Table
              </Button>
            </div>
          </div>
        </div>

        {showLegend ? (
          <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {legend?.map((entry) => (
              <li
                key={entry.label}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                {entry.label}
              </li>
            ))}
          </ul>
        ) : null}
      </CardHeader>

      <CardContent>
        {view === "chart" ? (
          children
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                <tr>
                  {table.columns.map((column, index) => (
                    <th
                      key={column}
                      scope="col"
                      className={cn(
                        "px-3 py-2 font-medium text-muted-foreground",
                        index === 0 ? "text-left" : "text-right",
                      )}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className="border-t border-border/60 last:border-b-0"
                  >
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className={cn(
                          "px-3 py-2 tabular-nums",
                          cellIndex === 0
                            ? "text-left font-medium"
                            : "text-right text-muted-foreground",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
