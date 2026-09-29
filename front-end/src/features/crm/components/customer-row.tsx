import { motion } from "motion/react";
import { Link } from "react-router";

import { StageBadge } from "@/components/stage-badge";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { paths } from "@/config/paths";
import { assetUrl } from "@/utils/asset-url";
import { formatCount, formatDate, formatPrice } from "@/utils/format";
import type { Customer } from "@/types/api";

/**
 * One customer in the book.
 *
 * The four numbers on the right are the ones a person actually acts on: what
 * the account is worth, how often it buys, how long since it last did, and
 * whether anything is stuck in a cart. Everything else is a click away rather
 * than crammed in here.
 */

const rowVariants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 220, damping: 26 },
  },
};

const initials = (customer: Customer) =>
  (customer.displayName || customer.username).slice(0, 2).toUpperCase();

/** How long since the last purchase, said in words rather than a raw count. */
const lastSeen = (customer: Customer) => {
  if (customer.lastOrderAt === null) return "Never bought";

  const days = customer.daysSinceLastOrder;
  if (days === null) return formatDate(customer.lastOrderAt);
  if (days === 0) return "Bought today";
  if (days === 1) return "Bought yesterday";

  return `${formatCount(days)} days ago`;
};

export const CustomerRow = ({ customer }: { customer: Customer }) => (
  <motion.li variants={rowVariants} layout>
    <Link
      to={paths.dashboardCustomer.getHref(customer.userId)}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-border hover:bg-muted/40"
    >
      <Avatar className="size-10 shrink-0">
        <AvatarImage
          src={assetUrl(customer.avatar) ?? undefined}
          alt=""
        />
        <AvatarFallback className="text-xs">
          {initials(customer)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-medium">
          {customer.displayName || customer.username}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {customer.email}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StageBadge
          stage={customer.stage}
          isOverride={customer.stageOverride !== null}
        />
        {customer.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="secondary" className="font-normal">
            {tag}
          </Badge>
        ))}
        {customer.tags.length > 2 ? (
          <Badge variant="ghost" className="text-muted-foreground">
            +{customer.tags.length - 2}
          </Badge>
        ) : null}
      </div>

      <dl className="ml-auto grid shrink-0 grid-cols-3 gap-x-6 text-right">
        <div>
          <dt className="text-[11px] text-muted-foreground">Lifetime</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {formatPrice(customer.lifetimeValue)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Orders</dt>
          <dd className="text-sm font-semibold tabular-nums">
            {formatCount(customer.paidOrders)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Last order</dt>
          <dd className="text-sm tabular-nums">{lastSeen(customer)}</dd>
        </div>
      </dl>
    </Link>
  </motion.li>
);
