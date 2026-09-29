import { motion } from "motion/react";

import {
  bestSavingFor,
  type PricingCatalogue,
} from "@/features/pricing/billing-term";
import { billingCadence, type BillingPeriod } from "@/utils/billing-periods";
import { cn } from "@/lib/utils";

/**
 * Chooses which billing term the prices are shown for.
 *
 * The page opens on the longest term because that is the cheapest per month,
 * and this is how somebody moves to a shorter commitment. The saving on each
 * tab is the best available on that term, so the cost of choosing a shorter
 * one is visible before it is chosen rather than after.
 */
export const TermSwitcher = ({
  catalogue,
  value,
  onChange,
}: {
  catalogue: PricingCatalogue;
  value: BillingPeriod;
  onChange: (period: BillingPeriod) => void;
}) => {
  // One option is not a choice, so there is nothing to show.
  if (catalogue.periods.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label="Billing term"
      className="mx-auto mb-10 flex w-full max-w-2xl flex-col gap-2 rounded-2xl border border-border bg-card/50 p-2 sm:flex-row"
    >
      {catalogue.periods.map((period) => {
        const plans = catalogue.plansByPeriod[period];
        const saving = bestSavingFor(plans);
        const isActive = period === value;

        return (
          <button
            key={period}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(period)}
            className={cn(
              "relative flex flex-1 items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {/* One panel that slides between the tabs, rather than three that
                fade independently. */}
            {isActive ? (
              <motion.span
                layoutId="term-switch"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 rounded-xl border border-primary/40 bg-primary/10"
              />
            ) : null}

            <span className="relative">
              <span className="block text-sm font-semibold">{period}</span>
              <span className="block text-xs text-muted-foreground">
                Billed {billingCadence(period)}
              </span>
            </span>

            {saving > 0 ? (
              <motion.span
                layout
                className={cn(
                  "relative shrink-0 rounded-full px-2 py-1 text-xs font-bold",
                  isActive
                    ? "bg-emerald-500 text-white"
                    : "bg-emerald-500/15 text-emerald-500",
                )}
              >
                SAVE {saving}%
              </motion.span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};
