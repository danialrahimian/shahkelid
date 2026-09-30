import { describe, expect, it } from "vitest";

import { daysLeft, usedShare } from "./service-facts";

const now = Date.parse("2026-09-30T12:00:00Z");

describe("Days left on a service", () => {
  it("When it ends later today, then one day is left, not none", () => {
    expect(daysLeft("2026-09-30T20:00:00Z", now)).toBe(1);
  });

  it("When it ends in 30 days, then 30 days are left", () => {
    expect(daysLeft("2026-10-30T12:00:00Z", now)).toBe(30);
  });

  it("When it has ended, then none are left (never a negative count)", () => {
    expect(daysLeft("2026-09-01T00:00:00Z", now)).toBe(0);
  });
});

describe("How full the volume is", () => {
  it("When more than the limit was used, then it is full, not more", () => {
    expect(usedShare(60, 50)).toBe(1);
  });

  it("When the service is unlimited, then it is never full", () => {
    expect(usedShare(60, null)).toBe(0);
  });
});
