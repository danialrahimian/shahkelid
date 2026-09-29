import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bytesToGigabytes, gigabytesToBytes } from "./traffic.ts";

describe("Traffic", () => {
  it("When one gigabyte is converted, then it matches the panel's own figure", () => {
    // PasarGuard documents 1 GB as 1,073,741,824 bytes.
    assert.equal(gigabytesToBytes(1), 1_073_741_824);
  });

  it("When a 50 GB plan is stored, then reading it back gives 50", () => {
    assert.equal(bytesToGigabytes(gigabytesToBytes(50)), 50);
  });

  it("When a plan is fractional, then it still lands on whole bytes", () => {
    assert.equal(gigabytesToBytes(0.5), 536_870_912);
  });

  it("When a negative or non-numeric volume is passed, then it is refused", () => {
    assert.throws(() => gigabytesToBytes(-1), RangeError);
    assert.throws(() => gigabytesToBytes(Number.POSITIVE_INFINITY), RangeError);
  });
});
