import type { OrderView, PublicPlan } from "@shah-kelid/contracts";
import { and, asc, desc, eq, exists, inArray, isNull, lt, sql } from "drizzle-orm";

import config from "../../config";
import type { Db, Executor } from "../../platform/db/client";
import { ApiError, notFound } from "../../platform/http/api-error";
import { planPanelSettings, plans } from "../catalog/schema";
import { users } from "../identity/schema";
import { post } from "../ledger/ledger";
import { alertStaff } from "../notifications/alerts";
import { panels } from "../infrastructure/schema";
import { subscriptions } from "../subscriptions/schema";
import { createSubscription, linkFor } from "../subscriptions/service";
import { quoteForPayment } from "./crypto-quote";
import { invoices, orderItems, orders, payments } from "./schema";

/**
 * Orders: what a customer is buying, and everything that happens once it is
 * paid for.
 *
 * The one rule this module exists to keep: **once money is confirmed, it is
 * recorded, whatever else fails.** Settling a payment is a single
 * transaction (the payment, the ledger, the order, the invoice), and making
 * the subscription is tried inside it on its own savepoint. No room on any
 * server, a plan gone off sale: the subscription waits, staff are told, and
 * the money is still on the books.
 */

export type OrderRow = typeof orders.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
type PlanRow = typeof plans.$inferSelect;

const GATEWAY_ACCOUNT = {
  zarinpal: "gateway_zarinpal",
  card_transfer: "gateway_card",
  nowpayments: "gateway_nowpayments",
  usdt_tron: "gateway_usdt_tron",
} as const;

// ------------------------------------------------------------------ plans

export const toPublicPlan = (plan: PlanRow | PublicPlan): PublicPlan => ({
  id: plan.id,
  slug: plan.slug,
  name: plan.name,
  description: plan.description,
  dataLimitBytes: plan.dataLimitBytes,
  durationDays: plan.durationDays,
  deviceLimit: plan.deviceLimit,
  priceToman: plan.priceToman,
});

/** Plans on sale: active, public, not archived, not the trial, and sold on at least one panel. */
const onSale = and(
  eq(plans.isActive, true),
  eq(plans.isPublic, true),
  eq(plans.isTrial, false),
  isNull(plans.archivedAt),
  exists(
    sql`(select 1 from ${planPanelSettings} pps where pps.plan_id = ${plans.id})`,
  ),
);

export const plansOnSale = async (db: Db) =>
  (await db.select().from(plans).where(onSale).orderBy(asc(plans.sortOrder), asc(plans.priceToman))).map(
    toPublicPlan,
  );

// ----------------------------------------------------------------- reading

const orderOf = async (executor: Executor, userId: string, orderId: string) => {
  const [order] = await executor
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
  if (!order) throw notFound("No such order");
  return order;
};

const snapshotOf = async (executor: Executor, orderId: string): Promise<PublicPlan> => {
  const [item] = await executor.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return item!.planSnapshot as PublicPlan;
};

export const orderView = async (executor: Executor, order: OrderRow): Promise<OrderView> => {
  const [payment] = await executor
    .select()
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  let subscription: OrderView["subscription"] = null;
  if (order.subscriptionId) {
    const [row] = await executor
      .select({ subscription: subscriptions, subscriptionBaseUrl: panels.subscriptionBaseUrl })
      .from(subscriptions)
      .innerJoin(panels, eq(panels.id, subscriptions.panelId))
      .where(eq(subscriptions.id, order.subscriptionId));
    if (row) {
      const ready = !["provisioning", "provisioning_failed", "deleted"].includes(row.subscription.status);
      subscription = {
        id: row.subscription.id,
        status: row.subscription.status,
        link: ready ? linkFor(row.subscription.accessToken, row.subscriptionBaseUrl) : null,
      };
    }
  }

  const [invoice] = await executor
    .select({ number: invoices.number })
    .from(invoices)
    .where(eq(invoices.orderId, order.id));

  return {
    id: order.id,
    number: order.number,
    status: order.status,
    totalToman: order.totalToman,
    plan: await snapshotOf(executor, order.id),
    createdAt: order.createdAt.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    payment: payment
      ? {
          method: payment.method,
          status: payment.status,
          refId: payment.providerRefId,
          failureReason: payment.failureReason,
          crypto:
            payment.method === "usdt_tron" && payment.status === "pending"
              ? await quoteForPayment(executor, payment.id)
              : null,
        }
      : null,
    subscription,
    invoiceNumber: invoice?.number ?? null,
  };
};

export const myOrder = async (db: Db, userId: string, orderId: string) =>
  orderView(db, await orderOf(db, userId, orderId));

export const myOrders = async (db: Db, userId: string) => {
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(50);
  return Promise.all(rows.map((order) => orderView(db, order)));
};

// ---------------------------------------------------------------- ordering

/**
 * A new order for a plan. With an idempotency key, asking twice (a double
 * click, a retried request) returns the first order instead of a second.
 */
export const createOrder = async (
  db: Db,
  userId: string,
  planId: string,
  idempotencyKey?: string,
): Promise<OrderView> => {
  if (idempotencyKey) {
    const [existing] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, idempotencyKey)));
    if (existing) return orderView(db, existing);
  }

  const [plan] = await db.select().from(plans).where(and(eq(plans.id, planId), onSale));
  if (!plan) throw new ApiError(404, "PLAN_NOT_ON_SALE", "That plan is not on sale");

  try {
    const order = await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(orders)
        .values({
          userId,
          kind: "new",
          subtotalToman: plan.priceToman,
          totalToman: plan.priceToman,
          idempotencyKey: idempotencyKey ?? null,
          expiresAt: new Date(Date.now() + config.checkout.orderTtlMs),
        })
        .returning();
      await tx.insert(orderItems).values({
        orderId: order!.id,
        planId: plan.id,
        planSnapshot: { ...toPublicPlan(plan), trafficReset: plan.trafficReset },
        unitPriceToman: plan.priceToman,
        totalToman: plan.priceToman,
      });
      // Nothing to pay: it is paid.
      if (plan.priceToman === 0) return markPaidAndFulfil(tx, order!, null);
      return order!;
    });
    return orderView(db, order);
  } catch (error) {
    // The same key sent twice at once: the second insert lost the race.
    const cause = (error as { cause?: { code?: string } }).cause ?? error;
    if (idempotencyKey && (cause as { code?: string }).code === "23505") {
      const [existing] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, idempotencyKey)));
      if (existing) return orderView(db, existing);
    }
    throw error;
  }
};

/** An order that can still be paid: this customer's, pending, not lapsed. */
export const payableOrder = async (executor: Executor, userId: string, orderId: string) => {
  const order = await orderOf(executor, userId, orderId);
  if (order.status !== "pending" || order.expiresAt.getTime() < Date.now()) {
    throw new ApiError(409, "ORDER_NOT_PAYABLE", `The order is ${order.status}`);
  }
  return order;
};

// ---------------------------------------------------------------- settling

/**
 * The order is paid: record it, issue the invoice, and make the
 * subscription. The subscription is tried on a savepoint, so its failure
 * cannot undo the rest.
 */
const markPaidAndFulfil = async (tx: Executor, order: OrderRow, paymentId: string | null) => {
  const [paid] = await tx
    .update(orders)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(orders.id, order.id))
    .returning();

  const plan = await snapshotOf(tx, order.id);
  const [customer] = await tx
    .select({ email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, order.userId));
  await tx.insert(invoices).values({
    orderId: order.id,
    userId: order.userId,
    subtotalToman: order.subtotalToman,
    discountToman: order.discountToman,
    totalToman: order.totalToman,
    lines: [{ description: plan.name, planId: plan.id, quantity: 1, unitPriceToman: order.totalToman }],
    customerSnapshot: customer ?? {},
  });

  return fulfil(tx, paid!, paymentId);
};

/** Makes the order's subscription, or leaves the order paid and tells staff why not. */
export const fulfil = async (tx: Executor, order: OrderRow, paymentId: string | null) => {
  const plan = await snapshotOf(tx, order.id);
  try {
    const subscriptionId = await tx.transaction((savepoint) =>
      createSubscription(savepoint, "system", { userId: order.userId, planId: plan.id, orderId: order.id }),
    );
    const [fulfilled] = await tx
      .update(orders)
      .set({ status: "fulfilled", fulfilledAt: new Date(), subscriptionId })
      .where(eq(orders.id, order.id))
      .returning();
    return fulfilled!;
  } catch (error) {
    const reason = error instanceof ApiError ? error.code : (error as Error).message;
    await alertStaff(
      tx,
      {
        subject: "سفارش پرداخت شد ولی سرویس ساخته نشد",
        text: [
          `سفارش ${order.number} (${plan.name}) پرداخت شده${paymentId ? ` (پرداخت ${paymentId})` : ""}، ولی اشتراکش ساخته نشد.`,
          `علت: ${reason}`,
          reason === "NO_SERVER_AVAILABLE"
            ? "هیچ سروری جای خالی ندارد. ظرفیت یک سرور را بالا ببرید یا سرور تازه اضافه کنید، بعد در صفحه‌ی سفارش «ساخت اشتراک» را بزنید."
            : "در بخش مدیریت، صفحه‌ی سفارش را باز کنید و «ساخت اشتراک» را بزنید.",
        ].join("\n"),
      },
      { type: "order", id: order.id },
    );
    return order;
  }
};

/**
 * A payment is confirmed (by the gateway, or by staff for a card transfer).
 * Safe to call twice: the second call finds the payment settled and does
 * nothing, so a duplicate callback cannot make a second subscription.
 */
export const settlePayment = async (
  db: Executor,
  paymentId: string,
  confirmation: {
    refId?: string | null;
    payload?: Record<string, unknown>;
    reviewedByUserId?: string;
    /** Settle only if the payment is still in this state (a receipt still waiting for review). */
    onlyFrom?: PaymentRow["status"];
  },
) =>
  db.transaction(async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!payment) throw notFound("No such payment");
    if (payment.status === "succeeded") return { settled: false as const, reason: "already" };
    if (confirmation.onlyFrom && payment.status !== confirmation.onlyFrom) {
      return { settled: false as const, reason: "not_waiting" };
    }

    const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).for("update");
    if (order!.status !== "pending" && order!.status !== "expired") {
      // Paid twice (two tabs, two methods): the money is real and must be returned.
      await tx
        .update(payments)
        .set({ status: "failed", failureReason: "order_already_paid", providerRefId: confirmation.refId ?? null })
        .where(eq(payments.id, paymentId));
      await alertStaff(
        tx,
        {
          subject: "پرداخت دوباره برای یک سفارش",
          text: `برای سفارش ${order!.number} دو پرداخت موفق رسید. پرداخت ${paymentId} (${payment.amountToman} تومان، کد پیگیری ${confirmation.refId ?? "-"}) باید به مشتری برگردانده شود.`,
        },
        { type: "payment", id: paymentId },
      );
      return { settled: false as const, reason: "order_already_paid" };
    }

    await tx
      .update(payments)
      .set({
        status: "succeeded",
        succeededAt: new Date(),
        providerRefId: confirmation.refId ?? payment.providerRefId,
        providerPayload: { ...(payment.providerPayload as object), ...(confirmation.payload ?? {}) },
        failureReason: null,
        ...(confirmation.reviewedByUserId
          ? { reviewedByUserId: confirmation.reviewedByUserId, reviewedAt: new Date() }
          : {}),
      })
      .where(eq(payments.id, paymentId));

    await post(tx, {
      kind: "order_payment",
      idempotencyKey: `payment:${paymentId}`,
      reference: { type: "payment", id: paymentId },
      memo: `order ${order!.number}`,
      createdByUserId: confirmation.reviewedByUserId ?? null,
      entries: [
        { account: GATEWAY_ACCOUNT[payment.method as keyof typeof GATEWAY_ACCOUNT], amountToman: -payment.amountToman },
        { account: "revenue", amountToman: payment.amountToman },
      ],
    });

    await markPaidAndFulfil(tx, order!, paymentId);
    return { settled: true as const };
  });

// ------------------------------------------------------------ housekeeping

/**
 * Unpaid orders lapse, and so do their unfinished payments. An order with a
 * receipt waiting for review does not: the customer has done their part.
 */
export const expireLapsedOrders = async (db: Db) =>
  db.transaction(async (tx) => {
    const lapsed = await tx
      .update(orders)
      .set({ status: "expired" })
      .where(
        and(
          eq(orders.status, "pending"),
          lt(orders.expiresAt, new Date()),
          sql`not exists (select 1 from ${payments} p where p.order_id = ${orders.id} and p.status = 'pending_review')`,
        ),
      )
      .returning({ id: orders.id });
    if (lapsed.length > 0) {
      await tx
        .update(payments)
        .set({ status: "expired" })
        .where(
          and(
            inArray(
              payments.orderId,
              lapsed.map((order) => order.id),
            ),
            inArray(payments.status, ["initiated", "pending"]),
          ),
        );
    }
    return lapsed.length;
  });

// ------------------------------------------------------------------- staff

export type StaffOrderView = OrderView & { customer: { id: string; email: string } };

export const staffOrders = async (
  db: Db,
  filter: { userId?: string; status?: OrderRow["status"]; limit: number },
): Promise<StaffOrderView[]> => {
  const rows = await db
    .select({ order: orders, email: users.email })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(
      and(
        filter.userId ? eq(orders.userId, filter.userId) : undefined,
        filter.status ? eq(orders.status, filter.status) : undefined,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(filter.limit);
  return Promise.all(
    rows.map(async ({ order, email }) => ({
      ...(await orderView(db, order)),
      customer: { id: order.userId, email },
    })),
  );
};

/**
 * A paid order whose subscription could not be made (no room, at the time):
 * staff make it once there is room. Refused for any other state, so it cannot
 * make a second subscription for an order that already has one.
 */
export const fulfilPaidOrder = async (db: Db, orderId: string) =>
  db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw notFound("No such order");
    if (order.status !== "paid") {
      throw new ApiError(409, "CONFLICT", `The order is ${order.status}, not waiting for its subscription`);
    }
    const after = await fulfil(tx, order, null);
    if (after.status !== "fulfilled") {
      throw new ApiError(409, "NO_SERVER_AVAILABLE", "The subscription still could not be made");
    }
    return orderView(tx, after);
  });
