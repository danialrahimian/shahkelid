import {
  ChevronsUpDown,
  CreditCard,
  LogOut,
  ShieldCheck,
  Store,
  UserRound,
} from "lucide-react";
import * as React from "react";
import { Link, useLocation } from "react-router";

import {
  canSeeDashboardLink,
  DASHBOARD_LINKS,
  DASHBOARD_SECTIONS,
  isDashboardLinkActive,
  type DashboardLink,
} from "@/components/layouts/nav-links";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { paths } from "@/config/paths";
import { useSession } from "@/lib/use-session";
import { useSignOut } from "@/lib/use-sign-out";
import { assetUrl } from "@/utils/asset-url";

/**
 * The dashboard's sidebar.
 *
 * Built from the vendored shadcn primitives rather than by hand, so it gets
 * their behaviour for free: it collapses to icons on desktop (with tooltips
 * standing in for the labels), becomes a sheet on a phone, remembers whether
 * it was open, and toggles with Ctrl/Cmd+B.
 *
 * Only the screens the signed-in role may open are listed. An admin never
 * sees "Users", because following it would only ever end on "forbidden".
 */

/** The signed-in person, and the things they can do about their own account. */
const SidebarUser = () => {
  const { user } = useSession();
  const { isMobile } = useSidebar();
  const { signOut, isSigningOut } = useSignOut();

  const name = user?.displayName || user?.username || "";
  const avatar = assetUrl(user?.avatar);
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                {avatar ? <AvatarImage src={avatar} alt="" /> : null}
                <AvatarFallback className="rounded-lg text-xs">
                  {initials || <UserRound className="size-4" />}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground capitalize">
                  {user?.role}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.email}
              </p>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link to={paths.profile.getHref()}>
                  <UserRound />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link to={paths.invoices.getHref()}>
                  <CreditCard />
                  Invoices
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="cursor-pointer"
              disabled={isSigningOut}
              onSelect={(event) => {
                event.preventDefault();
                void signOut();
              }}
            >
              {isSigningOut ? <Spinner /> : <LogOut />}
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};

const NavItem = ({
  link,
  isActive,
}: {
  link: DashboardLink;
  isActive: boolean;
}) => (
  <SidebarMenuItem>
    {/* The tooltip only shows while the sidebar is collapsed to icons, where
        it is the only place the label still appears. */}
    <SidebarMenuButton asChild isActive={isActive} tooltip={link.label}>
      <Link to={link.to} aria-current={isActive ? "page" : undefined}>
        <link.icon />
        <span>{link.label}</span>
      </Link>
    </SidebarMenuButton>
  </SidebarMenuItem>
);

export const AppSidebar = (props: React.ComponentProps<typeof Sidebar>) => {
  const { pathname } = useLocation();
  const { user } = useSession();
  const { isMobile, setOpenMobile } = useSidebar();

  // On a phone the sidebar is a sheet over the page. Following a link inside
  // it should reveal the page it led to, not leave the sheet covering it.
  React.useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);

  const visible = DASHBOARD_LINKS.filter((link) =>
    canSeeDashboardLink(link, user?.role),
  );

  const sections = (
    Object.keys(DASHBOARD_SECTIONS) as DashboardLink["section"][]
  )
    .map((section) => ({
      section,
      label: DASHBOARD_SECTIONS[section],
      links: visible.filter((link) => link.section === section),
    }))
    .filter((group) => group.links.length > 0);

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Dashboard">
              <Link to={paths.dashboard.getHref()}>
                <span className="grid aspect-square size-8 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <ShieldCheck className="size-4" />
                </span>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Shah Kelid</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Dashboard
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {sections.map((group) => (
          <SidebarGroup key={group.section}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.links.map((link) => (
                  <NavItem
                    key={link.path}
                    link={link}
                    isActive={isDashboardLinkActive(link, pathname)}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {/* Pushed to the bottom of the scroll area, away from the work. */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="sm" tooltip="Back to the store">
                  <Link to={paths.home.getHref()}>
                    <Store />
                    <span>Back to the store</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
};
