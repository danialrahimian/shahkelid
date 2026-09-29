import { KeyRound } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The frame every account screen sits in: the key mark, a title, a line of
 * explanation and the step itself.
 */
export const AccountCard = ({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className="flex min-h-[70vh] flex-col items-center justify-center py-10">
    <section
      className={cn("w-full max-w-100 rounded-lg border bg-card p-6 shadow-xs", className)}
      aria-labelledby="account-card-title"
    >
      <header className="mb-6 flex flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="size-6" aria-hidden />
        </span>
        <h1 id="account-card-title" className="text-xl font-bold text-balance">
          {title}
        </h1>
        {description ? (
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  </div>
);

/** The primary button of a step, with its busy state. */
export const SubmitButton = ({
  busy,
  label,
  busyLabel,
  disabled,
}: {
  busy: boolean;
  label: string;
  busyLabel: string;
  disabled?: boolean;
}) => (
  <button
    type="submit"
    disabled={busy || disabled}
    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
  >
    {busy ? (
      <span
        aria-hidden
        className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
    ) : null}
    {busy ? busyLabel : label}
  </button>
);

/** A quiet text button for the way out of a step ("use another email"). */
export const TextButton = ({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline focus-visible:outline-none disabled:opacity-50"
  >
    {children}
  </button>
);
