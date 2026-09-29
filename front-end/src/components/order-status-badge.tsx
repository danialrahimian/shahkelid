import { motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { statusMetaFor } from "@/utils/order-status";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/types/api";

/** The coloured pill that names an order's state. */
export const OrderStatusBadge = ({
  status,
  className,
}: {
  status: OrderStatus | undefined;
  className?: string;
}) => {
  const meta = statusMetaFor(status);
  const Icon = meta.icon;

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 py-1", meta.className, className)}
    >
      {meta.pulse ? (
        // A payment the provider has not confirmed yet is genuinely still
        // moving, and the dot is the only thing on the card that says so.
        <motion.span
          aria-hidden
          animate={{ opacity: [1, 0.3, 1], scale: [1, 0.8, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          className="size-1.5 rounded-full bg-current"
        />
      ) : (
        <Icon className="size-3.5" />
      )}
      {meta.label}
    </Badge>
  );
};
