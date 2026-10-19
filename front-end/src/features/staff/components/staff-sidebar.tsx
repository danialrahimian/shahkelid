import type { AccountView } from "@shah-kelid/contracts";
import { House, KeyRound, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { paths } from "@/config/paths";
import { directionOf } from "@/lib/i18n";

import { STAFF_GROUPS } from "../staff-links";

/**
 * The staff area's navigation. Only what the signed-in person's permissions
 * open is listed: a link that could only end on "forbidden" is not offered.
 * The server checks the same permissions on every request regardless.
 */

export const StaffSidebar = ({ account }: { account: AccountView }) => {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();

  return (
    <Sidebar side={directionOf(i18n.language) === "rtl" ? "right" : "left"} collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to={paths.staff.getHref()}>
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <KeyRound className="size-4" aria-hidden />
                </span>
                <span className="truncate font-semibold">{t("staff.title")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {STAFF_GROUPS.map((group) => {
          const links = group.links.filter((link) => account.permissions.includes(link.permission));
          if (links.length === 0) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{t(`staff.nav.${group.label}`)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {links.map((link) => {
                    const Icon = link.icon;
                    const label = t(`staff.nav.${link.label}`);
                    return (
                      <SidebarMenuItem key={link.to}>
                        <SidebarMenuButton asChild isActive={pathname.startsWith(link.to)} tooltip={label}>
                          <Link to={link.to}>
                            <Icon aria-hidden />
                            <span>{label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("staff.nav.account")}>
              <Link to={paths.account.getHref()}>
                <UserRound aria-hidden />
                <span className="truncate" dir="ltr">
                  {account.email ?? account.username}
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("staff.nav.store")}>
              <Link to={paths.home.getHref()}>
                <House aria-hidden />
                <span>{t("staff.nav.store")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
};
