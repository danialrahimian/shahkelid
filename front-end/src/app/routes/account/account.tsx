import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router";

import { useAccountSessionQuery } from "@/api/account";
import { RouteFallback } from "@/components/ui/route-fallback";
import { paths } from "@/config/paths";
import { AccountCard } from "@/features/account/components/account-card";
import { AccountOverview } from "@/features/account/components/account-overview";
import { MyOrders } from "@/features/shop/components/my-orders";

/**
 * /account. Anything short of a finished sign-in (signed out, or the
 * authenticator step still to come) goes back to the sign-in screen, which
 * picks up at the step the session is on.
 */
const AccountRoute = () => {
  const { t } = useTranslation();
  const { data: session, isLoading } = useAccountSessionQuery();

  if (isLoading) return <RouteFallback />;
  if (session?.status !== "signed_in") {
    return <Navigate to={paths.accountSignIn.getHref(paths.account.getHref())} replace />;
  }
  return (
    <AccountCard title={t("account.profile.title")}>
      <div className="space-y-6">
        {session.account.isStaff ? (
          <Link
            to={paths.staff.getHref()}
            className="flex items-center justify-center rounded-md border px-4 py-2.5 text-sm font-medium hover:bg-accent"
          >
            {t("shop.nav.staff")}
          </Link>
        ) : null}
        <MyOrders />
        <AccountOverview account={session.account} />
      </div>
    </AccountCard>
  );
};

export default AccountRoute;
