import { Check, ShoppingCart } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { paths } from "@/config/paths";
import { useAddToCartMutation } from "@/api/cart";
import { notifyApiError } from "@/lib/api-client";
import { useSession } from "@/lib/use-session";

/**
 * Adds one unit of a product to the cart.
 *
 * The button reports its own outcome: a spinner while the request is in
 * flight, then a tick that holds for a moment before turning back into the
 * cart icon. Before, the click dispatched a thunk and nothing on screen
 * changed, so the only way to know it had worked was to open the cart.
 */
export const AddToCartButton = ({
  productId,
  className,
}: {
  productId: string;
  className?: string;
}) => {
  const [addToCart, { isLoading }] = useAddToCartMutation();
  const [justAdded, setJustAdded] = React.useState(false);
  const { isLoggedIn, isLoading: isSessionLoading } = useSession();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!justAdded) return;
    const timer = setTimeout(() => setJustAdded(false), 1600);
    return () => clearTimeout(timer);
  }, [justAdded]);

  const handleClick = async () => {
    // Sending an anonymous visitor straight to sign in is kinder than letting
    // the request 401 and bouncing them with an error they did not cause.
    if (!isSessionLoading && !isLoggedIn) {
      toast.info("Sign in to start a cart");
      navigate(paths.auth.getHref(paths.pricing.getHref()));
      return;
    }

    try {
      await addToCart(productId).unwrap();
      setJustAdded(true);
    } catch (error) {
      notifyApiError(error, "Could not add this to your cart");
    }
  };

  let icon;
  if (isLoading) {
    icon = <Spinner className="size-4" />;
  } else if (justAdded) {
    icon = <Check className="size-4" />;
  } else {
    icon = (
      <ShoppingCart className="size-4 transition-transform duration-300 group-hover/btn:-translate-y-0.5" />
    );
  }

  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 340, damping: 18 }}
      className={className}
    >
      <Button
        onClick={handleClick}
        disabled={isLoading}
        aria-label="Add to cart"
        className="group/btn w-full cursor-pointer gap-2"
        variant={justAdded ? "secondary" : "default"}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={isLoading ? "loading" : justAdded ? "added" : "idle"}
            initial={{ opacity: 0, scale: 0.6, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, y: -4 }}
            transition={{ duration: 0.15 }}
            className="flex items-center"
          >
            {icon}
          </motion.span>
        </AnimatePresence>

        {justAdded ? "added" : "add to cart"}
      </Button>
    </motion.div>
  );
};
