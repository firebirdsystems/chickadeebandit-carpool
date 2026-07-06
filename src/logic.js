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
  const cursor = new Date(`${fromDate}T12:00:00`);
  let guard = 0;
  while (out.length < count && guard < 400) {
    if (days.has(cursor.getDay())) out.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
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
