import { ShieldX } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { Link, Navigate, useLocation } from "react-router";

import { RouteFallback } from "@/components/ui/route-fallback";
import { Button } from "@/components/ui/button";
import { paths } from "@/config/paths";
import { useSession } from "@/lib/use-session";
import { useAuthorization } from "@/lib/authorization";
import type { Role } from "@/types/api";

/**
 * Shown when someone signed in reaches a page their role does not cover.
 *
 * Deliberately distinct from the sign-in redirect: bouncing an already
 * authenticated person to a login form tells them nothing about why.
 */
const Forbidden = () => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    className="mx-auto flex max-w-md flex-col items-center gap-5 py-24 text-center"
  >
    <motion.div
      initial={{ scale: 0.7, rotate: -12 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 18 }}
      className="grid size-16 place-items-center rounded-2xl bg-destructive/10 text-destructive"
    >
      <ShieldX className="size-8" />
    </motion.div>

    <div className="space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">
        You do not have access to this page
      </h1>
      <p className="text-sm text-muted-foreground">
        Your account is signed in, but this area needs a different role. Ask an
        owner if you think that is wrong.
      </p>
    </div>

    <Button asChild variant="outline">
      <Link to={paths.home.getHref()}>Back to the store</Link>
    </Button>
  </motion.div>
);

/**
 * A route open only to the listed roles.
 *
 * An anonymous visitor is sent to sign in with a return address; a signed-in
 * visitor without the role is told so.
 */
export const RoleRoute = ({
  allowedRoles,
  children,
}: {
  allowedRoles: Role[];
  children: React.ReactNode;
}) => {
  const { isLoggedIn, isLoading } = useSession();
  const { checkAccess } = useAuthorization();
  const location = useLocation();

  if (isLoading) {
    return <RouteFallback />;
  }

  if (!isLoggedIn) {
    return (
      <Navigate
        to={paths.auth.getHref(`${location.pathname}${location.search}`)}
        replace
      />
    );
  }

  if (!checkAccess({ allowedRoles })) {
    return <Forbidden />;
  }

  return <>{children}</>;
};
