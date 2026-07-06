-- Per-occurrence exceptions for recurring events (Google-parity "this event").
--
-- A recurring event is one RRULE base row expanded at read time. An override
-- pins a SINGLE occurrence by its ORIGINAL start slot (original_start_at) and
-- either cancels it or replaces selected fields — mirroring Google's exception
-- model (recurringEventId + originalStartTime). NULL columns inherit from the
-- base row; source_id holds the Google exception event id so we can PATCH the
-- right instance on push.

CREATE TABLE IF NOT EXISTS planner_event_overrides (
  id                TEXT PRIMARY KEY,
  base_id           TEXT NOT NULL,
  original_start_at INTEGER NOT NULL,          -- the occurrence slot being overridden (ms epoch)
  cancelled         INTEGER NOT NULL DEFAULT 0, -- 1 = this occurrence removed
  title             TEXT,
  description       TEXT,
  start_at          INTEGER,
  end_at            INTEGER,
  all_day           INTEGER,
  location          TEXT,
  color             TEXT,
  source_id         TEXT,                       -- Google exception event id (for sync)
  created_at        INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL DEFAULT 0,
  synced_at         INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_overrides_slot
  ON planner_event_overrides(base_id, original_start_at);
CREATE INDEX IF NOT EXISTS idx_planner_overrides_base
  ON planner_event_overrides(base_id);
