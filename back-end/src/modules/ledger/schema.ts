import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "../identity/schema";
import { createdAt, id, wholeNumber } from "../../platform/db/columns";

/**
 * Double-entry money records.
 *
 * Every movement of money is one transaction of two or more entries that sum
 * to zero, and an account's balance is the sum of its entries. Money flows
 * FROM negative entries TO positive ones:
 *
 *   plan bought by Zarinpal:  gateway_zarinpal -100, revenue +100
 *   wallet topped up:         gateway_zarinpal -100, customer_wallet +100
 *   plan bought from wallet:  customer_wallet -100,  revenue +100
 *
 * Three rules are enforced by the database itself (see the ledger migration):
 * a transaction must balance at commit, entries are append-only, and the
 * cached balance moves with every entry under a row lock, so a per-user
 * account can never be spent below zero, even by two purchases at once.
 */

export const ledgerAccountKind = pgEnum("ledger_account_kind", [
  // per user
  "customer_wallet",
  "reseller_credit",
  "commission_balance",
  // system
  "revenue",
  "discounts",
  "refunds",
  "adjustments",
  "gateway_zarinpal",
  "gateway_card",
  "gateway_nowpayments",
  "gateway_usdt_tron",
]);

const PER_USER = sql`('customer_wallet', 'reseller_credit', 'commission_balance')`;

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: id(),
    kind: ledgerAccountKind("kind").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    balanceToman: wholeNumber("balance_toman").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    // per-user kinds belong to a user; system kinds belong to nobody
    check("ledger_accounts_owner", sql`(${t.kind} in ${PER_USER}) = (${t.userId} is not null)`),
    // the check that makes spending the same money twice impossible
    check(
      "ledger_accounts_user_balance_not_negative",
      sql`${t.kind} not in ${PER_USER} or ${t.balanceToman} >= 0`,
    ),
    // one account of each kind per user, and exactly one of each system kind
    unique("ledger_accounts_kind_user_id_key").on(t.kind, t.userId).nullsNotDistinct(),
  ],
);

export const ledgerTxKind = pgEnum("ledger_tx_kind", [
  "order_payment",
  "wallet_topup",
  "wallet_purchase",
  "refund",
  "commission_accrual",
  "commission_payout",
  "reseller_credit_topup",
  "manual_adjustment",
]);

export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: id(),
    kind: ledgerTxKind("kind").notNull(),
    referenceType: text("reference_type"), // 'payment', 'order', 'commission'
    referenceId: uuid("reference_id"),
    memo: text("memo").notNull().default(""),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // one ledger posting per business event, however many times it is retried
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_transactions_ref_idx").on(t.referenceType, t.referenceId)],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    amountToman: wholeNumber("amount_toman").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("ledger_entries_amount_not_zero", sql`${t.amountToman} <> 0`),
    index("ledger_entries_account_idx").on(t.accountId, t.id),
    index("ledger_entries_transaction_idx").on(t.transactionId),
  ],
);
