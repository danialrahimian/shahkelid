import { Inbox, ServerCrash } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * The three states every data-backed screen needs: loading, empty, failed.
 *
 * They were written from scratch on each page before, so a skeleton on one
 * screen looked nothing like the skeleton on the next. Sharing them keeps the
 * motion and the spacing identical everywhere.
 */

/** A shimmering placeholder card, sized by the caller. */
export const LoadingCard = ({
  className,
  lines = 3,
}: {
  className?: string;
  lines?: number;
}) => (
  <div
    className={cn(
      "space-y-3 rounded-2xl border border-border/60 bg-card/40 p-5",
      className,
    )}
  >
    <Skeleton className="h-32 w-full rounded-xl" />
    {Array.from({ length: lines }).map((_, index) => (
      <Skeleton
        key={index}
        className="h-3.5"
        style={{ width: `${90 - index * 18}%` }}
      />
    ))}
  </div>
);

/** A grid of placeholders, staggered so they cascade rather than blink in. */
export const LoadingGrid = ({
  count = 3,
  className,
  cardClassName,
}: {
  count?: number;
  className?: string;
  cardClassName?: string;
}) => (
  <div className={cn("grid gap-6 sm:grid-cols-2 lg:grid-cols-3", className)}>
    {Array.from({ length: count }).map((_, index) => (
      <motion.div
        key={index}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: index * 0.07, ease: "easeOut" }}
      >
        <LoadingCard className={cardClassName} />
      </motion.div>
    ))}
  </div>
);

/** Nothing to show, and that is fine. */
export const EmptyState = ({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="relative isolate flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border/70 px-6 py-16 text-center"
    >
      <motion.div
        aria-hidden
        // A gentle float, enough to signal the page is not stuck.
        animate={shouldReduceMotion ? undefined : { y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="grid size-16 place-items-center rounded-2xl bg-muted/60 text-muted-foreground"
      >
        {icon ?? <Inbox className="size-8" />}
      </motion.div>

      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>

      {action}
    </motion.div>
  );
};

/** A request failed. Shows the server's own message, with a way to retry. */
export const ErrorState = ({
  error,
  onRetry,
  title = "We could not load this",
}: {
  error?: unknown;
  onRetry?: () => void;
  title?: string;
}) => {
  const { message } = normalizeError(error);

  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex flex-col items-center gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-14 text-center"
    >
      <motion.div
        initial={{ rotate: -10 }}
        animate={{ rotate: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 16 }}
        className="grid size-14 place-items-center rounded-full bg-destructive/15 text-destructive"
      >
        <ServerCrash className="size-7" />
      </motion.div>

      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {message}
        </p>
      </div>

      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </motion.div>
  );
};
