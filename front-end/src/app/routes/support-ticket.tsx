import { Navigate, useLocation, useParams } from "react-router";

import { useAccountSessionQuery } from "@/api/account";
import { RouteFallback } from "@/components/ui/route-fallback";
import { paths } from "@/config/paths";
import { TicketPage } from "@/features/support/components/ticket-page";

/** /support/:ticketId: one of the customer's tickets (the link in the reply email). */
const SupportTicketRoute = () => {
  const { ticketId = "" } = useParams();
  const { pathname } = useLocation();
  const { data: session, isLoading } = useAccountSessionQuery();

  if (isLoading) return <RouteFallback />;
  if (session?.status !== "signed_in") return <Navigate to={paths.accountSignIn.getHref(pathname)} replace />;
  return (
    <div className="mx-auto max-w-3xl py-10">
      <TicketPage key={ticketId} ticketId={ticketId} />
    </div>
  );
};

export default SupportTicketRoute;
