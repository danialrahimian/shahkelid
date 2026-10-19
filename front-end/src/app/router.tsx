import * as React from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";

import { AppRoot } from "@/app/routes/app-root";
import { RouteFallback } from "@/components/ui/route-fallback";
import { LEGACY_REDIRECTS, paths } from "@/config/paths";

/**
 * One lazily loaded route module per screen, so a first-time visitor
 * downloads the home page and nothing else: the staff area and checkout
 * arrive only when someone opens them.
 */
const lazyRoute = (loader: () => Promise<{ default: React.ComponentType }>) => {
  const Component = React.lazy(loader);
  return (
    <React.Suspense fallback={<RouteFallback />}>
      <Component />
    </React.Suspense>
  );
};

export const createAppRouter = () =>
  createBrowserRouter([
    {
      // The public shell: navigation, the page frame and the outermost boundary.
      // Pages that need a session send the visitor to sign in themselves.
      element: <AppRoot />,
      children: [
        { path: paths.home.path, element: lazyRoute(() => import("@/app/routes/home")) },
        { path: paths.pricing.path, element: lazyRoute(() => import("@/app/routes/pricing")) },
        { path: paths.posts.path, element: lazyRoute(() => import("@/app/routes/posts")) },
        { path: paths.post.path, element: lazyRoute(() => import("@/app/routes/post")) },
        { path: paths.buy.path, element: lazyRoute(() => import("@/app/routes/buy")) },
        { path: paths.order.path, element: lazyRoute(() => import("@/app/routes/order")) },
        { path: paths.invoice.path, element: lazyRoute(() => import("@/app/routes/invoice")) },
        { path: paths.renew.path, element: lazyRoute(() => import("@/app/routes/renew")) },
        { path: paths.support.path, element: lazyRoute(() => import("@/app/routes/support")) },
        { path: paths.supportTicket.path, element: lazyRoute(() => import("@/app/routes/support-ticket")) },
        { path: paths.account.path, element: lazyRoute(() => import("@/app/routes/account/account")) },
        { path: paths.accountSignIn.path, element: lazyRoute(() => import("@/app/routes/account/sign-in")) },
        {
          path: paths.accountForgotPassword.path,
          element: lazyRoute(() => import("@/app/routes/account/forgot-password")),
        },

        // Replace rather than push, so the back button does not bounce
        // between the old address and the new one.
        ...LEGACY_REDIRECTS.map(({ from, to }) => ({ path: from, element: <Navigate to={to} replace /> })),

        { path: paths.notFound.path, element: lazyRoute(() => import("@/app/routes/not-found")) },
      ],
    },

    {
      // The staff area has its own frame (a sidebar instead of the public
      // bar). It guards itself: a finished sign-in, as staff, or back to
      // sign-in; each page is then offered only with its permission.
      path: paths.staff.path,
      element: lazyRoute(() => import("@/app/routes/staff/layout")),
      children: [
        { index: true, element: lazyRoute(() => import("@/app/routes/staff/index")) },
        { path: paths.staffReports.path, element: lazyRoute(() => import("@/app/routes/staff/reports")) },
        { path: paths.staffCustomers.path, element: lazyRoute(() => import("@/app/routes/staff/customers")) },
        { path: paths.staffCustomer.path, element: lazyRoute(() => import("@/app/routes/staff/customer")) },
        { path: paths.staffSubscriptions.path, element: lazyRoute(() => import("@/app/routes/staff/subscriptions")) },
        { path: paths.staffSubscription.path, element: lazyRoute(() => import("@/app/routes/staff/subscription")) },
        { path: paths.staffTickets.path, element: lazyRoute(() => import("@/app/routes/staff/tickets")) },
        { path: paths.staffTicket.path, element: lazyRoute(() => import("@/app/routes/staff/ticket")) },
        { path: paths.staffPayments.path, element: lazyRoute(() => import("@/app/routes/staff/payments")) },
        { path: paths.staffPosts.path, element: lazyRoute(() => import("@/app/routes/staff/posts")) },
        { path: paths.staffPost.path, element: lazyRoute(() => import("@/app/routes/staff/post")) },
        { path: paths.staffComments.path, element: lazyRoute(() => import("@/app/routes/staff/comments")) },
        { path: paths.staffPlans.path, element: lazyRoute(() => import("@/app/routes/staff/plans")) },
        { path: paths.staffNotifications.path, element: lazyRoute(() => import("@/app/routes/staff/notifications")) },
        { path: paths.staffSettings.path, element: lazyRoute(() => import("@/app/routes/staff/settings")) },
        { path: paths.staffServers.path, element: lazyRoute(() => import("@/app/routes/staff/servers")) },
        { path: paths.staffPanels.path, element: lazyRoute(() => import("@/app/routes/staff/panels")) },
        { path: paths.staffTeam.path, element: lazyRoute(() => import("@/app/routes/staff/team")) },
        { path: paths.staffAudit.path, element: lazyRoute(() => import("@/app/routes/staff/audit")) },
      ],
    },
  ]);

export const AppRouter = () => {
  // Built once. Rebuilding on every render would remount the whole tree.
  const router = React.useMemo(() => createAppRouter(), []);
  return <RouterProvider router={router} />;
};
