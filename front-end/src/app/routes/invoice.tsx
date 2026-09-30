import { Navigate, useLocation, useParams } from "react-router";

import { useAccountSessionQuery } from "@/api/account";
import { RouteFallback } from "@/components/ui/route-fallback";
import { paths } from "@/config/paths";
import { Invoice } from "@/features/shop/components/invoice";

/** /orders/:orderId/invoice */
const InvoiceRoute = () => {
  const { orderId = "" } = useParams();
  const { pathname } = useLocation();
  const session = useAccountSessionQuery();

  if (session.isLoading) return <RouteFallback />;
  if (session.data?.status !== "signed_in") return <Navigate to={paths.accountSignIn.getHref(pathname)} replace />;
  return (
    <div className="mx-auto max-w-2xl py-10">
      <Invoice orderId={orderId} />
    </div>
  );
};

export default InvoiceRoute;
