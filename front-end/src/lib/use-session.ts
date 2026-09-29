import * as React from "react";

import { useGetSessionQuery } from "@/api/auth";
import type { User } from "@/types/api";

/**
 * The signed-in user, read from the server rather than remembered locally.
 *
 * `GET /login-status` is the single source of truth and it is cached like any
 * other query, so a reload restores the session without the app having to
 * mirror it in its own store. The previous version copied the login response
 * into Redux, which meant a page refresh lost the username, email and cart,
 * and a role changed by a moderator went unnoticed until the next sign-in.
 */
export const useSession = () => {
  const { data, isLoading, isFetching, refetch } = useGetSessionQuery();

  const user: User | null = React.useMemo(() => {
    if (!data?.isLoggedIn) return null;

    // Everything but the flag is the user record itself.
    const { isLoggedIn, ...rest } = data;
    void isLoggedIn;
    return rest;
  }, [data]);

  return {
    user,
    isLoggedIn: Boolean(user),
    isLoading,
    isFetching,
    refetch,
  };
};
