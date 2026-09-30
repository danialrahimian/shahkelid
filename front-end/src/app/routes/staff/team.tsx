import type { AccountView } from "@shah-kelid/contracts";
import { useOutletContext } from "react-router";

import { TeamPage } from "@/features/staff/components/team-page";

/** /staff/team: everyone with a role; owners (users:manage_roles) change them. */
const TeamRoute = () => {
  const account = useOutletContext<AccountView>();
  return <TeamPage canManage={account.permissions.includes("users:manage_roles")} />;
};

export default TeamRoute;
