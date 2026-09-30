import type { MySubscriptionView, PublicPlan } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";

import { formatGb, formatNumber, formatToman } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Checkout } from "./checkout";

/**
 * Renewing one service: the rule said plainly, the plan to renew with (the
 * current one first, when it is still sold), then the same checkout as a
 * first purchase.
 */
export const Renew = ({ service, plans }: { service: MySubscriptionView; plans: PublicPlan[] }) => {
  const { t } = useTranslation();
  const current = plans.find((plan) => plan.id === service.plan.id);
  const [chosenId, setChosenId] = React.useState(current?.id ?? plans[0]?.id);
  const [confirmed, setConfirmed] = React.useState(false);
  const chosen = plans.find((plan) => plan.id === chosenId);

  if (!service.renewable || !chosen) {
    return <p className="text-muted-foreground">{t("shop.renew.notRenewable")}</p>;
  }

  if (confirmed) return <Checkout plan={chosen} renewSubscriptionId={service.id} />;

  const ordered = current ? [current, ...plans.filter((plan) => plan.id !== current.id)] : plans;
  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-muted/50 p-4 text-sm leading-7">{t("shop.renew.rule")}</p>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">{t("shop.renew.choose")}</legend>
        {ordered.map((plan) => (
          <label
            key={plan.id}
            className={cn(
              "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 transition-colors has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
              chosenId === plan.id ? "border-primary bg-primary/5" : "hover:bg-accent",
            )}
          >
            <span className="flex items-center gap-3">
              <input
                type="radio"
                name="renew-plan"
                value={plan.id}
                checked={chosenId === plan.id}
                onChange={() => setChosenId(plan.id)}
                className="size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">
                  {plan.name}
                  {plan.id === current?.id ? (
                    <span className="ms-2 text-xs text-muted-foreground">({t("shop.renew.current")})</span>
                  ) : null}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {formatGb(plan.dataLimitBytes)} · {t("units.days", { amount: formatNumber(plan.durationDays) })}
                </span>
              </span>
            </span>
            <span className="font-semibold tabular-nums">{formatToman(plan.priceToman)}</span>
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        onClick={() => setConfirmed(true)}
        className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {t("shop.renew.continue")}
      </button>
    </div>
  );
};
