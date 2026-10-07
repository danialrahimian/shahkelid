import { randomInt } from "node:crypto";

import {
  formatUsdtUnits,
  type CryptoQuote,
  type CryptoTransferView,
  type reviewCryptoTransferInput,
} from "@shah-kelid/contracts";
import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

import config from "../../config";
import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { auditBy, type StaffActor } from "../../platform/http/actor";
import { ApiError, notFound } from "../../platform/http/api-error";
import { writeAudit } from "../access/audit";
import { users } from "../identity/schema";
import { alertStaff } from "../notifications/alerts";
import { payableOrder, settlePayment } from "./orders";
import { quoteOf } from "./crypto-quote";
import { freshRate } from "./rates";
import { cryptoInvoices, cryptoTransfers, orders, payments } from "./schema";
import { tronSource, type IncomingTransfer } from "./tron";

/**
 * USDT on TRON, straight to our wallet.
 *
 * Every invoice goes to the same address, so a payment is recognised by its
 * exact amount: the price in USDT, rounded up to the cent, plus a tail of up
 * to 9999 millionths that no other open invoice has (the database enforces
 * that). 12.000347 USDT is one invoice; 12.000348 another.
 *
 * Every confirmed transfer is recorded before anything else happens to it.
 * Paid in time, it settles its invoice's order. Paid after the invoice
 * expired, or with an amount no invoice has, it waits for staff, who settle,
 * refund or ignore it. Money is never silently dropped.
 */

const CENT = 10_000; // 0.01 USDT in units
const RECENT_DAYS = 7;

export const isUsdtConfigured = () => Boolean(config.crypto.tronAddress);

/** The price in USDT units, rounded up to a whole cent. */
export const baseUnits = (totalToman: number, rateTomanPerUsdt: number) =>
  Math.ceil((totalToman * 1_000_000) / rateTomanPerUsdt / CENT) * CENT;

export const startUsdtTron = async (db: Db, userId: string, orderId: string): Promise<CryptoQuote> => {
  if (!isUsdtConfigured()) throw new ApiError(409, "METHOD_UNAVAILABLE", "USDT on TRON is not set up");
  const rate = await freshRate(db);
  if (!rate) throw new ApiError(503, "RATE_UNAVAILABLE", "No fresh USDT rate");
  const order = await payableOrder(db, userId, orderId);
  const base = baseUnits(order.totalToman, rate.bidToman);

  return db.transaction(async (tx) => {
    const [payment] = await tx
      .insert(payments)
      .values({ orderId: order.id, userId, method: "usdt_tron", status: "pending", amountToman: order.totalToman })
      .returning();

    // A tail no open invoice on this address uses; the unique index decides.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const [invoice] = await tx.transaction((savepoint) =>
          savepoint
            .insert(cryptoInvoices)
            .values({
              paymentId: payment!.id,
              tokenContract: config.crypto.usdtContract,
              amountUnits: base + randomInt(1, 10_000),
              rateTomanPerAsset: rate.bidToman,
              exchangeRateId: rate.id,
              payAddress: config.crypto.tronAddress,
              expiresAt: new Date(Date.now() + config.crypto.invoiceTtlMs),
            })
            .returning(),
        );
        return quoteOf(invoice!);
      } catch (error) {
        const cause = (error as { cause?: { code?: string } }).cause ?? error;
        if ((cause as { code?: string }).code !== "23505") throw error;
      }
    }
    throw new ApiError(503, "METHOD_UNAVAILABLE", "Too many open USDT invoices at once; try again");
  });
};

// ---------------------------------------------------------------- matching

/**
 * Records a transfer and decides what it is. One transaction: the transfer,
 * the settlement and the invoice move together, so a crash half way cannot
 * leave a settled order with an unrecorded transfer or the reverse.
 */
const recordAndMatch = async (db: Db, transfer: IncomingTransfer, blockNumber: number) =>
  db.transaction(async (tx) => {
    const [row] = await tx
      .insert(cryptoTransfers)
      .values({
        network: "TRON",
        tokenContract: transfer.tokenContract,
        txHash: transfer.txHash,
        eventIndex: transfer.eventIndex,
        fromAddress: transfer.from,
        toAddress: transfer.to,
        amountUnits: transfer.units,
        blockNumber,
        blockTime: transfer.blockTime,
        confirmed: true,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return "seen" as const; // recorded on an earlier pass

    // The invoices this could be: same address, same exact amount, not yet
    // paid, recent. At most one is open (unique index); older ones may be closed.
    const candidates = await tx
      .select({ invoice: cryptoInvoices, payment: payments })
      .from(cryptoInvoices)
      .innerJoin(payments, eq(payments.id, cryptoInvoices.paymentId))
      .where(
        and(
          eq(cryptoInvoices.network, "TRON"),
          eq(cryptoInvoices.payAddress, transfer.to),
          eq(cryptoInvoices.tokenContract, transfer.tokenContract),
          eq(cryptoInvoices.amountUnits, transfer.units),
          ne(payments.status, "succeeded"),
          gt(cryptoInvoices.expiresAt, new Date(Date.now() - RECENT_DAYS * 86400_000)),
        ),
      )
      .orderBy(desc(cryptoInvoices.expiresAt))
      .for("update");

    // Paid before its invoice expired (by the block's time, not ours: the
    // scan may run late). That counts, even if the invoice has since closed.
    const onTime = candidates.find((candidate) => transfer.blockTime <= candidate.invoice.expiresAt);
    if (onTime) {
      const settled = await settlePayment(tx, onTime.payment.id, { refId: transfer.txHash, payload: { from: transfer.from } });
      await tx
        .update(cryptoInvoices)
        .set({ closedAt: new Date(), amountReceivedUnits: transfer.units })
        .where(eq(cryptoInvoices.paymentId, onTime.payment.id));
      if (settled.settled || settled.reason === "already") {
        await tx
          .update(cryptoTransfers)
          .set({ match: "matched", paymentId: onTime.payment.id })
          .where(eq(cryptoTransfers.id, row.id));
        return "matched" as const;
      }
      // The order was already paid another way (settlePayment has told staff
      // the money must go back): the transfer waits in the review queue, where
      // it is marked refunded once it is.
      await tx
        .update(cryptoTransfers)
        .set({ match: "unmatched", suspectedPaymentId: onTime.payment.id })
        .where(eq(cryptoTransfers.id, row.id));
      return "unmatched" as const;
    }

    const late = candidates[0];
    await tx
      .update(cryptoTransfers)
      .set({ match: late ? "late" : "unmatched", suspectedPaymentId: late?.payment.id ?? null })
      .where(eq(cryptoTransfers.id, row.id));
    await alertStaff(
      tx,
      {
        subject: late ? "انتقال USDT بعد از انقضای فاکتور" : "انتقال USDT بدون فاکتور",
        text: [
          `${formatUsdtUnits(transfer.units)} USDT از ${transfer.from} رسید (تراکنش ${transfer.txHash}).`,
          late
            ? "مبلغ دقیقاً با یک فاکتور منقضی‌شده می‌خواند. اگر مشتری دیر پرداخته، در بخش پرداخت‌ها «تسویه» را بزنید."
            : "با هیچ فاکتوری نمی‌خواند (مبلغ اشتباه یا انتقال ناشناس). در بخش پرداخت‌ها تصمیم بگیرید.",
        ].join("\n"),
      },
      { type: "crypto_transfer", id: row.id },
    );
    return late ? ("late" as const) : ("unmatched" as const);
  });

/**
 * The watcher: reads new confirmed transfers into our wallet and matches
 * them. Starts an hour before the newest one it knows, so a transfer that
 * TronGrid reported late is still found (seen ones are skipped by the
 * unique index).
 */
export const scanUsdt = async (db: Db) => {
  if (!isUsdtConfigured()) return { skipped: true as const };
  const [latest] = await db
    .select({ blockTime: cryptoTransfers.blockTime })
    .from(cryptoTransfers)
    .where(and(eq(cryptoTransfers.network, "TRON"), eq(cryptoTransfers.toAddress, config.crypto.tronAddress)))
    .orderBy(desc(cryptoTransfers.blockTime))
    .limit(1);
  const since = latest
    ? new Date(latest.blockTime.getTime() - 60 * 60_000)
    : new Date(Date.now() - 24 * 60 * 60_000);

  const source = tronSource();
  const transfers = await source.incoming(config.crypto.tronAddress, config.crypto.usdtContract, since);
  const outcomes: Record<string, number> = {};
  for (const transfer of transfers) {
    // A token merely named USDT is not USDT: only the official contract, to our address.
    if (transfer.tokenContract !== config.crypto.usdtContract || transfer.to !== config.crypto.tronAddress) {
      continue;
    }
    const [known] = await db
      .select({ id: cryptoTransfers.id })
      .from(cryptoTransfers)
      .where(
        and(
          eq(cryptoTransfers.network, "TRON"),
          eq(cryptoTransfers.txHash, transfer.txHash),
          eq(cryptoTransfers.eventIndex, transfer.eventIndex),
        ),
      );
    if (known) continue;
    const blockNumber = await source.blockNumberOf(transfer.txHash).catch(() => 0);
    const outcome = await recordAndMatch(db, transfer, blockNumber);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  if (Object.keys(outcomes).length) logger.info({ outcomes }, "USDT transfers matched");
  return outcomes;
};

/** Open quotes past their time close, and their payments lapse. A late transfer still finds them. */
export const expireUsdtInvoices = async (db: Db) =>
  db.transaction(async (tx) => {
    const closed = await tx
      .update(cryptoInvoices)
      .set({ closedAt: new Date() })
      .where(and(isNull(cryptoInvoices.closedAt), lt(cryptoInvoices.expiresAt, new Date())))
      .returning({ paymentId: cryptoInvoices.paymentId });
    if (closed.length) {
      await tx
        .update(payments)
        .set({ status: "expired" })
        .where(
          and(
            inArray(
              payments.id,
              closed.map((row) => row.paymentId),
            ),
            eq(payments.status, "pending"),
          ),
        );
    }
    return closed.length;
  });

// ------------------------------------------------------------------ review

const reviewer = alias(users, "reviewer");
const customer = alias(users, "customer");
const suspectedInvoice = alias(cryptoInvoices, "suspected_invoice");

const transferRows = (db: Db) =>
  db
    .select({
      transfer: cryptoTransfers,
      reviewerEmail: reviewer.email,
      orderId: orders.id,
      orderNumber: orders.number,
      customerEmail: customer.email,
      suspectedUnits: suspectedInvoice.amountUnits,
    })
    .from(cryptoTransfers)
    .leftJoin(reviewer, eq(reviewer.id, cryptoTransfers.reviewedByUserId))
    .leftJoin(payments, eq(payments.id, cryptoTransfers.suspectedPaymentId))
    .leftJoin(orders, eq(orders.id, payments.orderId))
    .leftJoin(customer, eq(customer.id, payments.userId))
    .leftJoin(suspectedInvoice, eq(suspectedInvoice.paymentId, cryptoTransfers.suspectedPaymentId));

type TransferRow = Awaited<ReturnType<ReturnType<typeof transferRows>["where"]>>[number];

/** Tronscan for the network we watch: the Nile testnet's own explorer, or mainnet's. */
const explorerFor = (txHash: string) =>
  `${config.crypto.tronGridUrl.includes("nile") ? "https://nile.tronscan.org" : "https://tronscan.org"}/#/transaction/${txHash}`;

const transferView = (row: TransferRow): CryptoTransferView => ({
  id: row.transfer.id,
  txHash: row.transfer.txHash,
  explorerUrl: explorerFor(row.transfer.txHash),
  fromAddress: row.transfer.fromAddress,
  amount: formatUsdtUnits(row.transfer.amountUnits),
  blockTime: row.transfer.blockTime.toISOString(),
  match: row.transfer.match,
  suspected:
    row.transfer.suspectedPaymentId && row.orderId
      ? {
          paymentId: row.transfer.suspectedPaymentId,
          orderId: row.orderId,
          orderNumber: row.orderNumber!,
          customerEmail: row.customerEmail ?? "",
          amount: formatUsdtUnits(row.suspectedUnits ?? 0),
        }
      : null,
  reviewNote: row.transfer.reviewNote,
  reviewedAt: row.transfer.reviewedAt?.toISOString() ?? null,
  reviewerEmail: row.reviewerEmail ?? null,
});

const WAITING = ["unmatched", "late", "wrong_amount"] as const;

export const cryptoTransfersFor = async (db: Db, which: "waiting" | "decided") => {
  const rows =
    which === "waiting"
      ? await transferRows(db)
          .where(inArray(cryptoTransfers.match, [...WAITING]))
          .orderBy(cryptoTransfers.seenAt)
      : await transferRows(db)
          .where(sql`${cryptoTransfers.reviewedAt} is not null`)
          .orderBy(desc(cryptoTransfers.reviewedAt))
          .limit(100);
  return rows.map(transferView);
};

export const reviewCryptoTransfer = async (
  db: Db,
  actor: StaffActor,
  id: string,
  input: z.output<typeof reviewCryptoTransferInput>,
) => {
  const view = await db.transaction(async (tx) => {
    const [transfer] = await tx.select().from(cryptoTransfers).where(eq(cryptoTransfers.id, id)).for("update");
    if (!transfer) throw notFound("No such transfer");
    if (!(WAITING as readonly string[]).includes(transfer.match)) {
      throw new ApiError(409, "ALREADY_REVIEWED", `The transfer is already ${transfer.match}`);
    }

    const reviewed = { reviewedByUserId: actor.userId, reviewedAt: new Date(), reviewNote: input.note };
    if (input.decision === "settle") {
      if (!transfer.suspectedPaymentId) {
        throw new ApiError(409, "CONFLICT", "This transfer matches no order; refund or ignore it");
      }
      const result = await settlePayment(tx, transfer.suspectedPaymentId, {
        refId: transfer.txHash,
        reviewedByUserId: actor.userId,
      });
      if (!result.settled && result.reason !== "already") {
        throw new ApiError(409, "CONFLICT", `The order could not be settled: ${result.reason}`);
      }
      await tx
        .update(cryptoTransfers)
        .set({ ...reviewed, match: "matched", paymentId: transfer.suspectedPaymentId })
        .where(eq(cryptoTransfers.id, id));
    } else {
      await tx.update(cryptoTransfers).set({ ...reviewed, match: input.decision }).where(eq(cryptoTransfers.id, id));
    }

    await writeAudit(tx, {
      ...auditBy(actor),
      action: `crypto_transfer.${input.decision}`,
      entityType: "crypto_transfer",
      entityId: id,
      before: { match: transfer.match },
      after: { decision: input.decision, note: input.note },
    });
    return transfer.id;
  });
  const [row] = await transferRows(db).where(eq(cryptoTransfers.id, view));
  return transferView(row!);
};
