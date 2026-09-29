import { formatUsdtUnits, type CryptoQuote } from "@shah-kelid/contracts";
import { eq } from "drizzle-orm";

import type { Executor } from "../../platform/db/client";
import { cryptoInvoices } from "./schema";

/** A direct USDT invoice, as the buyer is shown it: this exact amount, to this address, before this time. */
export const quoteOf = (invoice: typeof cryptoInvoices.$inferSelect): CryptoQuote => ({
  asset: "USDT",
  network: "TRON",
  address: invoice.payAddress,
  amount: formatUsdtUnits(invoice.amountUnits),
  amountUnits: invoice.amountUnits,
  rateTomanPerUsdt: invoice.rateTomanPerAsset,
  expiresAt: invoice.expiresAt.toISOString(),
});

/** The quote behind a payment, if it is a direct USDT one. */
export const quoteForPayment = async (executor: Executor, paymentId: string) => {
  const [invoice] = await executor.select().from(cryptoInvoices).where(eq(cryptoInvoices.paymentId, paymentId));
  return invoice && invoice.network === "TRON" ? quoteOf(invoice) : null;
};
