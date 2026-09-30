import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router";

import { useAccountSessionQuery } from "@/api/account";
import { RouteFallback } from "@/components/ui/route-fallback";
import { paths } from "@/config/paths";
import { AccountOverview } from "@/features/account/components/account-overview";
import { MyOrders } from "@/features/shop/components/my-orders";
import { MyServices } from "@/features/shop/components/my-services";

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
    <div className="mx-auto max-w-4xl space-y-10 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("account.profile.title")}</h1>
          <p dir="ltr" className="text-start text-sm text-muted-foreground">
            {session.account.email}
          </p>
        </div>
        {session.account.isStaff ? (
          <Link
            to={paths.staff.getHref()}
            className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
          >
            {t("shop.nav.staff")}
          </Link>
        ) : null}
      </header>

      <MyServices />

      <div className="grid gap-10 md:grid-cols-2">
        <MyOrders />
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <AccountOverview account={session.account} />
        </section>
      </div>
    </div>
  );
};

export default AccountRoute;
