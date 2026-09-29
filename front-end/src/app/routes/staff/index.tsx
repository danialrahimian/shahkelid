import type { AccountView } from "@shah-kelid/contracts";
import { useTranslation } from "react-i18next";
import { Navigate, useOutletContext } from "react-router";

import { firstStaffPage } from "@/features/staff/staff-links";

/** /staff: straight to the first page this person may open. */
const StaffIndexRoute = () => {
  const { t } = useTranslation();
  const account = useOutletContext<AccountView>();
  const first = firstStaffPage(account);
  return first ? <Navigate to={first} replace /> : <p className="text-muted-foreground">{t("staff.guard")}</p>;
};

export default StaffIndexRoute;
