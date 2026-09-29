import { ChevronLeft, ChevronRight, Contact, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetCustomersQuery } from "@/api/crm";
import { CustomerFilters } from "@/features/crm/components/customer-filters";
import { CustomerRow } from "@/features/crm/components/customer-row";
import { SegmentsPanel } from "@/features/crm/components/segments-panel";
import { formatCount, formatPrice } from "@/utils/format";
import type { CustomersQuery } from "@/types/api";

/**
 * The customer book.
 *
 * Nothing here is ever shown to the customer it describes. Lifetime value,
 * lifecycle stage and the team's notes are the business's own record, which is
 * why they live in a staff-only view and behind a staff-only API rather than
 * hanging off the customer's profile.
 */

const PAGE_SIZE = 20;

const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const CustomersRoute = () => {
  const [query, setQuery] = React.useState<CustomersQuery>({
    sort: "value",
    page: 1,
    limit: PAGE_SIZE,
  });

  const { data, isLoading, isFetching, isError, error, refetch } =
    useGetCustomersQuery(query);

  const customers = data?.customers ?? [];
  const total = data?.totalCustomersLength ?? 0;
  const page = data?.page ?? 1;
  const pages = Math.max(Math.ceil(total / (data?.limit ?? PAGE_SIZE)), 1);

  const goToPage = (next: number) =>
    setQuery((current) => ({
      ...current,
      page: Math.min(Math.max(next, 1), pages),
    }));

  return (
    <div className="pb-14">
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-8 flex items-center gap-3"
      >
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
          <Contact className="size-5" />
        </motion.div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Every figure here is worked out from the orders as they stand, not
            stored and left to drift.
          </p>
        </div>
      </motion.header>

      <div className="mb-6">
        <SegmentsPanel
          activeStage={query.stage}
          onPickStage={(stage) =>
            setQuery((current) => ({ ...current, stage, page: 1 }))
          }
        />
      </div>

      <CustomerFilters query={query} onChange={setQuery} />

      {isError ? (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          title="We could not load the customers"
        />
      ) : isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <EmptyState
          icon={<Users className="size-8" />}
          title="No customer matches those filters"
          description="Try a different stage, or clear the search."
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">
            <p>
              {formatCount(total)}{" "}
              {total === 1 ? "customer" : "customers"} match
              {total === 1 ? "es" : ""} these filters
            </p>
            {/* The whole matching set's worth, not this page's. */}
            <p>
              Worth{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatPrice(data?.segmentValue ?? 0)}
              </span>{" "}
              in lifetime payments
            </p>
          </div>

          <motion.ul
            variants={listVariants}
            initial="hidden"
            animate="show"
            className={
              "space-y-3 transition-opacity " +
              (isFetching ? "opacity-60" : "opacity-100")
            }
          >
            <AnimatePresence mode="popLayout">
              {customers.map((customer) => (
                <CustomerRow key={customer.userId} customer={customer} />
              ))}
            </AnimatePresence>
          </motion.ul>

          {pages > 1 ? (
            <nav
              aria-label="Customer pages"
              className="mt-6 flex items-center justify-center gap-3"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>

              <span className="text-sm text-muted-foreground tabular-nums">
                Page {page} of {pages}
              </span>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={page >= pages}
                onClick={() => goToPage(page + 1)}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
};

export default CustomersRoute;
