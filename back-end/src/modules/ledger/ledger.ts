import { and, eq, isNull, sql } from "drizzle-orm";

import type { Executor } from "../../platform/db/client";
import { ledgerAccountKind, ledgerAccounts, ledgerEntries, ledgerTransactions, ledgerTxKind } from "./schema";

/**
 * Posting to the double-entry ledger.
 *
 * The database already refuses an unbalanced transaction, an edited entry
 * and a user account below zero (migration 0002). This adds two things
 * callers would otherwise repeat: accounts are made on first use, and a
 * posting with an idempotency key is made once however often it is asked
 * for, so a payment confirmed twice is revenue once.
 */

type AccountKind = (typeof ledgerAccountKind.enumValues)[number];
type TxKind = (typeof ledgerTxKind.enumValues)[number];

const PER_USER = new Set<AccountKind>(["customer_wallet", "reseller_credit", "commission_balance"]);

/** The account of a kind (and user, for per-user kinds), made if it does not exist yet. */
export const accountId = async (executor: Executor, kind: AccountKind, userId: string | null = null) => {
  if (PER_USER.has(kind) !== (userId !== null)) {
    throw new Error(`${kind} ${PER_USER.has(kind) ? "needs" : "cannot have"} a user`);
  }
  await executor
    .insert(ledgerAccounts)
    .values({ kind, userId })
    .onConflictDoNothing({ target: [ledgerAccounts.kind, ledgerAccounts.userId] });
  const [row] = await executor
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.kind, kind),
        userId === null ? isNull(ledgerAccounts.userId) : eq(ledgerAccounts.userId, userId),
      ),
    );
  return row!.id;
};

export type Posting = {
  kind: TxKind;
  idempotencyKey: string;
  reference: { type: string; id: string };
  memo?: string;
  createdByUserId?: string | null;
  /** Money moves from negative entries to positive ones; they must sum to zero. */
  entries: { account: AccountKind; userId?: string | null; amountToman: number }[];
};

/** Posts a transaction. Returns false when it was already posted under this key. */
export const post = async (executor: Executor, posting: Posting) => {
  const [transaction] = await executor
    .insert(ledgerTransactions)
    .values({
      kind: posting.kind,
      referenceType: posting.reference.type,
      referenceId: posting.reference.id,
      memo: posting.memo ?? "",
      createdByUserId: posting.createdByUserId ?? null,
      idempotencyKey: posting.idempotencyKey,
    })
    .onConflictDoNothing({ target: ledgerTransactions.idempotencyKey })
    .returning({ id: ledgerTransactions.id });
  if (!transaction) return false;

  for (const entry of posting.entries) {
    await executor.insert(ledgerEntries).values({
      transactionId: transaction.id,
      accountId: await accountId(executor, entry.account, entry.userId ?? null),
      amountToman: entry.amountToman,
    });
  }
  return true;
};

/** An account's balance, for tests and reports. */
export const balanceOf = async (executor: Executor, kind: AccountKind, userId: string | null = null) => {
  const [row] = await executor
    .select({ balance: sql<number>`coalesce(${ledgerAccounts.balanceToman}, 0)` })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.kind, kind),
        userId === null ? isNull(ledgerAccounts.userId) : eq(ledgerAccounts.userId, userId),
      ),
    );
  return Number(row?.balance ?? 0);
};
