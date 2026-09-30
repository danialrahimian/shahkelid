import type { PublicPlan, TrafficReset } from "@shah-kelid/contracts";
import { and, eq } from "drizzle-orm";

import type { Db, Executor } from "../../platform/db/client";
import { ApiError, notFound } from "../../platform/http/api-error";
import { recordEvent } from "../../platform/outbox/outbox";
import { orderItems, orders } from "../billing/schema";
import { planPanelSettings } from "../catalog/schema";
import { findPanel } from "../infrastructure/service";
import type { PanelUser } from "../provisioning/driver";
import { driverFor } from "../provisioning/drivers";
import { subscriptionEvents, subscriptions } from "./schema";
import { fromPanel, groupsFor, recordHistory } from "./service";

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
  const [soldThere] = await executor
    .select({ planId: planPanelSettings.planId })
    .from(planPanelSettings)
    .where(and(eq(planPanelSettings.planId, planId), eq(planPanelSettings.panelId, subscription.panelId)));
  if (!soldThere) {
    throw new ApiError(409, "PLAN_NOT_ON_SALE", "That plan is not sold on this subscription's panel");
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
export const renewalTarget = (user: PanelUser, plan: Snapshot, now = new Date()): Target => {
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
  const driver = driverFor(await findPanel(db, subscription!.panelId));

  const [planned] = await db
    .select({ details: subscriptionEvents.details })
    .from(subscriptionEvents)
    .where(and(eq(subscriptionEvents.orderId, order.id), eq(subscriptionEvents.kind, "renewal_planned")));

  let target = (planned?.details as { target?: Target } | undefined)?.target;
  if (!target) {
    const user = await driver.getUser(subscription!.panelUsername);
    if (!user) throw new Error("The subscription is not on its panel");
    target = renewalTarget(user, plan);
    await recordHistory(db, subscription!.id, "renewal_planned", "system", { target }, order.id);
  }

  const user = await driver.updateLimits(subscription!.panelUsername, {
    dataLimitBytes: target.dataLimitBytes,
    deviceLimit: target.deviceLimit,
    trafficReset: target.trafficReset,
    groupIds: await groupsFor(db, { ...subscription!, planId: plan.id }),
    ...(target.expiresAt ? { expiresAt: new Date(target.expiresAt) } : {}),
    ...(target.onHoldDurationSeconds !== undefined ? { onHoldDurationSeconds: target.onHoldDurationSeconds } : {}),
    activate: target.activate,
  });

  await db.transaction(async (tx) => {
    const done = await tx
      .update(orders)
      .set({ status: "fulfilled", fulfilledAt: new Date() })
      .where(and(eq(orders.id, order.id), eq(orders.status, "paid")))
      .returning({ id: orders.id });
    if (done.length === 0) return;
    await tx
      .update(subscriptions)
      .set({ ...fromPanel(user), planId: plan.id })
      .where(eq(subscriptions.id, subscription!.id));
    await recordHistory(tx, subscription!.id, "renewed", "system", { planId: plan.id, days: plan.durationDays }, order.id);
  });
  return "renewed" as const;
};
