import { and, eq } from "drizzle-orm";

import config from "../../config";
import type { Db } from "../../platform/db/client";
import { plans } from "../catalog/schema";
import { findPanel } from "../infrastructure/service";
import { fromPanel, groupsFor, recordHistory } from "../subscriptions/service";
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

  await db.transaction(async (tx) => {
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
    }
  });
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
    }
  });
