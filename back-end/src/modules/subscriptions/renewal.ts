import type { PublicPlan, TrafficReset } from "@shah-kelid/contracts";
import { and, eq } from "drizzle-orm";

import type { Db, Executor } from "../../platform/db/client";
import { ApiError, notFound } from "../../platform/http/api-error";
import { recordEvent } from "../../platform/outbox/outbox";
import { orderItems, orders } from "../billing/schema";
import { format, notifyCustomer, siteUrl } from "../notifications/notify";
import type { PanelUser } from "../provisioning/driver";
import { driverFor } from "../provisioning/drivers";
import { subscriptionEvents, subscriptionGroups, subscriptionPanels, subscriptions } from "./schema";
import { MISSING, isMade, limitFor, memberFromPanel, membersOf, saveMember, subscriptionFrom, totalsOf, type MemberRow } from "./members";
import { recordHistory } from "./service";
import { groupIdsOfPlan, panelsOfGroups } from "../groups/service";
import { alignGroups } from "../provisioning/groups";

/**
 * Renewing: more time and more volume on a subscription the customer
 * already has, on the same panel user, so their link never changes.
 *
 * The rule (your decision in M6): the renewal takes effect at once and
 * nothing already paid for is lost. The plan's days are added to the
 * current expiry and its volume to what is left. An expired subscription
 * starts again from today with the plan's volume. One still waiting for its
 * first connection gets the days added to the time that will start then.
 *
 * Applying it is a call to the panel, retried if the panel is down. A retry
 * must not add the time twice, so the target (the new expiry and the new
 * limit, as absolute values) is worked out once, from what the panel said
 * the first time, and recorded; every attempt sets that same target.
 */

export const RENEWAL_TOPIC = "order.renewal_paid";

/** What can be renewed: on the panel and not switched off by staff. */
export const RENEWABLE = ["on_hold", "active", "limited", "expired"] as const;

type Snapshot = PublicPlan & { trafficReset?: TrafficReset };

/**
 * Checks that this customer may renew this subscription with this plan,
 * before they are asked to pay for it.
 */
export const assertRenewable = async (executor: Executor, userId: string, subscriptionId: string, planId: string) => {
  const [subscription] = await executor
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, userId)));
  if (!subscription) throw notFound("No such subscription");
  if (!(RENEWABLE as readonly string[]).includes(subscription.status)) {
    throw new ApiError(409, "NOT_RENEWABLE", `The subscription is ${subscription.status}`);
  }
  // Renewed where it already is: the plan's groups must take from at least
  // one panel the subscription is on.
  const sold = await panelsOfGroups(executor, await groupIdsOfPlan(executor, planId));
  const on = await executor
    .select({ panelId: subscriptionPanels.panelId })
    .from(subscriptionPanels)
    .where(eq(subscriptionPanels.subscriptionId, subscription.id));
  if (!sold.some((entry) => on.some((member) => member.panelId === entry.panelId))) {
    throw new ApiError(409, "PLAN_NOT_ON_SALE", "That plan is not sold on any of this subscription's panels");
  }
  return subscription;
};

/** The order is paid: ask the worker to apply it (inside the payment's transaction). */
export const requestRenewal = async (tx: Executor, order: typeof orders.$inferSelect) => {
  await recordHistory(tx, order.subscriptionId!, "renewal_paid", "system", {}, order.id);
  await recordEvent(tx, { topic: RENEWAL_TOPIC, aggregateType: "order", aggregateId: order.id });
};

type Target = {
  dataLimitBytes: number | null;
  deviceLimit: number | null;
  trafficReset: TrafficReset;
  /** ISO time; absent while on hold. */
  expiresAt?: string;
  onHoldDurationSeconds?: number;
  activate: boolean;
};

/** The new limits, as absolute values, from what the panel has now and the plan bought. */
export const renewalTarget = (
  user: Pick<PanelUser, "status" | "dataLimitBytes" | "usedBytes" | "expiresAt" | "onHoldDurationSeconds">,
  plan: Snapshot,
  now = new Date(),
): Target => {
  const days = plan.durationDays;
  const common = {
    deviceLimit: plan.deviceLimit,
    trafficReset: plan.trafficReset ?? "no_reset",
  };

  if (user.status === "on_hold") {
    return {
      ...common,
      dataLimitBytes:
        plan.dataLimitBytes === null || user.dataLimitBytes === null ? null : user.dataLimitBytes + plan.dataLimitBytes,
      onHoldDurationSeconds: (user.onHoldDurationSeconds ?? 0) + days * 86400,
      activate: false,
    };
  }

  const expired = user.status === "expired" || (user.expiresAt !== null && user.expiresAt <= now);
  const left = expired || user.dataLimitBytes === null ? 0 : Math.max(0, user.dataLimitBytes - user.usedBytes);
  // The panel counts usage up from the start of the period: the new limit is
  // what has been used, plus what was left, plus the plan.
  const dataLimitBytes = plan.dataLimitBytes === null ? null : user.usedBytes + left + plan.dataLimitBytes;
  const from = expired || user.expiresAt === null ? now : user.expiresAt;
  return {
    ...common,
    dataLimitBytes,
    expiresAt: new Date(from.getTime() + days * 86400_000).toISOString(),
    activate: true,
  };
};

/**
 * Applies a paid renewal to the panel. Run by the worker; safe to run again
 * (a fulfilled order is left alone; the target is worked out only once).
 */
export const applyRenewal = async (db: Db, orderId: string) => {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.kind !== "renewal" || order.status !== "paid") return "not_waiting" as const;

  const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const plan = item!.planSnapshot as Snapshot;
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, order.subscriptionId!));

  const [planned] = await db
    .select({ details: subscriptionEvents.details })
    .from(subscriptionEvents)
    .where(and(eq(subscriptionEvents.orderId, order.id), eq(subscriptionEvents.kind, "renewal_planned")));

  let target = (planned?.details as { target?: Target } | undefined)?.target;
  if (!target) {
    // From every panel's count as it is now: the subscription as one user.
    const fresh: MemberRow[] = [];
    for (const member of (await membersOf(db, subscription!.id)).filter(isMade)) {
      const user = await driverFor(member.panel).getUser(subscription!.panelUsername);
      if (!user) continue;
      await saveMember(db, member, memberFromPanel(user));
      fresh.push({ ...member, ...memberFromPanel(user) });
    }
    if (fresh.length === 0) throw new Error("The subscription is not on its panel");
    const now = totalsOf(subscription!.dataLimitBytes, fresh);
    target = renewalTarget(
      {
        status: now.status as PanelUser["status"],
        dataLimitBytes: subscription!.dataLimitBytes,
        usedBytes: now.usedBytes,
        expiresAt: now.expiresAt,
        onHoldDurationSeconds: now.onHoldDurationSeconds,
      },
      plan,
    );
    await recordHistory(db, subscription!.id, "renewal_planned", "system", { target }, order.id);
  }

  // The same target on every panel; each panel's limit is what it counted
  // itself plus what the renewed subscription has left overall.
  const members = (await membersOf(db, subscription!.id)).filter((member) => isMade(member) && member.lastError !== MISSING);
  if (members.length === 0) throw new Error("The subscription is not on its panel");
  const used = members.reduce((sum, member) => sum + member.usedBytes, 0);
  for (const member of members) {
    const user = await driverFor(member.panel).updateLimits(subscription!.panelUsername, {
      dataLimitBytes: limitFor(target.dataLimitBytes, member, used),
      deviceLimit: target.deviceLimit,
      trafficReset: target.trafficReset,
      ...(target.expiresAt ? { expiresAt: new Date(target.expiresAt) } : {}),
      ...(target.onHoldDurationSeconds !== undefined ? { onHoldDurationSeconds: target.onHoldDurationSeconds } : {}),
      activate: target.activate,
    });
    await saveMember(db, member, memberFromPanel(user));
  }

  const renewed = subscriptionFrom(
    { dataLimitBytes: target.dataLimitBytes, panelId: subscription!.panelId },
    await membersOf(db, subscription!.id),
  );
  await db.transaction(async (tx) => {
    const done = await tx
      .update(orders)
      .set({ status: "fulfilled", fulfilledAt: new Date() })
      .where(and(eq(orders.id, order.id), eq(orders.status, "paid")))
      .returning({ id: orders.id });
    if (done.length === 0) return;
    await tx
      .update(subscriptions)
      .set({ ...renewed, dataLimitBytes: target.dataLimitBytes, deviceLimit: target.deviceLimit, planId: plan.id })
      .where(eq(subscriptions.id, subscription!.id));
    // Renewed with a plan of other groups: from now on it gets those.
    const groupIds = await groupIdsOfPlan(tx, plan.id);
    if (groupIds.length > 0) {
      await tx.delete(subscriptionGroups).where(eq(subscriptionGroups.subscriptionId, subscription!.id));
      await tx.insert(subscriptionGroups).values(groupIds.map((groupId) => ({ subscriptionId: subscription!.id, groupId })));
    }
    await recordHistory(tx, subscription!.id, "renewed", "system", { planId: plan.id, days: plan.durationDays }, order.id);
    await notifyCustomer(tx, subscription!.userId, "subscription_renewed", {
      plan_name: plan.name,
      expires_on: renewed.expiresAt
        ? format.date(renewed.expiresAt)
        : "اولین اتصال + " + format.days(Math.round((renewed.onHoldDurationSeconds ?? 0) / 86400)),
      remaining: format.gb(target.dataLimitBytes === null ? null : Math.max(0, target.dataLimitBytes - renewed.usedBytes)),
      account_url: siteUrl.account(),
    });
  });
  // Panel users given the plan's groups now rather than at the next sync; a
  // panel it was not on is made by the sync.
  await alignGroups(db, subscription!.id).catch(() => undefined);
  return "renewed" as const;
};
