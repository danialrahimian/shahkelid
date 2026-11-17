import { and, eq } from "drizzle-orm";

import config from "../../config";
import type { Db } from "../../platform/db/client";
import { plans } from "../catalog/schema";
import { users } from "../identity/schema";
import { alertStaff } from "../notifications/alerts";
import { format, notifyCustomer, siteUrl } from "../notifications/notify";
import { panels } from "../infrastructure/schema";
import { SYNCED, isMade, memberFromPanel, membersOf, saveMember, subscriptionFrom, type Member } from "../subscriptions/members";
import { linkFor, recordHistory, type SubscriptionRow } from "../subscriptions/service";
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

/** Makes (or finds) the subscription's user on one panel, and keeps what the panel said. */
const makeOn = async (db: Db, subscription: SubscriptionRow, plan: typeof plans.$inferSelect, member: Member, dataLimitBytes: number | null) => {
  const driver = driverFor(member.panel);
  const existing = await driver.getUser(subscription.panelUsername);
  const user =
    existing ??
    (await driver.createUser({
      username: subscription.panelUsername,
      groupIds: member.groupIds,
      dataLimitBytes,
      deviceLimit: subscription.deviceLimit,
      trafficReset: plan.trafficReset,
      note: `shah-kelid ${subscription.id}`,
      startsOnFirstUse: true,
      durationSeconds: plan.durationDays * 86400,
      startsAtLatest: new Date(Date.now() + config.provisioning.firstUseDeadlineDays * 86400_000),
    }));
  await saveMember(db, member, memberFromPanel(user));
  return { user, foundExisting: existing !== null };
};

/**
 * Tries each panel the user is not on yet. One panel failing does not stop
 * the others; its error is kept on its row.
 */
const makeOnPending = async (db: Db, subscription: SubscriptionRow) => {
  const [plan] = await db.select().from(plans).where(eq(plans.id, subscription.planId));
  const members = await membersOf(db, subscription.id);
  // A panel joining late gets what is left, not the whole volume again.
  const used = members.filter(isMade).reduce((sum, member) => sum + member.usedBytes, 0);
  const limit = subscription.dataLimitBytes === null ? null : Math.max(1, subscription.dataLimitBytes - used);

  const made: Member[] = [];
  const failures: Error[] = [];
  let foundExisting = false;
  for (const member of members.filter((row) => !isMade(row))) {
    try {
      const result = await makeOn(db, subscription, plan!, member, limit);
      foundExisting ||= result.foundExisting;
      made.push(member);
    } catch (error) {
      failures.push(error as Error);
      await saveMember(db, member, { lastError: (error as Error).message.slice(0, 500) });
    }
  }
  return { plan: plan!, members, made, failures, foundExisting };
};

export const provisionSubscription = async (db: Db, id: string): Promise<ProvisionOutcome> => {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
  if (!subscription || subscription.status !== "provisioning") return "not_waiting";

  const { plan, made, failures, foundExisting } = await makeOnPending(db, subscription);
  const members = await membersOf(db, id);
  // On no panel at all: nothing to give the customer yet. The job is retried.
  if (!members.some(isMade)) throw failures[0] ?? new Error("The subscription has no panel to be made on");

  const [primary] = await db.select().from(panels).where(eq(panels.id, subscription.panelId));
  const done = await db.transaction(async (tx) => {
    const updated = await tx
      .update(subscriptions)
      .set({ ...subscriptionFrom(subscription, members), provisionedAt: new Date() })
      // Only if still waiting: staff may have acted while the panel answered.
      .where(and(eq(subscriptions.id, id), eq(subscriptions.status, "provisioning")))
      .returning({ id: subscriptions.id });
    if (updated.length > 0) {
      await recordHistory(tx, id, "provisioned", "system", {
        panelUserId: members.find(isMade)?.panelUserId,
        foundExisting,
        panels: members.filter(isMade).length,
        ...(failures.length > 0 ? { waitingForPanels: failures.length } : {}),
      });
      if (failures.length > 0) {
        await alertStaff(
          tx,
          {
            subject: "A service was made on some of its panels only",
            text: [
              `Subscription ${id} is on ${members.filter(isMade).length} of its ${members.length} panels, and the customer has its link.`,
              `Error from the rest: ${failures[0]!.message.slice(0, 300)}`,
              "The remaining panels are tried again at every sync (every few minutes).",
            ].join("\n"),
          },
          { type: "subscription", id },
        );
      }
      await notifyCustomer(tx, subscription.userId, "subscription_ready", {
        plan_name: plan.name,
        volume: format.gb(subscription.dataLimitBytes),
        days: format.days(plan.durationDays),
        link: linkFor(subscription.accessToken, primary?.subscriptionBaseUrl ?? null),
        account_url: siteUrl.account(),
      });
    }
    return updated.length > 0;
  });

  // Deleted while the panels were answering (by staff, or with the customer's
  // account): the users just made belong to nothing now, so they go, rather
  // than being left on the panels taking a place.
  if (!done) {
    const [now] = await db.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.id, id));
    if (now?.status === "deleted" && !foundExisting) {
      for (const member of made) await driverFor(member.panel).deleteUser(subscription.panelUsername).catch(() => undefined);
    }
    return "not_waiting";
  }
  return "provisioned";
};

/**
 * A live subscription that is not on all of its panels yet: tries the rest.
 * Called by the sync. True when a panel was added (the limits then need
 * setting again).
 */
export const provisionPending = async (db: Db, id: string) => {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
  if (!subscription || !(SYNCED as readonly string[]).includes(subscription.status)) return false;
  const { made } = await makeOnPending(db, subscription);
  return made.length > 0;
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
        subject: "Making a service stopped",
        text: [
          `Subscription ${id} for ${row?.email ?? "?"} was not made on the panel, and the automatic attempts are over.`,
          `Error: ${error.message.slice(0, 300)}`,
          "The customer's payment is recorded. Once the panel is fixed, press \"Retry\" on the subscription in the staff area.",
        ].join("\n"),
      }
    : {
        subject: "Making a service has been failing for a minute",
        text: [
          `Subscription ${id} for ${row?.email ?? "?"} is not on the panel yet.`,
          `Error: ${error.message.slice(0, 300)}`,
          "Automatic attempts carry on, and the service is made as soon as the panel is back. The customer sees \"being prepared\".",
        ].join("\n"),
      };
};
