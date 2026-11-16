import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "../../platform/db/client";
import { panels } from "../infrastructure/schema";
import {
  MISSING,
  SYNCED,
  isMade,
  memberFromPanel,
  reconcile,
  refreshSubscription,
  saveMember,
  type MemberRow,
} from "../subscriptions/members";
import { subscriptionPanels, subscriptions } from "../subscriptions/schema";
import type { SubscriptionRow } from "../subscriptions/service";
import type { PanelUser } from "./driver";
import { driverFor, type PanelRow } from "./drivers";
import { provisionPending } from "./provision";

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
 *
 * A subscription may be on several panels (subscriptions/members.ts). Each
 * panel's own count is kept on its row; once the panels are read, every
 * subscription that changed is reconciled: its usage added up, and each
 * panel's limit set to what that panel counted plus what is left overall.
 */

const PAGE = 200;
const OURS = "sk_";

/** PostgreSQL takes at most 65,535 parameters in one statement. */
const CHUNK = 5000;

/** Whether anything we keep differs, so unchanged rows are not rewritten. */
const differs = (current: MemberRow, user: PanelUser) => {
  const next = memberFromPanel(user);
  return (
    next.panelStatus !== current.panelStatus ||
    next.usedBytes !== current.usedBytes ||
    next.lifetimeUsedBytes !== current.lifetimeUsedBytes ||
    next.dataLimitBytes !== current.dataLimitBytes ||
    next.expiresAt?.getTime() !== current.expiresAt?.getTime() ||
    next.onlineAt?.getTime() !== current.onlineAt?.getTime() ||
    next.panelSubscriptionUrl !== current.panelSubscriptionUrl ||
    next.panelUserId !== current.panelUserId ||
    next.onHoldDurationSeconds !== current.onHoldDurationSeconds ||
    current.lastError !== null
  );
};

export type SyncResult = { seen: number; updated: number; missing: number };

/** Reads one panel's users into its rows. Returns the subscriptions to reconcile. */
const readPanel = async (db: Db, panel: PanelRow) => {
  const driver = driverFor(panel);
  const ours = await db
    .select({ member: subscriptionPanels, username: subscriptions.panelUsername })
    .from(subscriptionPanels)
    .innerJoin(subscriptions, eq(subscriptions.id, subscriptionPanels.subscriptionId))
    .where(and(eq(subscriptionPanels.panelId, panel.id), inArray(subscriptions.status, [...SYNCED])));
  const byUsername = new Map(ours.filter(({ member }) => isMade(member)).map((row) => [row.username, row.member]));

  const touched = new Set<string>();
  const seen: string[] = [];
  let updated = 0;
  for (let offset = 0; ; offset += PAGE) {
    const page = await driver.listUsers({ offset, limit: PAGE });
    for (const user of page.users) {
      if (!user.username.startsWith(OURS)) continue;
      const current = byUsername.get(user.username);
      if (!current) continue;
      seen.push(current.subscriptionId);
      byUsername.delete(user.username);
      if (differs(current, user)) {
        await saveMember(db, current, memberFromPanel(user));
        touched.add(current.subscriptionId);
        updated += 1;
      }
    }
    if (page.users.length < PAGE || offset + PAGE >= page.total) break;
  }

  // A statement per few thousand for "checked just now", rather than a write
  // per unchanged row (and never one statement too big for PostgreSQL).
  const checkedAt = new Date();
  for (let start = 0; start < seen.length; start += CHUNK) {
    const ids = seen.slice(start, start + CHUNK);
    await db
      .update(subscriptionPanels)
      .set({ lastSyncedAt: checkedAt })
      .where(and(eq(subscriptionPanels.panelId, panel.id), inArray(subscriptionPanels.subscriptionId, ids)));
    await db.update(subscriptions).set({ lastSyncedAt: checkedAt }).where(inArray(subscriptions.id, ids));
  }

  // Ours, made here, and not in the panel's list any more.
  let missing = 0;
  for (const member of byUsername.values()) {
    missing += 1;
    if (member.lastError === MISSING) continue;
    await saveMember(db, member, { lastError: MISSING });
    touched.add(member.subscriptionId);
  }

  // Not made here yet (the panel was down or said no when the others were made).
  const pending = ours.filter(({ member }) => !isMade(member)).map(({ member }) => member.subscriptionId);

  await db
    .update(panels)
    .set({ lastOkAt: new Date(), lastError: null })
    .where(eq(panels.id, panel.id));
  return { result: { seen: seen.length, updated, missing }, touched, pending };
};

const settle = async (db: Db, touched: Iterable<string>, pending: Iterable<string>) => {
  const again = new Set(touched);
  for (const id of new Set(pending)) {
    if (await provisionPending(db, id)) again.add(id);
  }
  for (const id of again) await reconcile(db, id);
};

export const syncPanel = async (db: Db, panel: PanelRow): Promise<SyncResult> => {
  const { result, touched, pending } = await readPanel(db, panel);
  await settle(db, touched, pending);
  return result;
};

/**
 * Every active panel. One panel being down does not stop the others. The
 * subscriptions are reconciled once all panels are read, so each panel's
 * limit is worked out from every panel's latest count.
 */
export const syncAllPanels = async (db: Db) => {
  const active = await db.select().from(panels).where(eq(panels.isActive, true));
  const results: Record<string, SyncResult | { error: string }> = {};
  const touched = new Set<string>();
  const pending = new Set<string>();
  for (const panel of active) {
    try {
      const read = await readPanel(db, panel);
      results[panel.id] = read.result;
      read.touched.forEach((id) => touched.add(id));
      read.pending.forEach((id) => pending.add(id));
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      results[panel.id] = { error: message };
      await db.update(panels).set({ lastError: message }).where(eq(panels.id, panel.id));
    }
  }
  await settle(db, touched, pending);
  return results;
};

/** One subscription, now: for staff, and when a customer opens their panel. */
export const syncSubscription = (db: Db, current: SubscriptionRow) => refreshSubscription(db, current);
