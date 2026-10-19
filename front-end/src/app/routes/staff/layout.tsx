import { Navigate, Outlet, useLocation } from "react-router";
import { useTranslation } from "react-i18next";

import { useAccountSessionQuery } from "@/api/account";
import { AppErrorBoundary } from "@/components/errors/error-fallback";
import { ModeToggle } from "@/components/layouts/mode-toggle";
import { RouteFallback } from "@/components/ui/route-fallback";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { paths } from "@/config/paths";
import { SetupBanner } from "@/features/staff/components/setup-banner";
import { StaffSidebar } from "@/features/staff/components/staff-sidebar";

/**
 * /staff: the new staff area, on the new accounts.
 *
 * Only a finished sign-in gets in: someone signed out, or with the
 * authenticator step still to come or not yet set up, goes to the sign-in
 * page, which picks up at that step and brings them back here. The API
 * refuses the same people on every request; this only saves them the trip.
 */
const StaffLayout = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { data: session, isLoading } = useAccountSessionQuery();

  if (isLoading) return <RouteFallback />;
  if (session?.status !== "signed_in") {
    return <Navigate to={paths.accountSignIn.getHref(pathname)} replace />;
  }
  if (!session.account.isStaff) {
    return <p className="p-10 text-center text-muted-foreground">{t("staff.guard")}</p>;
  }

  return (
    <SidebarProvider>
      <StaffSidebar account={session.account} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger />
          <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
          <span className="text-sm font-medium">{t("staff.title")}</span>
          <div className="ms-auto">
            <ModeToggle />
          </div>
        </header>
        <AppErrorBoundary resetKeys={[pathname]}>
          <div className="min-w-0 flex-1 p-4 md:p-6">
            {session.account.permissions.includes("settings:manage") ? <SetupBanner /> : null}
            <Outlet context={session.account} />
          </div>
        </AppErrorBoundary>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default StaffLayout;
