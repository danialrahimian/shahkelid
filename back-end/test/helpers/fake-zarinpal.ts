import {
  GatewayUnavailableError,
  type InquiryStatus,
  type PaymentGateway,
  type VerifyResult,
} from "../../src/modules/billing/zarinpal";

/**
 * Zarinpal in memory, behaving as the sandbox was seen to behave:
 * verify is -51 before paying, -50 for a different amount, 100 then 101
 * after paying; inquiry says IN_BANK, then PAID, then VERIFIED.
 */
export class FakeZarinpal implements PaymentGateway {
  payments = new Map<string, { amountToman: number; paid: boolean; verified: boolean; refId: string }>();
  /** Every call fails as if Zarinpal were unreachable. */
  down = false;
  private next = 1;

  async request({ amountToman }: { amountToman: number }) {
    if (this.down) throw new GatewayUnavailableError("fake Zarinpal is down");
    const authority = `S${String(this.next++).padStart(35, "0")}`;
    this.payments.set(authority, { amountToman, paid: false, verified: false, refId: String(500000 + this.next) });
    return { authority, payUrl: `https://sandbox.zarinpal.test/pg/StartPay/${authority}` };
  }

  /** The customer pays at the bank. */
  pay(authority: string) {
    this.payments.get(authority)!.paid = true;
  }

  /** As if Zarinpal holds a different amount (a tampered or mistaken request). */
  changeAmount(authority: string, amountToman: number) {
    this.payments.get(authority)!.amountToman = amountToman;
  }

  async verify({ authority, amountToman }: { authority: string; amountToman: number }): Promise<VerifyResult> {
    if (this.down) throw new GatewayUnavailableError("fake Zarinpal is down");
    const payment = this.payments.get(authority);
    if (!payment || !payment.paid) return { outcome: "not_paid", code: -51 };
    if (payment.amountToman !== amountToman) return { outcome: "amount_mismatch" };
    payment.verified = true;
    return { outcome: "paid", refId: payment.refId, cardPan: "999999******9999" };
  }

  async inquiry(authority: string): Promise<InquiryStatus> {
    if (this.down) throw new GatewayUnavailableError("fake Zarinpal is down");
    const payment = this.payments.get(authority);
    if (!payment) return "UNKNOWN";
    return payment.verified ? "VERIFIED" : payment.paid ? "PAID" : "IN_BANK";
  }

  /** The authority of the latest payment request, i.e. the one just started. */
  get lastAuthority() {
    return [...this.payments.keys()].at(-1)!;
  }
}
