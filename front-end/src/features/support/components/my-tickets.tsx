import { CUSTOMER_PRIORITIES, type TicketPriority } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { useShopSubscriptionsQuery } from "@/api/shop";
import { useSupportCategoriesQuery, useSupportOpenTicketMutation, useSupportTicketsQuery } from "@/api/support";
import { PriorityText, ReplyBox, TicketStatusBadge } from "@/components/tickets/ticket-thread";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";
import { formatDateTime, formatNumber } from "@/lib/format";

const selectClass =
  "block h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * A new ticket: what it is about, which service (if any), how urgent, and
 * the message with screenshots. Opens the ticket's page once sent.
 */
const NewTicket = ({ onCancel }: { onCancel: () => void }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: categories } = useSupportCategoriesQuery();
  const { data: services } = useShopSubscriptionsQuery();
  const [open, { isLoading }] = useSupportOpenTicketMutation();
  const [subject, setSubject] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [subscriptionId, setSubscriptionId] = React.useState("");
  const [priority, setPriority] = React.useState<TicketPriority>("normal");
  const [error, setError] = React.useState<string>();
  const id = React.useId();

  const chosenCategory = categoryId || categories?.[0]?.id || "";

  return (
    <section className="space-y-5 rounded-xl border bg-card p-5" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {t("support.new.title")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor={`${id}-subject`} className="text-sm font-medium">
            {t("support.new.subject")}
          </label>
          <input
            id={`${id}-subject`}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={160}
            dir="auto"
            className={selectClass}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-category`} className="text-sm font-medium">
            {t("support.new.category")}
          </label>
          <select
            id={`${id}-category`}
            value={chosenCategory}
            onChange={(event) => setCategoryId(event.target.value)}
            className={selectClass}
          >
            {categories?.map((category) => (
              <option key={category.id} value={category.id}>
                {i18n.language === "en" ? category.nameEn : category.nameFa}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-priority`} className="text-sm font-medium">
            {t("support.new.priority")}
          </label>
          <select
            id={`${id}-priority`}
            value={priority}
            onChange={(event) => setPriority(event.target.value as TicketPriority)}
            className={selectClass}
          >
            {CUSTOMER_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {t(`support.priority.${value}`)}
              </option>
            ))}
          </select>
        </div>
        {services?.length ? (
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor={`${id}-service`} className="text-sm font-medium">
              {t("support.new.service")}
            </label>
            <select
              id={`${id}-service`}
              value={subscriptionId}
              onChange={(event) => setSubscriptionId(event.target.value)}
              className={selectClass}
            >
              <option value="">{t("support.new.noService")}</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.plan.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <ReplyBox
        label={t("support.new.body")}
        submitLabel={t("support.new.submit")}
        busy={isLoading}
        error={error}
        onSend={async (form) => {
          if (subject.trim().length < 3) {
            setError(`${t("support.new.subject")}: ${t("errors.codes.TOO_SHORT")}`);
            return false;
          }
          form.set("subject", subject);
          form.set("categoryId", chosenCategory);
          form.set("priority", priority);
          if (subscriptionId) form.set("subscriptionId", subscriptionId);
          try {
            const ticket = await open(form).unwrap();
            void navigate(paths.supportTicket.getHref(ticket.id));
            return true;
          } catch (caught) {
            setError(errorText(caught));
            return false;
          }
        }}
      />
      <button type="button" onClick={onCancel} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t("support.new.cancel")}
      </button>
    </section>
  );
};

/** The customer's tickets, most recently active first, and the way to open a new one. */
export const MyTickets = () => {
  const { t } = useTranslation();
  const { data: tickets, isLoading } = useSupportTicketsQuery();
  const [writing, setWriting] = React.useState(false);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl space-y-1">
          <h1 className="text-2xl font-bold">{t("support.title")}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{t("support.subtitle")}</p>
        </div>
        {!writing ? (
          <button
            type="button"
            onClick={() => setWriting(true)}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {t("support.new.open")}
          </button>
        ) : null}
      </header>

      {writing ? <NewTicket onCancel={() => setWriting(false)} /> : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : !tickets?.length ? (
        writing ? null : (
          <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            {t("support.empty")}
          </p>
        )
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Link
                to={paths.supportTicket.getHref(ticket.id)}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="min-w-0 space-y-1">
                  <span className="block truncate font-medium" dir="auto">
                    {ticket.subject}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("support.number", { number: formatNumber(ticket.number) })}
                    {ticket.category ? ` · ${ticket.category.name}` : ""} · {formatDateTime(ticket.lastMessageAt)}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-xs">
                  <PriorityText priority={ticket.priority} />
                  <TicketStatusBadge status={ticket.status} viewer="customer" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
