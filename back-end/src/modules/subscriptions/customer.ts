import type { MySubscriptionView } from "@shah-kelid/contracts";
import { and, desc, eq, ne } from "drizzle-orm";

import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { plans } from "../catalog/schema";
import { panels } from "../infrastructure/schema";
import { syncSubscription } from "../provisioning/sync";
import { RENEWABLE } from "./renewal";
import { subscriptions } from "./schema";
import { linkFor } from "./service";

/**
 * The customer's own services, as their panel shows them.
 *
 * Opening the panel is when usage matters most to them, so services not
 * read from the panel in the last minute are read now, for up to three
 * seconds. A panel that is slow or down does not hold the page: the last
 * copy is shown, with the time it was read.
 */

const FRESH_MS = 60_000;
const WAIT_MS = 3_000;
const ON_PANEL = ["on_hold", "active", "limited", "expired", "disabled"];

const refresh = async (db: Db, rows: (typeof subscriptions.$inferSelect)[]) => {
  const stale = rows.filter(
    (row) => ON_PANEL.includes(row.status) && (!row.lastSyncedAt || Date.now() - row.lastSyncedAt.getTime() > FRESH_MS),
  );
  if (stale.length === 0) return false;
  const work = Promise.allSettled(stale.map((row) => syncSubscription(db, row)));
  const finished = await Promise.race([work.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), WAIT_MS))]);
  if (!finished) logger.debug({ count: stale.length }, "The panel was slow; showing the last usage read");
  return true;
};

const read = (db: Db, userId: string) =>
  db
    .select({ subscription: subscriptions, planName: plans.name, subscriptionBaseUrl: panels.subscriptionBaseUrl })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .innerJoin(panels, eq(panels.id, subscriptions.panelId))
    .where(and(eq(subscriptions.userId, userId), ne(subscriptions.status, "deleted")))
    .orderBy(desc(subscriptions.createdAt));

export const mySubscriptions = async (db: Db, userId: string): Promise<MySubscriptionView[]> => {
  let rows = await read(db, userId);
  if (await refresh(db, rows.map((row) => row.subscription))) rows = await read(db, userId);

  return rows.map(({ subscription: s, planName, subscriptionBaseUrl }) => ({
    id: s.id,
    plan: { id: s.planId, name: planName },
    status: s.status,
    dataLimitBytes: s.dataLimitBytes,
    usedBytes: s.usedBytes,
    remainingBytes: s.dataLimitBytes === null ? null : Math.max(0, s.dataLimitBytes - s.usedBytes),
    expiresAt: s.expiresAt?.toISOString() ?? null,
    daysOnHold:
      s.status === "on_hold" && s.onHoldDurationSeconds !== null ? Math.round(s.onHoldDurationSeconds / 86400) : null,
    deviceLimit: s.deviceLimit,
    link: ON_PANEL.includes(s.status) ? linkFor(s.accessToken, subscriptionBaseUrl) : null,
    lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
    renewable: (RENEWABLE as readonly string[]).includes(s.status),
  }));
};
