import { ChevronDown, Package, Receipt } from "lucide-react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Variants,
} from "motion/react";
import * as React from "react";

import { Separator } from "@/components/ui/separator";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { cn } from "@/lib/utils";
import type { Order } from "@/types/api";
import { assetUrl } from "@/utils/asset-url";
import { formatDate } from "@/utils/format";

/** A gradient per state, used for the top rule and the corner glow. */
const ACCENTS: Record<string, string> = {
  pending: "from-amber-400 via-amber-500 to-orange-500",
  paid: "from-emerald-400 via-emerald-500 to-teal-500",
  shipped: "from-sky-400 via-sky-500 to-indigo-500",
  failed: "from-red-400 via-red-500 to-rose-600",
  cancelled: "from-zinc-400 via-zinc-500 to-zinc-600",
};

const GLOWS: Record<string, string> = {
  pending: "hover:shadow-amber-500/20",
  paid: "hover:shadow-emerald-500/20",
  shipped: "hover:shadow-sky-500/20",
  failed: "hover:shadow-destructive/20",
  cancelled: "hover:shadow-black/20",
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 28, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 220, damping: 24, mass: 0.9 },
  },
};

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -14 },
  show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

/** Counts the total up once the card appears, rather than snapping to it. */
const AnimatedPrice = ({ value }: { value: number }) => {
  const shouldReduceMotion = useReducedMotion();
  const raw = useMotionValue(shouldReduceMotion ? value : 0);
  const text = useTransform(raw, (current: number) => `$${current.toFixed(2)}`);

  React.useEffect(() => {
    if (shouldReduceMotion) {
      raw.set(value);
      return;
    }
    const controls = animate(raw, value, {
      duration: 0.9,
      delay: 0.25,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [raw, value, shouldReduceMotion]);

  return <motion.span>{text}</motion.span>;
};

/**
 * One past order, collapsed to a summary that expands to show its lines.
 *
 * Keeping the items hidden by default means a long history stays scannable,
 * and the overlapping thumbnails still say at a glance what the order was.
 */
export const InvoiceCard = ({
  order,
  index = 0,
}: {
  order: Order;
  index?: number;
}) => {
  const [open, setOpen] = React.useState(false);

  const accent = ACCENTS[order.status] ?? ACCENTS.pending;
  const glow = GLOWS[order.status] ?? GLOWS.pending;

  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const thumbnails = order.items.filter((item) => item.image).slice(0, 4);
  const hiddenThumbnails = order.items.length - thumbnails.length;

  return (
    <motion.article
      layout
      variants={cardVariants}
      whileHover={{ y: -5 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow duration-300 hover:shadow-xl",
        glow,
      )}
    >
      {/* The rule draws itself in, staggered down the list. */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{
          duration: 0.7,
          delay: 0.1 + index * 0.05,
          ease: "easeOut",
        }}
        className={cn(
          "absolute inset-x-0 top-0 h-1 origin-left bg-linear-to-r",
          accent,
        )}
      />

      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-24 -right-24 size-48 rounded-full bg-linear-to-br opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-20",
          accent,
        )}
      />

      <div className="flex flex-wrap items-start justify-between gap-4 p-5 pt-6">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: "spring",
              stiffness: 260,
              damping: 16,
              delay: 0.15 + index * 0.05,
            }}
            whileHover={{ rotate: -8, scale: 1.08 }}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <Receipt className="size-5" />
          </motion.div>

          <div>
            <p className="font-mono text-sm font-semibold">
              #{order._id.slice(-8).toUpperCase()}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDate(order.createdAt) || "-"}
            </p>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.25 + index * 0.05 }}
        >
          <OrderStatusBadge status={order.status} />
        </motion.div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            {thumbnails.map((item, thumbIndex) => (
              <motion.img
                key={item.productId}
                src={assetUrl(item.image) ?? ""}
                alt={item.name}
                title={item.name}
                loading="lazy"
                initial={{ opacity: 0, scale: 0.5, x: -10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 300,
                  damping: 20,
                  delay: 0.3 + index * 0.05 + thumbIndex * 0.07,
                }}
                whileHover={{ scale: 1.18, y: -3, zIndex: 10 }}
                style={{ zIndex: thumbnails.length - thumbIndex }}
                className={cn(
                  "size-10 rounded-full border-2 border-card object-cover shadow-sm",
                  thumbIndex > 0 && "-ml-3",
                )}
              />
            ))}

            {hiddenThumbnails > 0 ? (
              <motion.span
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 + index * 0.05 }}
                className="-ml-3 flex size-10 items-center justify-center rounded-full border-2 border-card bg-muted text-xs font-medium text-muted-foreground"
              >
                +{hiddenThumbnails}
              </motion.span>
            ) : null}
          </div>

          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Package className="size-4" />
            {itemCount} {itemCount === 1 ? "item" : "items"}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              Total
            </p>
            <p className="font-mono text-xl font-extrabold tabular-nums">
              <AnimatedPrice value={order.totalPrice} />
            </p>
          </div>

          <motion.button
            type="button"
            onClick={() => setOpen((previous) => !previous)}
            aria-expanded={open}
            aria-label={open ? "Hide items" : "Show items"}
            whileHover={{ scale: 1.12 }}
            whileTap={{ scale: 0.92 }}
            className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <motion.span
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="flex"
            >
              <ChevronDown className="size-4" />
            </motion.span>
          </motion.button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="items"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <Separator />
            <motion.ul
              variants={listVariants}
              initial="hidden"
              animate="show"
              className="flex flex-col gap-3 p-5"
            >
              {order.items.map((item) => {
                const image = assetUrl(item.image);

                return (
                  <motion.li
                    key={item.productId}
                    variants={rowVariants}
                    className="flex items-center gap-3"
                  >
                    {image ? (
                      <img
                        src={image}
                        alt=""
                        loading="lazy"
                        className="size-12 shrink-0 rounded-md border border-border object-cover"
                      />
                    ) : null}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Qty {item.quantity} × ${item.price.toFixed(2)}
                      </p>
                    </div>

                    <p className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                      ${(item.price * item.quantity).toFixed(2)}
                    </p>
                  </motion.li>
                );
              })}
            </motion.ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
};
