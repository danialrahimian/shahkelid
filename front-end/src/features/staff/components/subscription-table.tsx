import type { SubscriptionView } from "@shah-kelid/contracts";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { paths } from "@/config/paths";

import { formatDate } from "@/lib/format";
import { StatusBadge, TableFrame, UsageMeter } from "./staff-ui";

/** Subscriptions as rows: shared by the subscriptions list and a customer's page. */
export const SubscriptionTable = ({
  subscriptions,
  showCustomer = true,
}: {
  subscriptions: SubscriptionView[];
  showCustomer?: boolean;
}) => {
  const { t } = useTranslation();
  return (
    <TableFrame>
      <thead>
        <tr>
          {showCustomer ? <th>{t("staff.subscriptions.customer")}</th> : null}
          <th>{t("staff.subscriptions.plan")}</th>
          <th>{t("staff.common.status")}</th>
          <th>{t("staff.subscriptions.usage")}</th>
          <th>{t("staff.subscriptions.expires")}</th>
          <th>{t("staff.subscriptions.groups")}</th>
        </tr>
      </thead>
      <tbody>
        {subscriptions.map((subscription) => (
          <tr key={subscription.id} className="hover:bg-muted/40">
            {showCustomer ? (
              <td>
                <Link
                  to={paths.staffCustomer.getHref(subscription.userId)}
                  className="underline-offset-4 hover:underline"
                >
                  <bdi dir="ltr">{subscription.userEmail}</bdi>
                </Link>
              </td>
            ) : null}
            <td>
              <Link
                to={paths.staffSubscription.getHref(subscription.id)}
                className="font-medium underline-offset-4 hover:underline"
              >
                {subscription.plan.name}
              </Link>
            </td>
            <td>
              <StatusBadge status={subscription.status} />
            </td>
            <td>
              <UsageMeter used={subscription.usedBytes} limit={subscription.dataLimitBytes} />
            </td>
            <td className="whitespace-nowrap">
              {subscription.expiresAt
                ? formatDate(subscription.expiresAt)
                : subscription.status === "on_hold"
                  ? t("staff.subscription.notStarted")
                  : "—"}
            </td>
            <td className="text-xs">
              {subscription.groups.length > 0 ? subscription.groups.map((group) => group.name).join("، ") : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
};
