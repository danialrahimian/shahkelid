import type { OrderView } from "@shah-kelid/contracts";

/**
 * Where an order stands, from the buyer's side of the screen, and how often
 * its page should look again.
 */

export type Stage =
  | "waiting_payment"
  | "awaiting_transfer"
  | "checking"
  | "review"
  | "preparing"
  | "ready"
  | "renewed"
  | "failed"
  | "expired";

export const stageOf = (order: OrderView): Stage => {
  // A renewal's subscription (and link) exists from the start: it is done
  // only when the order is, i.e. when the panel has the new date and volume.
  if (order.kind === "renewal") {
    if (order.status === "fulfilled") return "renewed";
    if (order.status === "paid") return "preparing";
  } else if (order.subscription?.link) {
    return "ready";
  }
  if (order.status === "paid" || order.status === "fulfilled") return "preparing";
  if (order.status === "expired" || order.status === "cancelled") return "expired";
  const payment = order.payment;
  if (!payment) return "waiting_payment";
  if (payment.status === "pending_review") return "review";
  if (payment.status === "pending" && payment.crypto) return "awaiting_transfer";
  if (payment.status === "pending" || payment.status === "initiated") return "checking";
  if (payment.status === "failed" || payment.status === "expired") return "failed";
  return "waiting_payment";
};

/** How often to look again, by stage; 0 when there is nothing to wait for. */
export const pollEvery = (stage: Stage) =>
  stage === "checking" || stage === "preparing"
    ? 2000
    : stage === "awaiting_transfer"
      ? 5000
      : stage === "review"
        ? 15000
        : 0;

