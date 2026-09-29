import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ZarinpalGateway } from "../src/modules/billing/zarinpal";
import { payInSandbox } from "./helpers/zarinpal-sandbox";

/**
 * The Zarinpal gateway against Zarinpal's real sandbox.
 *
 *   npm run test:contract
 *
 * Proves what test/helpers/fake-zarinpal.ts assumes. The sandbox accepts
 * any merchant id, so this needs no account.
 */

const enabled = process.env.PASARGUARD_CONTRACT === "1";
const gateway = new ZarinpalGateway("00000000-0000-0000-0000-000000000000", true);
const callbackUrl = "http://localhost:5000/api/v1/payments/zarinpal/callback";

describe("Zarinpal gateway against the sandbox", { skip: !enabled && "run with npm run test:contract" }, () => {
  it("When a payment is paid, then verify says paid the first time and again after, with the same ref id", async () => {
    const { authority, payUrl } = await gateway.request({ amountToman: 15_000, callbackUrl, description: "contract" });
    assert.match(payUrl, new RegExp(`/pg/StartPay/${authority}$`));

    const back = await payInSandbox(payUrl);
    assert.equal(back.authority, authority);
    assert.equal(back.status, "OK");
    assert.equal(back.callback.pathname, "/api/v1/payments/zarinpal/callback");

    const first = await gateway.verify({ authority, amountToman: 15_000 });
    const second = await gateway.verify({ authority, amountToman: 15_000 });
    assert.equal(first.outcome, "paid");
    assert.deepEqual(second, first, "verifying twice is harmless");
    assert.equal(await gateway.inquiry(authority), "VERIFIED");
  });

  it("When the amount differs from the one paid, then verify refuses it as a mismatch", async () => {
    const { authority, payUrl } = await gateway.request({ amountToman: 20_000, callbackUrl, description: "contract" });
    await payInSandbox(payUrl);

    assert.deepEqual(await gateway.verify({ authority, amountToman: 100 }), { outcome: "amount_mismatch" });
  });

  it("When nothing was paid, then verify says not paid and inquiry says it is still at the bank", async () => {
    const { authority } = await gateway.request({ amountToman: 12_000, callbackUrl, description: "contract" });

    const result = await gateway.verify({ authority, amountToman: 12_000 });
    assert.equal(result.outcome, "not_paid");
    assert.equal(await gateway.inquiry(authority), "IN_BANK");
  });

  it("When the customer cancels at the bank, then the callback says NOK", async () => {
    const { payUrl } = await gateway.request({ amountToman: 12_000, callbackUrl, description: "contract" });

    assert.equal((await payInSandbox(payUrl, "NOK")).status, "NOK");
  });
});
