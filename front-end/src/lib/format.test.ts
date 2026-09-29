import { describe, expect, it } from "vitest";

import { formatDate, formatGb, formatToman, formatUsage, fullness } from "./format";

/** What staff read: Persian digits, the Solar Hijri calendar, binary gigabytes. */

const GB = 1024 ** 3;

describe("Volumes and money", () => {
  it("When a plan is 50 GB in bytes, then it reads as ۵۰ گیگ", () => {
    expect(formatGb(50 * GB)).toBe("۵۰ گیگ");
  });

  it("When there is no limit, then it reads as unlimited", () => {
    expect(formatGb(null)).toBe("نامحدود");
  });

  it("When 3 GB of 50 are used, then both are shown", () => {
    expect(formatUsage(3 * GB, 50 * GB)).toBe("۳ گیگ از ۵۰ گیگ");
  });

  it("When a price is 150000 toman, then it has Persian digits and separators", () => {
    expect(formatToman(150_000)).toBe("۱۵۰٬۰۰۰ تومان");
  });
});

describe("Dates", () => {
  it("When a date is shown, then it is in the Solar Hijri calendar", () => {
    // 2026-09-30 is 8 Mehr 1405.
    expect(formatDate("2026-09-30T12:00:00Z")).toContain("۱۴۰۵");
  });

  it("When there is no date, then a dash stands in", () => {
    expect(formatDate(null)).toBe("—");
  });
});

describe("The usage meter", () => {
  it("When more than the limit is used, then the meter stops at full", () => {
    expect(fullness(60 * GB, 50 * GB)).toBe(1);
  });

  it("When the plan is unlimited, then the meter stays empty", () => {
    expect(fullness(60 * GB, null)).toBe(0);
  });
});
