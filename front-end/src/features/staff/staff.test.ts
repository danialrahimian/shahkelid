import type { AccountView } from "@shah-kelid/contracts";
import { describe, expect, it } from "vitest";

import { parseGroups } from "./group-list";
import { firstStaffPage } from "./staff-links";

describe("Typing panel group ids", () => {
  it("When ids are typed in Persian digits with a Persian comma, then they are read", () => {
    expect(parseGroups("۳، ۵")).toEqual([3, 5]);
  });

  it("When an id is repeated or is not a whole number, then it is dropped", () => {
    expect(parseGroups("3, 3, 0, 2.5, 7")).toEqual([3, 7]);
  });

  it("When nothing is typed, then there are no extra groups", () => {
    expect(parseGroups("")).toEqual([]);
    expect(parseGroups(undefined)).toEqual([]);
  });
});

const staff = (permissions: string[]): AccountView => ({
  id: "0190a0b4-0000-7000-8000-000000000000",
  email: "staff@example.com",
  displayName: "",
  locale: "fa",
  emailVerified: true,
  hasPassword: true,
  isStaff: true,
  permissions,
  twoFactor: { enabled: true, required: true },
});

describe("Where /staff leads", () => {
  it("When someone may see customers, then they land on customers", () => {
    expect(firstStaffPage(staff(["customers:read", "servers:manage"]))).toBe("/staff/customers");
  });

  it("When staff may review receipts, then receipts come after customers, and alone they land on receipts", () => {
    expect(firstStaffPage(staff(["orders:read", "payments:review", "analytics:read", "customers:read"]))).toBe(
      "/staff/customers",
    );
    expect(firstStaffPage(staff(["payments:review"]))).toBe("/staff/payments");
  });

  it("When someone may only manage servers, then they land on servers", () => {
    expect(firstStaffPage(staff(["servers:manage"]))).toBe("/staff/servers");
  });

  it("When someone has no staff page at all (an editor), then there is nowhere to go", () => {
    expect(firstStaffPage(staff(["content:manage"]))).toBeUndefined();
  });
});
