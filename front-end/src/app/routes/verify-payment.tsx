import { CheckCircle2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { Link, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback";
import { paths } from "@/config/paths";
import { useVerifyPaymentMutation } from "@/api/orders";
import { Invoice } from "@/features/orders/components/invoice";
import { InvoiceSkeleton } from "@/features/orders/components/invoice-skeleton";
import type { Order, VerifiedPayment } from "@/types/api";

/** A verified payment either comes back as the order, or as a note about one. */
const isOrder = (result: VerifiedPayment | undefined): result is Order =>
  Boolean(result && "items" in result);

/**
 * Confirmation, shown as the gateway sends the customer back.
 *
 * Rings expand outward behind the tick: paying is the moment the whole flow
 * exists for, and it deserves more than a line of text.
 */
const PaymentSucceeded = ({ refId }: { refId?: string }) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center gap-5 py-20 text-center"
    >
      <div className="relative grid place-items-center">
        {!shouldReduceMotion
          ? [0, 0.35, 0.7].map((delay) => (
              <motion.span
                key={delay}
                aria-hidden
                className="absolute size-20 rounded-full border border-emerald-500/40"
                initial={{ scale: 0.5, opacity: 0.8 }}
                animate={{ scale: 2, opacity: 0 }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeOut",
                  delay,
                }}
              />
            ))
          : null}

        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
          className="grid size-16 place-items-center rounded-full bg-emerald-500/15 text-emerald-500"
        >
          <CheckCircle2 className="size-8" />
        </motion.div>
      </div>

      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          This order is already paid
        </h1>
        {refId ? (
          <p className="font-mono text-sm text-muted-foreground">
            Reference {refId}
          </p>
        ) : null}
      </div>

      <div className="flex gap-3">
        <Button asChild>
          <Link to={paths.invoices.getHref()}>View invoices</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={paths.home.getHref()}>Home</Link>
        </Button>
      </div>
    </motion.div>
  );
};

const VerifyPaymentRoute = () => {
  const [searchParams] = useSearchParams();
  const authority = searchParams.get("Authority");
  const status = searchParams.get("Status");

  const [verifyPayment, { data, isLoading, isError, error, isUninitialized }] =
    useVerifyPaymentMutation();

  // A mutation, not a query, because confirming a payment changes state on the
  // server. It is fired once for the authority in the URL.
  React.useEffect(() => {
    if (!authority) return;
    void verifyPayment({ Authority: authority, Status: status }).unwrap().catch(
      () => {
        // Rendered from the hook's error state below.
      },
    );
  }, [authority, status, verifyPayment]);

  let content;
  if (!authority) {
    content = (
      <motion.div key="missing" className="w-full" exit={{ opacity: 0 }}>
        <ErrorState
          title="This link is incomplete"
          error={{
            status: 400,
            data: {
              errors: [
                {
                  msg: "The payment reference is missing from the address. Open the link from your bank or start the payment again.",
                },
              ],
            },
          }}
        />
      </motion.div>
    );
  } else if (isLoading || isUninitialized) {
    content = (
      <motion.div key="loading" className="w-full" exit={{ opacity: 0 }}>
        <InvoiceSkeleton />
      </motion.div>
    );
  } else if (isError) {
    content = (
      <motion.div key="error" className="w-full" exit={{ opacity: 0 }}>
        <ErrorState
          error={error}
          title="We could not verify your payment"
          onRetry={() =>
            void verifyPayment({ Authority: authority, Status: status })
          }
        />
      </motion.div>
    );
  } else if (isOrder(data)) {
    content = (
      <motion.div key="invoice" className="w-full" exit={{ opacity: 0 }}>
        <Invoice
          order={data}
          actions={
            <Button asChild className="flex-1">
              <Link to={paths.home.getHref()}>Home</Link>
            </Button>
          }
        />
      </motion.div>
    );
  } else {
    // The callback arrived twice, which is normal and not a failure.
    content = (
      <motion.div key="notice" className="w-full" exit={{ opacity: 0 }}>
        <PaymentSucceeded refId={data?.refId} />
      </motion.div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center pb-14">
      <AnimatePresence mode="wait">{content}</AnimatePresence>
    </div>
  );
};

export default VerifyPaymentRoute;
