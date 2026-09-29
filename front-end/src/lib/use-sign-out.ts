import { useNavigate } from "react-router";
import { toast } from "sonner";

import { useLogoutMutation } from "@/api/auth";
import { paths } from "@/config/paths";
import { notifyApiError } from "@/lib/api-client";

/**
 * Signing out, from wherever the button happens to be.
 *
 * The navigation bar and the dashboard sidebar both offer it. Each used to be
 * a candidate for its own copy of this, and two copies of "what happens on
 * logout" is how one of them ends up leaving a stale cache behind.
 */
export const useSignOut = () => {
  const navigate = useNavigate();
  const [logout, { isLoading }] = useLogoutMutation();

  const signOut = async () => {
    try {
      await logout().unwrap();
      // Logging out invalidates the session tag, so the cart and invoice
      // caches are dropped with it and nothing of the last visitor lingers.
      toast.success("Signed out");
      navigate(paths.home.getHref());
    } catch (error) {
      notifyApiError(error, "Could not sign you out. Please try again.");
    }
  };

  return { signOut, isSigningOut: isLoading };
};
