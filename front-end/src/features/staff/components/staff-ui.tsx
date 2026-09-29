import type { SubscriptionStatus } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { formatUsage, fullness } from "../format";

/**
 * The small pieces every staff page is made of, so the pages read the same:
 * a header, a table frame, a status pill, a usage meter, a dialog, a
 * confirmation. Direction-neutral throughout (start/end, never left/right).
 */

export const PageHeader = ({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) => (
  <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div className="max-w-2xl space-y-1">
      <h1 className="text-2xl font-bold text-balance">{title}</h1>
      {description ? <p className="text-sm leading-6 text-muted-foreground">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
  </header>
);

/** A section inside a page, with its own heading and actions. */
export const Section = ({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {actions}
    </div>
    {children}
  </section>
);

/** Wide tables scroll on their own; the page never scrolls sideways. */
export const TableFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="overflow-x-auto rounded-lg border bg-card">
    <table className="w-full min-w-160 text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-start [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_thead]:border-b [&_tbody_tr]:border-b [&_tbody_tr:last-child]:border-0">
      {children}
    </table>
  </div>
);

/** Loading, failure and emptiness, said the same way on every page. */
export const Placeholder = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
    {children}
  </p>
);

/** Each status a colour and a word; the word carries it, the colour helps the eye. */
const STATUS_TONE: Record<SubscriptionStatus, string> = {
  provisioning: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  provisioning_failed: "bg-red-500/10 text-red-700 dark:text-red-300",
  on_hold: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  limited: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  expired: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  disabled: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  deleted: "bg-zinc-500/10 text-zinc-500 line-through",
};

export const StatusBadge = ({ status }: { status: SubscriptionStatus }) => {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_TONE[status],
      )}
    >
      {t(`staff.status.${status}`)}
    </span>
  );
};

/** Used of limit, as a bar and in words. Amber past 80%, red when full. */
export const UsageMeter = ({ used, limit }: { used: number; limit: number | null }) => {
  const share = fullness(used, limit);
  return (
    <div className="min-w-36 space-y-1">
      <p className="text-xs tabular-nums">{formatUsage(used, limit)}</p>
      {limit !== null ? (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <div
            className={cn(
              "h-full rounded-full",
              share >= 1 ? "bg-red-500" : share >= 0.8 ? "bg-amber-500" : "bg-emerald-500",
            )}
            style={{ width: `${share * 100}%` }}
          />
        </div>
      ) : null}
    </div>
  );
};

/** A form in a dialog. Closed by its own Cancel button, so no corner "×" to misplace in RTL. */
export const FormDialog = ({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader className="sm:text-start">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      {children}
    </DialogContent>
  </Dialog>
);

/** A button that asks first, saying exactly what will happen. */
export const ConfirmButton = ({
  label,
  question,
  onConfirm,
  disabled,
  tone = "default",
}: {
  label: string;
  question: string;
  onConfirm: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) => {
  const { t } = useTranslation();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button tone={tone === "danger" ? "danger" : "outline"} disabled={disabled}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader className="sm:text-start">
          <AlertDialogTitle>{label}</AlertDialogTitle>
          <AlertDialogDescription>{question}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-start">
          <AlertDialogAction onClick={onConfirm}>{t("staff.common.confirm")}</AlertDialogAction>
          <AlertDialogCancel>{t("staff.common.cancel")}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const TONES = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border bg-background hover:bg-accent",
  ghost: "hover:bg-accent",
  danger: "border border-destructive/40 text-destructive hover:bg-destructive/10",
};

/** The staff area's button. A plain <button>, so forms submit the way forms do. */
export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { tone?: keyof typeof TONES; busy?: boolean }
>(({ tone = "outline", busy, className, children, disabled, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    disabled={disabled || busy}
    className={cn(
      "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
      TONES[tone],
      className,
    )}
    {...props}
  >
    {busy ? (
      <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
    ) : null}
    {children}
  </button>
));
Button.displayName = "Button";
