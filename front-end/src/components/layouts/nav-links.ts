import { House, LayoutDashboard, LifeBuoy, Newspaper, Tags, type LucideIcon } from "lucide-react";

import { paths } from "@/config/paths";

/**
 * The public site's navigation, described once and shared by the desktop bar
 * and the mobile menu, so the two cannot drift apart.
 *
 * The staff area has its own sidebar; here there is one door into it, shown
 * to staff only.
 */

export type NavLink = {
  to: string;
  path: string;
  label: "home" | "pricing" | "journal" | "support" | "staff";
  icon: LucideIcon;
  /** Who sees it: everyone, the signed in, or staff. */
  audience: "everyone" | "signed-in" | "staff";
};

export const NAV_LINKS: NavLink[] = [
  { to: paths.home.getHref(), path: paths.home.path, label: "home", icon: House, audience: "everyone" },
  { to: paths.pricing.getHref(), path: paths.pricing.path, label: "pricing", icon: Tags, audience: "everyone" },
  { to: paths.posts.getHref(), path: paths.posts.path, label: "journal", icon: Newspaper, audience: "everyone" },
  { to: paths.support.getHref(), path: paths.support.path, label: "support", icon: LifeBuoy, audience: "signed-in" },
  { to: paths.staff.getHref(), path: paths.staff.path, label: "staff", icon: LayoutDashboard, audience: "staff" },
];

export const visibleLinks = ({ signedIn, isStaff }: { signedIn: boolean; isStaff: boolean }) =>
  NAV_LINKS.filter(
    (link) =>
      link.audience === "everyone" ||
      (link.audience === "signed-in" && signedIn) ||
      (link.audience === "staff" && isStaff),
  );

/** Whether the current URL sits inside this link's section. */
export const isLinkActive = (link: NavLink, pathname: string) =>
  link.path === "/" ? pathname === "/" : pathname.startsWith(link.path);
