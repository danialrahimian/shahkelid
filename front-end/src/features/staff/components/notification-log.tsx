import { useTranslation } from "react-i18next";

import { useStaffCustomerNotificationsQuery } from "@/api/staff";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Placeholder, Section, TableFrame } from "./staff-ui";

const TONE: Record<string, string> = {
  sent: "text-emerald-700 dark:text-emerald-300",
  failed: "text-red-700 dark:text-red-300",
  skipped: "text-muted-foreground",
  queued: "text-sky-700 dark:text-sky-300",
};

const KNOWN_KEYS = [
  "subscription_ready",
  "subscription_renewed",
  "payment_received",
  "expiry_3d",
  "expiry_1d",
  "usage_80",
  "usage_100",
  "ticket_reply",
] as const;

/** Every email this customer was sent, or not sent and why: what support needs when "I never got it". */
export const NotificationLog = ({ customerId }: { customerId: string }) => {
  const { t } = useTranslation();
  const { data: log, isLoading } = useStaffCustomerNotificationsQuery(customerId);

  return (
    <Section title={t("staff.notifications.log")}>
      {isLoading ? (
        <Placeholder>{t("common.loading")}</Placeholder>
      ) : !log?.length ? (
        <Placeholder>{t("staff.notifications.logEmpty")}</Placeholder>
      ) : (
        <TableFrame>
          <tbody>
            {log.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {(KNOWN_KEYS as readonly string[]).includes(entry.templateKey)
                    ? t(`staff.notifications.keys.${entry.templateKey as (typeof KNOWN_KEYS)[number]}`)
                    : entry.templateKey}
                </td>
                <td className={cn("whitespace-nowrap", TONE[entry.status])}>
                  {t(`staff.notifications.statuses.${entry.status}`)}
                  {entry.error ? <p className="text-xs text-muted-foreground">{entry.error}</p> : null}
                </td>
                <td className="whitespace-nowrap text-muted-foreground">{formatDateTime(entry.sentAt ?? entry.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </Section>
  );
};
