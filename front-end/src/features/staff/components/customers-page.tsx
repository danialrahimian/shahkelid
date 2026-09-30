import {
  createSubscriptionInput,
  CUSTOMER_SORTS,
  CUSTOMER_STAGES,
  type CreateSubscriptionInput,
  type CustomerDetail,
  type CustomerSort,
  type CustomerStage,
} from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  CUSTOMERS_PAGE,
  useStaffAddCustomerNoteMutation,
  useStaffCreateSubscriptionMutation,
  useStaffCustomerQuery,
  useStaffCustomerSegmentsQuery,
  useStaffCustomersQuery,
  useStaffDeleteCustomerMutation,
  useStaffDeleteCustomerNoteMutation,
  useStaffFulfilOrderMutation,
  useStaffOrdersQuery,
  useStaffPlansQuery,
  useStaffSetCustomerStageMutation,
  useStaffSetCustomerStatusMutation,
  useStaffSetCustomerTagsMutation,
} from "@/api/staff";
import { Form } from "@/components/ui/form/form";
import { Input } from "@/components/ui/input";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";
import { formatDate, formatDateTime, formatGb, formatNumber, formatToman } from "@/lib/format";
import { cn } from "@/lib/utils";

import { showSaveError } from "../form-errors";
import { FormActions, SelectField } from "./fields";
import { NotificationLog } from "./notification-log";
import { Button, ConfirmButton, FormDialog, PageHeader, Placeholder, Section, TableFrame } from "./staff-ui";
import { SubscriptionTable } from "./subscription-table";

/** Waits for typing to pause before searching, so each keystroke is not a request. */
const useSettled = (value: string, ms = 300) => {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
};

const STAGE_TONE: Record<CustomerStage, string> = {
  lead: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "at-risk": "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  churned: "bg-red-500/10 text-red-700 dark:text-red-300",
  vip: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  blocked: "bg-zinc-800/10 text-zinc-500 line-through",
};

/** The stage in a word and a colour; hovering says the rule behind it. */
const StageBadge = ({ stage }: { stage: CustomerStage }) => {
  const { t } = useTranslation();
  return (
    <span
      title={t(`staff.customers.stageHints.${stage}`)}
      className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", STAGE_TONE[stage])}
    >
      {t(`staff.customers.stages.${stage}`)}
    </span>
  );
};

const selectClass =
  "h-10 rounded-md border bg-background px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * The customer book: how many stand at each stage (click one to filter),
 * then the list, filtered by stage, tag or a search, sorted three ways.
 */
export const CustomersPage = () => {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState("");
  const settled = useSettled(search.trim());
  const [stage, setStage] = React.useState<CustomerStage | "">("");
  const [tagId, setTagId] = React.useState("");
  const [sort, setSort] = React.useState<CustomerSort>("joined");
  // The page belongs to the filter it was chosen under: a new filter starts
  // from the first page without an effect to reset it.
  const filterKey = JSON.stringify([settled, stage, tagId, sort]);
  const [paging, setPaging] = React.useState({ key: filterKey, offset: 0 });
  const offset = paging.key === filterKey ? paging.offset : 0;
  const setOffset = (next: number) => setPaging({ key: filterKey, offset: next });
  const customers = useStaffCustomersQuery({
    search: settled || undefined,
    stage: stage || undefined,
    tagId: tagId || undefined,
    sort,
    offset,
  });
  const { data: segments } = useStaffCustomerSegmentsQuery();

  return (
    <>
      <PageHeader title={t("staff.customers.title")} description={t("staff.customers.description")} />

      {segments ? (
        <ul className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {CUSTOMER_STAGES.map((candidate) => {
            const row = segments.stages.find((entry) => entry.stage === candidate);
            return (
              <li key={candidate}>
                <button
                  type="button"
                  aria-pressed={stage === candidate}
                  onClick={() => setStage(stage === candidate ? "" : candidate)}
                  className={cn(
                    "w-full space-y-1.5 rounded-lg border bg-card p-3 text-start hover:border-foreground/30 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                    stage === candidate && "border-primary",
                  )}
                >
                  <StageBadge stage={candidate} />
                  <p className="text-xl font-semibold tabular-nums">{formatNumber(row?.customers ?? 0)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{formatToman(row?.valueToman ?? 0)}</p>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label htmlFor="customer-search" className="sr-only">
          {t("staff.customers.searchPlaceholder")}
        </label>
        <Input
          id="customer-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("staff.customers.searchPlaceholder")}
          className="h-10 max-w-xs"
        />
        <select
          aria-label={t("staff.customers.stage")}
          value={stage}
          onChange={(event) => setStage(event.target.value as CustomerStage | "")}
          className={selectClass}
        >
          <option value="">{t("staff.customers.allStages")}</option>
          {CUSTOMER_STAGES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {t(`staff.customers.stages.${candidate}`)}
            </option>
          ))}
        </select>
        {segments?.tags.length ? (
          <select
            aria-label={t("staff.customers.tags")}
            value={tagId}
            onChange={(event) => setTagId(event.target.value)}
            className={selectClass}
          >
            <option value="">{t("staff.customers.allTags")}</option>
            {segments.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name} ({formatNumber(tag.customers)})
              </option>
            ))}
          </select>
        ) : null}
        <select
          aria-label={t("staff.customers.sort")}
          value={sort}
          onChange={(event) => setSort(event.target.value as CustomerSort)}
          className={selectClass}
        >
          {CUSTOMER_SORTS.map((candidate) => (
            <option key={candidate} value={candidate}>
              {t(`staff.customers.sorts.${candidate}`)}
            </option>
          ))}
        </select>
        {customers.data ? (
          <p className="text-sm text-muted-foreground">
            {t("staff.customers.segment", {
              amount: formatNumber(customers.data.total),
              value: formatToman(customers.data.segmentValueToman),
            })}
          </p>
        ) : null}
      </div>

      {customers.isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : customers.isError ? (
        <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
      ) : !customers.data?.customers.length ? (
        <Placeholder>{t("staff.customers.noResults")}</Placeholder>
      ) : (
        <>
          <TableFrame>
            <thead>
              <tr>
                <th>{t("staff.customers.email")}</th>
                <th>{t("staff.customers.stage")}</th>
                <th>{t("staff.customers.value")}</th>
                <th>{t("staff.customers.live")}</th>
                <th>{t("staff.customers.tags")}</th>
                <th>{t("staff.customers.joined")}</th>
              </tr>
            </thead>
            <tbody>
              {customers.data.customers.map((customer) => (
                <tr key={customer.id} className="hover:bg-muted/40">
                  <td>
                    <Link
                      to={paths.staffCustomer.getHref(customer.id)}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      <bdi dir="ltr">{customer.email}</bdi>
                    </Link>
                    {customer.displayName ? (
                      <p className="text-xs text-muted-foreground">{customer.displayName}</p>
                    ) : null}
                  </td>
                  <td>
                    <StageBadge stage={customer.stage} />
                  </td>
                  <td className="tabular-nums">{formatToman(customer.lifetimeValueToman)}</td>
                  <td className="tabular-nums">{formatNumber(customer.liveSubscriptions)}</td>
                  <td className="text-xs">{customer.tags.map((tag) => tag.name).join("، ") || "—"}</td>
                  <td>{formatDate(customer.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
          <div className="mt-4 flex justify-center gap-2">
            {offset > 0 ? (
              <Button tone="ghost" onClick={() => setOffset(Math.max(0, offset - CUSTOMERS_PAGE))}>
                {t("journal.previous")}
              </Button>
            ) : null}
            {customers.data.total > offset + CUSTOMERS_PAGE ? (
              <Button onClick={() => setOffset(offset + CUSTOMERS_PAGE)}>{t("journal.next")}</Button>
            ) : null}
          </div>
        </>
      )}
    </>
  );
};

/** Making a subscription by hand: pick a plan, the server is chosen for you. */
const NewSubscriptionDialog = ({ userId, onClose }: { userId: string; onClose: () => void }) => {
  const { t } = useTranslation();
  const { data: plans = [] } = useStaffPlansQuery();
  const [create, { isLoading }] = useStaffCreateSubscriptionMutation();
  const onSale = plans.filter((plan) => plan.isActive && !plan.archivedAt);

  return (
    <FormDialog open onOpenChange={(open) => !open && onClose()} title={t("staff.customer.newSubscription")}>
      {onSale.length === 0 ? (
        <Placeholder>{t("staff.customer.noPlans")}</Placeholder>
      ) : (
        <Form<CreateSubscriptionInput>
          schema={createSubscriptionInput}
          options={{ defaultValues: { userId, planId: onSale[0]!.id } }}
          onSubmit={async (values, methods) => {
            try {
              await create(values).unwrap();
              toast.success(t("staff.customer.created"));
              onClose();
            } catch (error) {
              showSaveError(error, methods);
            }
          }}
        >
          {() => (
            <>
              <SelectField<CreateSubscriptionInput>
                name="planId"
                label={t("staff.customer.plan")}
                options={onSale.map((plan) => ({
                  value: plan.id,
                  label: `${plan.name} · ${formatGb(plan.dataLimitBytes)} · ${t("units.days", {
                    amount: formatNumber(plan.durationDays),
                  })} · ${formatToman(plan.priceToman)}`,
                }))}
              />
              <FormActions>
                <Button type="submit" tone="primary" busy={isLoading}>
                  {t("staff.customer.create")}
                </Button>
                <Button onClick={onClose}>{t("staff.common.cancel")}</Button>
              </FormActions>
            </>
          )}
        </Form>
      )}
    </FormDialog>
  );
};

/** The customer's orders; a paid order still waiting for room gets a "make it" button. */
const OrdersSection = ({ userId }: { userId: string }) => {
  const { t } = useTranslation();
  const { data: orders, isLoading } = useStaffOrdersQuery({ userId });
  const [fulfil, { isLoading: isFulfilling }] = useStaffFulfilOrderMutation();

  return (
    <Section title={t("staff.orders.title")}>
      {isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : !orders?.length ? (
        <Placeholder>{t("staff.orders.none")}</Placeholder>
      ) : (
        <TableFrame>
          <thead>
            <tr>
              <th>{t("staff.orders.number")}</th>
              <th>{t("staff.subscriptions.plan")}</th>
              <th>{t("staff.orders.total")}</th>
              <th>{t("staff.orders.method")}</th>
              <th>{t("staff.orders.status")}</th>
              <th>{t("staff.orders.paidAt")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="tabular-nums">{formatNumber(order.number)}</td>
                <td>{order.plan.name}</td>
                <td className="tabular-nums">{formatToman(order.totalToman)}</td>
                <td>{order.payment ? t(`shop.methods.${order.payment.method}`) : "—"}</td>
                <td>
                  {order.status === "paid" ? (
                    <div className="space-y-1.5">
                      <p className="text-amber-700 dark:text-amber-300">
                        {order.kind === "renewal" ? t("staff.orders.waitingForRenewal") : t("staff.orders.waitingForServer")}
                      </p>
                      <Button
                        tone="primary"
                        busy={isFulfilling}
                        onClick={() =>
                          fulfil(order.id)
                            .unwrap()
                            .then(() =>
                              toast.success(
                                order.kind === "renewal" ? t("staff.orders.renewalRequested") : t("staff.orders.fulfilled"),
                              ),
                            )
                            .catch((error: unknown) => toast.error(errorText(error)))
                        }
                      >
                        {order.kind === "renewal" ? t("staff.orders.applyRenewal") : t("staff.orders.fulfil")}
                      </Button>
                    </div>
                  ) : (
                    t(`shop.orders.status.${order.status}`)
                  )}
                </td>
                <td>{formatDate(order.paidAt)}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </Section>
  );
};

/** Stage, tags, notes: what the team records about a customer. */
const CrmSection = ({ customer, canManage }: { customer: CustomerDetail; canManage: boolean }) => {
  const { t } = useTranslation();
  const [setStage] = useStaffSetCustomerStageMutation();
  const [setTags, { isLoading: isTagging }] = useStaffSetCustomerTagsMutation();
  const [addNote, { isLoading: isNoting }] = useStaffAddCustomerNoteMutation();
  const [deleteNote] = useStaffDeleteCustomerNoteMutation();
  const [tagText, setTagText] = React.useState(customer.tags.map((tag) => tag.name).join("، "));
  const [note, setNote] = React.useState("");
  const fail = (error: unknown) => toast.error(errorText(error));

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Section title={t("staff.customer.facts")}>
        <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-card p-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{t("staff.customers.value")}</dt>
            <dd className="font-semibold tabular-nums">{formatToman(customer.lifetimeValueToman)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("staff.customer.paidOrders")}</dt>
            <dd className="font-semibold tabular-nums">{formatNumber(customer.paidOrders)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("staff.customer.lastPaid")}</dt>
            <dd>{formatDate(customer.lastPaidAt)}</dd>
          </div>
          <div className="space-y-1.5">
            <dt className="text-xs text-muted-foreground">{t("staff.customer.stage")}</dt>
            <dd className="space-y-1">
              {canManage ? (
                <select
                  aria-label={t("staff.customer.stage")}
                  value={customer.stageOverride ?? ""}
                  onChange={(event) =>
                    setStage({ id: customer.id, stage: (event.target.value || null) as CustomerStage | null })
                      .unwrap()
                      .catch(fail)
                  }
                  className={selectClass}
                >
                  <option value="">
                    {t("staff.customer.auto")} ({t(`staff.customers.stages.${customer.computedStage}`)})
                  </option>
                  {CUSTOMER_STAGES.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {t(`staff.customers.stages.${candidate}`)}
                    </option>
                  ))}
                </select>
              ) : (
                <StageBadge stage={customer.stage} />
              )}
              {customer.stageOverride ? (
                <p className="text-xs text-muted-foreground">
                  {t("staff.customer.computedStage", { stage: t(`staff.customers.stages.${customer.computedStage}`) })}
                </p>
              ) : null}
            </dd>
          </div>
        </dl>
        <div className="space-y-2">
          <label htmlFor="customer-tags" className="text-sm font-medium">
            {t("staff.customer.tags")}
          </label>
          {canManage ? (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const names = tagText
                  .split(/[,،]/)
                  .map((name) => name.trim())
                  .filter(Boolean);
                setTags({ id: customer.id, tags: names })
                  .unwrap()
                  .then(() => toast.success(t("staff.common.saved")))
                  .catch(fail);
              }}
            >
              <Input
                id="customer-tags"
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                aria-describedby="customer-tags-hint"
                className="h-10 max-w-sm"
              />
              <Button type="submit" busy={isTagging}>
                {t("staff.common.save")}
              </Button>
              <p id="customer-tags-hint" className="w-full text-xs text-muted-foreground">
                {t("staff.customer.tagsHint")}
              </p>
            </form>
          ) : (
            <p className="text-sm">{customer.tags.map((tag) => tag.name).join("، ") || "—"}</p>
          )}
        </div>
      </Section>

      <Section title={t("staff.customer.notes")}>
        {canManage ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!note.trim()) return;
              addNote({ id: customer.id, body: note })
                .unwrap()
                .then(() => setNote(""))
                .catch(fail);
            }}
          >
            <label htmlFor="customer-note" className="sr-only">
              {t("staff.customer.addNote")}
            </label>
            <textarea
              id="customer-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t("staff.customer.notePlaceholder")}
              dir="auto"
              className="block w-full rounded-md border bg-background px-3 py-2 text-sm leading-7 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            />
            <Button type="submit" tone="primary" busy={isNoting}>
              {t("staff.customer.addNote")}
            </Button>
          </form>
        ) : null}
        {customer.notes.length ? (
          <ul className="space-y-3">
            {customer.notes.map((entry) => (
              <li key={entry.id} className="space-y-1 rounded-lg border bg-card p-3">
                <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{entry.authorName}</span>
                  <span>{formatDateTime(entry.createdAt)}</span>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => deleteNote({ id: customer.id, noteId: entry.id }).unwrap().catch(fail)}
                      className="ms-auto underline-offset-4 hover:underline"
                    >
                      {t("staff.customer.deleteNote")}
                    </button>
                  ) : null}
                </p>
                <p className="text-sm leading-7 whitespace-pre-line" dir="auto">
                  {entry.body}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Placeholder>{t("staff.customer.noNotes")}</Placeholder>
        )}
      </Section>
    </div>
  );
};

/** Suspending or deleting the account (never a member of staff's: that is the team page). */
const AccountSection = ({ customer }: { customer: CustomerDetail }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [setStatus, { isLoading }] = useStaffSetCustomerStatusMutation();
  const [remove] = useStaffDeleteCustomerMutation();
  const fail = (error: unknown) => toast.error(errorText(error));

  return (
    <Section title={t("staff.customer.account")}>
      {customer.status === "suspended" ? (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{t("staff.customer.suspended")}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {customer.status === "suspended" ? (
          <Button busy={isLoading} onClick={() => setStatus({ id: customer.id, status: "active" }).unwrap().catch(fail)}>
            {t("staff.customer.restore")}
          </Button>
        ) : (
          <ConfirmButton
            label={t("staff.customer.suspend")}
            question={t("staff.customer.suspendQuestion")}
            onConfirm={() => setStatus({ id: customer.id, status: "suspended" }).unwrap().catch(fail)}
          />
        )}
        <ConfirmButton
          tone="danger"
          label={t("staff.customer.delete")}
          question={t("staff.customer.deleteQuestion")}
          onConfirm={() =>
            remove(customer.id)
              .unwrap()
              .then(() => {
                toast.success(t("staff.customer.deleted"));
                void navigate(paths.staffCustomers.getHref());
              })
              .catch(fail)
          }
        />
      </div>
    </Section>
  );
};

export const CustomerPage = ({
  customerId,
  canSeeOrders,
  canManage,
}: {
  customerId: string;
  canSeeOrders: boolean;
  canManage: boolean;
}) => {
  const { t } = useTranslation();
  const customer = useStaffCustomerQuery(customerId);
  const [adding, setAdding] = React.useState(false);

  if (customer.isLoading) return <Placeholder>{t("common.loading")}</Placeholder>;
  if (!customer.data) return <Placeholder>{t("staff.common.loadFailed")}</Placeholder>;
  const { data } = customer;

  return (
    <div className="space-y-8">
      <PageHeader
        title={data.displayName || data.email}
        description={`${t("staff.customers.joined")}: ${formatDate(data.createdAt)} · ${t("staff.customers.lastLogin")}: ${
          data.lastLoginAt ? formatDate(data.lastLoginAt) : t("staff.common.never")
        }`}
        actions={<StageBadge stage={data.stage} />}
      />
      {data.displayName ? (
        <p className="-mt-6 text-sm">
          <bdi dir="ltr">{data.email}</bdi>
        </p>
      ) : null}

      <CrmSection key={data.id} customer={data} canManage={canManage} />

      <Section
        title={t("staff.customer.subscriptions")}
        actions={
          <Button tone="primary" onClick={() => setAdding(true)}>
            {t("staff.customer.newSubscription")}
          </Button>
        }
      >
        {data.subscriptions.length === 0 ? (
          <Placeholder>{t("staff.customer.noSubscriptions")}</Placeholder>
        ) : (
          <SubscriptionTable subscriptions={data.subscriptions} showCustomer={false} />
        )}
      </Section>

      {canSeeOrders ? <OrdersSection userId={data.id} /> : null}

      <NotificationLog customerId={data.id} />

      {canManage ? <AccountSection customer={data} /> : null}

      {adding ? <NewSubscriptionDialog userId={data.id} onClose={() => setAdding(false)} /> : null}
    </div>
  );
};
