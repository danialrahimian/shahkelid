import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  Receipt,
  UserPlus,
  Users,
} from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";

import { ErrorState } from "@/components/ui/feedback";
import { useGetSalesSummaryQuery } from "@/api/analytics";
import { FunnelPanel } from "@/features/dashboard/components/funnel-panel";
import { PlanPanel } from "@/features/dashboard/components/plan-panel";
import { RecurringRevenuePanel } from "@/features/dashboard/components/recurring-revenue-panel";
import { RevenuePanel } from "@/features/dashboard/components/revenue-panel";
import { RangePicker } from "@/features/dashboard/components/range-picker";
import { StatTile } from "@/components/stat-tile";
import { TopCustomersPanel } from "@/features/dashboard/components/top-customers-panel";
import { formatCount, formatPrice } from "@/utils/format";
import {
  DEFAULT_PRESET,
  rangeFor,
  type RangePreset,
} from "@/utils/report-ranges";

/**
 * The sales dashboard.
 *
 * Three things make the figures on it mean something, and all three are the
 * server's doing rather than this page's: only paid orders count as revenue,
 * revenue is dated by when the payment landed rather than when the order was
 * opened, and recurring revenue is normalised per month before it is summed.
 *
 * What this page is responsible for is not undoing any of that -- scoping
 * every panel to one range, labelling what each figure is measured against,
 * and never showing a total without the comparison that gives it a size.
 */

const SalesRoute = () => {
  const [preset, setPreset] = React.useState<RangePreset>(DEFAULT_PRESET);

  // Recomputed when the preset changes rather than on every render, so the
  // query key is stable and the panels do not refetch on an unrelated update.
  const range = React.useMemo(() => rangeFor(preset), [preset]);

  const { data, isLoading, isFetching, isError, error, refetch } =
    useGetSalesSummaryQuery(range);

  const comparisonLabel = `vs the previous ${preset.days} days`;

  if (isError) {
    return (
      <div className="pb-14">
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          title="We could not load the dashboard"
        />
      </div>
    );
  }

  return (
    <div className="pb-14">
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-8 flex flex-wrap items-start justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0, rotate: -25 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: "spring",
              stiffness: 260,
              damping: 18,
              delay: 0.1,
            }}
            className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <ChartNoAxesCombined className="size-5" />
          </motion.div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sales</h1>
            <p className="text-sm text-muted-foreground">
              Paid orders only, dated by when the payment landed.
            </p>
          </div>
        </div>

        {/* One control for the whole page, so no two panels can be showing
            different windows. */}
        <RangePicker value={preset} onChange={setPreset} />
      </motion.header>

      <section
        aria-label="Headline figures"
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile
          label="Revenue"
          icon={BadgeDollarSign}
          value={formatPrice(data?.revenue.value ?? 0)}
          metric={data?.revenue}
          comparisonLabel={comparisonLabel}
          isLoading={isLoading}
        />
        <StatTile
          label="Paid orders"
          icon={Receipt}
          value={formatCount(data?.orders.value ?? 0)}
          metric={data?.orders}
          comparisonLabel={comparisonLabel}
          isLoading={isLoading}
        />
        <StatTile
          label="Average order"
          icon={ChartNoAxesCombined}
          value={formatPrice(data?.averageOrderValue.value ?? 0)}
          metric={data?.averageOrderValue}
          comparisonLabel={comparisonLabel}
          isLoading={isLoading}
        />
        <StatTile
          label="Customers who bought"
          icon={Users}
          value={formatCount(data?.customers.value ?? 0)}
          metric={data?.customers}
          comparisonLabel={comparisonLabel}
          isLoading={isLoading}
        />
      </section>

      <section
        aria-label="Activity"
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile
          label="New sign-ups"
          icon={UserPlus}
          value={formatCount(data?.newCustomers ?? 0)}
          hint={`Accounts created in the last ${preset.days} days`}
          isLoading={isLoading}
        />
        <StatTile
          label="Units sold"
          icon={Receipt}
          value={formatCount(data?.units ?? 0)}
          hint="Across every paid order in this range"
          isLoading={isLoading}
        />
        <StatTile
          label="Checkouts still open"
          icon={Receipt}
          value={formatCount(data?.pendingOrders ?? 0)}
          hint="Started in this range, neither paid nor refused"
          direction="down-is-good"
          isLoading={isLoading}
        />
        <StatTile
          label="Monthly recurring"
          icon={BadgeDollarSign}
          value={formatPrice(data?.mrr ?? 0)}
          hint="A snapshot of now, across every plan with a known term"
          isLoading={isLoading}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenuePanel
            from={range.from}
            to={range.to}
            interval={preset.interval}
            comparisonLabel={comparisonLabel}
          />
        </div>

        <RecurringRevenuePanel
          summary={data}
          isLoading={isLoading || (isFetching && !data)}
        />

        <div className="lg:col-span-2">
          <PlanPanel from={range.from} to={range.to} />
        </div>

        <TopCustomersPanel from={range.from} to={range.to} />

        <div className="lg:col-span-3">
          <FunnelPanel from={range.from} to={range.to} />
        </div>
      </div>
    </div>
  );
};

export default SalesRoute;
