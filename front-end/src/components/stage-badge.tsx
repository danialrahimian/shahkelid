import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stageMetaFor } from "@/utils/lifecycle-stages";
import type { LifecycleStage } from "@/types/api";

/**
 * The pill that names a customer's lifecycle stage.
 *
 * Always an icon plus a word. A reader who cannot separate the amber pill from
 * the emerald one still gets the whole answer.
 */
export const StageBadge = ({
  stage,
  /** Marks a stage that a person set rather than one the rules produced. */
  isOverride,
  className,
}: {
  stage: LifecycleStage;
  isOverride?: boolean;
  className?: string;
}) => {
  const meta = stageMetaFor(stage);
  const Icon = meta.icon;

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 py-1", meta.className, className)}
      title={isOverride ? "Set by a member of the team" : meta.description}
    >
      <Icon className="size-3.5" />
      {meta.label}
      {isOverride ? <span aria-label="set by hand">·&nbsp;set</span> : null}
    </Badge>
  );
};
