import type { AccountView } from "@shah-kelid/contracts";
import { Layers, Mail, Receipt, Server, ShieldCheck, Users, Waypoints } from "lucide-react";

import { paths } from "@/config/paths";

/**
 * The staff area's pages, grouped as the sidebar shows them, each with the
 * permission that opens it (the same one the API checks).
 */

type StaffLink = {
  to: string;
  label: "customers" | "subscriptions" | "payments" | "plans" | "servers" | "panels" | "notifications";
  icon: typeof Users;
  permission: string;
};

export const STAFF_GROUPS: { label: "sales" | "infrastructure" | "settings"; links: StaffLink[] }[] = [
  {
    label: "sales",
    links: [
      { to: paths.staffCustomers.getHref(), label: "customers", icon: Users, permission: "customers:read" },
      { to: paths.staffSubscriptions.getHref(), label: "subscriptions", icon: Waypoints, permission: "customers:read" },
      { to: paths.staffPayments.getHref(), label: "payments", icon: Receipt, permission: "payments:review" },
      { to: paths.staffPlans.getHref(), label: "plans", icon: Layers, permission: "plans:manage" },
    ],
  },
  {
    label: "infrastructure",
    links: [
      { to: paths.staffServers.getHref(), label: "servers", icon: Server, permission: "servers:manage" },
      { to: paths.staffPanels.getHref(), label: "panels", icon: ShieldCheck, permission: "servers:manage" },
    ],
  },
  {
    label: "settings",
    links: [
      { to: paths.staffNotifications.getHref(), label: "notifications", icon: Mail, permission: "settings:manage" },
    ],
  },
];

/** The first page this person may open: where /staff itself leads. */
export const firstStaffPage = (account: AccountView) =>
  STAFF_GROUPS.flatMap((group) => group.links).find((link) => account.permissions.includes(link.permission))?.to;

