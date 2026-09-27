import { isAdult } from "./shared.js";
export { isAdult };

// Drivers are adults; carpools/assignments/swap_requests are all adult_writable.
// The client gate MUST mirror that (a non-adult who saw manage controls would get a
// silent 403), so organizing is adult-only.
export function canManage(member) {
  return isAdult(member);
}

// Parse a "1,3,5" weekday CSV into a set of ints (0=Sun … 6=Sat).
export function parseWeekdays(csv) {
  return (csv || "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

// Return the next `count` ISO dates (YYYY-MM-DD) on/after `fromDate` whose weekday is
// in `weekdays`. Pure — takes an explicit start date for testability.
export function upcomingDates(fromDate, weekdays, count) {
  const days = new Set(weekdays);
  const out = [];
  if (!days.size || count <= 0) return out;
  // Anchored and stepped in UTC. The old `T12:00:00` local-noon trick papered
  // over the offset for most of the world but still lands on the wrong day past
  // ±12h, and `getDay()` on a local instant can disagree with the date string
  // the loop emits.
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  let guard = 0;
  while (out.length < count && guard < 400) {
    if (days.has(cursor.getUTCDay())) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard++;
  }
  return out;
}

// Driver for the Nth occurrence in a rotation order (round-robin). `index` is the
// 0-based occurrence number; empty order → "".
export function rotationDriver(order, index) {
  if (!Array.isArray(order) || order.length === 0) return "";
  return order[index % order.length];
}

// Build the calendar_events payload from upcoming scheduled assignments.
// Shape matches what the Calendar app consumes from cross.calendar_events.
export function buildCalendarEvents(carpools, assignments, todayIso) {
  const byId = new Map(carpools.map((c) => [c.id, c]));
  return assignments
    .filter((a) => a.status === "scheduled" && a.date >= todayIso)
    .map((a) => {
      const cp = byId.get(a.carpool_id);
      if (!cp || cp.archived) return null;
      const start = cp.pickup_time ? `${a.date}T${cp.pickup_time}` : a.date;
      return {
        id: a.id,
        title: `Carpool: ${cp.name}`,
        description: cp.location ? `Pickup at ${cp.location}` : "Carpool pickup",
        start,
        end: start,
        all_day: !cp.pickup_time,
        member_ids: a.driver_id ? [a.driver_id] : [],
        source_label: "Carpool",
      };
    })
    .filter(Boolean);
}

export function openSwap(swapRequests, assignmentId) {
  return swapRequests.find((s) => s.assignment_id === assignmentId && s.status === "open") ?? null;
}

// ── driver_name snapshot ──
// The public carpool calendar (manifest.shareable.carpool) titles each day with
// its driver, and a share link reads no member roster, so the driver's display
// name is copied onto the assignment. The encrypt codec THROWS on an empty
// string, so "no driver" or "no name" is always NULL, never "".

/**
 * The roster, with the signed-in member added when it is missing — a failed
 * roster read leaves `members` empty, but the member taking a drive still knows
 * their own name, and the snapshot should not go blank because of it.
 */
export function rosterWithSelf(members, me) {
  const list = Array.isArray(members) ? members : [];
  if (!me?.id || list.some((m) => m?.id === me.id)) return list;
  return [...list, me];
}

/** The name the household shows for `driverId`, or null. */
export function driverNameFor(members, driverId) {
  if (!driverId) return null;
  const member = (members ?? []).find((m) => m?.id === driverId);
  const name = typeof member?.name === "string" ? member.name.trim() : "";
  return name || null;
}

/**
 * The INSERT for one generated assignment. `a.driver_name` is bound as-is, so
 * callers set it from driverNameFor (null or a non-empty name). `orIgnore` is
 * for extending a schedule, where a (carpool_id, date) may already exist.
 */
export function assignmentInsert(a, { orIgnore = false } = {}) {
  return {
    sql: `INSERT${orIgnore ? " OR IGNORE" : ""} INTO app_carpool__assignments (id, carpool_id, date, driver_id, driver_name, note, status, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, '', 'scheduled', ?, ?)`,
    params: [a.id, a.carpool_id, a.date, a.driver_id, a.driver_name || null, a.created_at, a.updated_at],
  };
}

/** The UPDATE that hands a day to `driverId` ("" = unassigned) with its name. */
export function driverUpdate(assignmentId, driverId, members, now) {
  const driverName = driverNameFor(members, driverId);
  return {
    sql: "UPDATE app_carpool__assignments SET driver_id = ?, driver_name = ?, updated_at = ? WHERE id = ?",
    params: [driverId, driverName, now, assignmentId],
    driverName,
  };
}

// Rows per refresh statement, and per refresh. Assignments are generated 28
// days at a time, so a household's upcoming rows fit well inside this; a larger
// backlog is finished on the next load.
export const DRIVER_NAME_REFRESH_CHUNK = 50;
export const DRIVER_NAME_REFRESH_MAX = 200;

/**
 * The UPDATEs that bring upcoming assignments' driver_name in line with the
 * roster: a missing snapshot, a rename, or a day whose driver the hub blanked
 * when the member was removed (which must stop naming them). Grouped by
 * driver, bounded, and guarded on driver_id so a concurrent reassignment is
 * never stamped with the old driver's name.
 *
 * A driver_id the roster doesn't list keeps whatever name it has: an empty or
 * failed roster read must not wipe every name.
 */
export function driverNameRefreshes(assignments, members, todayIso, { carpoolId = null, max = DRIVER_NAME_REFRESH_MAX } = {}) {
  if (!Array.isArray(members) || members.length === 0) return [];
  const known = new Set(members.map((m) => m?.id).filter(Boolean));
  const groups = new Map();
  let taken = 0;
  for (const a of assignments ?? []) {
    if (taken >= max) break;
    if (!a?.id || !(a.date >= todayIso)) continue;
    if (carpoolId && a.carpool_id !== carpoolId) continue;
    const driverId = a.driver_id || "";
    if (driverId && !known.has(driverId)) continue;
    const want = driverNameFor(members, driverId);
    const have = a.driver_name || null;
    if (want === have) continue;
    if (!groups.has(driverId)) groups.set(driverId, { driverId, driverName: want, ids: [] });
    groups.get(driverId).ids.push(a.id);
    taken++;
  }
  const out = [];
  for (const { driverId, driverName, ids } of groups.values()) {
    for (let i = 0; i < ids.length; i += DRIVER_NAME_REFRESH_CHUNK) {
      const chunk = ids.slice(i, i + DRIVER_NAME_REFRESH_CHUNK);
      out.push({
        sql: `UPDATE app_carpool__assignments SET driver_name = ? WHERE driver_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`,
        params: [driverName, driverId, ...chunk],
        ids: chunk,
        driverName,
      });
    }
  }
  return out;
}
