import { Check } from "lucide-react";
import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { PricingPlan } from "@/features/pricing/billing-term";

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 210, damping: 26, mass: 0.9 },
  },
};

const perkVariants: Variants = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0, transition: { duration: 0.28, ease: "easeOut" } },
};

/** Two decimals, because a price per month is rarely round. */
const money = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * One plan, in the shape a subscription price is normally presented:
 * the per-month figure large, the commitment underneath it, and the total
 * actually charged spelled out so nothing is hidden behind the headline.
 *
 * The recommended plan is lifted rather than merely coloured, because the
 * whole row is scanned at a glance and height reads faster than hue.
 */
export const PlanCard = ({
  plan,
  index = 0,
  action,
}: {
  plan: PricingPlan;
  index?: number;
  action?: ReactNode;
}) => {
  const { product, period, monthlyPrice, savingPercent, recommended } = plan;
  const perks = product.perks ?? [];

  // What this same tier costs per month bought one month at a time, which is
  // the figure the saving is measured against.
  const baseline = plan.baselineMonthlyPrice;

  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ y: recommended ? -14 : -8 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      className={cn(
        "relative flex h-full flex-col",
        // A margin rather than a translate: an inline transform from motion
        // would override a Tailwind translate class outright.
        recommended && "lg:-mt-6 lg:mb-6",
      )}
    >
      {recommended ? (
        <motion.span
          aria-hidden
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
          className="pointer-events-none absolute -inset-px rounded-2xl bg-primary/30 blur-lg"
        />
      ) : null}

      <div
        className={cn(
          "relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card transition-colors duration-300",
          recommended
            ? "border-primary shadow-xl"
            : "border-border hover:border-foreground/25",
        )}
      >
        {/* The ribbon is part of the card, not floating over it, so the row
            keeps a single clean top edge. */}
        <div
          className={cn(
            "flex h-9 items-center justify-center text-xs font-semibold tracking-wide uppercase",
            recommended
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground",
          )}
        >
          {recommended ? "Most popular" : period}
        </div>

        <div className="flex flex-1 flex-col gap-6 p-6 sm:p-7">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">{product.name}</h3>
            <p className="text-sm text-muted-foreground">
              {period === "1 month"
                ? "Billed monthly"
                : `Billed every ${period}`}
            </p>
          </div>

          <div>
            {savingPercent > 0 ? (
              <motion.span
                initial={{ opacity: 0, scale: 0.8, y: -6 }}
                whileInView={{ opacity: 1, scale: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  type: "spring",
                  stiffness: 320,
                  damping: 18,
                  delay: 0.15 + index * 0.05,
                }}
                className="mb-3 inline-flex rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-500"
              >
                SAVE {savingPercent}%
              </motion.span>
            ) : null}

            <div className="flex items-end gap-1.5">
              <span className="text-2xl font-semibold">$</span>
              <span className="font-mono text-5xl leading-none font-extrabold tracking-tight tabular-nums">
                {money(monthlyPrice)}
              </span>
              <span className="pb-1 text-sm text-muted-foreground">/month</span>
            </div>

            {baseline !== null && savingPercent > 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="line-through">${money(baseline)}</span>
                <span className="ml-1.5">per month on the monthly plan</span>
              </p>
            ) : null}
          </div>

          {action ? <div className="[&_button]:w-full">{action}</div> : null}

          {/* The total actually charged. A per-month headline without this is
              the oldest trick in subscription pricing. */}
          <p className="-mt-3 text-center text-xs text-muted-foreground">
            ${product.price} billed{" "}
            {period === "1 month" ? "monthly" : `every ${period}`}
          </p>

          <Separator />

          <motion.ul
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } },
            }}
            className="flex flex-col gap-3 text-sm"
          >
            {perks.map((perk) => (
              <motion.li
                key={perk}
                variants={perkVariants}
                className="flex items-start gap-2.5"
              >
                <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span className="leading-6">{perk}</span>
              </motion.li>
            ))}
          </motion.ul>
        </div>
      </div>
    </motion.div>
  );
};
