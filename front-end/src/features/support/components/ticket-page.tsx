import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { useSupportCloseTicketMutation, useSupportReplyMutation, useSupportTicketQuery } from "@/api/support";
import { PriorityText, ReplyBox, TicketStatusBadge, TicketThread } from "@/components/tickets/ticket-thread";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";
import { formatNumber } from "@/lib/format";

/**
 * One of the customer's tickets: the conversation (never staff's internal
 * notes: the API leaves them out), and the box to reply. Replying to a
 * resolved ticket reopens it; a closed one says to open a new ticket.
 */
export const TicketPage = ({ ticketId }: { ticketId: string }) => {
  const { t } = useTranslation();
  const { data: ticket, isLoading, isError } = useSupportTicketQuery(ticketId, {
    // A reply may come while the page is open.
    pollingInterval: 60_000,
    skipPollingIfUnfocused: true,
  });
  const [reply, { isLoading: isSending }] = useSupportReplyMutation();
  const [close, { isLoading: isClosing }] = useSupportCloseTicketMutation();
  const [error, setError] = React.useState<string>();

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (isError || !ticket) return <p className="text-sm text-muted-foreground">{t("support.notFound")}</p>;

  return (
    <div className="space-y-6">
      <Link to={paths.support.getHref()} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t("support.back")}
      </Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-balance" dir="auto">
          {ticket.subject}
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{t("support.number", { number: formatNumber(ticket.number) })}</span>
          {ticket.category ? <span>{ticket.category.name}</span> : null}
          {ticket.subscription ? <span>{ticket.subscription.planName}</span> : null}
          <PriorityText priority={ticket.priority} />
          <TicketStatusBadge status={ticket.status} viewer="customer" />
        </p>
      </header>

      <TicketThread messages={ticket.messages} viewer="customer" />

      {ticket.status === "closed" ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {t("support.closedNote")}{" "}
          <Link to={paths.support.getHref()} className="underline underline-offset-4">
            {t("support.new.open")}
          </Link>
        </p>
      ) : (
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <ReplyBox
            label={ticket.status === "resolved" ? t("support.replyReopens") : t("support.reply")}
            submitLabel={t("support.send")}
            busy={isSending}
            error={error}
            onSend={async (form) => {
              try {
                await reply({ ticketId, form }).unwrap();
                setError(undefined);
                return true;
              } catch (caught) {
                setError(errorText(caught));
                return false;
              }
            }}
          />
          <button
            type="button"
            disabled={isClosing}
            onClick={() => void close(ticketId)}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
          >
            {t("support.close")}
          </button>
        </div>
      )}
    </div>
  );
};
