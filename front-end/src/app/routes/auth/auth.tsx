import { KeyRound } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import { paths } from "@/config/paths";
import { LoginForm } from "@/features/auth/components/login-form";
import { RegisterForm } from "@/features/auth/components/register-form";
import { useSession } from "@/lib/use-session";
import { cn } from "@/lib/utils";

type Mode = "login" | "register";

const TABS: { id: Mode; label: string }[] = [
  { id: "login", label: "Sign in" },
  { id: "register", label: "Create account" },
];

/**
 * The sign-in and sign-up screen.
 *
 * Signing in redirects to wherever the visitor was headed, which the route
 * guards record in a `redirectTo` parameter. Previously every sign-in landed
 * on the home page, so being bounced off a protected page meant finding your
 * way back to it by hand.
 */
const AuthRoute = () => {
  const [mode, setMode] = React.useState<Mode>("login");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isLoggedIn, isLoading } = useSession();

  const redirectTo = searchParams.get("redirectTo");
  const destination =
    redirectTo && redirectTo.startsWith("/")
      ? redirectTo
      : paths.home.getHref();

  // Somebody already signed in has no business on this screen.
  if (!isLoading && isLoggedIn) {
    return <Navigate to={destination} replace />;
  }

  const handleSuccess = () => navigate(destination, { replace: true });

  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <motion.div
          animate={{ x: [0, 40, 0], y: [0, -30, 0], scale: [1, 1.15, 1] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-10 left-1/4 size-72 rounded-full bg-foreground/10 blur-3xl"
        />
        <motion.div
          animate={{ x: [0, -50, 0], y: [0, 40, 0], scale: [1, 1.2, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute right-1/4 bottom-0 size-80 rounded-full bg-primary/10 blur-3xl"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-6 flex flex-col items-center gap-3 text-center"
      >
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            type: "spring",
            stiffness: 260,
            damping: 16,
            delay: 0.1,
          }}
          whileHover={{ rotate: -12, scale: 1.08 }}
          className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <KeyRound className="size-6" />
        </motion.div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome to Shah Kelid
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in, or create an account to get your key.
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
        className="relative w-full max-w-100 overflow-hidden rounded-lg border bg-card"
      >
        <motion.span
          aria-hidden
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="absolute inset-x-0 top-0 h-0.5 origin-left bg-foreground/40"
        />

        <div className="flex gap-1 border-b border-border p-1.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
              aria-pressed={mode === tab.id}
              className={cn(
                "relative flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                mode === tab.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {/* One pill that slides between tabs, rather than two that fade. */}
              {mode === tab.id ? (
                <motion.span
                  layoutId="auth-tab"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  className="absolute inset-0 -z-10 rounded-md bg-muted"
                />
              ) : null}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* The two forms are different heights, so the container animates to
              the new one rather than snapping. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, x: mode === "login" ? -18 : 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: mode === "login" ? 18 : -18 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              {mode === "login" ? (
                <LoginForm onSuccess={handleSuccess} />
              ) : (
                <RegisterForm onSuccess={handleSuccess} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

export default AuthRoute;
