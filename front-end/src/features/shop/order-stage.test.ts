import type { OrderView } from "@shah-kelid/contracts";
import { describe, expect, it } from "vitest";

import { pollEvery, stageOf } from "./order-stage";

/**
 * What the buyer is told on the order page, and how often it looks again.
 * The page must never say "failed" for money that arrived, nor stop
 * looking while the service is still being made.
 */

const anOrder = (overrides: Partial<OrderView> = {}): OrderView => ({
  id: "o",
  number: 100001,
  status: "pending",
  totalToman: 150000,
  plan: { id: "p", slug: "m", name: "ماهانه", description: "", dataLimitBytes: null, durationDays: 30, deviceLimit: null, priceToman: 150000 },
  createdAt: "2026-09-30T00:00:00Z",
  expiresAt: "2026-09-30T01:00:00Z",
  paidAt: null,
  payment: null,
  subscription: null,
  invoiceNumber: null,
  ...overrides,
});

const payment = (status: NonNullable<OrderView["payment"]>["status"]) => ({
  method: "zarinpal" as const,
  status,
  refId: null,
  failureReason: null,
  crypto: null,
});

describe("The order page", () => {
  it("When the link exists, then the service is ready and the page stops asking", () => {
    const order = anOrder({
      status: "fulfilled",
      payment: payment("succeeded"),
      subscription: { id: "s", status: "on_hold", link: "https://x/s/abc" },
    });
    expect(stageOf(order)).toBe("ready");
    expect(pollEvery(stageOf(order))).toBe(0);
  });

  it("When paid but the service is not on the panel yet, then it is being prepared and asked about every 2 s", () => {
    const order = anOrder({ status: "fulfilled", payment: payment("succeeded"), subscription: { id: "s", status: "provisioning", link: null } });
    expect(stageOf(order)).toBe("preparing");
    expect(pollEvery("preparing")).toBe(2000);
  });

  it("When paid but no server had room (no subscription yet), then it still reads as being prepared, not failed", () => {
    expect(stageOf(anOrder({ status: "paid", payment: payment("succeeded") }))).toBe("preparing");
  });

  it("When the payment is still being checked, then the page keeps asking", () => {
    expect(stageOf(anOrder({ payment: payment("pending") }))).toBe("checking");
  });

  it("When a receipt is under review, then it says so and asks less often", () => {
    expect(stageOf(anOrder({ payment: { ...payment("pending_review"), method: "card_transfer" } }))).toBe("review");
    expect(pollEvery("review")).toBe(15000);
  });

  it("When the payment failed, then it says so and stops asking", () => {
    expect(stageOf(anOrder({ payment: payment("failed") }))).toBe("failed");
    expect(pollEvery("failed")).toBe(0);
  });

  it("When a USDT quote is waiting, then the page shows what to send and keeps watching", () => {
    const order = anOrder({
      payment: {
        ...payment("pending"),
        method: "usdt_tron",
        crypto: {
          asset: "USDT",
          network: "TRON",
          address: "TGBCcHD7f7eeVpzpy6rE9FcgAgg4CWugVT",
          amount: "1.500347",
          amountUnits: 1500347,
          rateTomanPerUsdt: 100000,
          expiresAt: "2026-09-30T01:00:00Z",
        },
      },
    });
    expect(stageOf(order)).toBe("awaiting_transfer");
    expect(pollEvery("awaiting_transfer")).toBe(5000);
  });

  it("When the order lapsed unpaid, then it is expired", () => {
    expect(stageOf(anOrder({ status: "expired", payment: payment("expired") }))).toBe("expired");
  });
});
