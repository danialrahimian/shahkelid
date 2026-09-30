import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "../../platform/db/client";
import { panels } from "../infrastructure/schema";
import { fromPanel, recordHistory, type SubscriptionRow } from "../subscriptions/service";
import { subscriptions } from "../subscriptions/schema";
import type { PanelUser } from "./driver";
import { driverFor, type PanelRow } from "./drivers";

/**
 * Keeping our copy of usage and status in step with the panels.
 *
 * The panel is the source of truth: it counts the bytes and starts and ends
 * the clock. Every few minutes each panel's users are read in pages and the
 * matching subscriptions updated. A status change (on hold to active, active
 * to limited) is written to the subscription's history, which is what the
 * reminders (M6) and support read.
 *
 * Subscriptions we did not make on this panel are ignored, and so are ours
 * that are not on it yet (still provisioning) or deleted.
 */

const PAGE = 200;
const OURS = "sk_";

/** Statuses the panel can change, so the ones the sync keeps up to date. */
const SYNCED = ["on_hold", "active", "limited", "expired", "disabled"] as const;

const MISSING = "Not found on the panel";

/** Applies what the panel says to one subscription; records a status change. */
const apply = async (db: Db, current: SubscriptionRow, user: PanelUser) => {
  const next = fromPanel(user);
  await db.transaction(async (tx) => {
    await tx.update(subscriptions).set(next).where(eq(subscriptions.id, current.id));
    if (next.status !== current.status) {
      await recordHistory(tx, current.id, "status_changed", "system", {
        from: current.status,
        to: next.status,
      });
    }
  });
};

const markMissing = async (db: Db, current: SubscriptionRow) => {
  // Said once, not every five minutes.
  if (current.lastError === MISSING) return;
  await db.transaction(async (tx) => {
    await tx.update(subscriptions).set({ lastError: MISSING }).where(eq(subscriptions.id, current.id));
    await recordHistory(tx, current.id, "missing_on_panel", "system");
  });
};

/** Whether anything we keep differs, so unchanged rows are not rewritten. */
const differs = (current: SubscriptionRow, user: PanelUser) => {
  const next = fromPanel(user);
  return (
    next.status !== current.status ||
    next.usedBytes !== current.usedBytes ||
    next.lifetimeUsedBytes !== current.lifetimeUsedBytes ||
    next.dataLimitBytes !== current.dataLimitBytes ||
    next.deviceLimit !== current.deviceLimit ||
    next.expiresAt?.getTime() !== current.expiresAt?.getTime() ||
    next.onlineAt?.getTime() !== current.onlineAt?.getTime() ||
    next.panelSubscriptionUrl !== current.panelSubscriptionUrl ||
    next.panelUserId !== current.panelUserId ||
    next.onHoldDurationSeconds !== current.onHoldDurationSeconds ||
    current.lastError !== null
  );
};

export type SyncResult = { seen: number; updated: number; missing: number };

export const syncPanel = async (db: Db, panel: PanelRow): Promise<SyncResult> => {
  const driver = driverFor(panel);
  const ours = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.panelId, panel.id), inArray(subscriptions.status, [...SYNCED])));
  const byUsername = new Map(ours.map((row) => [row.panelUsername, row]));

  const seen: string[] = [];
  let updated = 0;
  for (let offset = 0; ; offset += PAGE) {
    const page = await driver.listUsers({ offset, limit: PAGE });
    for (const user of page.users) {
      if (!user.username.startsWith(OURS)) continue;
      const current = byUsername.get(user.username);
      if (!current) continue;
      seen.push(user.username);
      if (differs(current, user)) {
        await apply(db, current, user);
        updated += 1;
      }
    }
    if (page.users.length < PAGE || offset + PAGE >= page.total) break;
  }

  // One statement for "checked just now", rather than a write per unchanged row.
  if (seen.length > 0) {
    await db
      .update(subscriptions)
      .set({ lastSyncedAt: new Date() })
      .where(and(eq(subscriptions.panelId, panel.id), inArray(subscriptions.panelUsername, seen)));
  }

  const found = new Set(seen);
  const missing = ours.filter((row) => !found.has(row.panelUsername));
  for (const row of missing) await markMissing(db, row);

  await db
    .update(panels)
    .set({ lastOkAt: new Date(), lastError: null })
    .where(eq(panels.id, panel.id));
  return { seen: seen.length, updated, missing: missing.length };
};

/** Every active panel. One panel being down does not stop the others. */
export const syncAllPanels = async (db: Db) => {
  const active = await db.select().from(panels).where(eq(panels.isActive, true));
  const results: Record<string, SyncResult | { error: string }> = {};
  for (const panel of active) {
    try {
      results[panel.id] = await syncPanel(db, panel);
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      results[panel.id] = { error: message };
      await db.update(panels).set({ lastError: message }).where(eq(panels.id, panel.id));
    }
  }
  return results;
};

/** One subscription, now: for staff, and when a customer opens their panel. */
export const syncSubscription = async (db: Db, current: SubscriptionRow) => {
  const [panel] = await db.select().from(panels).where(eq(panels.id, current.panelId));
  const user = await driverFor(panel!).getUser(current.panelUsername);
  if (user) await apply(db, current, user);
  else await markMissing(db, current);
};

