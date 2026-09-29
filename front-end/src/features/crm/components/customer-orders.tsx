import { Receipt } from "lucide-react";

import { OrderStatusBadge } from "@/components/order-status-badge";
import { formatDateTime, formatPrice } from "@/utils/format";
import type { CustomerDetail } from "@/types/api";

/**
 * Everything this account has ever started, paid or not.
 *
 * Failed and abandoned checkouts are shown alongside the paid ones because
 * they are the most useful thing on the page for anybody about to pick up the
 * phone: three failures in a week is a payment problem, not a lost customer.
 *
 * Dates show when the payment landed where there is one, and when the order
 * was opened otherwise -- and the row says which, rather than leaving two
 * different meanings under one column heading.
 */

export const CustomerOrders = ({ customer }: { customer: CustomerDetail }) => {
  if (customer.orders.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
        <Receipt className="size-4 shrink-0" />
        This account has never started a checkout.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60">
      {customer.orders.map((order) => (
        <li
          key={order._id}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
        >
          <div className="min-w-0 flex-1 basis-48">
            <p className="truncate text-sm font-medium">
              {order.items.map((item) => item.name).join(", ") || "Order"}
            </p>
            <p className="text-xs text-muted-foreground">
              {order.paidAt
                ? `Paid ${formatDateTime(order.paidAt)}`
                : `Opened ${formatDateTime(order.createdAt)}`}
              {order.refId ? ` · ref ${order.refId}` : ""}
            </p>
          </div>

          <OrderStatusBadge status={order.status} />

          <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">
            {formatPrice(order.totalPrice)}
          </span>
        </li>
      ))}
    </ul>
  );
};
