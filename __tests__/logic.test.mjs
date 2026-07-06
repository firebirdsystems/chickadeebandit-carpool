import { describe, it, expect } from "vitest";
import {
  canManage, parseWeekdays, upcomingDates, rotationDriver, buildCalendarEvents, openSwap,
} from "../src/logic.js";

describe("canManage mirrors adult_writable", () => {
  it("adults manage", () => expect(canManage({ role: "adult" })).toBe(true));
  it("children do not", () => expect(canManage({ role: "child" })).toBe(false));
  it("null does not", () => expect(canManage(null)).toBe(false));
});

describe("parseWeekdays", () => {
  it("parses valid days and drops junk", () => {
    expect(parseWeekdays("1,3,5")).toEqual([1, 3, 5]);
    expect(parseWeekdays("0, 6 , 9, x")).toEqual([0, 6]);
    expect(parseWeekdays("")).toEqual([]);
  });
});

describe("upcomingDates", () => {
  it("returns the next N matching weekdays", () => {
    // 2026-07-06 is a Monday. Weekdays [1,3] = Mon/Wed.
    const dates = upcomingDates("2026-07-06", [1, 3], 4);
    expect(dates).toEqual(["2026-07-06", "2026-07-08", "2026-07-13", "2026-07-15"]);
  });
  it("empty when no weekdays or count", () => {
    expect(upcomingDates("2026-07-06", [], 3)).toEqual([]);
    expect(upcomingDates("2026-07-06", [1], 0)).toEqual([]);
  });
});

describe("rotationDriver", () => {
  it("round-robins the order", () => {
    const order = ["a", "b", "c"];
    expect(rotationDriver(order, 0)).toBe("a");
    expect(rotationDriver(order, 3)).toBe("a");
    expect(rotationDriver(order, 4)).toBe("b");
  });
  it("empty order → empty string", () => expect(rotationDriver([], 2)).toBe(""));
});

describe("buildCalendarEvents", () => {
  const carpools = [
    { id: "cp1", name: "Soccer", location: "Field", pickup_time: "16:30", archived: false },
    { id: "cp2", name: "Old", location: "", pickup_time: "", archived: true },
  ];
  const assignments = [
    { id: "a1", carpool_id: "cp1", date: "2026-07-06", driver_id: "m1", status: "scheduled" },
    { id: "a2", carpool_id: "cp1", date: "2026-01-01", driver_id: "m1", status: "scheduled" }, // past
    { id: "a3", carpool_id: "cp1", date: "2026-07-07", driver_id: "m2", status: "skipped" },   // not scheduled
    { id: "a4", carpool_id: "cp2", date: "2026-07-06", driver_id: "m3", status: "scheduled" }, // archived carpool
  ];
  it("only future scheduled assignments of active carpools", () => {
    const ev = buildCalendarEvents(carpools, assignments, "2026-07-05");
    expect(ev.map((e) => e.id)).toEqual(["a1"]);
    expect(ev[0]).toMatchObject({
      title: "Carpool: Soccer", start: "2026-07-06T16:30", all_day: false,
      member_ids: ["m1"], source_label: "Carpool",
    });
  });
});

describe("openSwap", () => {
  const swaps = [
    { id: "s1", assignment_id: "a1", status: "open" },
    { id: "s2", assignment_id: "a1", status: "cancelled" },
  ];
  it("finds the open request for an assignment", () => {
    expect(openSwap(swaps, "a1")?.id).toBe("s1");
    expect(openSwap(swaps, "none")).toBe(null);
  });
});
