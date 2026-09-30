import type { OrderView } from "@shah-kelid/contracts";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";

import { useShopOrderQuery, useShopPayZarinpalMutation } from "@/api/shop";
import { QrLink } from "@/components/ui/qr-link";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";
import { formatNumber, formatToman } from "@/lib/format";

import { pollEvery, stageOf } from "../order-stage";
import { CardTransferForm } from "./card-transfer-form";
import { UsdtPayment } from "./usdt-payment";

/**
 * Where the buyer lands after paying, and where the link appears.
 *
 * The page asks again every two seconds until there is nothing left to wait
 * for, so the link and QR code show up on their own, a few seconds after
 * paying, without a reload. A receipt under review is checked less often.
 */

const reasonKey = (reason: string | null, status: string | undefined) => {
  if (status === "expired") return "expired" as const;
  if (reason === "cancelled") return "cancelled" as const;
  if (reason === "amount_mismatch") return "amount_mismatch" as const;
  if (reason === "partially_paid") return "partially_paid" as const;
  if (reason?.startsWith("not_paid")) return "not_paid" as const;
  return "other" as const;
};

const Headline = ({ icon: Icon, tone, children }: { icon: typeof Clock; tone: string; children: React.ReactNode }) => (
  <p className={`flex items-center gap-2 text-lg font-semibold ${tone}`}>
    <Icon className="size-6 shrink-0" aria-hidden />
    <span>{children}</span>
  </p>
);

/** Paying again after a failure: online again, or by card. */
const PayAgain = ({ order }: { order: OrderView }) => {
  const { t } = useTranslation();
  const [payZarinpal, { isLoading }] = useShopPayZarinpalMutation();
  const [byCard, setByCard] = React.useState(false);

  if (byCard) return <CardTransferForm orderId={order.id} amountToman={order.totalToman} onSent={() => setByCard(false)} />;
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={isLoading}
        onClick={() =>
          void payZarinpal(order.id)
            .unwrap()
            .then(({ payUrl }) => window.location.assign(payUrl))
            .catch((error: unknown) => toast.error(errorText(error)))
        }
        className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {t("shop.order.payAgain")} · {t("shop.checkout.zarinpal")}
      </button>
      <button type="button" onClick={() => setByCard(true)} className="inline-flex h-10 items-center rounded-md border px-4 text-sm hover:bg-accent">
        {t("shop.checkout.card")}
      </button>
    </div>
  );
};

export const OrderStatus = ({ orderId }: { orderId: string }) => {
  const { t } = useTranslation();
  const [pollInterval, setPollInterval] = React.useState(2000);
  const { data: order, isLoading, isError } = useShopOrderQuery(orderId, { pollingInterval: pollInterval });

  const stage = order ? stageOf(order) : undefined;
  // Adjusting state while rendering, as React recommends for derived values:
  // the polling rate follows the stage without an effect.
  const wanted = stage ? pollEvery(stage) : 2000;
  if (wanted !== pollInterval) setPollInterval(wanted);

  // Preparing for more than half a minute: say so, and say the money is safe.
  const [slow, setSlow] = React.useState(false);
  const preparing = stage === "preparing";
  React.useEffect(() => {
    if (!preparing) return;
    const timer = window.setTimeout(() => setSlow(true), 30_000);
    return () => window.clearTimeout(timer);
  }, [preparing]);

  if (isLoading) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (isError || !order || !stage) return <p className="text-muted-foreground">{t("errors.generic")}</p>;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">{t("shop.order.title", { number: formatNumber(order.number) })}</h1>
        <p className="text-sm text-muted-foreground">
          {order.plan.name} · {formatToman(order.totalToman)}
        </p>
      </header>

      <div aria-live="polite" className="space-y-4">
        {stage === "ready" ? (
          <>
            <Headline icon={CheckCircle2} tone="text-emerald-600 dark:text-emerald-400">
              {t("shop.order.ready")}
            </Headline>
            <QrLink
              link={order.subscription!.link!}
              hint={t("shop.order.linkHint")}
              qrAlt={t("shop.order.qrAlt")}
              copyLabel={t("shop.order.copyLink")}
              copiedLabel={t("shop.order.copied")}
            />
          </>
        ) : stage === "renewed" ? (
          <>
            <Headline icon={CheckCircle2} tone="text-emerald-600 dark:text-emerald-400">
              {t("shop.order.renewed")}
            </Headline>
            <p className="text-sm leading-6">{t("shop.order.renewedHint")}</p>
          </>
        ) : stage === "preparing" ? (
          <Headline icon={Loader2} tone="[&_svg]:animate-spin">
            {slow ? t("shop.order.preparingSlow") : t("shop.order.preparing")}
          </Headline>
        ) : stage === "awaiting_transfer" && order.payment?.crypto ? (
          <UsdtPayment quote={order.payment.crypto} />
        ) : stage === "checking" ? (
          <Headline icon={Loader2} tone="[&_svg]:animate-spin">
            {t("shop.order.checking")}
          </Headline>
        ) : stage === "review" ? (
          <Headline icon={Clock} tone="text-sky-700 dark:text-sky-300">
            {t("shop.order.review")}
          </Headline>
        ) : stage === "failed" ? (
          <>
            <Headline icon={XCircle} tone="text-destructive">
              {t("shop.order.failed")}
            </Headline>
            <p className="text-sm" dir="auto">
              {order.payment?.method === "card_transfer" && order.payment.failureReason
                ? order.payment.failureReason
                : t(`shop.order.reasons.${reasonKey(order.payment?.failureReason ?? null, order.payment?.status)}`)}
            </p>
            {order.status === "pending" ? <PayAgain order={order} /> : null}
          </>
        ) : stage === "expired" ? (
          <>
            <Headline icon={XCircle} tone="text-muted-foreground">
              {t("shop.order.expired")}
            </Headline>
            <Link to={paths.pricing.getHref()} className="text-sm underline underline-offset-4">
              {t("shop.order.choosePlan")}
            </Link>
          </>
        ) : (
          <>
            <Headline icon={Clock} tone="">
              {t("shop.order.waitingPayment")}
            </Headline>
            <PayAgain order={order} />
          </>
        )}
      </div>

      {order.payment?.status === "succeeded" ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {order.payment.refId ? (
            <div>
              <dt className="text-muted-foreground">{t("shop.order.refId")}</dt>
              <dd dir="ltr" className="text-start font-mono">
                {order.payment.refId}
              </dd>
            </div>
          ) : null}
          {order.invoiceNumber ? (
            <div>
              <dt className="text-muted-foreground">{t("shop.order.invoice")}</dt>
              <dd className="tabular-nums">
                <Link to={paths.invoice.getHref(order.id)} className="underline underline-offset-4">
                  {formatNumber(order.invoiceNumber)} · {t("shop.order.viewInvoice")}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <Link to={paths.account.getHref()} className="inline-block text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t("shop.order.myAccount")}
      </Link>
    </div>
  );
};
