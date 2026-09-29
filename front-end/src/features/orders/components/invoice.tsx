import { Receipt } from "lucide-react";
import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { OrderStatusBadge } from "@/components/order-status-badge";
import type { Order, OrderPreview } from "@/types/api";
import { assetUrl } from "@/utils/asset-url";

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.2 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

/**
 * One order, rendered as a document.
 *
 * Presentational: what the buttons do is passed in, so the same component
 * serves the checkout preview (which has no id yet and offers a Pay button)
 * and a settled invoice (which offers a way home). It used to dispatch the
 * payment itself, which meant the preview screen and the receipt screen could
 * not share it without branching inside.
 */
export const Invoice = ({
  order,
  actions,
}: {
  order: Order | OrderPreview;
  actions?: ReactNode;
}) => {
  const invoiceId = "_id" in order ? order._id : undefined;
  const date = order.createdAt ? new Date(order.createdAt) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="mx-auto w-full max-w-2xl print:max-w-none"
    >
      <Card className="overflow-hidden border-border py-0 shadow-lg">
        <CardHeader className="flex-row items-start justify-between gap-4 border-b border-border py-6">
          <div className="flex items-center gap-3">
            <motion.div
              initial={{ scale: 0, rotate: -25 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{
                type: "spring",
                stiffness: 260,
                damping: 18,
                delay: 0.15,
              }}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <Receipt className="size-5" />
            </motion.div>

            <div>
              <h2 className="text-lg font-semibold">Invoice</h2>
              {invoiceId ? (
                <p className="font-mono text-xs text-muted-foreground">
                  #{invoiceId.slice(-8).toUpperCase()}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Not placed yet
                </p>
              )}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
          >
            <OrderStatusBadge status={order.status} />
          </motion.div>
        </CardHeader>

        <CardContent className="grid gap-6 py-6 sm:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
          >
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Billed to
            </p>
            <p className="mt-1 font-medium">{order.user.username}</p>
            <p className="text-sm text-muted-foreground">{order.user.email}</p>
          </motion.div>

          {date ? (
            <motion.div
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 }}
              className="sm:text-right"
            >
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Date issued
              </p>
              <p className="mt-1 font-medium">
                {date.toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {date.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </motion.div>
          ) : null}
        </CardContent>

        <Separator />

        <CardContent className="py-6">
          <motion.ul
            variants={listVariants}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-4"
          >
            {order.items.map((item) => {
              const image = assetUrl(item.image);

              return (
                <motion.li
                  variants={itemVariants}
                  key={item.productId}
                  className="flex items-center gap-4"
                >
                  {image ? (
                    <img
                      src={image}
                      alt=""
                      loading="lazy"
                      className="size-14 shrink-0 rounded-md border border-border object-cover"
                    />
                  ) : null}

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Qty {item.quantity} × ${item.price.toFixed(2)}
                    </p>
                  </div>

                  <p className="shrink-0 font-mono font-semibold tabular-nums">
                    ${(item.price * item.quantity).toFixed(2)}
                  </p>
                </motion.li>
              );
            })}
          </motion.ul>
        </CardContent>

        <Separator />

        <CardFooter className="flex-col items-stretch gap-4 py-6">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            className="flex items-center justify-between"
          >
            <span className="text-muted-foreground">Total</span>
            <span className="font-mono text-2xl font-extrabold tabular-nums">
              ${order.totalPrice.toFixed(2)}
            </span>
          </motion.div>

          {actions ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65 }}
              className="flex flex-col gap-2 sm:flex-row print:hidden"
            >
              {actions}
            </motion.div>
          ) : null}
        </CardFooter>
      </Card>
    </motion.div>
  );
};
