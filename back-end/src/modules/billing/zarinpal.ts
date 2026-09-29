import config from "../../config";

/**
 * Zarinpal, v4 REST API (https://www.zarinpal.com/docs/paymentGateway/).
 *
 * Checked against the sandbox, which behaves as follows (and the tests hold
 * us to it):
 *
 *   request  → code 100 and an authority; the customer pays at StartPay/{authority}
 *   verify   → 100 "Paid" with a ref_id the first time, 101 "Verified" after;
 *              -50 when the amount differs; -51 when nothing was paid
 *   inquiry  → status IN_BANK (not paid yet), PAID, VERIFIED, FAILED, REVERSED
 *
 * Amounts go to Zarinpal in rial (its default currency); ours are toman.
 * The amount verified is always the one we stored, never one from a request:
 * a callback cannot talk us into accepting less.
 */

export type VerifyResult =
  | { outcome: "paid"; refId: string; cardPan: string | null }
  | { outcome: "not_paid"; code: number }
  | { outcome: "amount_mismatch" };

export type InquiryStatus = "IN_BANK" | "PAID" | "VERIFIED" | "FAILED" | "REVERSED" | "UNKNOWN";

export interface PaymentGateway {
  request(input: {
    amountToman: number;
    callbackUrl: string;
    description: string;
    email?: string;
  }): Promise<{ authority: string; payUrl: string }>;
  verify(input: { authority: string; amountToman: number }): Promise<VerifyResult>;
  inquiry(authority: string): Promise<InquiryStatus>;
}

/** Zarinpal did not answer, or failed on its side. Nothing is known to have happened. */
export class GatewayUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GatewayUnavailableError";
  }
}

/** Zarinpal answered and refused (bad merchant, amount too small, …). */
export class GatewayRejectedError extends Error {
  readonly code: number | undefined;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "GatewayRejectedError";
    this.code = code;
  }
}

const TIMEOUT_MS = 10_000;

type Envelope<T> = {
  data: T | [] | Record<string, never>;
  errors: [] | { code: number; message: string };
};

export class ZarinpalGateway implements PaymentGateway {
  constructor(
    private readonly merchantId: string,
    private readonly sandbox: boolean,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private get api() {
    return this.sandbox
      ? "https://sandbox.zarinpal.com/pg/v4/payment"
      : "https://payment.zarinpal.com/pg/v4/payment";
  }

  private get startPay() {
    return this.sandbox ? "https://sandbox.zarinpal.com/pg/StartPay" : "https://payment.zarinpal.com/pg/StartPay";
  }

  private async call<T>(endpoint: string, body: Record<string, unknown>) {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.api}/${endpoint}.json`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ merchant_id: this.merchantId, ...body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new GatewayUnavailableError(`Zarinpal did not answer: ${(error as Error).message}`, {
        cause: error,
      });
    }
    if (response.status >= 500) {
      throw new GatewayUnavailableError(`Zarinpal failed: HTTP ${response.status}`);
    }
    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch (error) {
      throw new GatewayUnavailableError("Zarinpal sent something that is not JSON", { cause: error });
    }
    const error = Array.isArray(envelope.errors) ? undefined : envelope.errors;
    return { data: envelope.data as Partial<T>, error };
  }

  async request({
    amountToman,
    callbackUrl,
    description,
    email,
  }: {
    amountToman: number;
    callbackUrl: string;
    description: string;
    email?: string;
  }) {
    const { data, error } = await this.call<{ code: number; authority: string }>("request", {
      amount: amountToman * 10,
      callback_url: callbackUrl,
      description,
      ...(email ? { metadata: { email } } : {}),
    });
    if (error || data.code !== 100 || !data.authority) {
      throw new GatewayRejectedError(
        `Zarinpal refused the payment request: ${error?.message ?? `code ${data.code}`}`,
        error?.code ?? data.code,
      );
    }
    return { authority: data.authority, payUrl: `${this.startPay}/${data.authority}` };
  }

  async verify({ authority, amountToman }: { authority: string; amountToman: number }): Promise<VerifyResult> {
    const { data, error } = await this.call<{ code: number; ref_id: number; card_pan: string }>("verify", {
      amount: amountToman * 10,
      authority,
    });
    if (!error && (data.code === 100 || data.code === 101) && data.ref_id) {
      return { outcome: "paid", refId: String(data.ref_id), cardPan: data.card_pan ?? null };
    }
    if (error?.code === -50) return { outcome: "amount_mismatch" };
    if (error && [-51, -52, -53, -54, -55].includes(error.code)) {
      return { outcome: "not_paid", code: error.code };
    }
    if (error && error.code <= -9 && error.code >= -12) {
      throw new GatewayRejectedError(`Zarinpal refused the verification: ${error.message}`, error.code);
    }
    return { outcome: "not_paid", code: error?.code ?? data.code ?? 0 };
  }

  async inquiry(authority: string): Promise<InquiryStatus> {
    const { data, error } = await this.call<{ status: string }>("inquiry", { authority });
    if (error || !data.status) return "UNKNOWN";
    return (["IN_BANK", "PAID", "VERIFIED", "FAILED", "REVERSED"] as const).find((s) => s === data.status) ?? "UNKNOWN";
  }
}

let gateway: PaymentGateway | undefined;

export const zarinpal = (): PaymentGateway =>
  (gateway ??= new ZarinpalGateway(config.checkout.zarinpalMerchantId, config.checkout.zarinpalSandbox));

/** Test seam. */
export const setZarinpal = (replacement: PaymentGateway | null) => {
  gateway = replacement ?? undefined;
};
