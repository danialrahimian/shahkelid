import { ShoppingBag, ShoppingCart } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { paths } from "@/config/paths";
import { useGetCartQuery } from "@/api/cart";
import { useGetCheckoutQuery } from "@/api/orders";
import { CartLine } from "@/features/cart/components/cart-line";
import { CartSummary } from "@/features/cart/components/cart-summary";

const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const CartItemSkeleton = () => (
  <div className="overflow-hidden rounded-xl border border-border bg-card">
    <Skeleton className="h-50 w-full rounded-none" />
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-10 rounded-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="flex justify-around gap-3 pt-2">
        <Skeleton className="h-9 w-2/5" />
        <Skeleton className="h-9 w-2/5" />
      </div>
    </div>
  </div>
);

/**
 * The shopper's cart.
 *
 * Two requests, each for what it is authoritative about: the lines come from
 * the cart endpoint, and the total from the checkout preview, which prices the
 * order exactly as the payment endpoint will.
 */
const CartRoute = () => {
  const {
    data: items,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetCartQuery();

  // The preview 400s on an empty cart, which is expected rather than a fault,
  // so it is not requested until there is something to price.
  const cartItems = items ?? [];
  const isEmpty = !isLoading && cartItems.length === 0;
  const { data: checkout, isFetching: isPricing } = useGetCheckoutQuery(
    undefined,
    { skip: isLoading || isEmpty },
  );

  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const itemCountLabel = isLoading
    ? "Loading your items…"
    : `${itemCount} ${itemCount === 1 ? "item" : "items"} in your cart`;

  let content: ReactNode;
  if (isError) {
    content = (
      <motion.div key="error" exit={{ opacity: 0 }}>
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          title="We could not load your cart"
        />
      </motion.div>
    );
  } else if (isLoading) {
    content = (
      <motion.div
        key="loading"
        exit={{ opacity: 0 }}
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {[0, 1, 2].map((index) => (
          <CartItemSkeleton key={index} />
        ))}
      </motion.div>
    );
  } else if (isEmpty) {
    content = (
      <motion.div key="empty" exit={{ opacity: 0 }}>
        <EmptyState
          icon={<ShoppingBag className="size-8" />}
          title="Your cart is empty"
          description="Pick a plan and it will show up here."
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
        key="items"
        variants={gridVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {/* popLayout so the survivors slide into place as a line is removed. */}
        <AnimatePresence mode="popLayout">
          {cartItems.map((item, index) => (
            <CartLine key={item._id} item={item} index={index} />
          ))}
        </AnimatePresence>
      </motion.div>
    );
  }

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
          <ShoppingCart className="size-5" />
        </motion.div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your cart</h1>
          <AnimatePresence mode="wait">
            <motion.p
              key={itemCountLabel}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="text-sm text-muted-foreground"
            >
              {itemCountLabel}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.header>

      <AnimatePresence mode="wait">{content}</AnimatePresence>

      <AnimatePresence>
        {!isLoading && !isEmpty && !isError ? (
          <CartSummary
            totalPrice={checkout?.totalPrice}
            isLoading={isPricing && checkout === undefined}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export default CartRoute;
