import { PackageSearch, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import * as React from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";

import { GradientText } from "@/components/animate-ui/primitives/texts/gradient";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { SHEEN } from "@/components/ui/motion-primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetProductsQuery } from "@/api/products";
import { AddToCartButton } from "@/features/cart/components/add-to-cart-button";
import { toPricingCatalogue } from "@/features/pricing/billing-term";
import { GuaranteeStrip } from "@/features/pricing/components/guarantee-strip";
import { PlanCard } from "@/features/pricing/components/plan-card";
import { PlanComparison } from "@/features/pricing/components/plan-comparison";
import { TermSwitcher } from "@/features/pricing/components/term-switcher";
import {
  DEFAULT_PERIOD,
  isBillingPeriod,
  type BillingPeriod,
} from "@/utils/billing-periods";

const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

/** Holds the row's shape while the plans load, so nothing jumps. */
const PlanCardSkeleton = () => (
  <div className="overflow-hidden rounded-2xl border border-border bg-card">
    <Skeleton className="h-9 w-full rounded-none" />
    <div className="space-y-6 p-7">
      <div className="space-y-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-12 w-40" />
        <Skeleton className="h-4 w-36" />
      </div>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-px w-full" />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </div>
    </div>
  </div>
);

/**
 * The pricing page.
 *
 * One billing term is shown at a time, opening on the longest because that is
 * the cheapest per month. The other terms are a click away, and each tab
 * carries the best saving available on it, so the cost of a shorter commitment
 * is visible before it is chosen.
 *
 * The chosen term lives in the URL, which makes a particular view shareable
 * and means the back button steps through the terms somebody looked at.
 */
const PricingRoute = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // The whole catalogue in one request: the grouping and the per-tier saving
  // both need every term, not just the one on screen.
  const { data, isLoading, isError, error, refetch } = useGetProductsQuery({
    limit: 60,
  });

  const catalogue = React.useMemo(
    () => toPricingCatalogue(data?.products ?? []),
    [data?.products],
  );

  const requested = searchParams.get("term") ?? "";
  const period: BillingPeriod =
    isBillingPeriod(requested) && catalogue.plansByPeriod[requested].length > 0
      ? requested
      : (catalogue.periods[0] ?? DEFAULT_PERIOD);

  const plans = catalogue.plansByPeriod[period] ?? [];

  const selectTerm = (next: BillingPeriod) => {
    const params = new URLSearchParams(searchParams);
    params.set("term", next);
    setSearchParams(params, { replace: true });
  };

  // Three tiers sit in a row; more wrap rather than shrinking.
  const columns =
    plans.length >= 4
      ? "sm:grid-cols-2 xl:grid-cols-4"
      : plans.length === 3
        ? "md:grid-cols-3"
        : "sm:grid-cols-2";

  let content: ReactNode;
  if (isError) {
    content = (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        title="We could not load the plans"
      />
    );
  } else if (isLoading) {
    content = (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <PlanCardSkeleton key={index} />
        ))}
      </div>
    );
  } else if (plans.length === 0) {
    content = (
      <EmptyState
        icon={<PackageSearch className="size-8" />}
        title="No plans are available right now"
        description="Check back shortly, or get in touch and we will sort you out."
      />
    );
  } else {
    content = (
      <AnimatePresence mode="wait">
        <motion.div
          // Keyed on the term so switching replays the entrance rather than
          // swapping the prices underneath a static row.
          key={period}
          variants={gridVariants}
          initial="hidden"
          animate="show"
          exit={{ opacity: 0, y: -8 }}
          className={`grid grid-cols-1 items-start gap-6 ${columns}`}
        >
          {plans.map((plan, index) => (
            <PlanCard
              key={plan.product._id}
              plan={plan}
              index={index}
              action={<AddToCartButton productId={plan.product._id} />}
            />
          ))}
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <div className="pb-16">
      <header className="mx-auto mb-10 flex max-w-2xl flex-col items-center gap-4 text-center">
        <motion.div
          initial={{ opacity: 0, y: -12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 20 }}
        >
          <Badge
            variant="outline"
            className="gap-1.5 rounded-full border-border bg-muted/40 px-4 py-1.5"
          >
            <ShieldCheck className="size-3.5" />
            30-day money-back guarantee
          </Badge>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          <GradientText
            gradient={SHEEN}
            text="Choose the plan that fits"
            className="w-full text-4xl font-extrabold tracking-tight sm:text-5xl"
          />
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease: "easeOut" }}
          className="text-base leading-8 text-balance text-muted-foreground"
        >
          The same encryption and the same 80+ servers on every plan. What
          changes is how many devices you cover, and how much you save by
          committing for longer.
        </motion.p>
      </header>

      <TermSwitcher
        catalogue={catalogue}
        value={period}
        onChange={selectTerm}
      />

      {content}

      <GuaranteeStrip />

      {plans.length > 0 ? <PlanComparison plans={plans} /> : null}
    </div>
  );
};

export default PricingRoute;
