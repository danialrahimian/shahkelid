import {
  CalendarDays,
  Globe,
  Mail,
  Phone,
  ShoppingCart,
  UserRound,
} from "lucide-react";
import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { OrderStatusBadge } from "@/components/order-status-badge";
import type { Order, User } from "@/types/api";
import { formatDate } from "@/utils/format";

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { duration: 0.32, ease: "easeOut" } },
};

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
};

/** One labelled fact about the account. */
const Fact = ({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) => (
  <motion.div
    variants={rowVariants}
    className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/40 p-3"
  >
    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
      {icon}
    </span>
    <div className="min-w-0">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="truncate font-medium">{value}</div>
    </div>
  </motion.div>
);

/**
 * Everything about the account at a glance, before any of it is edited.
 *
 * The point of the page is that a person can *see* their details, so this
 * comes first and the forms follow.
 */
export const ProfileSummary = ({
  user,
  latestOrder,
  orderCount,
}: {
  user: User;
  latestOrder?: Order;
  orderCount: number;
}) => {
  const cartCount =
    user.cart?.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  const notSet = <span className="text-muted-foreground">Not set</span>;

  return (
    <motion.div
      variants={listVariants}
      initial="hidden"
      animate="show"
      className="grid gap-3 sm:grid-cols-2"
    >
      <Fact
        icon={<UserRound className="size-4" />}
        label="Username"
        value={user.username}
      />
      <Fact
        icon={<Mail className="size-4" />}
        label="Email"
        value={user.email}
      />
      <Fact
        icon={<Phone className="size-4" />}
        label="Phone"
        value={user.phone || notSet}
      />
      <Fact
        icon={<Globe className="size-4" />}
        label="Country"
        value={user.country || notSet}
      />
      <Fact
        icon={<CalendarDays className="size-4" />}
        label="Member since"
        value={formatDate(user.createdAt) || notSet}
      />
      <Fact
        icon={<ShoppingCart className="size-4" />}
        label="In your cart"
        value={`${cartCount} ${cartCount === 1 ? "item" : "items"}`}
      />

      {user.bio ? (
        <motion.div
          variants={rowVariants}
          className="rounded-lg border border-border/60 bg-card/40 p-3 sm:col-span-2"
        >
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            About you
          </p>
          <p className="mt-1 leading-7 whitespace-pre-line">{user.bio}</p>
        </motion.div>
      ) : null}

      <motion.div
        variants={rowVariants}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-3 sm:col-span-2"
      >
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          Orders
        </p>
        <Badge variant="secondary" className="tabular-nums">
          {orderCount} placed
        </Badge>
        {latestOrder ? (
          <>
            <span className="text-sm text-muted-foreground">
              Most recent {formatDate(latestOrder.createdAt)}
            </span>
            <OrderStatusBadge status={latestOrder.status} />
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            Nothing yet
          </span>
        )}
      </motion.div>
    </motion.div>
  );
};
