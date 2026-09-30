import { useParams } from "react-router";

import { StaffTicketPage } from "@/features/staff/components/tickets-page";

/** /staff/tickets/:ticketId */
const TicketRoute = () => {
  const { ticketId = "" } = useParams();
  return <StaffTicketPage key={ticketId} ticketId={ticketId} />;
};

export default TicketRoute;
