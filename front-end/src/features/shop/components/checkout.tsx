import type { OrderView, PublicPlan } from "@shah-kelid/contracts";
import { CreditCard, Landmark } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { useShopCreateOrderMutation, useShopPayZarinpalMutation } from "@/api/shop";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";
import { formatGb, formatNumber, formatToman } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CardTransferForm } from "./card-transfer-form";

type Method = "zarinpal" | "card";

/**
 * Checkout, for a signed-in buyer: the plan, how to pay, and paying. The
 * order is only made when the buyer commits (pay, or continue to the card
 * details), with one idempotency key for the page, so a double click or a
 * retry is still one order.
 */
export const Checkout = ({ plan }: { plan: PublicPlan }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [method, setMethod] = React.useState<Method>("zarinpal");
  const [order, setOrder] = React.useState<OrderView>();
  const [idempotencyKey] = React.useState(() => crypto.randomUUID());
  const [createOrder, creating] = useShopCreateOrderMutation();
  const [payZarinpal, paying] = useShopPayZarinpalMutation();
  const [redirecting, setRedirecting] = React.useState(false);

  const ensureOrder = async () => order ?? (await createOrder({ planId: plan.id, idempotencyKey }).unwrap());

  const goOn = async () => {
    try {
      const current = await ensureOrder();
      setOrder(current);
      if (method === "card") return;
      const { payUrl } = await payZarinpal(current.id).unwrap();
      setRedirecting(true);
      window.location.assign(payUrl);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const busy = creating.isLoading || paying.isLoading || redirecting;
  const showCardForm = method === "card" && order;

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
            {(
              [
                { value: "zarinpal", icon: CreditCard, title: t("shop.checkout.zarinpal"), hint: t("shop.checkout.zarinpalHint") },
                { value: "card", icon: Landmark, title: t("shop.checkout.card"), hint: t("shop.checkout.cardHint") },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
                  method === option.value ? "border-primary bg-primary/5" : "hover:bg-accent",
                )}
              >
                <input
                  type="radio"
                  name="method"
                  value={option.value}
                  checked={method === option.value}
                  onChange={() => setMethod(option.value)}
                  className="mt-1 size-4 accent-primary"
                />
                <option.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="space-y-1">
                  <span className="block font-medium">{option.title}</span>
                  <span className="block text-sm leading-6 text-muted-foreground">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <button
            type="button"
            onClick={() => void goOn()}
            disabled={busy}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          >
            {busy
              ? redirecting
                ? t("shop.checkout.redirecting")
                : t("common.loading")
              : method === "zarinpal"
                ? t("shop.checkout.pay", { amount: formatToman(plan.priceToman) })
                : t("shop.checkout.continue")}
          </button>
        </>
      )}
    </div>
  );
};
