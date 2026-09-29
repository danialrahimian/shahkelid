import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { useShopOrdersQuery } from "@/api/shop";
import { paths } from "@/config/paths";
import { formatDate, formatNumber, formatToman } from "@/lib/format";

/** The buyer's orders, newest first, each linking to its page (and its link, once ready). */
export const MyOrders = () => {
  const { t } = useTranslation();
  const { data: orders, isLoading } = useShopOrdersQuery();

  return (
    <section className="space-y-3" aria-labelledby="my-orders-title">
      <h2 id="my-orders-title" className="text-sm font-medium">
        {t("shop.orders.title")}
      </h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : !orders?.length ? (
        <p className="text-sm text-muted-foreground">
          {t("shop.orders.empty")}{" "}
          <Link to={paths.pricing.getHref()} className="underline underline-offset-4">
            {t("shop.checkout.choosePlan")}
          </Link>
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                to={paths.order.getHref(order.id)}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-accent"
              >
                <span>
                  <span className="font-medium">{order.plan.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t("shop.order.title", { number: formatNumber(order.number) })} · {formatDate(order.createdAt)}
                  </span>
                </span>
                <span className="text-end">
                  <span className="block tabular-nums">{formatToman(order.totalToman)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`shop.orders.status.${order.status}`)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
