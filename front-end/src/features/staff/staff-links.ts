import type { AccountView } from "@shah-kelid/contracts";
import {
  ChartNoAxesCombined,
  FileText,
  History,
  Layers,
  LifeBuoy,
  Mail,
  MessageSquare,
  Receipt,
  Server,
  ShieldCheck,
  UserCog,
  Users,
  Waypoints,
} from "lucide-react";

import { paths } from "@/config/paths";

/**
 * The staff area's pages, grouped as the sidebar shows them, each with the
 * permission that opens it (the same one the API checks).
 */

type StaffLink = {
  to: string;
  label:
    | "reports"
    | "customers"
    | "subscriptions"
    | "payments"
    | "plans"
    | "servers"
    | "panels"
    | "notifications"
    | "tickets"
    | "posts"
    | "comments"
    | "team"
    | "audit";
  icon: typeof Users;
  permission: string;
};

export const STAFF_GROUPS: {
  label: "support" | "sales" | "content" | "infrastructure" | "settings";
  links: StaffLink[];
}[] = [
  {
    label: "support",
    links: [{ to: paths.staffTickets.getHref(), label: "tickets", icon: LifeBuoy, permission: "tickets:reply" }],
  },
  {
    label: "sales",
    links: [
      { to: paths.staffReports.getHref(), label: "reports", icon: ChartNoAxesCombined, permission: "analytics:read" },
      { to: paths.staffCustomers.getHref(), label: "customers", icon: Users, permission: "customers:read" },
      { to: paths.staffSubscriptions.getHref(), label: "subscriptions", icon: Waypoints, permission: "customers:read" },
      { to: paths.staffPayments.getHref(), label: "payments", icon: Receipt, permission: "payments:review" },
      { to: paths.staffPlans.getHref(), label: "plans", icon: Layers, permission: "plans:manage" },
    ],
  },
  {
    label: "content",
    links: [
      { to: paths.staffPosts.getHref(), label: "posts", icon: FileText, permission: "content:manage" },
      { to: paths.staffComments.getHref(), label: "comments", icon: MessageSquare, permission: "content:manage" },
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
      { to: paths.staffTeam.getHref(), label: "team", icon: UserCog, permission: "users:read" },
      { to: paths.staffAudit.getHref(), label: "audit", icon: History, permission: "audit:read" },
    ],
  },
];

/** The first page this person may open: where /staff itself leads. */
export const firstStaffPage = (account: AccountView) =>
  STAFF_GROUPS.flatMap((group) => group.links).find((link) => account.permissions.includes(link.permission))?.to;
