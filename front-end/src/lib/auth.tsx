import * as React from "react";
import { Navigate, useLocation } from "react-router";

import { paths } from "@/config/paths";
import { useSession } from "@/lib/use-session";

/**
 * Waits for the session before deciding, so a signed-in visitor who reloads a
 * private page is not bounced to the sign-in screen while the check is still
 * in flight. Where they were headed travels along in the URL, so signing in
 * returns them to it.
 */
export const ProtectedRoute = ({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) => {
  const { isLoggedIn, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) {
    return <>{fallback ?? null}</>;
  }

  if (!isLoggedIn) {
    return (
      <Navigate
        to={paths.auth.getHref(`${location.pathname}${location.search}`)}
        replace
      />
    );
  }

  return <>{children}</>;
};
