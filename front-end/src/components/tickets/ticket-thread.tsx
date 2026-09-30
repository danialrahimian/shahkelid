import {
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENTS_PER_MESSAGE,
  type TicketMessageView,
  type TicketPriority,
  type TicketStatus,
} from "@shah-kelid/contracts";
import { Paperclip } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";

import { ticketFileUrl } from "@/api/support";
import { env } from "@/config/env";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A ticket's conversation and the box to add to it, shared by the customer's
 * page and the staff page. Which side is "mine" is the viewer's: a customer
 * sees their own messages tinted, and staff see support's.
 */

const STATUS_TONE: Record<TicketStatus, string> = {
  awaiting_staff: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  awaiting_customer: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  resolved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  closed: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
};

/** The status as the viewer reads it: "waiting for you" means the customer to a customer, staff to staff. */
export const TicketStatusBadge = ({ status, viewer }: { status: TicketStatus; viewer: "customer" | "staff" }) => {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_TONE[status],
      )}
    >
      {t(`support.status.${viewer}.${status}`)}
    </span>
  );
};

const PRIORITY_TONE: Record<TicketPriority, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground",
  high: "text-amber-700 dark:text-amber-300",
  urgent: "font-semibold text-red-700 dark:text-red-300",
};

export const PriorityText = ({ priority }: { priority: TicketPriority }) => {
  const { t } = useTranslation();
  return <span className={cn("whitespace-nowrap", PRIORITY_TONE[priority])}>{t(`support.priority.${priority}`)}</span>;
};

export const TicketThread = ({
  messages,
  viewer,
}: {
  messages: TicketMessageView[];
  viewer: "customer" | "staff";
}) => {
  const { t } = useTranslation();
  const mine = viewer === "customer" ? "customer" : "staff";

  return (
    <ol className="space-y-4" aria-label={t("support.thread")}>
      {messages.map((message) => {
        const isMine = message.authorKind === mine;
        const author =
          message.authorKind === "customer"
            ? viewer === "customer"
              ? t("support.author.you")
              : t("support.author.customer")
            : message.authorKind === "system"
              ? t("support.author.system")
              : (message.authorName ?? t("support.author.support"));
        return (
          <li
            key={message.id}
            className={cn(
              "max-w-[min(100%,42rem)] rounded-lg border p-4",
              message.isInternal
                ? "border-dashed border-amber-500/50 bg-amber-500/5"
                : message.authorKind === "system"
                  ? "mx-auto bg-muted/40 text-sm text-muted-foreground"
                  : isMine
                    ? "ms-auto bg-primary/5"
                    : "me-auto bg-card",
            )}
          >
            <p className="mb-2 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground" dir="auto">
                {author}
              </span>
              {message.isInternal ? (
                <span className="font-medium text-amber-800 dark:text-amber-300">{t("support.internalNote")}</span>
              ) : null}
              <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
            </p>
            <p className="text-sm leading-7 break-words whitespace-pre-wrap" dir="auto">
              {message.body}
            </p>
            {message.attachments.length ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {message.attachments.map((file) => (
                  <li key={file.id}>
                    <a
                      href={ticketFileUrl(env.API_URL, file.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-md border hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      title={file.name}
                    >
                      <img
                        src={ticketFileUrl(env.API_URL, file.id)}
                        alt={file.name}
                        loading="lazy"
                        className="h-24 w-32 object-cover"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
};

const ACCEPTED = "image/jpeg,image/png,image/webp";

/**
 * The text and screenshots to send. Checks what it can before sending (count,
 * size, type), and leaves the rest to the server's answer, shown in `error`.
 */
export const ReplyBox = ({
  label,
  submitLabel,
  busy,
  error,
  allowInternal = false,
  onSend,
}: {
  label: string;
  submitLabel: string;
  busy: boolean;
  error?: string | undefined;
  allowInternal?: boolean;
  /** Resolves true when sent, so the box empties itself. */
  onSend: (form: FormData) => Promise<boolean>;
}) => {
  const { t } = useTranslation();
  const [body, setBody] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [internal, setInternal] = React.useState(false);
  const [problem, setProblem] = React.useState<string>();
  const [inputKey, setInputKey] = React.useState(0);
  const id = React.useId();

  const pick = (list: FileList | null) => {
    const chosen = Array.from(list ?? []);
    const bad =
      chosen.length > TICKET_ATTACHMENTS_PER_MESSAGE ||
      chosen.some((file) => file.size > TICKET_ATTACHMENT_MAX_BYTES || !ACCEPTED.split(",").includes(file.type));
    setProblem(bad ? t("errors.codes.ATTACHMENT_INVALID") : undefined);
    setFiles(bad ? [] : chosen);
    if (bad) setInputKey((key) => key + 1);
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) {
          setProblem(t("errors.codes.REQUIRED"));
          return;
        }
        const form = new FormData();
        form.set("body", body);
        if (allowInternal) form.set("internal", String(internal));
        for (const file of files) form.append("attachments", file, file.name);
        void onSend(form).then((sent) => {
          if (!sent) return;
          setBody("");
          setFiles([]);
          setInternal(false);
          setProblem(undefined);
          setInputKey((key) => key + 1);
        });
      }}
    >
      <label htmlFor={`${id}-body`} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={`${id}-body`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={5}
        maxLength={10_000}
        dir="auto"
        className={cn(
          "block w-full rounded-md border bg-background px-3 py-2 text-sm leading-7 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
          internal && "border-dashed border-amber-500/60 bg-amber-500/5",
        )}
      />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Paperclip aria-hidden className="size-4" />
          <span className="sr-only">{t("support.attach")}</span>
          <input
            key={inputKey}
            type="file"
            multiple
            accept={ACCEPTED}
            aria-describedby={`${id}-hint`}
            onChange={(event) => pick(event.target.files)}
            className="block max-w-full text-sm file:me-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
        </label>
        {allowInternal ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={internal}
              onChange={(event) => setInternal(event.target.checked)}
              className="size-4 accent-amber-600"
            />
            {t("support.internalToggle")}
          </label>
        ) : null}
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {t("support.attachHint")}
      </p>
      {problem || error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {problem ?? error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
      >
        {busy ? t("common.loading") : internal ? t("support.saveNote") : submitLabel}
      </button>
    </form>
  );
};
