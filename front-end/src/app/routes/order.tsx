import { Navigate, useLocation, useParams } from "react-router";

import { useAccountSessionQuery } from "@/api/account";
import { RouteFallback } from "@/components/ui/route-fallback";
import { paths } from "@/config/paths";
import { OrderStatus } from "@/features/shop/components/order-status";

/** /orders/:orderId: the buyer's order, as it moves from paid to ready. */
const OrderRoute = () => {
  const { orderId = "" } = useParams();
  const { pathname } = useLocation();
  const session = useAccountSessionQuery();

  if (session.isLoading) return <RouteFallback />;
  if (session.data?.status !== "signed_in") {
    return <Navigate to={paths.accountSignIn.getHref(pathname)} replace />;
  }
  return (
    <div className="mx-auto max-w-xl py-10">
      <OrderStatus key={orderId} orderId={orderId} />
    </div>
  );
};

export default OrderRoute;
