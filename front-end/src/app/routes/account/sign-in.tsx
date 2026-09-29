import { Navigate, useSearchParams } from "react-router";

import { useAccountSessionQuery } from "@/api/account";
import { RouteFallback } from "@/components/ui/route-fallback";
import { paths } from "@/config/paths";
import { SignInFlow } from "@/features/account/components/sign-in-flow";
import { safeRedirect } from "@/features/account/sign-in-steps";

/**
 * /account/sign-in. Once the session is signed in, the visitor goes where
 * they were headed (a path on this site only), or to their account.
 */
const SignInRoute = () => {
  const [searchParams] = useSearchParams();
  const { data: session, isLoading } = useAccountSessionQuery();

  if (isLoading) return <RouteFallback />;
  if (session?.status === "signed_in") {
    return (
      <Navigate
        to={safeRedirect(searchParams.get("redirectTo"), paths.account.getHref())}
        replace
      />
    );
  }
  return <SignInFlow />;
};

export default SignInRoute;
