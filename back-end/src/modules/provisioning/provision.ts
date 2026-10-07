import { and, eq } from "drizzle-orm";

import config from "../../config";
import type { Db } from "../../platform/db/client";
import { plans } from "../catalog/schema";
import { users } from "../identity/schema";
import { alertStaff } from "../notifications/alerts";
import { format, notifyCustomer, siteUrl } from "../notifications/notify";
import { findPanel } from "../infrastructure/service";
import { fromPanel, groupsFor, linkFor, recordHistory } from "../subscriptions/service";
import { subscriptions } from "../subscriptions/schema";
import { driverFor } from "./drivers";

/**
 * Puts a subscription on its panel. Run by the worker for each
 * "subscription.provision_requested" event, and safe to run again:
 *
 * - A subscription that is no longer waiting (made already, deleted) is left alone.
 * - The panel username comes from the subscription id, so a retry first asks
 *   the panel for it and finds the user an earlier attempt made even if that
 *   attempt's answer was lost. No second user, no second charge on capacity.
 */

export type ProvisionOutcome = "provisioned" | "not_waiting";

export const provisionSubscription = async (db: Db, id: string): Promise<ProvisionOutcome> => {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
  if (!subscription || subscription.status !== "provisioning") return "not_waiting";

  const [plan] = await db.select().from(plans).where(eq(plans.id, subscription.planId));
  const panel = await findPanel(db, subscription.panelId);
  const driver = driverFor(panel);

  const existing = await driver.getUser(subscription.panelUsername);
  const user =
    existing ??
    (await driver.createUser({
      username: subscription.panelUsername,
      groupIds: await groupsFor(db, subscription),
      dataLimitBytes: subscription.dataLimitBytes,
      deviceLimit: subscription.deviceLimit,
      trafficReset: plan!.trafficReset,
      note: `shah-kelid ${subscription.id}`,
      startsOnFirstUse: true,
      durationSeconds: plan!.durationDays * 86400,
      startsAtLatest: new Date(
        Date.now() + config.provisioning.firstUseDeadlineDays * 86400_000,
      ),
    }));

  const made = await db.transaction(async (tx) => {
    const updated = await tx
      .update(subscriptions)
      .set({ ...fromPanel(user), provisionedAt: new Date() })
      // Only if still waiting: staff may have acted while the panel answered.
      .where(and(eq(subscriptions.id, id), eq(subscriptions.status, "provisioning")))
      .returning({ id: subscriptions.id });
    if (updated.length > 0) {
      await recordHistory(tx, id, "provisioned", "system", {
        panelUserId: user.id,
        foundExisting: existing !== null,
      });
      await notifyCustomer(tx, subscription.userId, "subscription_ready", {
        plan_name: plan!.name,
        volume: format.gb(subscription.dataLimitBytes),
        days: format.days(plan!.durationDays),
        link: linkFor(subscription.accessToken, panel.subscriptionBaseUrl),
        account_url: siteUrl.account(),
      });
    }
    return updated.length > 0;
  });

  // Deleted while the panel was answering (by staff, or with the customer's
  // account): the user just made there belongs to nothing now, so it goes,
  // rather than being left on the panel taking a place.
  if (!made && existing === null) {
    const [now] = await db.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.id, id));
    if (now?.status === "deleted") {
      await driver.deleteUser(subscription.panelUsername).catch(() => undefined);
    }
    return "not_waiting";
  }
  return "provisioned";
};

/** Remembers why the last attempt failed, for the dashboard. */
export const noteAttemptFailed = (db: Db, id: string, error: Error) =>
  db
    .update(subscriptions)
    .set({ lastError: error.message.slice(0, 500) })
    .where(and(eq(subscriptions.id, id), eq(subscriptions.status, "provisioning")));

/**
 * No more attempts: the subscription waits for staff ("retry" in the
 * dashboard). Whatever was paid stays recorded; nothing is refunded or lost.
 */
export const markProvisioningFailed = async (db: Db, id: string, error: Error) =>
  db.transaction(async (tx) => {
    const updated = await tx
      .update(subscriptions)
      .set({ status: "provisioning_failed", lastError: error.message.slice(0, 500) })
      .where(and(eq(subscriptions.id, id), eq(subscriptions.status, "provisioning")))
      .returning({ id: subscriptions.id });
    if (updated.length > 0) {
      await recordHistory(tx, id, "provisioning_failed", "system", { error: error.message.slice(0, 500) });
      await alertStaff(tx, await provisioningAlert(tx, id, error, "gave_up"), { type: "subscription", id });
    }
  });

/** What staff are told about a subscription that cannot be put on its panel. */
export const provisioningAlert = async (
  executor: Pick<Db, "select">,
  id: string,
  error: Error,
  stage: "still_failing" | "gave_up",
) => {
  const [row] = await executor
    .select({ email: users.email })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(eq(subscriptions.id, id));
  return stage === "gave_up"
    ? {
        subject: "ساخت سرویس متوقف شد",
        text: [
          `اشتراک ${id} برای ${row?.email ?? "?"} روی پنل ساخته نشد و تلاش خودکار تمام شد.`,
          `خطا: ${error.message.slice(0, 300)}`,
          "پول مشتری ثبت شده است. بعد از رفع مشکل پنل، در بخش مدیریت روی «تلاش دوباره برای ساخت» بزنید.",
        ].join("\n"),
      }
    : {
        subject: "ساخت سرویس یک دقیقه است که شکست می‌خورد",
        text: [
          `اشتراک ${id} برای ${row?.email ?? "?"} هنوز روی پنل ساخته نشده است.`,
          `خطا: ${error.message.slice(0, 300)}`,
          "تلاش خودکار ادامه دارد و به محض برگشتن پنل، سرویس ساخته می‌شود. مشتری «در حال آماده‌سازی» می‌بیند.",
        ].join("\n"),
      };
};
