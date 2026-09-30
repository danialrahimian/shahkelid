import { describe, expect, it } from "vitest";

import { groupPoints, lastDays, tehranToday } from "./reports";

const point = (day: string, revenueToman: number) => ({ day, revenueToman, orders: 1 });

describe("Report ranges", () => {
  it("Today is Tehran's: 22:00 UTC is already tomorrow there", () => {
    expect(tehranToday(new Date("2031-02-09T22:00:00Z"))).toBe("2031-02-10");
  });

  it("The last 7 days end today and include it", () => {
    expect(lastDays(7, new Date("2031-02-10T08:00:00Z"))).toEqual({ from: "2031-02-04", to: "2031-02-10" });
  });
});

describe("Grouping days", () => {
  it("Weeks start on Saturday", () => {
    // 2031-02-07 is a Friday, 2031-02-08 a Saturday.
    const weeks = groupPoints([point("2031-02-07", 1), point("2031-02-08", 2), point("2031-02-09", 3)], "week");
    expect(weeks.map((group) => [group.day, group.revenueToman])).toEqual([
      ["2031-02-07", 1],
      ["2031-02-08", 5],
    ]);
  });

  it("Months are Persian: 20 and 21 March fall in different months", () => {
    // 1 Farvardin is 21 March in 2031.
    const months = groupPoints([point("2031-03-20", 1), point("2031-03-21", 2), point("2031-03-22", 3)], "month");
    expect(months.map((group) => group.revenueToman)).toEqual([1, 5]);
  });

  it("By day, nothing is merged", () => {
    expect(groupPoints([point("2031-02-07", 1), point("2031-02-08", 2)], "day")).toHaveLength(2);
  });
});
