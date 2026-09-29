import { useTranslation } from "react-i18next";
import { Navigate } from "react-router";

import { useAccountSessionQuery } from "@/api/account";
import { RouteFallback } from "@/components/ui/route-fallback";
import { paths } from "@/config/paths";
import { AccountCard } from "@/features/account/components/account-card";
import { AccountOverview } from "@/features/account/components/account-overview";

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
      <AccountOverview account={session.account} />
    </AccountCard>
  );
};

export default AccountRoute;
