import type { AccountView } from "@shah-kelid/contracts";
import { useOutletContext } from "react-router";

import { TicketsPage } from "@/features/staff/components/tickets-page";

/** /staff/tickets: the support queue, and (for settings managers) the ticket categories. */
const TicketsRoute = () => {
  const account = useOutletContext<AccountView>();
  return <TicketsPage canManageCategories={account.permissions.includes("settings:manage")} />;
};

export default TicketsRoute;
