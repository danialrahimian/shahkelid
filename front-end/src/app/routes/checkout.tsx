import { Printer, ShoppingCart } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { Spinner } from "@/components/ui/spinner";
import { paths } from "@/config/paths";
import { useGetCheckoutQuery, useStartPaymentMutation } from "@/api/orders";
import { Invoice } from "@/features/orders/components/invoice";
import { InvoiceSkeleton } from "@/features/orders/components/invoice-skeleton";
import { normalizeError, notifyApiError } from "@/lib/api-client";

/**
 * The order about to be paid for.
 *
 * The preview is built entirely by the server from its own copy of the cart,
 * and starting a payment sends no body at all. There is deliberately nothing
 * here that could name a price.
 */
const CheckoutRoute = () => {
  const { data: order, isLoading, isError, error, refetch } =
    useGetCheckoutQuery();
  const [startPayment, { isLoading: isPaying }] = useStartPaymentMutation();

  const handlePay = async () => {
    try {
      const ticket = await startPayment().unwrap();
      if (ticket.url) {
        // Leaving the app entirely, so replace rather than push: the back
        // button should not return to a checkout that is mid-payment.
        window.location.replace(ticket.url);
      }
    } catch (paymentError) {
      notifyApiError(paymentError, "We could not start the payment");
    }
  };

  let content: ReactNode;
  if (isError) {
    // An empty cart comes back as 400, which is a state rather than a fault.
    const { status } = normalizeError(error);

    content =
      status === 400 ? (
        <motion.div key="empty" className="w-full" exit={{ opacity: 0 }}>
          <EmptyState
            icon={<ShoppingCart className="size-8" />}
            title="There is nothing to check out"
            description="Add a plan to your cart and the invoice will appear here."
            action={
              <Button asChild>
                <Link to={paths.pricing.getHref()}>Browse plans</Link>
              </Button>
            }
          />
        </motion.div>
      ) : (
        <motion.div key="error" className="w-full" exit={{ opacity: 0 }}>
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            title="We could not load your invoice"
          />
        </motion.div>
      );
  } else if (isLoading || !order) {
    content = (
      <motion.div key="loading" className="w-full" exit={{ opacity: 0 }}>
        <InvoiceSkeleton />
      </motion.div>
    );
  } else {
    content = (
      <motion.div key="invoice" className="w-full" exit={{ opacity: 0 }}>
        <Invoice
          order={order}
          actions={
            <>
              <Button
                variant="secondary"
                className="flex-1 gap-2"
                onClick={() => window.print()}
              >
                <Printer className="size-4" />
                Print
              </Button>
              <Button
                className="flex-1 gap-2"
                onClick={handlePay}
                disabled={isPaying}
              >
                {isPaying ? <Spinner className="size-4" /> : null}
                {isPaying ? "Redirecting…" : "Pay"}
              </Button>
            </>
          }
        />
      </motion.div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center pb-14">
      <AnimatePresence mode="wait">{content}</AnimatePresence>
    </div>
  );
};

export default CheckoutRoute;
