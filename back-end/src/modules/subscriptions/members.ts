import type { SubscriptionStatus } from "@shah-kelid/contracts";
import { and, asc, eq, inArray } from "drizzle-orm";

import logger from "../../libraries/logger";
import type { Db, Executor } from "../../platform/db/client";
import { panels } from "../infrastructure/schema";
import type { LimitsChange, PanelUser } from "../provisioning/driver";
import { driverFor, type PanelRow } from "../provisioning/drivers";
import { subscriptionPanels, subscriptions } from "./schema";
import { recordHistory, type SubscriptionRow } from "./service";

/**
 * One subscription on several panels.
 *
 * The customer has one link and one volume. On each panel there is a panel
 * user with the same username; each panel counts what is used through its
 * own configs. Here:
 *
 * - The subscription's usage is the sum of its panels' usage: 1 GB on one
 *   panel and 2 GB on another is 3 GB used.
 * - The subscription's limit is ours (the plan's volume, plus renewals).
 *   Each panel is given "what it has counted itself, plus what is left
 *   overall" as its limit, so whichever panel the customer uses, it stops
 *   them when the whole volume is gone. The limits are set again after
 *   every sync that finds new usage.
 * - The clock is one: when the first panel sees a connection and starts the
 *   time, the others are started with the same expiry.
 *
 * Between two syncs a customer using two panels at once could go over by
 * what they use in that time; SLACK bounds what is tolerated on top.
 */

export type MemberRow = typeof subscriptionPanels.$inferSelect;
export type Member = MemberRow & { panel: PanelRow };

/** A difference in a panel's limit smaller than this is left for the next sync. */
export const SLACK_BYTES = 16 * 1024 * 1024;

/** Statuses the panels decide, so the ones kept in step with them. */
export const SYNCED = ["on_hold", "active", "limited", "expired", "disabled"] as const;

export const MISSING = "Not found on the panel";

/** Whether the user exists on this panel (as far as we know). */
export const isMade = (member: MemberRow) => member.panelUserId !== null;

export const membersOf = async (executor: Executor, subscriptionId: string): Promise<Member[]> => {
  const rows = await executor
    .select({ member: subscriptionPanels, panel: panels })
    .from(subscriptionPanels)
    .innerJoin(panels, eq(panels.id, subscriptionPanels.panelId))
    .where(eq(subscriptionPanels.subscriptionId, subscriptionId))
    .orderBy(asc(subscriptionPanels.createdAt), asc(subscriptionPanels.panelId));
  return rows.map(({ member, panel }) => ({ ...member, panel }));
};

/** What a panel says about its user, as that panel's columns. */
export const memberFromPanel = (user: PanelUser) => ({
  panelUserId: user.id,
  panelSubscriptionUrl: user.subscriptionUrl,
  panelStatus: user.status as string,
  dataLimitBytes: user.dataLimitBytes,
  usedBytes: user.usedBytes,
  lifetimeUsedBytes: Math.max(user.lifetimeUsedBytes, user.usedBytes),
  expiresAt: user.expiresAt,
  onHoldDurationSeconds: user.onHoldDurationSeconds,
  onlineAt: user.onlineAt,
  lastSyncedAt: new Date(),
  lastError: null,
});

export const saveMember = (executor: Executor, member: Pick<MemberRow, "subscriptionId" | "panelId">, change: Partial<MemberRow>) =>
  executor
    .update(subscriptionPanels)
    .set(change)
    .where(and(eq(subscriptionPanels.subscriptionId, member.subscriptionId), eq(subscriptionPanels.panelId, member.panelId)));

const latest = (dates: (Date | null)[]) =>
  dates.reduce<Date | null>((best, date) => (date && (!best || date > best) ? date : best), null);

/**
 * The subscription as a whole, from its panels: usage added up, one status,
 * one expiry.
 */
export const totalsOf = (dataLimitBytes: number | null, members: MemberRow[], now = new Date()) => {
  const made = members.filter(isMade);
  const usedBytes = made.reduce((sum, member) => sum + member.usedBytes, 0);
  const lifetimeUsedBytes = made.reduce((sum, member) => sum + member.lifetimeUsedBytes, 0);
  const onlineAt = latest(made.map((member) => member.onlineAt));

  // A panel switched off by hand does not decide for the others.
  const enabled = made.filter((member) => member.panelStatus !== "disabled");
  let status: SubscriptionStatus;
  let expiresAt: Date | null = null;
  let onHoldDurationSeconds: number | null = null;

  if (made.length > 0 && enabled.length === 0) {
    status = "disabled";
    expiresAt = made.find((member) => member.expiresAt)?.expiresAt ?? null;
  } else if (enabled.every((member) => member.panelStatus === "on_hold")) {
    status = "on_hold";
    onHoldDurationSeconds = enabled.reduce<number | null>(
      (most, member) => (member.onHoldDurationSeconds !== null && (most === null || member.onHoldDurationSeconds > most) ? member.onHoldDurationSeconds : most),
      null,
    );
  } else {
    // Started: the clock is the first panel's to have started it.
    const started = enabled.filter((member) => member.panelStatus !== "on_hold");
    expiresAt = started.reduce<Date | null>(
      (first, member) => (member.expiresAt && (!first || member.expiresAt < first) ? member.expiresAt : first),
      null,
    );
    const outOfTime = (expiresAt !== null && expiresAt <= now) || started.some((member) => member.panelStatus === "expired");
    const outOfVolume =
      dataLimitBytes !== null
        ? usedBytes >= dataLimitBytes
        : started.every((member) => member.panelStatus === "limited");
    status = outOfTime ? "expired" : outOfVolume ? "limited" : "active";
  }

  return { status, usedBytes, lifetimeUsedBytes, onlineAt, expiresAt, onHoldDurationSeconds };
};

/** The limit one panel should have: what it counted itself, plus what is left overall. */
export const limitFor = (dataLimitBytes: number | null, member: MemberRow, totalUsedBytes: number) =>
  dataLimitBytes === null
    ? null
    : // Never 0: that is "unlimited" to the panels.
      Math.max(1, member.usedBytes + Math.max(0, dataLimitBytes - totalUsedBytes));

/** What must change on one panel for it to agree with the whole. */
const changeFor = (
  dataLimitBytes: number | null,
  member: MemberRow,
  totals: ReturnType<typeof totalsOf>,
): LimitsChange | null => {
  if (member.panelStatus === "disabled") return null;
  const change: LimitsChange = {};

  const wanted = limitFor(dataLimitBytes, member, totals.usedBytes);
  const has = member.dataLimitBytes;
  const remaining = dataLimitBytes === null ? Infinity : Math.max(0, dataLimitBytes - totals.usedBytes);
  const wronglyStopped = member.panelStatus === "limited" && (wanted === null || member.usedBytes < wanted);
  if (
    wanted !== has &&
    (wanted === null || has === null || Math.abs(wanted - has) > SLACK_BYTES || remaining <= SLACK_BYTES || wronglyStopped)
  ) {
    change.dataLimitBytes = wanted;
  }
  if (wronglyStopped) change.activate = true;

  if (totals.status !== "on_hold" && totals.status !== "disabled") {
    if (member.panelStatus === "on_hold") {
      // Another panel saw the first connection: this one's clock starts with it.
      change.expiresAt = totals.expiresAt;
      change.activate = true;
    } else if ((member.expiresAt?.getTime() ?? null) !== (totals.expiresAt?.getTime() ?? null)) {
      change.expiresAt = totals.expiresAt;
    }
  }
  return Object.keys(change).length > 0 ? change : null;
};

/** The subscription's own columns, from its panels. */
export const subscriptionFrom = (subscription: Pick<SubscriptionRow, "dataLimitBytes" | "panelId">, members: MemberRow[]) => {
  const totals = totalsOf(subscription.dataLimitBytes, members);
  const primary = members.find((member) => member.panelId === subscription.panelId) ?? members[0];
  const missing = members.some((member) => member.lastError === MISSING);
  return {
    ...totals,
    panelUserId: primary?.panelUserId ?? null,
    panelSubscriptionUrl: primary?.panelSubscriptionUrl ?? null,
    lastSyncedAt: new Date(),
    lastError: missing ? MISSING : null,
  };
};

/**
 * Brings a subscription and its panels into agreement, after its panels'
 * rows were refreshed: sets each panel's limit and expiry where they are
 * out of step, then writes the totals on the subscription.
 *
 * A panel that cannot be reached keeps its row's error and is tried again
 * at the next sync; the others are still set.
 */
export const reconcile = async (db: Db, subscriptionId: string) => {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId));
  if (!subscription || !(SYNCED as readonly string[]).includes(subscription.status)) return;

  let members = await membersOf(db, subscriptionId);
  if (!members.some(isMade)) return;

  // A panel its user has gone from keeps its last count in the total, and
  // is not asked for anything.
  const totals = totalsOf(subscription.dataLimitBytes, members);
  let changed = false;
  for (const member of members.filter((row) => isMade(row) && row.lastError !== MISSING)) {
    const change = changeFor(subscription.dataLimitBytes, member, totals);
    if (!change) continue;
    try {
      const user = await driverFor(member.panel).updateLimits(subscription.panelUsername, change);
      await saveMember(db, member, memberFromPanel(user));
      changed = true;
    } catch (error) {
      logger.warn({ err: error, subscriptionId, panelId: member.panelId }, "A panel's limits could not be set; the next sync tries again");
      await saveMember(db, member, { lastError: (error as Error).message.slice(0, 500) });
    }
  }
  if (changed) members = await membersOf(db, subscriptionId);

  const next = subscriptionFrom(subscription, members);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(subscriptions)
      .set(next)
      // Only while the panels still decide: staff (or an account being
      // deleted) may have deleted it meanwhile, and must not be undone.
      .where(and(eq(subscriptions.id, subscriptionId), inArray(subscriptions.status, [...SYNCED])))
      .returning({ id: subscriptions.id });
    if (updated.length === 0) return;
    if (next.status !== subscription.status) {
      await recordHistory(tx, subscriptionId, "status_changed", "system", { from: subscription.status, to: next.status });
    }
    // Said once, not at every sync.
    if (next.lastError === MISSING && subscription.lastError !== MISSING) {
      await recordHistory(tx, subscriptionId, "missing_on_panel", "system");
    }
  });
};

/**
 * Reads one subscription from every panel it is on, now, and reconciles.
 * Throws when a panel cannot be read (the caller decides what that means).
 */
export const refreshSubscription = async (db: Db, subscription: Pick<SubscriptionRow, "id" | "panelUsername">) => {
  const members = await membersOf(db, subscription.id);
  const failures: unknown[] = [];
  for (const member of members.filter(isMade)) {
    try {
      const user = await driverFor(member.panel).getUser(subscription.panelUsername);
      await saveMember(db, member, user ? memberFromPanel(user) : { lastError: MISSING });
    } catch (error) {
      failures.push(error);
    }
  }
  // Every panel unreachable: nothing new is known.
  if (failures.length > 0 && failures.length === members.filter(isMade).length) throw failures[0];
  await reconcile(db, subscription.id);
};
