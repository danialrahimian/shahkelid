import * as React from "react";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useParams,
} from "react-router";

import { AppRoot } from "@/app/routes/app-root";
import { paths } from "@/config/paths";
import { ProtectedRoute } from "@/lib/auth";
import { RoleRoute } from "@/lib/role-route";
import { ROLES } from "@/lib/authorization";
import { RouteFallback } from "@/components/ui/route-fallback";

/**
 * One lazily loaded route module per screen.
 *
 * Splitting at the route level means a first-time visitor downloads the home
 * page and nothing else: the admin panel, the moderator panel and the checkout
 * flow arrive only when someone actually opens them. Previously every page was
 * in the initial bundle.
 */
const lazyRoute = (
  loader: () => Promise<{ default: React.ComponentType }>,
) => {
  const Component = React.lazy(loader);
  return (
    <React.Suspense fallback={<RouteFallback />}>
      <Component />
    </React.Suspense>
  );
};

/** Everybody who may enter the dashboard at all. */
const STAFF_ROLES = [ROLES.ADMIN, ROLES.MODERATOR, ROLES.OWNER];

/**
 * A redirect that carries a route parameter across, for the old addresses
 * that named one item: `/admin/:productId` has to land on that same product.
 */
const RedirectWithParam = ({
  param,
  to,
}: {
  param: string;
  to: (value: string) => string;
}) => {
  const params = useParams();
  const value = params[param];

  return (
    <Navigate to={value ? to(value) : paths.dashboard.getHref()} replace />
  );
};

export const createAppRouter = () =>
  createBrowserRouter([
    {
      // The shell: navigation, the page frame and the outermost boundary.
      element: <AppRoot />,
      children: [
        {
          path: paths.home.path,
          element: lazyRoute(() => import("@/app/routes/home")),
        },
        {
          path: paths.pricing.path,
          element: lazyRoute(() => import("@/app/routes/pricing")),
        },
        {
          // The catalogue moved. Replace rather than push, so the back button
          // does not bounce between the old address and the new one.
          path: paths.productsLegacy.path,
          element: <Navigate to={paths.pricing.getHref()} replace />,
        },
        {
          path: paths.posts.path,
          element: lazyRoute(() => import("@/app/routes/posts")),
        },
        {
          // Reading is open, so this sits with the public routes.
          path: paths.post.path,
          element: lazyRoute(() => import("@/app/routes/post")),
        },
        {
          path: paths.buy.path,
          element: lazyRoute(() => import("@/app/routes/buy")),
        },
        {
          path: paths.order.path,
          element: lazyRoute(() => import("@/app/routes/order")),
        },
        // The new account screens, on /api/v1. They guard themselves: each
        // follows the session the server reports, step by step.
        {
          path: paths.account.path,
          element: lazyRoute(() => import("@/app/routes/account/account")),
        },
        {
          path: paths.accountSignIn.path,
          element: lazyRoute(() => import("@/app/routes/account/sign-in")),
        },
        {
          path: paths.accountForgotPassword.path,
          element: lazyRoute(() => import("@/app/routes/account/forgot-password")),
        },
        {
          path: paths.auth.path,
          element: lazyRoute(() => import("@/app/routes/auth/auth")),
        },
        {
          path: paths.resetPassword.path,
          element: lazyRoute(() => import("@/app/routes/auth/reset-password")),
        },
        {
          path: paths.resetPasswordToken.path,
          element: lazyRoute(() => import("@/app/routes/auth/reset-password")),
        },

        // Everything below needs a session. The guard waits for the session
        // check to finish, so a reload on a private page does not bounce a
        // signed-in visitor to the sign-in screen.
        {
          // The old cart and checkout: buying is one plan at a time now.
          path: paths.cart.path,
          element: <Navigate to={paths.pricing.getHref()} replace />,
        },
        {
          // The old cart and checkout: buying is one plan at a time now.
          path: paths.checkout.path,
          element: <Navigate to={paths.pricing.getHref()} replace />,
        },
        {
          // The old cart and checkout: buying is one plan at a time now.
          path: paths.verifyPayment.path,
          element: <Navigate to={paths.pricing.getHref()} replace />,
        },
        {
          path: paths.profile.path,
          element: (
            <ProtectedRoute fallback={<RouteFallback />}>
              {lazyRoute(() => import("@/app/routes/profile"))}
            </ProtectedRoute>
          ),
        },
        {
          path: paths.invoices.path,
          element: (
            <ProtectedRoute fallback={<RouteFallback />}>
              {lazyRoute(() => import("@/app/routes/invoices"))}
            </ProtectedRoute>
          ),
        },

        // The panels moved into the dashboard. Replace rather than push, so
        // the back button does not bounce between the old address and the
        // new one.
        {
          path: paths.adminLegacy.path,
          element: <Navigate to={paths.dashboardProducts.getHref()} replace />,
        },
        {
          path: paths.adminProductLegacy.path,
          element: (
            <RedirectWithParam
              param="productId"
              to={paths.dashboardProduct.getHref}
            />
          ),
        },
        {
          path: paths.moderatorLegacy.path,
          element: <Navigate to={paths.dashboardUsers.getHref()} replace />,
        },
        {
          path: paths.crmLegacy.path,
          element: <Navigate to={paths.dashboardCustomers.getHref()} replace />,
        },
        {
          path: paths.crmCustomerLegacy.path,
          element: (
            <RedirectWithParam
              param="userId"
              to={paths.dashboardCustomer.getHref}
            />
          ),
        },

        {
          path: paths.notFound.path,
          element: lazyRoute(() => import("@/app/routes/not-found")),
        },
      ],
    },

    {
      // The new staff area (M3 onwards), on the new accounts and /api/v1.
      // It guards itself: a finished sign-in, as staff, or back to sign-in.
      path: paths.staff.path,
      element: lazyRoute(() => import("@/app/routes/staff/layout")),
      children: [
        { index: true, element: lazyRoute(() => import("@/app/routes/staff/index")) },
        { path: paths.staffCustomers.path, element: lazyRoute(() => import("@/app/routes/staff/customers")) },
        { path: paths.staffCustomer.path, element: lazyRoute(() => import("@/app/routes/staff/customer")) },
        {
          path: paths.staffSubscriptions.path,
          element: lazyRoute(() => import("@/app/routes/staff/subscriptions")),
        },
        {
          path: paths.staffSubscription.path,
          element: lazyRoute(() => import("@/app/routes/staff/subscription")),
        },
        { path: paths.staffPayments.path, element: lazyRoute(() => import("@/app/routes/staff/payments")) },
        { path: paths.staffPlans.path, element: lazyRoute(() => import("@/app/routes/staff/plans")) },
        { path: paths.staffServers.path, element: lazyRoute(() => import("@/app/routes/staff/servers")) },
        { path: paths.staffPanels.path, element: lazyRoute(() => import("@/app/routes/staff/panels")) },
      ],
    },

    {
      // The staff area has its own frame -- a sidebar instead of the public
      // navigation bar -- so it sits beside the public shell rather than
      // inside it. One guard covers every screen in it, mirroring the
      // server's own role checks so the UI never offers a door the API will
      // slam.
      path: paths.dashboard.path,
      element: (
        <RoleRoute allowedRoles={STAFF_ROLES}>
          {lazyRoute(() => import("@/app/routes/dashboard/layout"))}
        </RoleRoute>
      ),
      children: [
        {
          index: true,
          element: lazyRoute(() => import("@/app/routes/dashboard/sales")),
        },
        {
          path: paths.dashboardCustomers.path,
          element: lazyRoute(() => import("@/app/routes/dashboard/customers")),
        },
        {
          path: paths.dashboardCustomer.path,
          element: lazyRoute(() => import("@/app/routes/dashboard/customer")),
        },
        {
          path: paths.dashboardProducts.path,
          element: lazyRoute(() => import("@/app/routes/dashboard/products")),
        },
        {
          // The same screen: the parameter switches it from adding to editing.
          path: paths.dashboardProduct.path,
          element: lazyRoute(() => import("@/app/routes/dashboard/products")),
        },
        {
          path: paths.dashboardPosts.path,
          element: lazyRoute(() => import("@/app/routes/dashboard/posts")),
        },
        {
          // The same screen: the parameter switches it from writing to editing.
          path: paths.dashboardPost.path,
          element: lazyRoute(() => import("@/app/routes/dashboard/posts")),
        },
        {
          // Narrower than the rest. An admin runs the catalogue but cannot
          // change who else is an admin.
          path: paths.dashboardUsers.path,
          element: (
            <RoleRoute allowedRoles={[ROLES.MODERATOR, ROLES.OWNER]}>
              {lazyRoute(() => import("@/app/routes/dashboard/users"))}
            </RoleRoute>
          ),
        },
      ],
    },
  ]);

export const AppRouter = () => {
  // Built once. Rebuilding on every render would remount the whole tree.
  const router = React.useMemo(() => createAppRouter(), []);
  return <RouterProvider router={router} />;
};
