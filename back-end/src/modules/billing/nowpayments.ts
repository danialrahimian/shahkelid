import { createHmac, timingSafeEqual } from "node:crypto";

import { formatUsdtUnits } from "@shah-kelid/contracts";
import { and, eq } from "drizzle-orm";

import config from "../../config";
import { current } from "../settings/live";
import logger from "../../libraries/logger";
import type { Db } from "../../platform/db/client";
import { ApiError } from "../../platform/http/api-error";
import { alertStaff } from "../notifications/alerts";
import { payableOrder, settlePayment } from "./orders";
import { freshRate } from "./rates";
import { cryptoInvoices, payments } from "./schema";
import { baseUnits } from "./usdt-checkout";

/**
 * NOWPayments (https://documenter.getpostman.com/view/7907941/2s93JusNJt):
 * a hosted invoice the customer pays in the coin they like; NOWPayments
 * tells us over IPN, and we settle.
 *
 * The IPN is trusted only so far: its signature (HMAC-SHA512 of the body
 * with keys sorted, keyed by the IPN secret) must check out, and even then
 * the payment's status is read back from the API before anything is settled.
 * A forged or replayed notification cannot pay for an order.
 *
 * The price is quoted in USD from the USDT rate (USDT tracks the dollar),
 * so NOWPayments needs no toman price.
 */

export type NowPaymentStatus =
  | "waiting"
  | "confirming"
  | "confirmed"
  | "sending"
  | "partially_paid"
  | "finished"
  | "failed"
  | "refunded"
  | "expired";

export type NowPayment = {
  payment_id: number | string;
  invoice_id: number | string | null;
  order_id: string | null;
  payment_status: NowPaymentStatus;
  price_amount: number;
  price_currency: string;
  actually_paid?: number;
  pay_currency?: string;
};

export interface NowPaymentsApi {
  createInvoice(input: {
    priceUsd: string;
    orderId: string;
    description: string;
    ipnCallbackUrl: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; invoiceUrl: string }>;
  getPayment(paymentId: string): Promise<NowPayment>;
}

class NowPaymentsHttp implements NowPaymentsApi {
  private get base() {
    return current("nowpayments").sandbox ? "https://api-sandbox.nowpayments.io/v1" : "https://api.nowpayments.io/v1";
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { "x-api-key": current("nowpayments").apiKey, "content-type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`NOWPayments answered HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return (await response.json()) as T;
  }

  async createInvoice(input: Parameters<NowPaymentsApi["createInvoice"]>[0]) {
    const body = await this.call<{ id: string | number; invoice_url: string }>("/invoice", {
      method: "POST",
      body: JSON.stringify({
        price_amount: Number(input.priceUsd),
        price_currency: "usd",
        order_id: input.orderId,
        order_description: input.description,
        ipn_callback_url: input.ipnCallbackUrl,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      }),
    });
    return { id: String(body.id), invoiceUrl: body.invoice_url };
  }

  getPayment(paymentId: string) {
    return this.call<NowPayment>(`/payment/${encodeURIComponent(paymentId)}`);
  }
}

let api: NowPaymentsApi | undefined;
export const nowpayments = (): NowPaymentsApi => (api ??= new NowPaymentsHttp());

/** Test seam. */
export const setNowPayments = (replacement: NowPaymentsApi | null) => {
  api = replacement ?? undefined;
};

export const isNowPaymentsConfigured = () =>
  Boolean(current("nowpayments").apiKey && current("nowpayments").ipnSecret);

// --------------------------------------------------------------- signature

/** Keys sorted at every level, as NOWPayments signs them. */
const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value as object)
            .sort()
            .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
        )
      : value;

export const ipnSignature = (body: unknown, secret: string = current("nowpayments").ipnSecret) =>
  createHmac("sha512", secret).update(JSON.stringify(sortKeys(body))).digest("hex");

export const isValidIpn = (body: unknown, signature: string | undefined) => {
  if (!signature || !current("nowpayments").ipnSecret) return false;
  const expected = Buffer.from(ipnSignature(body), "hex");
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
};

// ---------------------------------------------------------------- checkout

export const startNowPayments = async (db: Db, userId: string, orderId: string) => {
  if (!isNowPaymentsConfigured()) throw new ApiError(409, "METHOD_UNAVAILABLE", "NOWPayments is not set up");
  const rate = await freshRate(db);
  if (!rate) throw new ApiError(503, "RATE_UNAVAILABLE", "No fresh USDT rate");
  const order = await payableOrder(db, userId, orderId);
  const units = baseUnits(order.totalToman, rate.bidToman);

  const [payment] = await db
    .insert(payments)
    .values({ orderId: order.id, userId, method: "nowpayments", status: "initiated", amountToman: order.totalToman })
    .returning();

  try {
    const invoice = await nowpayments().createInvoice({
      priceUsd: formatUsdtUnits(units),
      // Ours, so an IPN names the payment it is about.
      orderId: payment!.id,
      description: `Order ${order.number}`,
      ipnCallbackUrl: `${config.provisioning.publicUrl}/api/v1/payments/nowpayments/ipn`,
      successUrl: `${config.cors.origin}/orders/${order.id}`,
      cancelUrl: `${config.cors.origin}/orders/${order.id}`,
    });
    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ status: "pending", providerReference: invoice.id })
        .where(eq(payments.id, payment!.id));
      await tx.insert(cryptoInvoices).values({
        paymentId: payment!.id,
        network: "NOWPAYMENTS",
        tokenContract: "nowpayments",
        amountUnits: units,
        rateTomanPerAsset: rate.bidToman,
        exchangeRateId: rate.id,
        // One per invoice, so the open-amount uniqueness never collides here.
        payAddress: `nowpayments:${invoice.id}`,
        processorInvoiceId: invoice.id,
        expiresAt: new Date(Date.now() + config.checkout.orderTtlMs),
      });
    });
    return { payUrl: invoice.invoiceUrl };
  } catch (error) {
    await db
      .update(payments)
      .set({ status: "failed", failureReason: (error as Error).message.slice(0, 300) })
      .where(eq(payments.id, payment!.id));
    throw new ApiError(503, "GATEWAY_UNREACHABLE", (error as Error).message);
  }
};

/**
 * An IPN arrived and its signature checked out. The payment's status is read
 * back from NOWPayments; only that is acted on.
 */
export const handleNowPaymentsIpn = async (db: Db, notified: { payment_id?: unknown; order_id?: unknown }) => {
  const paymentId = String(notified.order_id ?? "");
  const [ours] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.method, "nowpayments")));
  if (!ours) return "unknown_payment" as const;

  const truth = await nowpayments().getPayment(String(notified.payment_id ?? ""));
  const [quote] = await db.select().from(cryptoInvoices).where(eq(cryptoInvoices.paymentId, ours.id));
  const pricedAsQuoted =
    truth.price_currency?.toLowerCase() === "usd" &&
    Math.round(Number(truth.price_amount) * 1_000_000) >= (quote?.amountUnits ?? Number.POSITIVE_INFINITY);
  if (truth.order_id !== ours.id || String(truth.invoice_id ?? "") !== ours.providerReference || !pricedAsQuoted) {
    logger.warn({ paymentId: ours.id }, "A NOWPayments payment did not match what we invoiced");
    return "mismatch" as const;
  }

  await db
    .update(payments)
    .set({ providerPayload: { ...(ours.providerPayload as object), nowpayments: truth } })
    .where(eq(payments.id, ours.id));

  switch (truth.payment_status) {
    case "finished":
      await settlePayment(db, ours.id, { refId: String(truth.payment_id), payload: { payCurrency: truth.pay_currency } });
      return "settled" as const;
    case "partially_paid":
      await db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({ status: "failed", failureReason: "partially_paid" })
          .where(and(eq(payments.id, ours.id), eq(payments.status, "pending")));
        await alertStaff(
          tx,
          {
            subject: "پرداخت ناقص در NOWPayments",
            text: `پرداخت ${ours.id} کمتر از مبلغ فاکتور پرداخت شد (${truth.actually_paid ?? "?"} ${truth.pay_currency ?? ""}). در NOWPayments بررسی کنید و با مشتری هماهنگ شوید.`,
          },
          { type: "payment", id: ours.id },
        );
      });
      return "partial" as const;
    case "failed":
    case "expired":
    case "refunded":
      await db
        .update(payments)
        .set({ status: "failed", failureReason: truth.payment_status })
        .where(and(eq(payments.id, ours.id), eq(payments.status, "pending")));
      return "failed" as const;
    default:
      return "waiting" as const; // waiting, confirming, confirmed, sending
  }
};
