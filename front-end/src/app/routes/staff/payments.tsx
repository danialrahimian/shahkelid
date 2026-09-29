import type { AccountView } from "@shah-kelid/contracts";
import { useOutletContext } from "react-router";

import { PaymentsPage } from "@/features/staff/components/payments-page";

/** /staff/payments: receipts to review, and (for settings managers) the cards shown to buyers. */
const PaymentsRoute = () => {
  const account = useOutletContext<AccountView>();
  return (
    <PaymentsPage
      canReview={account.permissions.includes("payments:review")}
      canManageCards={account.permissions.includes("settings:manage")}
    />
  );
};

export default PaymentsRoute;
