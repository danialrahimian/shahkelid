import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  ticketCategoryInput,
  type TicketCategoryInput,
  type TicketCategoryView,
  type TicketPriority,
  type TicketStatus,
} from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import type { ZodType } from "zod";

import {
  useStaffSaveTicketCategoryMutation,
  useStaffTicketAgentsQuery,
  useStaffTicketCategoriesQuery,
  useStaffTicketQuery,
  useStaffTicketReplyMutation,
  useStaffTicketsQuery,
  useStaffUpdateTicketMutation,
} from "@/api/staff";
import { PriorityText, ReplyBox, TicketStatusBadge, TicketThread } from "@/components/tickets/ticket-thread";
import { Form } from "@/components/ui/form/form";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { showSaveError } from "../form-errors";
import { CheckField, FormActions, NumberField, TextField } from "./fields";
import { Button, FormDialog, PageHeader, Placeholder, Section, StatusBadge, TableFrame } from "./staff-ui";

// ------------------------------------------------------------------- queue

/** The queue's views: what waits for us (the default), what I have, and the rest by status. */
const VIEWS = ["waiting", "mine", "unassigned", "awaiting_customer", "resolved", "closed"] as const;
type View = (typeof VIEWS)[number];

const queryOf = (view: View): { status?: TicketStatus; assignee: "me" | "none" | "all" } => {
  if (view === "waiting") return { status: "awaiting_staff", assignee: "all" };
  if (view === "mine") return { assignee: "me" };
  if (view === "unassigned") return { status: "awaiting_staff", assignee: "none" };
  return { status: view, assignee: "all" };
};

/** How long a ticket has waited, in the largest unit that fits: "۳ ساعت". */
const waited = (since: string, t: ReturnType<typeof useTranslation>["t"]) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(since)) / 60_000));
  if (minutes < 60) return t("staff.tickets.waitedMinutes", { amount: formatNumber(minutes) });
  if (minutes < 48 * 60) return t("staff.tickets.waitedHours", { amount: formatNumber(Math.floor(minutes / 60)) });
  return t("staff.tickets.waitedDays", { amount: formatNumber(Math.floor(minutes / 1440)) });
};

export const TicketsPage = ({ canManageCategories }: { canManageCategories: boolean }) => {
  const { t } = useTranslation();
  const [view, setView] = React.useState<View>("waiting");
  const { data: tickets, isLoading, isError } = useStaffTicketsQuery(queryOf(view), {
    pollingInterval: 60_000,
    skipPollingIfUnfocused: true,
  });

  return (
    <div className="space-y-10">
      <div>
        <PageHeader title={t("staff.tickets.title")} description={t("staff.tickets.description")} />
        <div role="tablist" aria-label={t("staff.tickets.views")} className="mb-4 flex flex-wrap gap-1.5">
          {VIEWS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={view === candidate}
              onClick={() => setView(candidate)}
              className={cn(
                "h-8 rounded-full border px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                view === candidate ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {t(`staff.tickets.view.${candidate}`)}
            </button>
          ))}
        </div>

        {isLoading ? (
          <Placeholder>{t("common.loading")}</Placeholder>
        ) : isError ? (
          <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
        ) : !tickets?.length ? (
          <Placeholder>{t("staff.tickets.empty")}</Placeholder>
        ) : (
          <TableFrame>
            <thead>
              <tr>
                <th>{t("staff.tickets.ticket")}</th>
                <th>{t("staff.tickets.customer")}</th>
                <th>{t("staff.tickets.priority")}</th>
                <th>{t("staff.tickets.status")}</th>
                <th>{t("staff.tickets.assignee")}</th>
                <th>{t("staff.tickets.lastActivity")}</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td className="max-w-80">
                    <Link
                      to={paths.staffTicket.getHref(ticket.id)}
                      className="block truncate font-medium underline-offset-4 hover:underline"
                      dir="auto"
                    >
                      {ticket.subject}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {t("support.number", { number: formatNumber(ticket.number) })}
                      {ticket.category ? ` · ${ticket.category.name}` : ""}
                    </span>
                  </td>
                  <td dir="ltr" className="text-start text-xs">
                    {ticket.customer.email}
                  </td>
                  <td>
                    <PriorityText priority={ticket.priority} />
                  </td>
                  <td>
                    <TicketStatusBadge status={ticket.status} viewer="staff" />
                  </td>
                  <td dir="ltr" className="text-start text-xs text-muted-foreground">
                    {ticket.assignedTo?.email ?? "—"}
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    {ticket.waitingSince ? (
                      <span className="font-medium">{waited(ticket.waitingSince, t)}</span>
                    ) : (
                      <span className="text-muted-foreground">{formatDateTime(ticket.lastMessageAt)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </div>

      {canManageCategories ? <CategoriesSection /> : null}
    </div>
  );
};

// -------------------------------------------------------------- categories

const CategoryDialog = ({ category, onClose }: { category: TicketCategoryView | null; onClose: () => void }) => {
  const { t } = useTranslation();
  const [save, { isLoading }] = useStaffSaveTicketCategoryMutation();
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={category ? t("staff.tickets.categories.edit") : t("staff.tickets.categories.add")}
    >
      <Form<TicketCategoryInput>
        schema={ticketCategoryInput as unknown as ZodType<TicketCategoryInput>}
        options={{
          defaultValues: {
            nameFa: category?.nameFa ?? "",
            nameEn: category?.nameEn ?? "",
            sortOrder: category?.sortOrder ?? 0,
            isActive: category?.isActive ?? true,
          },
        }}
        onSubmit={async (values, methods) => {
          try {
            await save({ id: category?.id, body: values }).unwrap();
            toast.success(t("staff.common.saved"));
            onClose();
          } catch (error) {
            showSaveError(error, methods);
          }
        }}
      >
        {() => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField<TicketCategoryInput> name="nameFa" label={t("staff.tickets.categories.nameFa")} autoFocus />
              <TextField<TicketCategoryInput> name="nameEn" label={t("staff.tickets.categories.nameEn")} dir="ltr" />
            </div>
            <NumberField<TicketCategoryInput> name="sortOrder" label={t("staff.cards.sortOrder")} />
            <CheckField<TicketCategoryInput> name="isActive" label={t("staff.tickets.categories.offered")} />
            <FormActions>
              <Button type="submit" tone="primary" busy={isLoading}>
                {t("staff.common.save")}
              </Button>
              <Button onClick={onClose}>{t("staff.common.cancel")}</Button>
            </FormActions>
          </>
        )}
      </Form>
    </FormDialog>
  );
};

const CategoriesSection = () => {
  const { t } = useTranslation();
  const { data: categories, isLoading } = useStaffTicketCategoriesQuery();
  const [editing, setEditing] = React.useState<TicketCategoryView | "new">();

  return (
    <Section
      title={t("staff.tickets.categories.title")}
      actions={<Button onClick={() => setEditing("new")}>{t("staff.tickets.categories.add")}</Button>}
    >
      {isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {categories?.map((category) => (
            <li key={category.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className={cn(!category.isActive && "text-muted-foreground line-through")}>
                {category.nameFa} <span className="text-muted-foreground">· {category.nameEn}</span>
              </span>
              <Button onClick={() => setEditing(category)}>{t("staff.common.edit")}</Button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <CategoryDialog category={editing === "new" ? null : editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </Section>
  );
};

// ------------------------------------------------------------------ ticket

const selectClass =
  "block h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

/**
 * One ticket, for staff: the whole conversation with the internal notes, the
 * reply box (or a note only staff see), and beside it who the customer is,
 * which service it is about, and who has the ticket.
 */
export const StaffTicketPage = ({ ticketId }: { ticketId: string }) => {
  const { t } = useTranslation();
  const { data: ticket, isLoading, isError } = useStaffTicketQuery(ticketId, {
    pollingInterval: 60_000,
    skipPollingIfUnfocused: true,
  });
  const { data: agents } = useStaffTicketAgentsQuery();
  const [reply, { isLoading: isSending }] = useStaffTicketReplyMutation();
  const [update, { isLoading: isUpdating }] = useStaffUpdateTicketMutation();
  const [error, setError] = React.useState<string>();

  if (isLoading) return <Placeholder>{t("common.loading")}</Placeholder>;
  if (isError || !ticket) return <Placeholder>{t("staff.common.loadFailed")}</Placeholder>;

  const change = (body: Parameters<typeof update>[0]["body"]) =>
    update({ ticketId, body })
      .unwrap()
      .then(() => toast.success(t("staff.common.saved")))
      .catch((caught: unknown) => toast.error(errorText(caught)));

  return (
    <div className="space-y-6">
      <Link to={paths.staffTickets.getHref()} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        {t("staff.tickets.back")}
      </Link>
      <PageHeader
        title={ticket.subject}
        description={`${t("support.number", { number: formatNumber(ticket.number) })}${ticket.category ? ` · ${ticket.category.name}` : ""}`}
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <TicketThread messages={ticket.messages} viewer="staff" />
          <div className="rounded-xl border bg-card p-5">
            <ReplyBox
              label={t("staff.tickets.reply")}
              submitLabel={t("staff.tickets.send")}
              busy={isSending}
              error={error}
              allowInternal
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
            <p className="mt-3 text-xs text-muted-foreground">{t("staff.tickets.replyHint")}</p>
          </div>
        </div>

        <aside className="space-y-6">
          <dl className="space-y-4 rounded-xl border bg-card p-4">
            <Fact label={t("staff.tickets.customer")}>
              <Link
                to={paths.staffCustomer.getHref(ticket.customer.id)}
                dir="ltr"
                className="block text-start break-all underline-offset-4 hover:underline"
              >
                {ticket.customer.email}
              </Link>
            </Fact>
            <Fact label={t("staff.tickets.service")}>
              {ticket.subscription ? (
                <Link
                  to={paths.staffSubscription.getHref(ticket.subscription.id)}
                  className="flex flex-wrap items-center gap-2 underline-offset-4 hover:underline"
                >
                  {ticket.subscription.planName}
                  <StatusBadge status={ticket.subscription.status} />
                </Link>
              ) : (
                <span className="text-muted-foreground">{t("staff.tickets.noService")}</span>
              )}
            </Fact>
            <Fact label={t("staff.tickets.opened")}>{formatDateTime(ticket.createdAt)}</Fact>
          </dl>

          <fieldset disabled={isUpdating} className="space-y-4 rounded-xl border bg-card p-4">
            <legend className="sr-only">{t("staff.tickets.manage")}</legend>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">{t("staff.tickets.status")}</span>
              <select
                value={ticket.status}
                onChange={(event) => void change({ status: event.target.value as TicketStatus })}
                className={selectClass}
              >
                {TICKET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`support.status.staff.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">{t("staff.tickets.priority")}</span>
              <select
                value={ticket.priority}
                onChange={(event) => void change({ priority: event.target.value as TicketPriority })}
                className={selectClass}
              >
                {TICKET_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {t(`support.priority.${priority}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs text-muted-foreground">{t("staff.tickets.assignee")}</span>
              <select
                value={ticket.assignedTo?.id ?? ""}
                onChange={(event) => void change({ assignedToUserId: event.target.value || null })}
                className={selectClass}
              >
                <option value="">{t("staff.tickets.nobody")}</option>
                {agents?.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.email}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        </aside>
      </div>
    </div>
  );
};
