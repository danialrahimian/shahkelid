import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatToman, rialToToman, tomanToRial } from "./money.ts";

describe("Money", () => {
  it("When toman goes to Zarinpal, then it is exactly ten times as many rial", () => {
    assert.equal(tomanToRial(150_000), 1_500_000);
  });

  it("When a Nobitex rial price comes in, then it becomes toman", () => {
    // A real quote from the stage 2 check: 2,521,600 rial per USDT.
    assert.equal(rialToToman(2_521_600), 252_160);
  });

  it("When a rial amount is not a multiple of ten, then it rounds down", () => {
    // Incoming money is never valued above what actually arrived.
    assert.equal(rialToToman(2_521_609), 252_160);
  });

  it("When a fractional amount is passed, then it is refused rather than rounded", () => {
    assert.throws(() => tomanToRial(10.5), RangeError);
    assert.throws(() => rialToToman(Number.NaN), RangeError);
  });

  it("When a price is shown in Persian, then it uses Persian digits and the word toman", () => {
    assert.equal(formatToman(120_000), "۱۲۰٬۰۰۰ تومان");
  });
});
