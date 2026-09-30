import type { AccountView } from "@shah-kelid/contracts";
import { useOutletContext, useParams } from "react-router";

import { CustomerPage } from "@/features/staff/components/customers-page";

/** /staff/customers/:customerId */
const CustomerRoute = () => {
  const { customerId = "" } = useParams();
  const account = useOutletContext<AccountView>();
  return (
    <CustomerPage
      key={customerId}
      customerId={customerId}
      canSeeOrders={account.permissions.includes("orders:read")}
      canManage={account.permissions.includes("customers:manage")}
    />
  );
};

export default CustomerRoute;
