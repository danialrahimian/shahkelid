import type {
  PaymentCardView,
  ReceiptFlag,
  ReceiptReviewView,
  cardTransferInput,
  paymentCardInput,
  reviewReceiptInput,
} from "@shah-kelid/contracts";
import { and, asc, desc, eq, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

import config from "../../config";
import type { Db } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { writeAudit } from "../access/audit";
import { savePrivateImage, sha256 } from "../files/storage";
import { users } from "../identity/schema";
import { alertStaff } from "../notifications/alerts";
import { payableOrder, settlePayment } from "./orders";
import { cardTransferReceipts, orderItems, orders, paymentCards, payments } from "./schema";

/**
 * Card-to-card: the customer transfers to one of our cards in their bank
 * app, then sends the tracking number and a picture of the receipt. An
 * accountant approves or rejects it.
 *
 * Suspicious receipts are flagged, not refused: the same picture or tracking
 * number as an earlier receipt, or an amount other than the order's. A
 * genuine customer re-sending after a mistake looks exactly like a cheat;
 * the accountant, who can see the bank statement, decides.
 */

// ------------------------------------------------------------------ cards

const cardView = (row: typeof paymentCards.$inferSelect): PaymentCardView => ({
  id: row.id,
  label: row.label,
  bankName: row.bankName,
  cardNumber: row.cardNumber,
  holderName: row.holderName,
});

export const activeCards = async (db: Db) =>
  (
    await db
      .select()
      .from(paymentCards)
      .where(eq(paymentCards.isActive, true))
      .orderBy(asc(paymentCards.sortOrder), asc(paymentCards.createdAt))
  ).map(cardView);

export const allCards = async (db: Db) =>
  (await db.select().from(paymentCards).orderBy(asc(paymentCards.sortOrder), asc(paymentCards.createdAt))).map(
    (row) => ({ ...cardView(row), isActive: row.isActive, sortOrder: row.sortOrder }),
  );

export const saveCard = async (
  db: Db,
  actor: StaffActor,
  id: string | null,
  input: z.output<typeof paymentCardInput>,
) =>
  db.transaction(async (tx) => {
    const [before] = id ? await tx.select().from(paymentCards).where(eq(paymentCards.id, id)) : [];
    if (id && !before) throw notFound("No such card");
    const [row] = id
      ? await tx.update(paymentCards).set(input).where(eq(paymentCards.id, id)).returning()
      : await tx.insert(paymentCards).values(input).returning();
    await writeAudit(tx, {
      ...auditBy(actor),
      action: id ? "payment_card.updated" : "payment_card.created",
      entityType: "payment_card",
      entityId: row!.id,
      before: before ?? null,
      after: row,
    });
    return { ...cardView(row!), isActive: row!.isActive, sortOrder: row!.sortOrder };
  });

// ---------------------------------------------------------------- receipts

export const submitCardTransfer = async (
  db: Db,
  userId: string,
  orderId: string,
  input: z.output<typeof cardTransferInput>,
  image: { bytes: Buffer; originalName: string },
) => {
  const order = await payableOrder(db, userId, orderId);

  const [card] = await db
    .select()
    .from(paymentCards)
    .where(and(eq(paymentCards.id, input.destinationCardId), eq(paymentCards.isActive, true)));
  if (!card) throw notFound("No such card");

  const [waiting] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.status, "pending_review")));
  if (waiting) {
    throw new ApiError(409, "ORDER_NOT_PAYABLE", "A receipt for this order is already waiting for review");
  }

  const imageHash = sha256(image.bytes);
  const earlier = await db
    .select({ imageSha256: cardTransferReceipts.imageSha256, trackingNumber: cardTransferReceipts.trackingNumber })
    .from(cardTransferReceipts)
    .where(
      or(
        eq(cardTransferReceipts.imageSha256, imageHash),
        eq(cardTransferReceipts.trackingNumber, input.trackingNumber),
      ),
    );
  const flags: ReceiptFlag[] = [];
  if (earlier.some((row) => row.imageSha256 === imageHash)) flags.push("duplicate_image");
  if (earlier.some((row) => row.trackingNumber === input.trackingNumber)) flags.push("duplicate_tracking");
  if (input.claimedAmountToman !== order.totalToman) flags.push("amount_mismatch");

  const paymentId = await db.transaction(async (tx) => {
    const file = await savePrivateImage(tx, {
      bytes: image.bytes,
      purpose: "receipt",
      originalName: image.originalName,
      uploadedBy: userId,
    });
    const [payment] = await tx
      .insert(payments)
      .values({
        orderId: order.id,
        userId,
        method: "card_transfer",
        status: "pending_review",
        amountToman: order.totalToman,
      })
      .returning();
    await tx.insert(cardTransferReceipts).values({
      paymentId: payment!.id,
      destinationCardId: card.id,
      fileId: file.id,
      trackingNumber: input.trackingNumber,
      claimedAmountToman: input.claimedAmountToman,
      payerCardLast4: input.payerCardLast4,
      imageSha256: imageHash,
      flags,
    });
    await alertStaff(
      tx,
      {
        subject: flags.length ? "رسید کارت‌به‌کارت تازه (مشکوک)" : "رسید کارت‌به‌کارت تازه",
        text: [
          `سفارش ${order.number}، مبلغ ${order.totalToman} تومان، کارت ${card.label}.`,
          `کد پیگیری ${input.trackingNumber}، مبلغ اعلام‌شده ${input.claimedAmountToman} تومان.`,
          flags.length ? `هشدارها: ${flags.join("، ")}` : "",
          "برای بررسی به بخش «پرداخت‌ها» در مدیریت بروید.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      { type: "payment", id: payment!.id },
    );
    return payment!.id;
  });
  return paymentId;
};

// ------------------------------------------------------------------ review

const reviewer = alias(users, "reviewer");

const receiptRows = (db: Db) =>
  db
    .select({
      payment: payments,
      receipt: cardTransferReceipts,
      order: orders,
      customerEmail: users.email,
      cardLabel: paymentCards.label,
      cardNumber: paymentCards.cardNumber,
      planName: orderItems.planSnapshot,
      reviewerEmail: reviewer.email,
    })
    .from(payments)
    .innerJoin(cardTransferReceipts, eq(cardTransferReceipts.paymentId, payments.id))
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(users, eq(users.id, payments.userId))
    .innerJoin(paymentCards, eq(paymentCards.id, cardTransferReceipts.destinationCardId))
    .leftJoin(reviewer, eq(reviewer.id, payments.reviewedByUserId));

type ReceiptRow = Awaited<ReturnType<ReturnType<typeof receiptRows>["where"]>>[number];

const receiptView = (row: ReceiptRow): ReceiptReviewView => ({
  paymentId: row.payment.id,
  status: row.payment.status,
  orderId: row.order.id,
  orderNumber: row.order.number,
  orderTotalToman: row.order.totalToman,
  customer: { id: row.payment.userId, email: row.customerEmail },
  planName: (row.planName as { name?: string }).name ?? "",
  destinationCard: { label: row.cardLabel, cardNumber: row.cardNumber },
  trackingNumber: row.receipt.trackingNumber,
  claimedAmountToman: row.receipt.claimedAmountToman,
  payerCardLast4: row.receipt.payerCardLast4,
  flags: row.receipt.flags as ReceiptFlag[],
  reviewNote: row.receipt.reviewNote,
  submittedAt: row.payment.createdAt.toISOString(),
  reviewedAt: row.payment.reviewedAt?.toISOString() ?? null,
  reviewerEmail: row.reviewerEmail ?? null,
});

/** The queue (waiting first, oldest first), or the recently decided ones. */
export const receipts = async (db: Db, which: "waiting" | "decided") => {
  const rows =
    which === "waiting"
      ? await receiptRows(db).where(eq(payments.status, "pending_review")).orderBy(asc(payments.createdAt))
      : await receiptRows(db)
          .where(ne(payments.status, "pending_review"))
          .orderBy(desc(payments.reviewedAt))
          .limit(100);
  return rows.map(receiptView);
};

export const receiptFileId = async (db: Db, paymentId: string) => {
  const [row] = await db
    .select({ fileId: cardTransferReceipts.fileId })
    .from(cardTransferReceipts)
    .where(eq(cardTransferReceipts.paymentId, paymentId));
  return row?.fileId ?? null;
};

export const reviewReceipt = async (
  db: Db,
  actor: StaffActor,
  paymentId: string,
  input: z.output<typeof reviewReceiptInput>,
) => {
  const [row] = await receiptRows(db).where(eq(payments.id, paymentId));
  if (!row) throw notFound("No such receipt");
  if (row.payment.status !== "pending_review") {
    throw new ApiError(409, "ALREADY_REVIEWED", `The payment is already ${row.payment.status}`);
  }

  if (input.decision === "approve") {
    const result = await settlePayment(db, paymentId, {
      refId: row.receipt.trackingNumber,
      reviewedByUserId: actor.userId,
      onlyFrom: "pending_review",
    });
    if (result.reason === "not_waiting") throw new ApiError(409, "ALREADY_REVIEWED", "Already reviewed");
    await db
      .update(cardTransferReceipts)
      .set({ reviewNote: input.note })
      .where(eq(cardTransferReceipts.paymentId, paymentId));
  } else {
    await db.transaction(async (tx) => {
      // Only one reviewer wins: the status is checked again under the update.
      const updated = await tx
        .update(payments)
        .set({
          status: "failed",
          failureReason: input.note,
          reviewedByUserId: actor.userId,
          reviewedAt: new Date(),
        })
        .where(and(eq(payments.id, paymentId), eq(payments.status, "pending_review")))
        .returning({ id: payments.id });
      if (updated.length === 0) throw new ApiError(409, "ALREADY_REVIEWED", "Already reviewed");
      await tx
        .update(cardTransferReceipts)
        .set({ reviewNote: input.note })
        .where(eq(cardTransferReceipts.paymentId, paymentId));
      // The customer gets time to pay again, however long the review took.
      await tx
        .update(orders)
        .set({ expiresAt: new Date(Date.now() + config.checkout.orderTtlMs) })
        .where(and(eq(orders.id, row.order.id), eq(orders.status, "pending")));
    });
  }

  await writeAudit(db, {
    ...auditBy(actor),
    action: input.decision === "approve" ? "payment.receipt_approved" : "payment.receipt_rejected",
    entityType: "payment",
    entityId: paymentId,
    before: { status: "pending_review" },
    after: { decision: input.decision, note: input.note },
  });

  const [after] = await receiptRows(db).where(eq(payments.id, paymentId));
  return receiptView(after!);
};
