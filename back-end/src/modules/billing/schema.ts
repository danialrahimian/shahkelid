import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { files } from "../files/schema";
import { users } from "../identity/schema";
import { plans } from "../catalog/schema";
import { subscriptions } from "../subscriptions/schema";
import { at, createdAt, id, updatedAt, wholeNumber } from "../../platform/db/columns";

// ------------------------------------------------------------------- orders

export const orderKind = pgEnum("order_kind", [
  "new",
  "renewal",
  "upgrade",
  "add_data",
  "add_days",
  "wallet_topup",
]);

export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "fulfilled",
  "failed",
  "cancelled",
  "expired",
  "refunded",
]);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    number: bigint("number", { mode: "number" })
      .notNull()
      .unique()
      .generatedAlwaysAsIdentity({ startWith: 100001 }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // staff or a reseller acting for the customer; null when they bought it
    placedByUserId: uuid("placed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    kind: orderKind("kind").notNull(),
    status: orderStatus("status").notNull().default("pending"),
    // renewal / upgrade / add_*: the subscription it changes.
    // new: the subscription it produced, set once fulfilled.
    subscriptionId: uuid("subscription_id").references((): AnyPgColumn => subscriptions.id, {
      onDelete: "restrict",
    }),
    subtotalToman: wholeNumber("subtotal_toman").notNull(),
    discountToman: wholeNumber("discount_toman").notNull().default(0),
    totalToman: wholeNumber("total_toman").notNull(),
    // discount_code_id arrives with discount codes in phase 2
    idempotencyKey: text("idempotency_key"),
    expiresAt: at("expires_at").notNull(), // an unpaid order lapses
    paidAt: at("paid_at"),
    fulfilledAt: at("fulfilled_at"),
    cancelledAt: at("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("orders_subtotal_not_negative", sql`${t.subtotalToman} >= 0`),
    check("orders_discount_not_negative", sql`${t.discountToman} >= 0`),
    check(
      "orders_total_adds_up",
      sql`${t.totalToman} = ${t.subtotalToman} - ${t.discountToman} and ${t.totalToman} >= 0`,
    ),
    check(
      "orders_target_subscription",
      sql`${t.kind} in ('new', 'wallet_topup') or ${t.subscriptionId} is not null`,
    ),
    // a retried POST with the same key returns the first order, not a second
    unique("orders_user_id_idempotency_key_key").on(t.userId, t.idempotencyKey),
    index("orders_user_idx").on(t.userId, t.createdAt.desc().nullsFirst()),
    index("orders_subscription_idx")
      .on(t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
    index("orders_pending_idx").on(t.expiresAt).where(sql`${t.status} = 'pending'`),
    index("orders_paid_at_idx").on(t.paidAt).where(sql`${t.paidAt} is not null`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    // null for wallet top-ups
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "restrict" }),
    // The plan exactly as sold. Reports and invoices read this, so editing a
    // plan never rewrites a past sale.
    planSnapshot: jsonb("plan_snapshot").notNull().default({}),
    quantity: integer("quantity").notNull().default(1),
    unitPriceToman: wholeNumber("unit_price_toman").notNull(),
    totalToman: wholeNumber("total_toman").notNull(),
  },
  (t) => [
    check("order_items_quantity_range", sql`${t.quantity} between 1 and 1000`),
    check("order_items_unit_price_not_negative", sql`${t.unitPriceToman} >= 0`),
    check("order_items_total_adds_up", sql`${t.totalToman} = ${t.unitPriceToman} * ${t.quantity}`),
    index("order_items_order_idx").on(t.orderId),
    index("order_items_plan_idx").on(t.planId),
  ],
);

// ----------------------------------------------------------------- payments

/**
 * Crypto is two methods, not one: they reach the same wallet by different
 * routes, fail in different ways and are reconciled against different records.
 */
export const paymentMethod = pgEnum("payment_method", [
  "zarinpal",
  "card_transfer",
  "nowpayments",
  "usdt_tron",
  "wallet",
]);

export const paymentStatus = pgEnum("payment_status", [
  "initiated",
  "pending",
  "pending_review",
  "succeeded",
  "failed",
  "expired",
  "refunded",
]);

/**
 * One order can have several attempts (a failed card, then a card transfer).
 * At most one succeeds: enforced by payments_one_success_idx.
 */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    method: paymentMethod("method").notNull(),
    status: paymentStatus("status").notNull().default("initiated"),
    amountToman: wholeNumber("amount_toman").notNull(),
    // Zarinpal authority, card-transfer tracking number, NOWPayments payment
    // id, or the TRON transaction hash
    providerReference: text("provider_reference"),
    providerRefId: text("provider_ref_id"), // Zarinpal ref_id after verify
    providerPayload: jsonb("provider_payload").notNull().default({}),
    failureReason: text("failure_reason"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: at("reviewed_at"),
    succeededAt: at("succeeded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("payments_amount_positive", sql`${t.amountToman} > 0`),
    check(
      "payments_success_is_timestamped",
      sql`(${t.status} = 'succeeded') = (${t.succeededAt} is not null) or ${t.status} = 'refunded'`,
    ),
    // a second callback for the same payment cannot count twice
    uniqueIndex("payments_provider_ref_idx")
      .on(t.method, t.providerReference)
      .where(sql`${t.providerReference} is not null`),
    // two payments cannot both settle one order
    uniqueIndex("payments_one_success_idx")
      .on(t.orderId)
      .where(sql`${t.status} = 'succeeded'`),
    // the reconcile job and the review queue
    index("payments_open_idx")
      .on(t.status, t.createdAt)
      .where(sql`${t.status} in ('initiated', 'pending', 'pending_review')`),
    index("payments_user_idx").on(t.userId, t.createdAt.desc().nullsFirst()),
  ],
);

/** The cards shown to customers for card-to-card transfer. */
export const paymentCards = pgTable(
  "payment_cards",
  {
    id: id(),
    label: text("label").notNull(),
    bankName: text("bank_name").notNull(),
    cardNumber: text("card_number").notNull(),
    holderName: text("holder_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [check("payment_cards_number_format", sql`${t.cardNumber} ~ '^[0-9]{16}$'`)],
);

/**
 * Duplicates are FLAGGED, not rejected. A genuine customer can re-upload the
 * same receipt after a mistake; the accountant sees the flag and decides.
 */
export const cardTransferReceipts = pgTable(
  "card_transfer_receipts",
  {
    paymentId: uuid("payment_id")
      .primaryKey()
      .references(() => payments.id, { onDelete: "cascade" }),
    destinationCardId: uuid("destination_card_id")
      .notNull()
      .references(() => paymentCards.id, { onDelete: "restrict" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "restrict" }),
    trackingNumber: text("tracking_number").notNull(),
    payerCardLast4: text("payer_card_last4"),
    claimedPaidAt: at("claimed_paid_at"),
    imageSha256: text("image_sha256").notNull(),
    // duplicate_image, duplicate_tracking, amount_mismatch
    flags: text("flags").array().notNull().default(sql`'{}'`),
    reviewNote: text("review_note").notNull().default(""),
  },
  (t) => [
    check("card_transfer_receipts_last4_format", sql`${t.payerCardLast4} ~ '^[0-9]{4}$'`),
    index("card_transfer_receipts_image_idx").on(t.imageSha256),
    index("card_transfer_receipts_tracking_idx").on(t.trackingNumber),
  ],
);

// ------------------------------------------------------------------- crypto

/**
 * The toman price of USDT, read from Nobitex's public API (which quotes rial;
 * the fetcher divides by ten). Invoices are quoted on the bid: what the
 * business would get converting what it receives. Crypto checkout is refused
 * when the newest row is stale.
 */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    source: text("source").notNull().default("nobitex"),
    asset: text("asset").notNull().default("USDT"),
    bidToman: wholeNumber("bid_toman").notNull(),
    askToman: wholeNumber("ask_toman").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("exchange_rates_bid_positive", sql`${t.bidToman} > 0`),
    check("exchange_rates_ask_positive", sql`${t.askToman} > 0`),
    check("exchange_rates_bid_not_above_ask", sql`${t.bidToman} <= ${t.askToman}`),
    index("exchange_rates_latest_idx").on(t.asset, t.fetchedAt.desc().nullsFirst()),
  ],
);

/**
 * One row per crypto quote, for both methods. The direct TRON path matches
 * incoming transfers to invoices by EXACT AMOUNT, so no two open invoices on
 * one address may wait for the same amount (crypto_invoices_open_amount_idx).
 */
export const cryptoInvoices = pgTable(
  "crypto_invoices",
  {
    paymentId: uuid("payment_id")
      .primaryKey()
      .references(() => payments.id, { onDelete: "cascade" }),
    asset: text("asset").notNull().default("USDT"),
    network: text("network").notNull().default("TRON"),
    // Checked by contract address, never by symbol: anyone can mint a
    // worthless token and name it "USDT".
    tokenContract: text("token_contract").notNull(),
    amountUnits: wholeNumber("amount_units").notNull(), // USDT has 6 decimals
    amountReceivedUnits: wholeNumber("amount_received_units").notNull().default(0),
    rateTomanPerAsset: wholeNumber("rate_toman_per_asset").notNull(),
    exchangeRateId: bigint("exchange_rate_id", { mode: "number" })
      .notNull()
      .references(() => exchangeRates.id, { onDelete: "restrict" }),
    payAddress: text("pay_address").notNull(),
    processorInvoiceId: text("processor_invoice_id").unique(), // NOWPayments only
    expiresAt: at("expires_at").notNull(),
    closedAt: at("closed_at"), // paid, expired or cancelled
  },
  (t) => [
    check("crypto_invoices_amount_positive", sql`${t.amountUnits} > 0`),
    check("crypto_invoices_received_not_negative", sql`${t.amountReceivedUnits} >= 0`),
    check("crypto_invoices_rate_positive", sql`${t.rateTomanPerAsset} > 0`),
    uniqueIndex("crypto_invoices_open_amount_idx")
      .on(t.network, t.payAddress, t.amountUnits)
      .where(sql`${t.closedAt} is null`),
    index("crypto_invoices_open_idx").on(t.expiresAt).where(sql`${t.closedAt} is null`),
  ],
);

export const transferMatch = pgEnum("transfer_match", [
  "matched",
  "unmatched",
  "late",
  "wrong_amount",
  "credited_to_wallet",
  "refunded",
  "ignored",
]);

/**
 * Every USDT transfer seen arriving at our TRON wallet, matched or not.
 * Recorded before it is matched, so money sent with the wrong amount or after
 * an invoice expired is never silently lost.
 */
export const cryptoTransfers = pgTable(
  "crypto_transfers",
  {
    id: id(),
    network: text("network").notNull().default("TRON"),
    tokenContract: text("token_contract").notNull(),
    txHash: text("tx_hash").notNull(),
    // a single transaction can carry more than one transfer
    eventIndex: integer("event_index").notNull().default(0),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    amountUnits: wholeNumber("amount_units").notNull(),
    blockNumber: wholeNumber("block_number").notNull(),
    blockTime: at("block_time").notNull(),
    // only transfers the chain has finalised are ever matched
    confirmed: boolean("confirmed").notNull().default(false),
    match: transferMatch("match").notNull().default("unmatched"),
    paymentId: uuid("payment_id")
      .unique()
      .references(() => payments.id, { onDelete: "restrict" }),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: at("reviewed_at"),
    reviewNote: text("review_note").notNull().default(""),
    seenAt: at("seen_at").notNull().defaultNow(),
  },
  (t) => [
    // the watcher can see a transfer many times; it is recorded once
    unique("crypto_transfers_network_tx_hash_event_index_key").on(
      t.network,
      t.txHash,
      t.eventIndex,
    ),
    check("crypto_transfers_amount_positive", sql`${t.amountUnits} > 0`),
    check(
      "crypto_transfers_matched_has_payment",
      sql`(${t.match} = 'matched') = (${t.paymentId} is not null)`,
    ),
    // the review queue: money that arrived and belongs to no invoice yet
    index("crypto_transfers_review_idx")
      .on(t.seenAt)
      .where(sql`${t.match} in ('unmatched', 'late', 'wrong_amount')`),
    // where the watcher resumes scanning
    index("crypto_transfers_block_idx").on(t.network, t.blockNumber.desc().nullsFirst()),
  ],
);

// ----------------------------------------------------------------- invoices

/**
 * The immutable document. An order's status moves; an invoice, once issued,
 * never changes (a trigger in the migrations refuses it).
 */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: bigint("number", { mode: "number" })
      .notNull()
      .unique()
      .generatedAlwaysAsIdentity({ startWith: 100001 }),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    issuedAt: at("issued_at").notNull().defaultNow(),
    subtotalToman: wholeNumber("subtotal_toman").notNull(),
    discountToman: wholeNumber("discount_toman").notNull(),
    totalToman: wholeNumber("total_toman").notNull(),
    lines: jsonb("lines").notNull(),
    customerSnapshot: jsonb("customer_snapshot").notNull(),
  },
  (t) => [
    check(
      "invoices_total_adds_up",
      sql`${t.totalToman} = ${t.subtotalToman} - ${t.discountToman}`,
    ),
    index("invoices_user_idx").on(t.userId, t.issuedAt.desc().nullsFirst()),
  ],
);
