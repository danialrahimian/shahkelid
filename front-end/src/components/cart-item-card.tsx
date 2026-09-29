import { ImageOff, Minus, Plus, Trash2 } from "lucide-react";
import { motion, type Variants } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { Product } from "@/types/api";
import { assetUrl } from "@/utils/asset-url";

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 30, scale: 0.95 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 210, damping: 24, mass: 0.9 },
  },
  exit: {
    opacity: 0,
    scale: 0.85,
    x: -40,
    transition: { duration: 0.28, ease: "easeIn" },
  },
};

/**
 * One line of a cart.
 *
 * Purely presentational: it is handed a product and two callbacks, and knows
 * nothing about who owns the cart. That is what lets the shopper's own cart
 * and the moderator's view of somebody else's cart share it. The old version
 * fetched its own product, read two different Redux slices and decided which
 * to write to by comparing `location.pathname` against "/cart".
 */
export const CartItemCard = ({
  product,
  quantity,
  index = 0,
  isBusy = false,
  isUnavailable = false,
  onAdd,
  onRemove,
}: {
  product: Product | undefined;
  quantity: number;
  index?: number;
  isBusy?: boolean;
  /** The plan is no longer sold. It can be removed, but not added to. */
  isUnavailable?: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) => {
  const price = product?.price ?? 0;
  const lineTotal = price * quantity;
  const imageSrc = assetUrl(product?.image);

  return (
    <motion.div
      layout
      variants={cardVariants}
      whileHover={{ y: -8 }}
      transition={{ type: "spring", stiffness: 280, damping: 22 }}
      className="group relative h-full"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-1 rounded-xl bg-foreground/10 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100"
      />

      <Card className="relative flex h-full flex-col overflow-hidden border-border pt-0 transition-colors duration-300 group-hover:border-foreground/30">
        <div className="relative h-50 overflow-hidden">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={product?.name ?? ""}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
              <ImageOff className="size-8" />
            </div>
          )}

          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-linear-to-t from-card via-card/10 to-transparent"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-foreground/25 to-transparent transition-all duration-700 group-hover:left-[150%]"
          />
        </div>

        <CardHeader>
          <CardAction>
            {/* Keyed on the number, so the badge pops each time it changes. */}
            <motion.div
              key={quantity}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 420, damping: 16 }}
            >
              <Badge variant="secondary" className="tabular-nums">
                × {quantity}
              </Badge>
            </motion.div>
          </CardAction>

          <CardTitle>
            {product ? (
              product.name
            ) : isUnavailable ? (
              <span className="text-muted-foreground">
                No longer available
              </span>
            ) : (
              <Skeleton className="h-5 w-32" />
            )}
          </CardTitle>
        </CardHeader>

        <CardContent className="flex items-end justify-between gap-2">
          <div>
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              Line total
            </p>
            <motion.p
              key={lineTotal}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="font-mono text-xl font-bold tabular-nums"
            >
              ${lineTotal}
            </motion.p>
          </div>

          {price > 0 ? (
            <span className="text-xs text-muted-foreground">${price} each</span>
          ) : null}
        </CardContent>

        <CardFooter className="mt-auto flex justify-around gap-3">
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.93 }}
            transition={{ type: "spring", stiffness: 340, damping: 18 }}
            className="w-2/5"
          >
            <Button
              className="group/add w-full cursor-pointer gap-1.5"
              onClick={onAdd}
              // Adding more of a withdrawn plan would only be refused.
              disabled={isBusy || isUnavailable}
            >
              {isBusy ? (
                <Spinner className="size-4" />
              ) : (
                <Plus className="size-4 transition-transform duration-300 group-hover/add:rotate-90" />
              )}
              add more
            </Button>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.93 }}
            transition={{ type: "spring", stiffness: 340, damping: 18 }}
            className="w-2/5"
          >
            <Button
              variant="outline"
              className="group/rm w-full cursor-pointer gap-1.5 hover:border-destructive/40 hover:text-destructive"
              onClick={onRemove}
              disabled={isBusy}
            >
              {/* The icon says what will happen: fewer, or gone entirely. */}
              {quantity > 1 ? (
                <Minus className="size-4" />
              ) : (
                <Trash2 className="size-4 transition-transform duration-300 group-hover/rm:rotate-12" />
              )}
              remove
            </Button>
          </motion.div>
        </CardFooter>

        <motion.span
          aria-hidden
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{
            duration: 0.6,
            delay: 0.1 + index * 0.05,
            ease: "easeOut",
          }}
          className="absolute inset-x-0 top-0 h-0.5 origin-left bg-foreground/40"
        />
      </Card>
    </motion.div>
  );
};
