import {
  SUBSCRIPTION_STATUSES,
  type SubscriptionAction,
  type SubscriptionStatus,
  type SubscriptionView,
} from "@shah-kelid/contracts";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  useStaffSubscriptionActionMutation,
  useStaffSubscriptionQuery,
  useStaffSubscriptionsQuery,
} from "@/api/staff";
import { QrLink } from "@/components/ui/qr-link";
import { paths } from "@/config/paths";
import { errorText } from "@/lib/error-text";
import { cn } from "@/lib/utils";

import { formatDate, formatDateTime, formatGb, formatNumber } from "@/lib/format";
import { Button, ConfirmButton, PageHeader, Placeholder, Section, StatusBadge, UsageMeter } from "./staff-ui";
import { SubscriptionTable } from "./subscription-table";

// -------------------------------------------------------------------- list

export const SubscriptionsPage = () => {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<SubscriptionStatus>();
  const subscriptions = useStaffSubscriptionsQuery({ status });

  return (
    <>
      <PageHeader title={t("staff.subscriptions.title")} description={t("staff.subscriptions.description")} />

      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label={t("staff.servers.status")}>
        {[undefined, ...SUBSCRIPTION_STATUSES].map((value) => (
          <button
            key={value ?? "all"}
            type="button"
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              status === value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {value ? t(`staff.status.${value}`) : t("staff.subscriptions.all")}
          </button>
        ))}
      </div>

      {subscriptions.isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : subscriptions.isError ? (
        <Placeholder>{t("staff.common.loadFailed")}</Placeholder>
      ) : !subscriptions.data?.length ? (
        <Placeholder>{t("staff.common.empty")}</Placeholder>
      ) : (
        <SubscriptionTable subscriptions={subscriptions.data} />
      )}
    </>
  );
};

// ------------------------------------------------------------------ detail

/** Which actions make sense in each status. */
const actionsFor = (subscription: SubscriptionView): SubscriptionAction[] => {
  switch (subscription.status) {
    case "provisioning":
    case "deleted":
      return [];
    case "provisioning_failed":
      return ["retry"];
    case "disabled":
      return ["sync", "enable", "revoke_link", "delete"];
    default:
      return ["sync", "reset_usage", "revoke_link", "disable", "delete"];
  }
};

/** Asked about first, with what will happen spelled out. */
const CONFIRMED: Partial<Record<SubscriptionAction, "danger" | "default">> = {
  reset_usage: "default",
  revoke_link: "default",
  disable: "default",
  delete: "danger",
};

const Actions = ({ subscription }: { subscription: SubscriptionView }) => {
  const { t } = useTranslation();
  const [act, { isLoading }] = useStaffSubscriptionActionMutation();
  const run = (action: SubscriptionAction) =>
    act({ id: subscription.id, action })
      .unwrap()
      .then(() => toast.success(t("staff.subscription.done")))
      .catch((error: unknown) => toast.error(errorText(error)));

  const available = actionsFor(subscription);
  if (available.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {available.map((action) => {
        const tone = CONFIRMED[action];
        const label = t(`staff.subscription.actions.${action}`);
        return tone ? (
          <ConfirmButton
            key={action}
            label={label}
            tone={tone === "danger" ? "danger" : "default"}
            question={t(`staff.subscription.confirm.${action as "reset_usage" | "revoke_link" | "disable" | "delete"}`)}
            disabled={isLoading}
            onConfirm={() => void run(action)}
          />
        ) : (
          <Button key={action} busy={isLoading} tone={action === "retry" ? "primary" : "outline"} onClick={() => void run(action)}>
            {label}
          </Button>
        );
      })}
    </div>
  );
};

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm">{children}</dd>
  </div>
);

const EVENT_KINDS = [
  "created",
  "provisioned",
  "provisioning_failed",
  "retry",
  "status_changed",
  "missing_on_panel",
  "reset_usage",
  "revoke_link",
  "disable",
  "enable",
  "delete",
] as const;
type EventKind = (typeof EVENT_KINDS)[number];
const isEventKind = (kind: string): kind is EventKind => (EVENT_KINDS as readonly string[]).includes(kind);

export const SubscriptionPage = ({ subscriptionId }: { subscriptionId: string }) => {
  const { t } = useTranslation();
  const detail = useStaffSubscriptionQuery(subscriptionId);
  // While it is being made on the panel, a second subscriber to the same
  // cache entry looks again every few seconds; it stops once it is made.
  const provisioning = detail.data?.subscription.status === "provisioning";
  useStaffSubscriptionQuery(subscriptionId, { pollingInterval: 3000, skip: !provisioning });

  if (detail.isLoading) return <Placeholder>{t("common.loading")}</Placeholder>;
  if (!detail.data) return <Placeholder>{t("staff.common.loadFailed")}</Placeholder>;
  const { subscription, history } = detail.data;
  const onPanel = !["provisioning", "provisioning_failed", "deleted"].includes(subscription.status);

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${t("staff.subscription.title")}: ${subscription.plan.name}`}
        actions={<StatusBadge status={subscription.status} />}
      />

      <p className="-mt-6 text-sm">
        <Link to={paths.staffCustomer.getHref(subscription.userId)} className="underline-offset-4 hover:underline">
          <bdi dir="ltr">{subscription.userEmail}</bdi>
        </Link>
      </p>

      <dl className="grid gap-6 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label={t("staff.subscription.usage")}>
          <UsageMeter used={subscription.usedBytes} limit={subscription.dataLimitBytes} />
        </Fact>
        <Fact label={t("staff.subscription.lifetime")}>{formatGb(subscription.lifetimeUsedBytes)}</Fact>
        <Fact label={t("staff.subscription.devices")}>
          {subscription.deviceLimit === null
            ? t("units.unlimited")
            : formatNumber(subscription.deviceLimit)}
        </Fact>
        <Fact label={t("staff.subscription.expires")}>
          {subscription.expiresAt ? formatDate(subscription.expiresAt) : t("staff.subscription.notStarted")}
        </Fact>
        <Fact label={t("staff.subscription.online")}>
          {subscription.onlineAt ? formatDateTime(subscription.onlineAt) : t("staff.common.never")}
        </Fact>
        <Fact label={t("staff.subscription.lastSync")}>{formatDateTime(subscription.lastSyncedAt)}</Fact>
        <Fact label={t("staff.subscriptions.server")}>
          {subscription.server ? (
            <>
              <bdi dir="ltr">{subscription.server.name}</bdi> · {subscription.server.locationName}
            </>
          ) : (
            "—"
          )}
        </Fact>
        <Fact label={t("staff.servers.panel")}>{subscription.panel.name}</Fact>
        <Fact label={t("staff.subscriptions.created")}>{formatDateTime(subscription.createdAt)}</Fact>
      </dl>

      {subscription.lastError ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" dir="auto">
          <span className="font-medium">{t("staff.subscription.lastError")}: </span>
          {subscription.lastError}
        </p>
      ) : null}

      <Actions subscription={subscription} />

      <Section title={t("staff.subscription.link")}>
        {onPanel ? (
          <QrLink
            link={subscription.link}
            hint={t("staff.subscription.linkHint")}
            qrAlt={t("staff.subscription.qrAlt")}
            copyLabel={t("staff.common.copy")}
            copiedLabel={t("staff.common.copied")}
          />
        ) : (
          <Placeholder>{t("staff.subscription.linkNotReady")}</Placeholder>
        )}
      </Section>

      <Section title={t("staff.subscription.history")}>
        <ol className="space-y-3 border-s ps-4">
          {history.map((event) => (
            <li key={event.id} className="space-y-0.5">
              <p className="text-sm font-medium">
                {isEventKind(event.kind) ? t(`staff.subscription.events.${event.kind}`) : event.kind}
                {event.kind === "status_changed" && typeof event.details.to === "string" ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    ({t(`staff.status.${event.details.from as SubscriptionStatus}`)} ←{" "}
                    {t(`staff.status.${event.details.to as SubscriptionStatus}`)})
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(event.createdAt)} ·{" "}
                {event.actorEmail ? (
                  <bdi dir="ltr">{event.actorEmail}</bdi>
                ) : (
                  t(`staff.subscription.by.${event.actorKind === "staff" ? "staff" : "system"}`)
                )}
              </p>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
};
