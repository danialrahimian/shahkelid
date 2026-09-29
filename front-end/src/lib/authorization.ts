import * as React from "react";

import { useSession } from "@/lib/use-session";
import type { Role, User } from "@/types/api";

/**
 * Role and permission checks, in one place.
 *
 * The old code scattered role comparisons through the navbar and a route
 * helper, and they disagreed: the panel guard accepted "admin" and "moderator"
 * but not "owner", so an owner was locked out of the panels the server happily
 * let them use. Roles are enumerated here once and both the UI and the route
 * guards read from the same table.
 */

export const ROLES = {
  USER: "user",
  ADMIN: "admin",
  MODERATOR: "moderator",
  OWNER: "owner",
} as const satisfies Record<string, Role>;

/**
 * Who may do what. Mirrors the server: `requireRole("admin","moderator","owner")`
 * on the product endpoints and `requireRole("moderator","owner")` on /mod.
 */
export const POLICIES = {
  "product:manage": (user: User) =>
    user.role === ROLES.ADMIN ||
    user.role === ROLES.MODERATOR ||
    user.role === ROLES.OWNER,

  "user:manage": (user: User) =>
    user.role === ROLES.MODERATOR || user.role === ROLES.OWNER,

  /** Only an owner can change somebody's role, exactly as the API enforces. */
  "user:change-role": (user: User) => user.role === ROLES.OWNER,
} satisfies Record<string, (user: User) => boolean>;

export type Policy = keyof typeof POLICIES;

export const useAuthorization = () => {
  const { user } = useSession();

  const checkAccess = React.useCallback(
    ({ allowedRoles }: { allowedRoles: Role[] }) => {
      if (!user) return false;
      if (allowedRoles.length === 0) return true;
      return allowedRoles.includes(user.role);
    },
    [user],
  );

  const checkPolicy = React.useCallback(
    (policy: Policy) => (user ? POLICIES[policy](user) : false),
    [user],
  );

  return { checkAccess, checkPolicy, role: user?.role, user };
};
