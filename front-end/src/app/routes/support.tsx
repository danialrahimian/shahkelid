import { Navigate, useLocation } from "react-router";

import { useAccountSessionQuery } from "@/api/account";
import { RouteFallback } from "@/components/ui/route-fallback";
import { paths } from "@/config/paths";
import { MyTickets } from "@/features/support/components/my-tickets";

/** /support: the signed-in customer's tickets. */
const SupportRoute = () => {
  const { pathname } = useLocation();
  const { data: session, isLoading } = useAccountSessionQuery();

  if (isLoading) return <RouteFallback />;
  if (session?.status !== "signed_in") return <Navigate to={paths.accountSignIn.getHref(pathname)} replace />;
  return (
    <div className="mx-auto max-w-3xl py-10">
      <MyTickets />
    </div>
  );
};

export default SupportRoute;
