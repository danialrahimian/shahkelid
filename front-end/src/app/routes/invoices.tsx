import { ReceiptText } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { paths } from "@/config/paths";
import { useGetInvoicesQuery } from "@/api/orders";
import { InvoiceCard } from "@/features/orders/components/invoice-card";
import { normalizeError } from "@/lib/api-client";

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const InvoiceRowSkeleton = () => (
  <div className="overflow-hidden rounded-xl border border-border bg-card">
    <Skeleton className="h-1 w-full rounded-none" />
    <div className="flex items-start justify-between gap-4 p-5 pt-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="h-6 w-20 rounded-full" />
    </div>
    <div className="flex items-center justify-between gap-4 px-5 pb-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="h-8 w-24" />
    </div>
  </div>
);

/**
 * Every order this account has placed, newest first.
 *
 * The API answers 404 when there are none, which is a state rather than a
 * fault, so that case renders the empty view instead of an error.
 */
const InvoicesRoute = () => {
  const { data, isLoading, isError, error, refetch } = useGetInvoicesQuery();
  const invoices = data ?? [];

  let content: ReactNode;
  if (isError) {
    const { status } = normalizeError(error);

    content =
      status === 404 ? (
        <motion.div key="empty" exit={{ opacity: 0 }}>
          <EmptyState
            icon={<ReceiptText className="size-8" />}
            title="You have no invoices yet"
            description="Once you complete a purchase, the receipt will live here."
            action={
              <Button asChild>
                <Link to={paths.pricing.getHref()}>Browse plans</Link>
              </Button>
            }
          />
        </motion.div>
      ) : (
        <motion.div key="error" exit={{ opacity: 0 }}>
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            title="We could not load your invoices"
          />
        </motion.div>
      );
  } else if (isLoading) {
    content = (
      <motion.div key="loading" exit={{ opacity: 0 }} className="flex flex-col gap-5">
        {[0, 1, 2].map((index) => (
          <InvoiceRowSkeleton key={index} />
        ))}
      </motion.div>
    );
  } else if (invoices.length === 0) {
    content = (
      <motion.div key="empty" exit={{ opacity: 0 }}>
        <EmptyState
          icon={<ReceiptText className="size-8" />}
          title="You have no invoices yet"
          description="Once you complete a purchase, the receipt will live here."
          action={
            <Button asChild>
              <Link to={paths.pricing.getHref()}>Browse plans</Link>
            </Button>
          }
        />
      </motion.div>
    );
  } else {
    content = (
      <motion.div
        key="list"
        variants={listVariants}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-5"
      >
        {invoices.map((order, index) => (
          <InvoiceCard key={order._id} order={order} index={index} />
        ))}
      </motion.div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl pb-14">
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
          <ReceiptText className="size-5" />
        </motion.div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your invoices</h1>
          <AnimatePresence mode="wait">
            <motion.p
              key={isLoading ? "loading" : invoices.length}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="text-sm text-muted-foreground"
            >
              {isLoading
                ? "Loading your orders…"
                : `${invoices.length} ${invoices.length === 1 ? "order" : "orders"}`}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.header>

      <AnimatePresence mode="wait">{content}</AnimatePresence>
    </div>
  );
};

export default InvoicesRoute;
