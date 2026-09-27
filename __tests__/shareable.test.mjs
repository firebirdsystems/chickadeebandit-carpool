import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));
const page = readFileSync(join(__dirname, "../src/index.html"), "utf-8");
const migrations = readdirSync(join(__dirname, "../migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(__dirname, "../migrations", f), "utf-8"))
  .join("\n");

const item = manifest.shareable?.carpool;
const query = item?.calendar?.source?.query ?? "";

/** Every column a migration creates on `table` (CREATE TABLE or ADD COLUMN). */
function columnsOf(table) {
  const cols = new Set();
  const create = migrations.match(new RegExp(`CREATE TABLE IF NOT EXISTS app_carpool__${table} \\(([\\s\\S]*?)\\n\\);`));
  for (const line of (create?.[1] ?? "").split("\n")) {
    const m = line.trim().match(/^([a-z_]+)\s+(TEXT|INTEGER)/);
    if (m) cols.add(m[1]);
  }
  for (const m of migrations.matchAll(new RegExp(`ALTER TABLE app_carpool__${table} ADD COLUMN ([a-z_]+)`, "g"))) cols.add(m[1]);
  return cols;
}

/**
 * A share link is an anonymous read that skips row policies, so the declared
 * columns and the calendar query are the whole public surface. The share
 * panel tells the adult what the link shows and what stays private; these
 * hold the manifest to that sentence.
 */
describe("shareable.carpool", () => {
  it("anchors on the carpools table by id, titled by name", () => {
    expect(item.table).toBe("carpools");
    expect(item.id_column ?? "id").toBe("id");
    expect(item.title_column).toBe("name");
  });

  it("projects the pickup place and time, and nothing else", () => {
    expect(item.columns.map((c) => c.column)).toEqual(["location", "pickup_time"]);
    expect(item.columns.map((c) => c.label)).toEqual(["Where", "Pickup"]);
    const carpoolCols = columnsOf("carpools");
    for (const c of item.columns) expect(carpoolCols.has(c.column), c.column).toBe(true);
  });

  // Notes, who set it up, the rotation order and its weekdays stay in the
  // household; a day's driver_id is a member id, not something to publish.
  it("never exposes notes, the author, the rotation or member ids", () => {
    // driver_id may appear only as the removal test inside the title's CASE —
    // compared, never selected.
    const json = JSON.stringify(item).replace("CASE WHEN a.driver_id != ''", "CASE WHEN");
    for (const col of ["description", "created_by", "created_by_name", "driver_order", "weekdays", "driver_id", "note"]) {
      expect(json).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(item.aggregates).toBeUndefined();
    expect(item.feed).toBeUndefined();
  });

  it("is read-only and is the item type the page mints", () => {
    expect(item.submit).toBeUndefined();
    expect(item.files).toBeUndefined();
    expect(Object.keys(manifest.shareable)).toEqual(["carpool"]);
    expect(page).toMatch(/itemType:\s*"carpool"/);
    expect(page).toMatch(/noun:\s*"carpool"/);
  });
});

describe("shareable.carpool.calendar", () => {
  it("prefixes each event with the carpool's name, from an sql source", () => {
    expect(item.calendar.title_prefix_from_item).toBe(true);
    expect(item.calendar.source.kind).toBe("sql");
  });

  it("pins the query", () => {
    expect(query).toBe(
      "SELECT a.id AS uid, CASE WHEN a.driver_id != '' THEN a.driver_name END AS title, a.date AS start_date, "
      + "c.pickup_time AS start_time, c.location AS location "
      + "FROM app_carpool__assignments a JOIN app_carpool__carpools c ON c.id = a.carpool_id AND c.archived = 0 "
      + "WHERE a.carpool_id = :item_id AND a.date BETWEEN :range_start AND :range_end AND a.status != 'skipped' "
      + "ORDER BY a.date LIMIT 2000",
    );
  });

  it("outputs only the hub's calendar aliases, including the required ones", () => {
    const aliases = [...query.matchAll(/\bAS (\w+)/g)].map((m) => m[1]);
    const allowed = ["uid", "title", "start_date", "start_time", "end_time", "location", "description"];
    for (const a of aliases) expect(allowed).toContain(a);
    for (const a of ["uid", "title", "start_date"]) expect(aliases).toContain(a);
  });

  // Removing a member blanks driver_id on SCHEDULED rides only
  // (member_references), and the hub cannot clear the name snapshot beside
  // it. The query drops the name wherever the id is blank, so a removed
  // member's upcoming drives are unnamed at the next refresh. Days they
  // already drove keep driver_id, and so their name, for the past month.
  it("titles each day with the driver's name snapshot, never the member id, and not on a removed driver's upcoming days", () => {
    expect(query).toMatch(/CASE WHEN a\.driver_id != '' THEN a\.driver_name END AS title/);
    expect(columnsOf("assignments").has("driver_name")).toBe(true);
    const removal = manifest.member_references.assignments;
    expect(removal).toMatchObject({ column: "driver_id", on_removed: "null", null_value: "" });
  });

  // Archiving a carpool retires it, and its days leave the calendar with it.
  // The share panel lives on a carpool's detail view, which an archived carpool
  // no longer has, so its links cannot be revoked from the app: the page and
  // the feed both close instead. `archived` is an INTEGER, stored in the clear.
  it("serves nothing for an archived carpool — page or feed", () => {
    expect(item.visible_where).toEqual({ column: "archived", values: ["0"] });
    expect(manifest.db_plaintext_columns).toContain("archived");
    expect(query).toMatch(/JOIN app_carpool__carpools c ON c\.id = a\.carpool_id AND c\.archived = 0/);
  });

  it("scopes to the shared carpool and the window on plaintext columns", () => {
    expect(query).toMatch(/a\.carpool_id = :item_id/); // plaintext by the _id suffix
    expect(query).toMatch(/a\.date BETWEEN :range_start AND :range_end/);
    expect(manifest.db_plaintext_columns).toEqual(expect.arrayContaining(["date", "pickup_time"]));
    expect(query.match(/:\w+/g).sort()).toEqual([":item_id", ":range_end", ":range_start"]);
  });

  it("reads only this app's tables and columns that exist", () => {
    for (const t of query.match(/(?:FROM|JOIN)\s+(\w+)/g)) expect(t).toMatch(/\sapp_carpool__/);
    const assignmentCols = columnsOf("assignments");
    const carpoolCols = columnsOf("carpools");
    for (const [, alias, col] of query.matchAll(/\b([ac])\.(\w+)/g)) {
      expect((alias === "a" ? assignmentCols : carpoolCols).has(col), `${alias}.${col}`).toBe(true);
    }
  });

  it("is a single bounded SELECT", () => {
    expect(query).toMatch(/^SELECT /);
    expect(query).not.toMatch(/;|--|\/\*/);
    const limit = Number(query.match(/LIMIT (\d+)$/)?.[1]);
    expect(limit).toBeGreaterThanOrEqual(1);
    expect(limit).toBeLessThanOrEqual(2000);
  });

  it("offers calendar-length expiries and the subscribe link in the panel", () => {
    expect(page).toMatch(/expiryChoices:\s*SHARE_CALENDAR_EXPIRY_CHOICES/);
    expect(page).toMatch(/defaultExpiryHours:\s*DEFAULT_SHARE_EXPIRY_HOURS/);
    expect(page).toMatch(/calendarUrl:\s*\(link\)\s*=>\s*share\.calendarUrl\(link\)/);
  });
});

describe("the share panel's scope sentence", () => {
  const scope = page.match(/scopeHtml:\s*\(\)\s*=>\s*"([^"]+)"/)?.[1] ?? "";

  it("says plainly that the calendar names each day's driver", () => {
    expect(scope).toMatch(/driver/);
    for (const phrase of ["name", "pickup time", "place"]) expect(scope).toContain(phrase);
  });

  it("says what stays private", () => {
    const kept = scope.split("stay private")[0].split(".").pop();
    for (const phrase of ["notes", "rotation order", "who else is in the household"]) {
      expect(kept).toContain(phrase);
    }
  });

  it("backfills driver names before the panel opens", () => {
    const open = page.match(/async function openShare[\s\S]*?\n}/)?.[0] ?? "";
    expect(open.indexOf("refreshDriverNames(")).toBeGreaterThan(-1);
    expect(open.indexOf("refreshDriverNames(")).toBeLessThan(open.indexOf("shareUi.open("));
  });

  it("offers Share to adults only", () => {
    expect(page).toMatch(/function canShare\(\) \{ return share\.enabled && !!ME && canManage\(\); \}/);
    expect(page).toMatch(/\$\{canShare\(\) \? `<button[^`]*data-share-carpool=/);
  });
});
