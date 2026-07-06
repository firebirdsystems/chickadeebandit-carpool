-- A recurring carpool rotation (e.g. "Soccer Practice", "Morning School Run").
-- Everyone reads the schedule; only adults create and manage rotations.
CREATE TABLE IF NOT EXISTS app_carpool__carpools (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',
  pickup_time     TEXT NOT NULL DEFAULT '',        -- "HH:MM" local
  weekdays        TEXT NOT NULL DEFAULT '',         -- CSV of 0-6 (Sun=0), e.g. "1,3,5"
  driver_order    TEXT NOT NULL DEFAULT '[]',       -- JSON array of member ids (rotation order)
  created_by      TEXT NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  archived        INTEGER NOT NULL DEFAULT 0
);

-- One concrete driving day. Generated from the rotation, editable by adults.
CREATE TABLE IF NOT EXISTS app_carpool__assignments (
  id          TEXT PRIMARY KEY,
  carpool_id  TEXT NOT NULL,
  date        TEXT NOT NULL,
  driver_id   TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'scheduled',    -- scheduled | done | skipped
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (carpool_id, date),
  FOREIGN KEY (carpool_id) REFERENCES app_carpool__carpools(id) ON DELETE CASCADE
);

-- A driver asking to be covered on a given day; another adult accepts it.
CREATE TABLE IF NOT EXISTS app_carpool__swap_requests (
  id            TEXT PRIMARY KEY,
  carpool_id    TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  requested_by  TEXT NOT NULL,
  reason        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open',        -- open | accepted | cancelled
  resolved_by   TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (assignment_id) REFERENCES app_carpool__assignments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS app_carpool__carpools_arch_idx ON app_carpool__carpools(archived);
CREATE INDEX IF NOT EXISTS app_carpool__assignments_cp_idx ON app_carpool__assignments(carpool_id, date);
CREATE INDEX IF NOT EXISTS app_carpool__assignments_date_idx ON app_carpool__assignments(date);
CREATE INDEX IF NOT EXISTS app_carpool__swap_assignment_idx ON app_carpool__swap_requests(assignment_id, status);
