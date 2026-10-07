import type { CheckoutMethod, CheckoutMethodView, OrderView, PublicPlan } from "@shah-kelid/contracts";
import { Bitcoin, CircleDollarSign, CreditCard, Landmark } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  useShopCreateOrderMutation,
  useShopPayNowPaymentsMutation,
  useShopPaymentMethodsQuery,
  useShopPayUsdtMutation,
  useShopPayZarinpalMutation,
} from "@/api/shop";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";
import { formatGb, formatNumber, formatToman } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CardTransferForm } from "./card-transfer-form";

/**
 * Checkout, for a signed-in buyer: the plan, how to pay, and paying.
 *
 * The ways to pay come from the server: card to card only when a card is set
 * up, crypto only when it is set up and the USDT rate is fresh. The order is
 * made only when the buyer commits, with one idempotency key for the page,
 * so a double click or a retry is still one order.
 */

const ICONS: Record<CheckoutMethod, typeof CreditCard> = {
  zarinpal: CreditCard,
  card_transfer: Landmark,
  usdt_tron: CircleDollarSign,
  nowpayments: Bitcoin,
};

export const Checkout = ({ plan, renewSubscriptionId }: { plan: PublicPlan; renewSubscriptionId?: string }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const methods = useShopPaymentMethodsQuery();
  const [chosen, setChosen] = React.useState<CheckoutMethod>();
  const [order, setOrder] = React.useState<OrderView>();
  const [idempotencyKey] = React.useState(() => crypto.randomUUID());
  const [createOrder, creating] = useShopCreateOrderMutation();
  const [payZarinpal, zarinpal] = useShopPayZarinpalMutation();
  const [payUsdt, usdt] = useShopPayUsdtMutation();
  const [payNowPayments, nowpayments] = useShopPayNowPaymentsMutation();
  const [redirecting, setRedirecting] = React.useState(false);

  const available = methods.data ?? [];
  // The first way to pay is chosen until the buyer picks another.
  const method = chosen ?? available[0]?.method ?? "zarinpal";

  const describe = (view: CheckoutMethodView) => {
    const rate = "rateTomanPerUsdt" in view ? t("shop.checkout.rate", { rate: formatToman(view.rateTomanPerUsdt) }) : "";
    switch (view.method) {
      case "zarinpal":
        return { title: t("shop.checkout.zarinpal"), hint: t("shop.checkout.zarinpalHint") };
      case "card_transfer":
        return { title: t("shop.checkout.card"), hint: t("shop.checkout.cardHint") };
      case "usdt_tron":
        return { title: t("shop.checkout.usdt"), hint: `${t("shop.checkout.usdtHint")} ${rate}` };
      case "nowpayments":
        return { title: t("shop.checkout.nowpayments"), hint: `${t("shop.checkout.nowpaymentsHint")} ${rate}` };
    }
  };

  const goOn = async () => {
    try {
      const current = order ?? (await createOrder({ planId: plan.id, idempotencyKey, renewSubscriptionId }).unwrap());
      setOrder(current);
      // A free plan is paid the moment it is ordered: straight to its page.
      if (current.status !== "pending") {
        void navigate(paths.order.getHref(current.id));
        return;
      }
      switch (method) {
        case "card_transfer":
          return; // the card details come next, on this page
        case "usdt_tron":
          await payUsdt(current.id).unwrap();
          navigate(paths.order.getHref(current.id));
          return;
        case "zarinpal":
        case "nowpayments": {
          const { payUrl } =
            method === "zarinpal" ? await payZarinpal(current.id).unwrap() : await payNowPayments(current.id).unwrap();
          setRedirecting(true);
          window.location.assign(payUrl);
          return;
        }
      }
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const busy = creating.isLoading || zarinpal.isLoading || usdt.isLoading || nowpayments.isLoading || redirecting;
  const showCardForm = method === "card_transfer" && order;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-4">
        <div>
          <p className="font-semibold">{plan.name}</p>
          <p className="text-sm text-muted-foreground">
            {formatGb(plan.dataLimitBytes)} · {t("units.days", { amount: formatNumber(plan.durationDays) })}
            {plan.deviceLimit !== null ? ` · ${t("units.devices", { amount: formatNumber(plan.deviceLimit) })}` : ""}
          </p>
        </div>
        <div className="text-end">
          <p className="text-xs text-muted-foreground">{t("shop.checkout.total")}</p>
          <p className="text-xl font-bold tabular-nums">{formatToman(plan.priceToman)}</p>
        </div>
      </section>

      {showCardForm ? (
        <CardTransferForm
          orderId={order.id}
          amountToman={order.totalToman}
          onSent={() => navigate(paths.order.getHref(order.id))}
        />
      ) : (
        <>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium">{t("shop.checkout.method")}</legend>
            {methods.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : (
              available.map((view) => {
                const Icon = ICONS[view.method];
                const { title, hint } = describe(view);
                return (
                  <label
                    key={view.method}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
                      method === view.method ? "border-primary bg-primary/5" : "hover:bg-accent",
                    )}
                  >
                    <input
                      type="radio"
                      name="method"
                      value={view.method}
                      checked={method === view.method}
                      onChange={() => setChosen(view.method)}
                      className="mt-1 size-4 accent-primary"
                    />
                    <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="space-y-1">
                      <span className="block font-medium">{title}</span>
                      <span className="block text-sm leading-6 text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                );
              })
            )}
          </fieldset>

          <button
            type="button"
            onClick={() => void goOn()}
            disabled={busy || methods.isLoading}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          >
            {busy
              ? redirecting
                ? t("shop.checkout.redirecting")
                : t("common.loading")
              : method === "card_transfer"
                ? t("shop.checkout.continue")
                : t("shop.checkout.pay", { amount: formatToman(plan.priceToman) })}
          </button>
        </>
      )}
    </div>
  );
};
