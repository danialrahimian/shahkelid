import {
  ChartNoAxesCombined,
  Contact,
  House,
  FilePen,
  LayoutDashboard,
  Newspaper,
  Package,
  Tags,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react";

import { paths } from "@/config/paths";
import { ROLES } from "@/lib/authorization";
import type { Role } from "@/types/api";

/**
 * The navigation, described once and shared by the desktop bar and the mobile
 * menu.
 *
 * Each entry carries what it takes to see it, so the two menus cannot drift
 * apart and neither can offer a link the router would refuse. The roles here
 * are the same ones the route guards use, which in turn match the server's.
 */
/** Everybody who may enter the dashboard at all. */
const STAFF_ROLES: Role[] = [ROLES.ADMIN, ROLES.MODERATOR, ROLES.OWNER];

export type NavLink = {
  to: string;
  path: string;
  label: string;
  icon: LucideIcon;
  /** Whether a session is required at all. */
  requiresAuth?: boolean;
  /** Which roles may see it. Undefined means any signed-in role. */
  allowedRoles?: Role[];
  /** Panel links are grouped apart in the mobile menu. */
  group: "main" | "panel";
};

export const NAV_LINKS: NavLink[] = [
  {
    to: paths.home.getHref(),
    path: paths.home.path,
    label: "home",
    icon: House,
    group: "main",
  },
  {
    to: paths.pricing.getHref(),
    path: paths.pricing.path,
    label: "pricing",
    icon: Tags,
    group: "main",
  },
  {
    to: paths.posts.getHref(),
    path: paths.posts.path,
    label: "journal",
    icon: Newspaper,
    group: "main",
  },
  {
    to: paths.cart.getHref(),
    path: paths.cart.path,
    label: "cart",
    icon: ShoppingCart,
    requiresAuth: true,
    group: "main",
  },
  {
    // One door into the staff area. The screens behind it are listed in the
    // sidebar there, not here, so the public bar stays about the public site.
    to: paths.dashboard.getHref(),
    path: paths.dashboard.path,
    label: "dashboard",
    icon: LayoutDashboard,
    requiresAuth: true,
    allowedRoles: STAFF_ROLES,
    group: "panel",
  },
];

/** Whether this session may be shown the link. */
export const canSeeLink = (
  link: NavLink,
  isLoggedIn: boolean,
  role: Role | undefined,
) => {
  if (link.requiresAuth && !isLoggedIn) return false;
  if (link.allowedRoles && (!role || !link.allowedRoles.includes(role))) {
    return false;
  }
  return true;
};

/** Whether the current URL sits inside this link's section. */
export const isLinkActive = (link: NavLink, pathname: string) =>
  link.path === "/" ? pathname === "/" : pathname.startsWith(link.path);

/**
 * The dashboard's own navigation, shown in its sidebar.
 *
 * Each screen carries the roles that may open it, matching both the route
 * guard and the server. Managing users is narrower than the rest -- an admin
 * runs the catalogue but cannot change who else is an admin -- so the sidebar
 * hides it from them rather than offering a page that answers "forbidden".
 */
export type DashboardLink = {
  to: string;
  path: string;
  label: string;
  icon: LucideIcon;
  allowedRoles: Role[];
  section: "reports" | "manage";
  /**
   * Active only on its own address, not on the ones beneath it. The overview
   * lives at the dashboard root, and every other screen is beneath that.
   */
  exact?: boolean;
  /** The breadcrumb for a page beneath this one, e.g. one customer. */
  detailLabel?: string;
};

export const DASHBOARD_SECTIONS: Record<DashboardLink["section"], string> = {
  reports: "Reports",
  manage: "Manage",
};

export const DASHBOARD_LINKS: DashboardLink[] = [
  {
    to: paths.dashboard.getHref(),
    path: paths.dashboard.path,
    label: "Sales",
    icon: ChartNoAxesCombined,
    allowedRoles: STAFF_ROLES,
    section: "reports",
    exact: true,
  },
  {
    to: paths.dashboardCustomers.getHref(),
    path: paths.dashboardCustomers.path,
    label: "Customers",
    icon: Contact,
    allowedRoles: STAFF_ROLES,
    section: "reports",
    detailLabel: "Customer",
  },
  {
    to: paths.dashboardProducts.getHref(),
    path: paths.dashboardProducts.path,
    label: "Products",
    icon: Package,
    allowedRoles: STAFF_ROLES,
    section: "manage",
    detailLabel: "Edit product",
  },
  {
    // Any member of staff may write for the journal; each edits only their
    // own posts, which the server enforces and the screen reflects.
    to: paths.dashboardPosts.getHref(),
    path: paths.dashboardPosts.path,
    label: "Posts",
    icon: FilePen,
    allowedRoles: STAFF_ROLES,
    section: "manage",
    detailLabel: "Edit post",
  },
  {
    to: paths.dashboardUsers.getHref(),
    path: paths.dashboardUsers.path,
    label: "Users",
    icon: Users,
    allowedRoles: [ROLES.MODERATOR, ROLES.OWNER],
    section: "manage",
  },
];

export const canSeeDashboardLink = (
  link: DashboardLink,
  role: Role | undefined,
) => Boolean(role && link.allowedRoles.includes(role));

export const isDashboardLinkActive = (link: DashboardLink, pathname: string) =>
  link.exact
    ? pathname === link.path || pathname === `${link.path}/`
    : pathname === link.path || pathname.startsWith(`${link.path}/`);
