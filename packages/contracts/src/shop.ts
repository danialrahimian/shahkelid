import { z } from "zod";

import { toLatinDigits } from "./auth.ts";
import type { SubscriptionStatus } from "./subscriptions.ts";

/**
 * Buying: plans as customers see them, orders, payments, and the
 * card-to-card receipt form. Shared by the storefront and the API.
 */

/** A plan on sale, as the storefront shows it. */
export type PublicPlan = {
  id: string;
  slug: string;
  name: string;
  description: string;
  dataLimitBytes: number | null;
  durationDays: number;
  deviceLimit: number | null;
  priceToman: number;
};

export const PAYMENT_METHODS_ON_SALE = ["zarinpal", "card_transfer", "usdt_tron", "nowpayments"] as const;
export type CheckoutMethod = (typeof PAYMENT_METHODS_ON_SALE)[number];

/**
 * The ways to pay right now. Crypto appears only when it is set up and the
 * USDT rate is fresh, with the rate the quote will use.
 */
export type CheckoutMethodView =
  | { method: "zarinpal" | "card_transfer" }
  | { method: "usdt_tron" | "nowpayments"; rateTomanPerUsdt: number };

/** What to send, for a direct USDT payment: this exact amount, to this address, before this time. */
export type CryptoQuote = {
  asset: "USDT";
  network: "TRON";
  address: string;
  /** "12.000347": the tail makes the amount unique, and is how the payment is recognised. */
  amount: string;
  amountUnits: number;
  rateTomanPerUsdt: number;
  expiresAt: string;
};

export const createOrderInput = z.object({ planId: z.string().uuid("REQUIRED") });
export type CreateOrderInput = z.infer<typeof createOrderInput>;

export type OrderStatus =
  | "pending"
  | "paid"
  | "fulfilled"
  | "failed"
  | "cancelled"
  | "expired"
  | "refunded";

export type PaymentStatus =
  | "initiated"
  | "pending"
  | "pending_review"
  | "succeeded"
  | "failed"
  | "expired"
  | "refunded";

/**
 * An order as its buyer follows it on the result page. `subscription` is
 * there once the order is fulfilled; its link is ready once it is on the panel.
 */
export type OrderView = {
  id: string;
  number: number;
  status: OrderStatus;
  totalToman: number;
  plan: PublicPlan;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  /** The latest attempt to pay, if any. */
  payment: {
    method: CheckoutMethod | "wallet";
    status: PaymentStatus;
    refId: string | null;
    failureReason: string | null;
    /** For a direct USDT payment still waiting: what to send, and where. */
    crypto: CryptoQuote | null;
  } | null;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    /** null until the subscription is on the panel. */
    link: string | null;
  } | null;
  invoiceNumber: number | null;
};

/** A card to transfer to, as shown at checkout. */
export type PaymentCardView = {
  id: string;
  label: string;
  bankName: string;
  cardNumber: string;
  holderName: string;
};

const digits = (value: unknown) =>
  typeof value === "string" ? toLatinDigits(value).replace(/[\s,٬-]/g, "") : value;

/**
 * What a customer fills in after transferring (sent as multipart form fields,
 * so every value arrives as text; digits in any script are accepted).
 */
export const cardTransferInput = z.object({
  destinationCardId: z.string().uuid("REQUIRED"),
  trackingNumber: z.preprocess(
    digits,
    z.string().regex(/^[0-9A-Za-z]{4,40}$/, "TRACKING_NUMBER_INVALID"),
  ),
  claimedAmountToman: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : Number(digits(value))),
    z
      .number({ required_error: "REQUIRED", invalid_type_error: "REQUIRED" })
      .int("NUMBER_OUT_OF_RANGE")
      .positive("NUMBER_OUT_OF_RANGE"),
  ),
  payerCardLast4: z.preprocess(digits, z.string().regex(/^[0-9]{4}$/, "LAST4_INVALID")),
});
export type CardTransferInput = z.input<typeof cardTransferInput>;

/** Receipts: images only, and small enough to review on a phone. */
export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export const paymentCardInput = z.object({
  label: z.string().trim().min(1, "REQUIRED").max(80, "TOO_LONG"),
  bankName: z.string().trim().min(1, "REQUIRED").max(80, "TOO_LONG"),
  cardNumber: z.preprocess(digits, z.string().regex(/^[0-9]{16}$/, "CARD_NUMBER_INVALID")),
  holderName: z.string().trim().min(1, "REQUIRED").max(120, "TOO_LONG"),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
});
export type PaymentCardInput = z.input<typeof paymentCardInput>;

/** Staff reviewing a receipt. A rejection must say why: the customer reads it. */
export const reviewReceiptInput = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), note: z.string().trim().max(500, "TOO_LONG").default("") }),
  z.object({ decision: z.literal("reject"), note: z.string().trim().min(1, "REQUIRED").max(500, "TOO_LONG") }),
]);
export type ReviewReceiptInput = z.input<typeof reviewReceiptInput>;

export const RECEIPT_FLAGS = ["duplicate_image", "duplicate_tracking", "amount_mismatch"] as const;
export type ReceiptFlag = (typeof RECEIPT_FLAGS)[number];

/** One receipt in the accountant's queue. */
export type ReceiptReviewView = {
  paymentId: string;
  status: PaymentStatus;
  orderId: string;
  orderNumber: number;
  orderTotalToman: number;
  customer: { id: string; email: string };
  planName: string;
  destinationCard: { label: string; cardNumber: string };
  trackingNumber: string;
  claimedAmountToman: number;
  payerCardLast4: string | null;
  flags: ReceiptFlag[];
  reviewNote: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewerEmail: string | null;
};

// ------------------------------------------------------------------ crypto

export const CRYPTO_TRANSFER_MATCHES = [
  "matched",
  "unmatched",
  "late",
  "wrong_amount",
  "credited_to_wallet",
  "refunded",
  "ignored",
] as const;
export type CryptoTransferMatch = (typeof CRYPTO_TRANSFER_MATCHES)[number];

/** A USDT transfer that arrived and belongs to no open invoice, for staff to decide on. */
export type CryptoTransferView = {
  id: string;
  txHash: string;
  /** The transaction on Tronscan (mainnet or Nile, whichever we watch). */
  explorerUrl: string;
  fromAddress: string;
  amount: string;
  blockTime: string;
  match: CryptoTransferMatch;
  /** A late transfer: the expired order whose exact amount it carries. */
  suspected: { paymentId: string; orderId: string; orderNumber: number; customerEmail: string; amount: string } | null;
  reviewNote: string;
  reviewedAt: string | null;
  reviewerEmail: string | null;
};

/**
 * Staff deciding what a stray transfer was: the late payment of the order it
 * matches (settle), money to give back (refunded: sent back by hand), or
 * nothing to do with us (ignored).
 */
export const reviewCryptoTransferInput = z.object({
  decision: z.enum(["settle", "refunded", "ignored"]),
  note: z.string().trim().max(500, "TOO_LONG").default(""),
});
export type ReviewCryptoTransferInput = z.input<typeof reviewCryptoTransferInput>;

/** USDT has six decimals: 12000347 units is "12.000347". */
export const USDT_DECIMALS = 6;
export const formatUsdtUnits = (units: number) => {
  const whole = Math.floor(units / 10 ** USDT_DECIMALS);
  const fraction = String(units % 10 ** USDT_DECIMALS).padStart(USDT_DECIMALS, "0");
  return `${whole}.${fraction}`;
};
