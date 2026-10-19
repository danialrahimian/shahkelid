import { and, eq, gt, lt, or } from "drizzle-orm";

import config from "../../config";
import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { ApiError } from "../../platform/http/api-error";
import { users } from "../identity/schema";
import { alertStaff } from "../notifications/alerts";
import { payableOrder, settlePayment, type PaymentRow } from "./orders";
import { orders, payments } from "./schema";
import { GatewayRejectedError, GatewayUnavailableError, isZarinpalSetUp, zarinpal } from "./zarinpal";

/**
 * Paying an order with Zarinpal:
 *
 *   start    → a payment row, then Zarinpal's authority; the customer is sent to pay
 *   callback → Zarinpal sends the customer back; we verify with the amount WE stored
 *   reconcile→ every few minutes, payments whose callback never came are asked about
 *
 * The callback is only a hint that something happened: a customer who closes
 * the tab after paying still gets their service, from the reconcile job.
 */

export const callbackUrl = () => `${config.provisioning.publicUrl}/api/v1/payments/zarinpal/callback`;

export const startZarinpal = async (db: Db, userId: string, orderId: string) => {
  if (!isZarinpalSetUp()) throw new ApiError(409, "METHOD_UNAVAILABLE", "Zarinpal is not set up");
  const order = await payableOrder(db, userId, orderId);
  const [customer] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));

  const [payment] = await db
    .insert(payments)
    .values({ orderId: order.id, userId, method: "zarinpal", amountToman: order.totalToman })
    .returning();

  try {
    const { authority, payUrl } = await zarinpal().request({
      amountToman: order.totalToman,
      callbackUrl: callbackUrl(),
      description: `سفارش ${order.number}`,
      email: customer?.email ?? undefined,
    });
    await db
      .update(payments)
      .set({ status: "pending", providerReference: authority })
      .where(eq(payments.id, payment!.id));
    return { payUrl };
  } catch (error) {
    await db
      .update(payments)
      .set({ status: "failed", failureReason: (error as Error).message.slice(0, 300) })
      .where(eq(payments.id, payment!.id));
    if (error instanceof GatewayUnavailableError) {
      throw new ApiError(503, "GATEWAY_UNREACHABLE", error.message);
    }
    if (error instanceof GatewayRejectedError) {
      throw new ApiError(502, "GATEWAY_REJECTED", error.message);
    }
    throw error;
  }
};

/**
 * Asks Zarinpal whether a payment went through, and settles it if so.
 * Returns what is now known; a gateway that does not answer leaves the
 * payment pending for the reconcile job.
 */
export const confirmZarinpal = async (db: Db, payment: PaymentRow) => {
  if (payment.status === "succeeded") return "succeeded" as const;
  if (!payment.providerReference) return "unknown" as const;

  let result;
  try {
    result = await zarinpal().verify({ authority: payment.providerReference, amountToman: payment.amountToman });
  } catch (error) {
    logger.warn({ err: error, paymentId: payment.id }, "Zarinpal verify failed; the reconcile job will ask again");
    return "unknown" as const;
  }

  if (result.outcome === "paid") {
    await settlePayment(db, payment.id, { refId: result.refId, payload: { cardPan: result.cardPan } });
    return "succeeded" as const;
  }

  if (result.outcome === "amount_mismatch") {
    // Zarinpal holds a different amount than we asked for: never settle, and say so.
    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ status: "failed", failureReason: "amount_mismatch" })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
      await alertStaff(
        tx,
        {
          subject: "مبلغ پرداخت زرین‌پال با سفارش نمی‌خواند",
          text: `پرداخت ${payment.id} (authority ${payment.providerReference}) با مبلغ ${payment.amountToman} تومان تأیید نشد، چون زرین‌پال مبلغ دیگری ثبت کرده است. بررسی کنید.`,
        },
        { type: "payment", id: payment.id },
      );
    });
    return "failed" as const;
  }

  await db
    .update(payments)
    .set({ status: "failed", failureReason: `not_paid (${result.code})` })
    .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
  return "failed" as const;
};

/**
 * A payment the customer came back from as cancelled: if Zarinpal says the
 * money moved after all, it is verified and settled; otherwise it is marked
 * as checked so the reconcile job leaves it alone from now on.
 */
const recheckCancelled = async (db: Db, payment: PaymentRow) => {
  let status;
  try {
    status = await zarinpal().inquiry(payment.providerReference!);
  } catch {
    return "unreachable"; // asked again on the next pass, within the half hour
  }
  if (status === "PAID" || status === "VERIFIED") {
    let result;
    try {
      result = await zarinpal().verify({ authority: payment.providerReference!, amountToman: payment.amountToman });
    } catch {
      return "unreachable";
    }
    if (result.outcome === "paid") {
      await settlePayment(db, payment.id, { refId: result.refId, payload: { cardPan: result.cardPan } });
      return "succeeded";
    }
  }
  await db
    .update(payments)
    .set({ failureReason: "cancelled_checked" })
    .where(and(eq(payments.id, payment.id), eq(payments.status, "failed"), eq(payments.failureReason, "cancelled")));
  return "cancelled";
};

/** Zarinpal sent the customer back. Returns the order to show them. */
export const zarinpalCallback = async (db: Db, authority: string, status: string) => {
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.method, "zarinpal"), eq(payments.providerReference, authority)));
  if (!payment) return null;

  if (status === "OK") {
    await confirmZarinpal(db, payment);
  } else {
    // Cancelled at the bank. If money did move after all, the reconcile job
    // asks Zarinpal about it within the next half hour (recheckCancelled).
    await db
      .update(payments)
      .set({ status: "failed", failureReason: "cancelled" })
      .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
  }
  return payment.orderId;
};

/**
 * The reconcile job: Zarinpal payments still pending a minute after they
 * started (the customer closed the tab, the callback was lost). Ones Zarinpal
 * reports paid are confirmed; ones it reports failed are closed.
 *
 * Payments the customer came back from as "cancelled" in the last half hour
 * are asked about too: a bank can take the money and still send the customer
 * back with NOK, and only Zarinpal's own word settles which it was. Once
 * asked, they are marked so, and not asked again.
 */
export const reconcileZarinpal = async (db: Db) => {
  const open = await db
    .select()
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        eq(payments.method, "zarinpal"),
        or(
          and(
            eq(payments.status, "pending"),
            lt(payments.createdAt, new Date(Date.now() - 60_000)),
            gt(payments.createdAt, new Date(Date.now() - 2 * 86400_000)),
          ),
          and(
            eq(payments.status, "failed"),
            eq(payments.failureReason, "cancelled"),
            gt(payments.createdAt, new Date(Date.now() - 30 * 60_000)),
          ),
        ),
      ),
    );

  const outcomes: Record<string, string> = {};
  for (const { payments: payment } of open) {
    if (payment.status === "failed") {
      outcomes[payment.id] = await recheckCancelled(db, payment);
      continue;
    }
    let status;
    try {
      status = await zarinpal().inquiry(payment.providerReference!);
    } catch {
      outcomes[payment.id] = "unreachable";
      continue;
    }
    if (status === "PAID" || status === "VERIFIED") {
      outcomes[payment.id] = await confirmZarinpal(db, payment);
    } else if (status === "FAILED" || status === "REVERSED") {
      await db
        .update(payments)
        .set({ status: "failed", failureReason: status.toLowerCase() })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
      outcomes[payment.id] = "failed";
    } else if (payment.createdAt.getTime() < Date.now() - 60 * 60_000) {
      // An hour at the bank page and nothing: it is not going to happen.
      await db
        .update(payments)
        .set({ status: "expired" })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
      outcomes[payment.id] = "expired";
    } else {
      outcomes[payment.id] = "waiting";
    }
  }
  return outcomes;
};
