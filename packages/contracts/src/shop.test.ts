import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cardTransferInput, paymentCardInput, reviewReceiptInput } from "./shop.ts";

/** The card-to-card form, as a customer on a Persian keyboard fills it in. */

const aReceipt = {
  destinationCardId: "0190a0b4-0000-7000-8000-000000000000",
  trackingNumber: "۱۲۳۴۵۶۷۸",
  claimedAmountToman: "۱۵۰,۰۰۰",
  payerCardLast4: "۶۰۳۷",
};

describe("The card-to-card receipt", () => {
  it("When digits are Persian and the amount has separators, then they read as numbers", () => {
    const parsed = cardTransferInput.parse(aReceipt);
    assert.equal(parsed.trackingNumber, "12345678");
    assert.equal(parsed.claimedAmountToman, 150000);
    assert.equal(parsed.payerCardLast4, "6037");
  });

  it("When the last four digits are not four digits, then it is refused with LAST4_INVALID", () => {
    const result = cardTransferInput.safeParse({ ...aReceipt, payerCardLast4: "12" });
    assert.equal(result.success, false);
    assert.equal(result.error!.issues[0]!.message, "LAST4_INVALID");
  });

  it("When the amount is missing, then it is required", () => {
    const result = cardTransferInput.safeParse({ ...aReceipt, claimedAmountToman: "" });
    assert.equal(result.error!.issues[0]!.message, "REQUIRED");
  });
});

describe("Cards to transfer to", () => {
  it("When a card number is typed with spaces or dashes, then 16 digits are kept", () => {
    const card = paymentCardInput.parse({
      label: "ملت",
      bankName: "ملت",
      cardNumber: "6104-3378 1234 ۵۶۷۸",
      holderName: "شاه‌کلید",
    });
    assert.equal(card.cardNumber, "6104337812345678");
  });

  it("When a card number is short, then it is refused", () => {
    const result = paymentCardInput.safeParse({ label: "x", bankName: "x", cardNumber: "6104 3378", holderName: "x" });
    assert.equal(result.error!.issues[0]!.message, "CARD_NUMBER_INVALID");
  });
});

describe("Reviewing a receipt", () => {
  it("When a receipt is rejected, then a reason is required, since the customer reads it", () => {
    assert.equal(reviewReceiptInput.safeParse({ decision: "reject", note: "" }).success, false);
    assert.equal(reviewReceiptInput.safeParse({ decision: "reject", note: "واریزی دیده نشد" }).success, true);
    assert.equal(reviewReceiptInput.safeParse({ decision: "approve" }).success, true);
  });
});

describe("USDT amounts", () => {
  it("When units are shown, then all six decimals are kept, so the unique tail is never rounded away", async () => {
    const { formatUsdtUnits } = await import("./shop.ts");
    assert.equal(formatUsdtUnits(12_000_347), "12.000347");
    assert.equal(formatUsdtUnits(1_500_000), "1.500000");
    assert.equal(formatUsdtUnits(7), "0.000007");
  });
});
