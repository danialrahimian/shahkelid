import { ArrowRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { paths } from "@/config/paths";

/**
 * The running total and the way out to checkout.
 *
 * The figure is the server's own: it comes from `GET /checkout`, which prices
 * the cart the same way the payment endpoint will. Adding the lines up in the
 * browser instead would let the total drift from what is actually charged
 * whenever a price changed between page load and payment.
 */
export const CartSummary = ({
  totalPrice,
  isLoading,
}: {
  totalPrice: number | undefined;
  isLoading: boolean;
}) => {
  const navigate = useNavigate();

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: "spring", stiffness: 240, damping: 26 }}
      className="group relative mx-auto mt-10 w-full max-w-md"
    >
      <motion.span
        aria-hidden
        animate={{ opacity: [0.2, 0.45, 0.2] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="pointer-events-none absolute -inset-1 rounded-xl bg-foreground/15 blur-xl"
      />

      <div className="relative flex items-center justify-between gap-4 overflow-hidden rounded-xl border border-border bg-card p-5">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-full w-1/3 -skew-x-12 bg-linear-to-r from-transparent via-foreground/10 to-transparent transition-all duration-1000 group-hover:left-[200%]"
        />

        <div>
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            Total price
          </p>

          {isLoading || totalPrice === undefined ? (
            <Skeleton className="mt-1 h-8 w-24" />
          ) : (
            <AnimatePresence mode="wait">
              <motion.p
                key={totalPrice}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25 }}
                className="font-mono text-2xl font-extrabold tabular-nums"
              >
                ${totalPrice}
              </motion.p>
            </AnimatePresence>
          )}
        </div>

        <motion.div
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 340, damping: 18 }}
        >
          <Button
            onClick={() => navigate(paths.checkout.getHref())}
            className="group/co gap-2"
            disabled={isLoading}
          >
            Check Out
            <ArrowRight className="size-4 transition-transform group-hover/co:translate-x-1" />
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
};
