import type { PublicPlan } from "@shah-kelid/contracts";
import { Gauge, MonitorSmartphone, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { useShopPlansQuery } from "@/api/shop";
import { paths } from "@/config/paths";
import { formatGb, formatNumber, formatToman } from "@/lib/format";

/**
 * The plans on sale, as cards: volume first (what people compare), then
 * days and devices, then the price and the way in. Used on the pricing page
 * and the home page.
 */

const Fact = ({ icon: Icon, children }: { icon: typeof Gauge; children: React.ReactNode }) => (
  <li className="flex items-center gap-2 text-sm text-muted-foreground">
    <Icon className="size-4 shrink-0" aria-hidden />
    <span>{children}</span>
  </li>
);

const PlanCard = ({ plan }: { plan: PublicPlan }) => {
  const { t } = useTranslation();
  return (
    <article className="flex flex-col rounded-xl border bg-card p-5 shadow-xs transition-shadow hover:shadow-md">
      <h3 className="text-lg font-semibold text-balance">{plan.name}</h3>
      <p className="mt-3 text-3xl font-bold tabular-nums">{formatGb(plan.dataLimitBytes)}</p>
      <ul className="mt-4 space-y-2">
        <Fact icon={Timer}>{t("units.days", { amount: formatNumber(plan.durationDays) })}</Fact>
        <Fact icon={MonitorSmartphone}>
          {plan.deviceLimit === null
            ? t("units.unlimited")
            : t("units.devices", { amount: formatNumber(plan.deviceLimit) })}
        </Fact>
        <Fact icon={Gauge}>{t("shop.plans.startsOnFirstUse")}</Fact>
      </ul>
      {plan.description ? <p className="mt-4 text-sm leading-6 text-muted-foreground">{plan.description}</p> : null}
      <div className="mt-auto flex items-end justify-between gap-3 pt-6">
        <p className="text-lg font-semibold tabular-nums">{formatToman(plan.priceToman)}</p>
        <Link
          to={paths.buy.getHref(plan.id)}
          className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {t("shop.plans.buy")}
        </Link>
      </div>
    </article>
  );
};

export const PlanCards = () => {
  const { t } = useTranslation();
  const { data: plans, isLoading, isError } = useShopPlansQuery();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-72 animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>
    );
  }
  if (isError) return <p className="text-center text-muted-foreground">{t("shop.plans.loadFailed")}</p>;
  if (!plans?.length) return <p className="text-center text-muted-foreground">{t("shop.plans.empty")}</p>;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} />
      ))}
    </div>
  );
};
