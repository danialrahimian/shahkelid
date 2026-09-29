import { useTranslation } from "react-i18next";

import { PlanCards } from "@/features/shop/components/plan-cards";

/** /pricing: the plans on sale, each a way into buying it. */
const PricingRoute = () => {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-5xl space-y-8 py-10">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold text-balance">{t("shop.plans.title")}</h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">{t("shop.plans.subtitle")}</p>
      </header>
      <PlanCards />
    </div>
  );
};

export default PricingRoute;
