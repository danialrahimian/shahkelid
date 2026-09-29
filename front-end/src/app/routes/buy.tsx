import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";

import { useAccountSessionQuery } from "@/api/account";
import { useShopPlansQuery } from "@/api/shop";
import { RouteFallback } from "@/components/ui/route-fallback";
import { paths } from "@/config/paths";
import { SignInFlow } from "@/features/account/components/sign-in-flow";
import { Checkout } from "@/features/shop/components/checkout";

/**
 * /buy/:planId. Signing in happens here, in place: the buyer types their
 * email and the code, and carries on with the same plan. Nobody is sent
 * away to a separate sign-in page and asked to find their way back.
 */
const BuyRoute = () => {
  const { t } = useTranslation();
  const { planId = "" } = useParams();
  const session = useAccountSessionQuery();
  const plans = useShopPlansQuery();

  if (session.isLoading || plans.isLoading) return <RouteFallback />;

  const plan = plans.data?.find((candidate) => candidate.id === planId);
  if (!plan) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <p>{t("shop.checkout.notOnSale")}</p>
        <Link to={paths.pricing.getHref()} className="underline underline-offset-4">
          {t("shop.checkout.choosePlan")}
        </Link>
      </div>
    );
  }

  if (session.data?.status !== "signed_in") {
    return (
      <div className="mx-auto max-w-md space-y-2 pt-8">
        <h1 className="text-center text-xl font-bold">{t("shop.checkout.title", { plan: plan.name })}</h1>
        <p className="text-center text-sm text-muted-foreground">{t("shop.checkout.signIn")}</p>
        <SignInFlow />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 py-10">
      <h1 className="text-2xl font-bold">{t("shop.checkout.title", { plan: plan.name })}</h1>
      <Checkout plan={plan} />
    </div>
  );
};

export default BuyRoute;
