import { CalendarRange } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, type RangePreset } from "@/utils/report-ranges";

/**
 * The date range the whole page is scoped to.
 *
 * One control above every panel rather than one per chart. Charts that could
 * each be showing a different window look consistent and are not, which is
 * worse than having no control at all.
 */
export const RangePicker = ({
  value,
  onChange,
  className,
}: {
  value: RangePreset;
  onChange: (preset: RangePreset) => void;
  className?: string;
}) => (
  <div className={cn("flex flex-wrap items-center gap-2", className)}>
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CalendarRange className="size-3.5" />
      Showing
    </span>

    <div
      role="group"
      aria-label="Date range"
      className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border p-0.5"
    >
      {RANGE_PRESETS.map((preset) => (
        <Button
          key={preset.key}
          type="button"
          size="sm"
          variant={preset.key === value.key ? "secondary" : "ghost"}
          aria-pressed={preset.key === value.key}
          className="h-7 px-2.5 text-xs"
          onClick={() => onChange(preset)}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  </div>
);
