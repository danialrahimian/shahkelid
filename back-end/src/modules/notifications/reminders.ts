import { eq, inArray } from "drizzle-orm";

import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { plans } from "../catalog/schema";
import { subscriptionAlertsSent, subscriptions } from "../subscriptions/schema";
import { format, notifyCustomer, siteUrl } from "./notify";

/**
 * Reminders: three days and one day before a service ends, and at 80% and
 * 100% of its volume.
 *
 * Each goes out once per cycle. The cycle is part of the key the database
 * refuses to repeat (subscription, reminder, cycle): for the expiry
 * reminders it is the expiry itself, for the volume ones the limit and the
 * expiry. A renewal changes both, so the same reminders can come again for
 * the new term, and never twice within one.
 *
 * Usage comes from the panel sync (every few minutes); this scan runs every
 * fifteen minutes and takes `now` as a parameter, so tests can move the clock.
 */

const DAY = 86_400_000;
type Alert = "expiry_3d" | "expiry_1d" | "usage_80" | "usage_100";

type Row = typeof subscriptions.$inferSelect;

/** The reminders due for a subscription right now, with the cycle each belongs to. */
export const dueReminders = (subscription: Row, now: Date): { alert: Alert; cycleKey: string }[] => {
  const due: { alert: Alert; cycleKey: string }[] = [];
  const expiry = subscription.expiresAt;

  if (expiry) {
    const left = expiry.getTime() - now.getTime();
    const cycleKey = `expiry:${expiry.toISOString()}`;
    if (left > 0 && left <= DAY) due.push({ alert: "expiry_1d", cycleKey });
    else if (left > DAY && left <= 3 * DAY) due.push({ alert: "expiry_3d", cycleKey });
  }

  if (subscription.dataLimitBytes !== null && subscription.dataLimitBytes > 0) {
    const share = subscription.usedBytes / subscription.dataLimitBytes;
    const cycleKey = `volume:${subscription.dataLimitBytes}:${expiry?.toISOString() ?? "on-hold"}`;
    if (share >= 1) due.push({ alert: "usage_100", cycleKey });
    else if (share >= 0.8) due.push({ alert: "usage_80", cycleKey });
  }
  return due;
};

export const scanReminders = async (db: Db, now = new Date()) => {
  const live = await db
    .select({ subscription: subscriptions, planName: plans.name })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(inArray(subscriptions.status, ["active", "limited"]));

  let sent = 0;
  for (const { subscription, planName } of live) {
    for (const { alert, cycleKey } of dueReminders(subscription, now)) {
      const queued = await db.transaction(async (tx) => {
        // The database decides "not yet sent in this cycle".
        const [fresh] = await tx
          .insert(subscriptionAlertsSent)
          .values({ subscriptionId: subscription.id, alert, cycleKey })
          .onConflictDoNothing()
          .returning();
        if (!fresh) return false;

        const limit = subscription.dataLimitBytes;
        await notifyCustomer(tx, subscription.userId, alert, {
          plan_name: planName,
          expires_on: subscription.expiresAt ? format.date(subscription.expiresAt) : "",
          days_left: subscription.expiresAt
            ? format.days(Math.max(1, Math.ceil((subscription.expiresAt.getTime() - now.getTime()) / DAY)))
            : "",
          used: format.gb(subscription.usedBytes),
          total: format.gb(limit),
          remaining: format.gb(limit === null ? null : Math.max(0, limit - subscription.usedBytes)),
          renew_url: siteUrl.renew(subscription.id),
        });
        return true;
      });
      if (queued) sent += 1;
    }
  }
  if (sent) logger.info({ sent }, "Reminders queued");
  return sent;
};
