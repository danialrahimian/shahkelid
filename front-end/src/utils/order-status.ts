import {
  Ban,
  CheckCircle2,
  Clock,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import type { OrderStatus } from "@/types/api";

/**
 * How each order state looks, in one table.
 *
 * The invoice page and the invoice list each carried their own copy of this,
 * and they had drifted: the same order showed a different colour depending on
 * which screen you were looking at.
 */
export const STATUS_META: Record<
  OrderStatus,
  {
    label: string;
    icon: LucideIcon;
    className: string;
    /** A soft accent used behind cards in the invoice list. */
    accent: string;
    /** Only a payment still in flight deserves a pulsing dot. */
    pulse: boolean;
  }
> = {
  pending: {
    label: "Pending",
    icon: Clock,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-500",
    accent: "bg-amber-500/15",
    pulse: true,
  },
  paid: {
    label: "Paid",
    icon: CheckCircle2,
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
    accent: "bg-emerald-500/15",
    pulse: false,
  },
  shipped: {
    label: "Shipped",
    icon: Truck,
    className: "border-sky-500/30 bg-sky-500/10 text-sky-500",
    accent: "bg-sky-500/15",
    pulse: false,
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
    accent: "bg-destructive/15",
    pulse: false,
  },
  cancelled: {
    label: "Cancelled",
    icon: Ban,
    className: "border-border bg-muted text-muted-foreground",
    accent: "bg-muted",
    pulse: false,
  },
};

export const statusMetaFor = (status: OrderStatus | undefined) =>
  STATUS_META[status ?? "pending"] ?? STATUS_META.pending;
