import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";
import {
  canManage, parseWeekdays, upcomingDates, rotationDriver, buildCalendarEvents, openSwap,
  driverNameFor, assignmentInsert, driverUpdate, driverNameRefreshes, rosterWithSelf,
  DRIVER_NAME_REFRESH_CHUNK,
} from "../src/logic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(__dirname, "../src/index.html"), "utf-8");

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

// ── driver_name snapshot ──
// The encrypt codec THROWS on an empty string, so no write may bind "" to
// driver_name. `nameParam` finds the value bound to driver_name in a statement.
function nameParam({ sql, params }) {
  if (/^UPDATE .* SET driver_name = \?/s.test(sql)) return params[0];
  if (/SET driver_id = \?, driver_name = \?/.test(sql)) return params[1];
  const cols = sql.match(/\(([^)]*)\)\s*VALUES/)[1].split(",").map((c) => c.trim());
  const values = sql.match(/VALUES\s*\(([^)]*)\)/)[1].split(",").map((v) => v.trim());
  let p = -1;
  for (let i = 0; i < cols.length; i++) {
    if (values[i] === "?") p++;
    if (cols[i] === "driver_name") return values[i] === "?" ? params[p] : values[i];
  }
  throw new Error("no driver_name in statement");
}

const members = [
  { id: "m1", name: "Alex", role: "adult" },
  { id: "m2", name: "  Jordan  ", role: "adult" },
  { id: "m3", name: "", role: "adult" },
  { id: "m4", name: "   ", role: "adult" },
];

describe("driverNameFor", () => {
  it("is the trimmed display name", () => {
    expect(driverNameFor(members, "m1")).toBe("Alex");
    expect(driverNameFor(members, "m2")).toBe("Jordan");
  });
  it("is null — never \"\" — with no driver, no member or no name", () => {
    expect(driverNameFor(members, "")).toBe(null);
    expect(driverNameFor(members, null)).toBe(null);
    expect(driverNameFor(members, "gone")).toBe(null);
    expect(driverNameFor(members, "m3")).toBe(null);
    expect(driverNameFor(members, "m4")).toBe(null);
    expect(driverNameFor(null, "m1")).toBe(null);
  });
});

describe("assignmentInsert", () => {
  const base = { id: "a1", carpool_id: "cp1", date: "2026-07-06", driver_id: "m1", created_at: "t0", updated_at: "t0" };
  it("writes driver_name alongside driver_id", () => {
    const ins = assignmentInsert({ ...base, driver_name: "Alex" });
    expect(ins.sql).toMatch(/^INSERT INTO app_carpool__assignments \(id, carpool_id, date, driver_id, driver_name, note, status, created_at, updated_at\)/);
    expect(ins.params).toEqual(["a1", "cp1", "2026-07-06", "m1", "Alex", "t0", "t0"]);
    expect(nameParam(ins)).toBe("Alex");
  });
  it("OR IGNORE for extending a schedule", () => {
    expect(assignmentInsert(base, { orIgnore: true }).sql).toMatch(/^INSERT OR IGNORE INTO app_carpool__assignments/);
  });
  it("binds NULL, never \"\", for no name", () => {
    for (const driver_name of [undefined, null, ""]) {
      expect(nameParam(assignmentInsert({ ...base, driver_id: "", driver_name }))).toBe(null);
    }
  });
  it("placeholders match params", () => {
    const ins = assignmentInsert(base);
    expect((ins.sql.match(/\?/g) ?? []).length).toBe(ins.params.length);
  });
});

describe("driverUpdate", () => {
  it("sets the driver and their name together", () => {
    const u = driverUpdate("a1", "m2", members, "t1");
    expect(u.sql).toBe("UPDATE app_carpool__assignments SET driver_id = ?, driver_name = ?, updated_at = ? WHERE id = ?");
    expect(u.params).toEqual(["m2", "Jordan", "t1", "a1"]);
    expect(u.driverName).toBe("Jordan");
  });
  it("unassigning, or a nameless member, binds NULL", () => {
    for (const id of ["", "m3", "gone"]) {
      const u = driverUpdate("a1", id, members, "t1");
      expect(nameParam(u)).toBe(null);
      expect(u.driverName).toBe(null);
    }
  });
});

describe("driverNameRefreshes", () => {
  const today = "2026-07-06";
  const rows = [
    { id: "a1", carpool_id: "cp1", date: "2026-07-06", driver_id: "m1", driver_name: null },     // missing
    { id: "a2", carpool_id: "cp1", date: "2026-07-07", driver_id: "m1", driver_name: "Al" },     // renamed
    { id: "a3", carpool_id: "cp1", date: "2026-07-08", driver_id: "m1", driver_name: "Alex" },   // current
    { id: "a4", carpool_id: "cp2", date: "2026-07-08", driver_id: "m2" },                         // missing, other carpool
    { id: "a5", carpool_id: "cp1", date: "2026-07-05", driver_id: "m1", driver_name: null },     // past
    { id: "a6", carpool_id: "cp1", date: "2026-07-09", driver_id: "", driver_name: "Sam" },      // driver removed
    { id: "a7", carpool_id: "cp1", date: "2026-07-10", driver_id: "", driver_name: null },       // unassigned, fine
    { id: "a8", carpool_id: "cp1", date: "2026-07-11", driver_id: "gone", driver_name: "Sam" },  // not on roster: keep
    { id: "a9", carpool_id: "cp1", date: "2026-07-12", driver_id: "m3", driver_name: "Old" },    // nameless member
  ];

  it("updates missing, renamed and removed-driver rows, upcoming only", () => {
    const u = driverNameRefreshes(rows, members, today);
    expect(u.map((x) => [x.driverName, x.ids])).toEqual([
      ["Alex", ["a1", "a2"]],
      ["Jordan", ["a4"]],
      [null, ["a6"]],
      [null, ["a9"]],
    ]);
  });

  it("guards each update on driver_id, so a concurrent reassignment keeps its name", () => {
    const [first] = driverNameRefreshes(rows, members, today);
    expect(first.sql).toBe("UPDATE app_carpool__assignments SET driver_name = ? WHERE driver_id = ? AND id IN (?, ?)");
    expect(first.params).toEqual(["Alex", "m1", "a1", "a2"]);
  });

  it("narrows to one carpool", () => {
    const u = driverNameRefreshes(rows, members, today, { carpoolId: "cp2" });
    expect(u.map((x) => x.ids)).toEqual([["a4"]]);
  });

  it("does nothing on an empty or failed roster read", () => {
    expect(driverNameRefreshes(rows, [], today)).toEqual([]);
    expect(driverNameRefreshes(rows, null, today)).toEqual([]);
  });

  it("is bounded per statement and per refresh", () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ id: `x${i}`, carpool_id: "cp1", date: "2026-08-01", driver_id: "m1" }));
    const u = driverNameRefreshes(many, members, today);
    expect(u.map((x) => x.ids.length)).toEqual([DRIVER_NAME_REFRESH_CHUNK, DRIVER_NAME_REFRESH_CHUNK, 30]);
    for (const x of u) expect((x.sql.match(/\?/g) ?? []).length).toBe(x.params.length);
    const capped = driverNameRefreshes(many, members, today, { max: 10 });
    expect(capped.flatMap((x) => x.ids)).toHaveLength(10);
  });

  it("never binds \"\" to driver_name", () => {
    for (const x of driverNameRefreshes(rows, members, today)) {
      expect(nameParam(x)).not.toBe("");
    }
  });
});

describe("every driver_id write in the page goes through a helper that sets driver_name", () => {
  it("has no hand-written INSERT or driver_id UPDATE on assignments left", () => {
    expect(page).not.toMatch(/INSERT[^`"]*INTO app_carpool__assignments/);
    expect(page).not.toMatch(/UPDATE app_carpool__assignments SET driver_id/);
  });
  it("uses the helpers at all four sites", () => {
    expect(page.match(/assignmentInsert\(a\)/g)).toHaveLength(1);                    // create
    expect(page.match(/assignmentInsert\(a, \{ orIgnore: true \}\)/g)).toHaveLength(1); // extend
    expect(page.match(/driverUpdate\(/g)).toHaveLength(2);                           // reassign + accept swap
    // Create and extend stamp the name from the roster plus the signed-in
    // member, as reassign does, so a failed roster read can't blank them.
    expect(page.match(/driver_name: driverNameFor\(rosterWithSelf\(members, currentMember\), driver_id\)/g)).toHaveLength(2);
  });
});

describe("rosterWithSelf", () => {
  const me = { id: "m-me", name: "Alex" };
  // A failed roster read leaves members empty; taking a drive yourself must
  // still stamp your own name rather than a blank one.
  it("adds the signed-in member when the roster lacks them", () => {
    expect(rosterWithSelf([], me)).toEqual([me]);
    expect(driverUpdate("a-1", me.id, rosterWithSelf([], me), "t").driverName).toBe("Alex");
  });

  it("leaves a roster that already lists them, and survives no member", () => {
    const roster = [{ id: "m-me", name: "Alex R." }];
    expect(rosterWithSelf(roster, me)).toBe(roster);
    expect(rosterWithSelf(undefined, null)).toEqual([]);
  });

  it("is what the page uses for reassign and swap acceptance", () => {
    expect(page.match(/driverUpdate\([^)]*rosterWithSelf\(members, currentMember\)/g)).toHaveLength(2);
  });
});
