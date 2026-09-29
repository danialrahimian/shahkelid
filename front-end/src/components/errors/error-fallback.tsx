import { AlertTriangle, RotateCcw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

import { Button } from "@/components/ui/button";

/**
 * What a broken subtree shows instead of a blank screen.
 *
 * Boundaries are placed per area rather than once around the whole app, so a
 * failure in the invoice list does not take the navigation and the rest of the
 * page with it.
 */
export const ErrorFallback = ({ error, resetErrorBoundary }: FallbackProps) => {
  const shouldReduceMotion = useReducedMotion();
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";

  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="relative isolate mx-auto my-10 flex max-w-lg flex-col items-center gap-4 overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center"
    >
      {/* A slow breathing glow, so the panel feels alive rather than frozen. */}
      {!shouldReduceMotion ? (
        <motion.div
          aria-hidden
          className="absolute -z-10 size-56 rounded-full bg-destructive/20 blur-3xl"
          animate={{ opacity: [0.25, 0.5, 0.25], scale: [1, 1.15, 1] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}

      <motion.div
        initial={{ rotate: -8, scale: 0.8 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="grid size-14 place-items-center rounded-full bg-destructive/15 text-destructive"
      >
        <AlertTriangle className="size-7" />
      </motion.div>

      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Something went wrong here</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>

      <Button
        variant="outline"
        onClick={resetErrorBoundary}
        className="group gap-2"
      >
        <RotateCcw className="size-4 transition-transform duration-300 group-hover:-rotate-180" />
        Try again
      </Button>
    </motion.div>
  );
};

/**
 * Wraps one area of the page. `resetKeys` lets a retry actually retry: change
 * the key (a route param, a filter) and the boundary clears itself.
 */
export const AppErrorBoundary = ({
  children,
  resetKeys,
}: {
  children: React.ReactNode;
  resetKeys?: unknown[];
}) => (
  <ErrorBoundary FallbackComponent={ErrorFallback} resetKeys={resetKeys}>
    {children}
  </ErrorBoundary>
);
