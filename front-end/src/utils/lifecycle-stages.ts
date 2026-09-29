import {
  Ban,
  CircleCheck,
  CircleSlash,
  Clock,
  Crown,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { LifecycleStage } from "@/types/api";

/**
 * How each lifecycle stage looks and what it actually means.
 *
 * Every stage ships with an icon and a word, never a colour on its own: the
 * list, the filter and the detail page all have to be readable by somebody who
 * cannot tell amber from emerald.
 *
 * The descriptions are here rather than in a tooltip on one screen, because a
 * label like "at risk" is a claim about a customer and staff will act on it.
 * The rule behind it should be legible wherever the label appears.
 */
export const STAGE_META: Record<
  LifecycleStage,
  {
    label: string;
    icon: LucideIcon;
    className: string;
    /**
     * The fill for a segment bar. A status colour, kept apart from the
     * categorical series hues so a stage can never be mistaken for a plan.
     */
    color: string;
    description: string;
  }
> = {
  lead: {
    label: "Lead",
    icon: Sparkles,
    className: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    color: "var(--color-sky-500)",
    description: "Signed up, has never completed a payment.",
  },
  active: {
    label: "Active",
    icon: CircleCheck,
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    color: "var(--color-emerald-500)",
    description: "Bought recently.",
  },
  "at-risk": {
    label: "At risk",
    icon: Clock,
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    color: "var(--color-amber-500)",
    description: "Has bought before, but not for a while.",
  },
  churned: {
    label: "Churned",
    icon: CircleSlash,
    className: "border-border bg-muted text-muted-foreground",
    color: "var(--color-muted-foreground)",
    description: "No purchase in a long time.",
  },
  vip: {
    label: "VIP",
    icon: Crown,
    className:
      "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
    color: "var(--color-violet-500)",
    description: "Set by hand. Never derived from the numbers.",
  },
  blocked: {
    label: "Blocked",
    icon: Ban,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    color: "var(--color-rose-500)",
    description: "Set by hand. Never derived from the numbers.",
  },
};

/** Every stage, in the order the filter and the segment chart present them. */
export const LIFECYCLE_STAGE_ORDER: LifecycleStage[] = [
  "lead",
  "active",
  "at-risk",
  "churned",
  "vip",
  "blocked",
];

/**
 * The two stages a rule can never produce.
 *
 * VIP and blocked are judgements, so they only ever appear as an override. The
 * stage control uses this to explain why picking one is different from picking
 * "active".
 */
export const MANUAL_ONLY_STAGES: LifecycleStage[] = ["vip", "blocked"];

export const stageMetaFor = (stage: LifecycleStage | undefined) =>
  STAGE_META[stage ?? "lead"] ?? STAGE_META.lead;
