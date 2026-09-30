import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useParams } from "react-router";

import { useAccountSessionQuery } from "@/api/account";
import { useShopPlansQuery, useShopSubscriptionsQuery } from "@/api/shop";
import { RouteFallback } from "@/components/ui/route-fallback";
import { paths } from "@/config/paths";
import { Renew } from "@/features/shop/components/renew";

/** /renew/:subscriptionId: renewing one of the signed-in customer's services. */
const RenewRoute = () => {
  const { t } = useTranslation();
  const { subscriptionId = "" } = useParams();
  const { pathname } = useLocation();
  const session = useAccountSessionQuery();
  const signedIn = session.data?.status === "signed_in";
  const services = useShopSubscriptionsQuery(undefined, { skip: !signedIn });
  const plans = useShopPlansQuery();

  if (session.isLoading) return <RouteFallback />;
  if (!signedIn) return <Navigate to={paths.accountSignIn.getHref(pathname)} replace />;
  if (services.isLoading || plans.isLoading) return <RouteFallback />;

  const service = services.data?.find((candidate) => candidate.id === subscriptionId);
  return (
    <div className="mx-auto max-w-xl space-y-6 py-10">
      <h1 className="text-2xl font-bold">
        {t("shop.renew.title")}
        {service ? `: ${service.plan.name}` : ""}
      </h1>
      {service ? (
        <Renew service={service} plans={plans.data ?? []} />
      ) : (
        <p className="text-muted-foreground">{t("shop.renew.notRenewable")}</p>
      )}
    </div>
  );
};

export default RenewRoute;
