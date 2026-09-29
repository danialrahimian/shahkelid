import {
  ArrowLeft,
  BadgeDollarSign,
  CalendarClock,
  Mail,
  MapPin,
  Phone,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { motion } from "motion/react";
import { Link, useParams } from "react-router";

import { StageBadge } from "@/components/stage-badge";
import { StatTile } from "@/components/stat-tile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetCustomerQuery } from "@/api/crm";
import { CustomerNotes } from "@/features/crm/components/customer-notes";
import { CustomerOrders } from "@/features/crm/components/customer-orders";
import { StageControl } from "@/features/crm/components/stage-control";
import { TagEditor } from "@/features/crm/components/tag-editor";
import { paths } from "@/config/paths";
import { assetUrl } from "@/utils/asset-url";
import { formatCount, formatDate, formatPrice } from "@/utils/format";

/**
 * One customer, in full.
 *
 * The four figures across the top are computed from the orders each time the
 * page is opened rather than stored on the account. A stored lifetime value
 * starts drifting the moment a refund or a late payment lands somewhere else,
 * and nothing about looking at it tells you whether it is still true.
 */

const CustomerRoute = () => {
  const { userId } = useParams<{ userId: string }>();
  const { data, isLoading, isError, error, refetch } = useGetCustomerQuery(
    userId ?? "",
    { skip: !userId },
  );

  const backLink = (
    <Button asChild variant="ghost" size="sm" className="mb-6 gap-1.5">
      <Link to={paths.dashboardCustomers.getHref()}>
        <ArrowLeft className="size-4" />
        All customers
      </Link>
    </Button>
  );

  if (isError) {
    return (
      <div className="pb-14">
        {backLink}
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          title="We could not load this customer"
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="pb-14">
        {backLink}
        <Skeleton className="mb-6 h-28 w-full rounded-xl" />
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const name = data.displayName || data.username;
  const lastOrder =
    data.lastOrderAt === null
      ? "Never bought"
      : data.daysSinceLastOrder === 0
        ? "Today"
        : `${formatCount(data.daysSinceLastOrder ?? 0)} days ago`;

  return (
    <div className="pb-14">
      {backLink}

      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="mb-6 flex flex-wrap items-start justify-between gap-6 rounded-xl border border-border bg-card p-6"
      >
        <div className="flex min-w-0 items-center gap-4">
          <Avatar className="size-14 shrink-0">
            <AvatarImage src={assetUrl(data.avatar) ?? undefined} alt="" />
            <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight">
                {name}
              </h1>
              <StageBadge
                stage={data.stage}
                isOverride={data.stageOverride !== null}
              />
            </div>

            <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Email</dt>
                <Mail className="size-3.5" aria-hidden />
                <dd className="truncate">{data.email}</dd>
              </div>

              {data.phone ? (
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Phone</dt>
                  <Phone className="size-3.5" aria-hidden />
                  <dd>{data.phone}</dd>
                </div>
              ) : null}

              {data.country ? (
                <div className="flex items-center gap-1.5">
                  <dt className="sr-only">Country</dt>
                  <MapPin className="size-3.5" aria-hidden />
                  <dd>{data.country}</dd>
                </div>
              ) : null}

              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Joined</dt>
                <CalendarClock className="size-3.5" aria-hidden />
                <dd>Joined {formatDate(data.joinedAt)}</dd>
              </div>
            </dl>
          </div>
        </div>

        <StageControl customer={data} />
      </motion.header>

      <section
        aria-label="Account figures"
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatTile
          label="Lifetime value"
          icon={BadgeDollarSign}
          value={formatPrice(data.lifetimeValue)}
          hint={`Across ${formatCount(data.paidOrders)} paid ${data.paidOrders === 1 ? "order" : "orders"}`}
        />
        <StatTile
          label="Average order"
          icon={Receipt}
          value={formatPrice(data.averageOrderValue)}
          hint={
            data.firstOrderAt
              ? `First bought ${formatDate(data.firstOrderAt)}`
              : "Has never completed a payment"
          }
        />
        <StatTile
          label="Last order"
          icon={CalendarClock}
          value={lastOrder}
          hint={
            data.lastOrderAt ? formatDate(data.lastOrderAt) : "No purchases yet"
          }
        />
        <StatTile
          label="Checkouts that failed"
          icon={ShoppingCart}
          value={formatCount(data.failedOrders)}
          hint={
            data.pendingOrders > 0
              ? `${formatCount(data.pendingOrders)} still open, ${formatCount(data.cartItems)} in the cart`
              : `${formatCount(data.cartItems)} items sitting in the cart`
          }
          direction="down-is-good"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Order history</CardTitle>
            <CardDescription>
              Everything this account has started, whether or not it was paid.
              The most recent fifty.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CustomerOrders customer={data} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tags</CardTitle>
            <CardDescription>
              For what the stages cannot say. Lower-cased and de-duplicated by
              the server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TagEditor customer={data} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">
              Notes
              {data.notes.length > 0 ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                  {formatCount(data.notes.length)}
                </span>
              ) : null}
            </CardTitle>
            <CardDescription>
              Internal, attributed and never shown to the customer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CustomerNotes customer={data} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CustomerRoute;
