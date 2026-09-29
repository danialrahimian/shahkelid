import { createSubscriptionInput, type CreateSubscriptionInput } from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  useStaffCreateSubscriptionMutation,
  useStaffCustomerQuery,
  useStaffCustomersQuery,
  useStaffPlansQuery,
} from "@/api/staff";
import { Form } from "@/components/ui/form/form";
import { Input } from "@/components/ui/input";
import { paths } from "@/config/paths";

import { formatDate, formatGb, formatNumber, formatToman } from "../format";
import { showSaveError } from "../form-errors";
import { FormActions, SelectField } from "./fields";
import { Button, FormDialog, PageHeader, Placeholder, Section, TableFrame } from "./staff-ui";
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

export const CustomersPage = () => {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState("");
  const settled = useSettled(search.trim());
  const customers = useStaffCustomersQuery({ search: settled || undefined });

  return (
    <>
      <PageHeader title={t("staff.customers.title")} description={t("staff.customers.description")} />

      <div className="mb-4 max-w-md">
        <label htmlFor="customer-search" className="sr-only">
          {t("staff.customers.searchPlaceholder")}
        </label>
        <Input
          id="customer-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("staff.customers.searchPlaceholder")}
          className="h-10"
        />
      </div>

      {customers.isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : customers.isError ? (
        <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
      ) : !customers.data?.length ? (
        <Placeholder>{t("staff.customers.noResults")}</Placeholder>
      ) : (
        <TableFrame>
          <thead>
            <tr>
              <th>{t("staff.customers.email")}</th>
              <th>{t("staff.customers.live")}</th>
              <th>{t("staff.customers.joined")}</th>
              <th>{t("staff.customers.lastLogin")}</th>
            </tr>
          </thead>
          <tbody>
            {customers.data.map((customer) => (
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
                <td className="tabular-nums">{formatNumber(customer.liveSubscriptions)}</td>
                <td>{formatDate(customer.createdAt)}</td>
                <td>{customer.lastLoginAt ? formatDate(customer.lastLoginAt) : t("staff.common.never")}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
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
                  label: `${plan.name} · ${formatGb(plan.dataLimitBytes)} · ${t("staff.units.days", {
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

export const CustomerPage = ({ customerId }: { customerId: string }) => {
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
      />
      {data.displayName ? (
        <p className="-mt-6 text-sm">
          <bdi dir="ltr">{data.email}</bdi>
        </p>
      ) : null}

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

      {adding ? <NewSubscriptionDialog userId={data.id} onClose={() => setAdding(false)} /> : null}
    </div>
  );
};
