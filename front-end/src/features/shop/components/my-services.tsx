import type { MySubscriptionView } from "@shah-kelid/contracts";
import { Gauge, MonitorSmartphone, Timer } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { useShopSubscriptionsQuery } from "@/api/shop";
import { QrLink } from "@/components/ui/qr-link";
import { paths } from "@/config/paths";
import { formatDate, formatDateTime, formatGb, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { daysLeft, usedShare } from "../service-facts";

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  on_hold: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  limited: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  expired: "bg-red-500/10 text-red-700 dark:text-red-300",
};

/**
 * One service: how much is left and for how long first (what people open
 * the panel to see), then the link, and the way to renew.
 */
const ServiceCard = ({ service, now }: { service: MySubscriptionView; now: number }) => {
  const { t } = useTranslation();
  const [showLink, setShowLink] = React.useState(false);
  const share = usedShare(service.usedBytes, service.dataLimitBytes);

  const time =
    service.status === "on_hold" && service.daysOnHold !== null
      ? t("shop.services.onHold", { days: formatNumber(service.daysOnHold) })
      : service.expiresAt === null
        ? "—"
        : daysLeft(service.expiresAt, now) === 0
          ? t("shop.services.expired")
          : `${t("shop.services.daysLeft", { days: formatNumber(daysLeft(service.expiresAt, now)) })} · ${t("shop.services.expiresOn", { date: formatDate(service.expiresAt) })}`;

  return (
    <article className="space-y-4 rounded-xl border bg-card p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{service.plan.name}</h3>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            STATUS_TONE[service.status] ?? "bg-muted text-muted-foreground",
          )}
        >
          {t(`shop.services.status.${service.status}`)}
        </span>
      </header>

      <div className="space-y-2">
        <p className="flex items-center gap-2 text-lg font-semibold tabular-nums">
          <Gauge className="size-5 text-muted-foreground" aria-hidden />
          {service.remainingBytes === null
            ? t("shop.services.unlimitedVolume")
            : t("shop.services.remaining", { amount: formatGb(service.remainingBytes) })}
        </p>
        {service.dataLimitBytes !== null ? (
          <>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(share * 100)}
              aria-label={t("shop.services.used", { used: formatGb(service.usedBytes), total: formatGb(service.dataLimitBytes) })}
            >
              <div
                className={cn("h-full rounded-full", share >= 1 ? "bg-red-500" : share >= 0.8 ? "bg-amber-500" : "bg-emerald-500")}
                style={{ width: `${share * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("shop.services.used", { used: formatGb(service.usedBytes), total: formatGb(service.dataLimitBytes) })}
            </p>
          </>
        ) : null}
      </div>

      <ul className="space-y-1.5 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <Timer className="size-4 shrink-0" aria-hidden />
          <span>{time}</span>
        </li>
        {service.deviceLimit !== null ? (
          <li className="flex items-center gap-2">
            <MonitorSmartphone className="size-4 shrink-0" aria-hidden />
            <span>{t("shop.services.devices", { amount: formatNumber(service.deviceLimit) })}</span>
          </li>
        ) : null}
      </ul>

      {showLink && service.link ? (
        <QrLink
          link={service.link}
          hint={t("shop.order.linkHint")}
          qrAlt={t("shop.order.qrAlt")}
          copyLabel={t("shop.order.copyLink")}
          copiedLabel={t("shop.order.copied")}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {service.link ? (
          <button
            type="button"
            onClick={() => setShowLink((shown) => !shown)}
            aria-expanded={showLink}
            className="inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {showLink ? t("shop.services.hideLink") : t("shop.services.showLink")}
          </button>
        ) : null}
        {service.renewable ? (
          <Link
            to={paths.renew.getHref(service.id)}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t("shop.services.renew")}
          </Link>
        ) : null}
      </div>

      {service.lastSyncedAt ? (
        <p className="text-xs text-muted-foreground">
          {t("shop.services.lastSync", { time: formatDateTime(service.lastSyncedAt) })}
        </p>
      ) : null}
    </article>
  );
};

/** The customer's services, freshly read from the panel when the page opens. */
export const MyServices = () => {
  const { t } = useTranslation();
  const { data: services, isLoading } = useShopSubscriptionsQuery(undefined, { refetchOnMountOrArgChange: true });
  const [now] = React.useState(() => Date.now());

  return (
    <section className="space-y-3" aria-labelledby="my-services-title">
      <h2 id="my-services-title" className="text-lg font-semibold">
        {t("shop.services.title")}
      </h2>
      {isLoading ? (
        <div className="h-48 animate-pulse rounded-xl border bg-muted/40" aria-busy />
      ) : !services?.length ? (
        <p className="text-sm text-muted-foreground">
          {t("shop.services.empty")}{" "}
          <Link to={paths.pricing.getHref()} className="underline underline-offset-4">
            {t("shop.services.buy")}
          </Link>
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {services.map((service) => (
            <ServiceCard key={service.id} service={service} now={now} />
          ))}
        </div>
      )}
    </section>
  );
};
