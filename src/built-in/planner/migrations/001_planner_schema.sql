-- Planner (M82) — tasks + events.
--
-- Schema notes:
--   * Tables in the shared workspace SQLite DB, prefixed planner_*.
--   * source_provider + source_id carried from day one so a future Google
--     Calendar provider extension can sync rows without a migration. NULL
--     source_provider = local-only row.
--   * status='reviewing' is the load-bearing default for the "log fast,
--     plan later" capture flow. New tasks land here; the editor surfaces a
--     Review queue so the user batch-confirms / adjusts dates after the
--     capture moment.
--   * dates stored as INTEGER ms-epoch for the same reason cron jobs do —
--     simple comparison, no timezone ambiguity at rest. Render-time UI
--     does locale conversion.

CREATE TABLE IF NOT EXISTS planner_tasks (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'reviewing',  -- reviewing | planned | done | cancelled
  due_at          INTEGER,
  reminder_at     INTEGER,
  reminder_fired  INTEGER NOT NULL DEFAULT 0,        -- 0 = pending, 1 = already dispatched
  completed_at    INTEGER,
  tags_json       TEXT NOT NULL DEFAULT '[]',
  source_uri      TEXT,                                -- e.g. journal page URI that captured this
  source_provider TEXT,                                -- NULL = local; 'google' etc when synced
  source_id       TEXT,                                -- opaque id from the sync provider
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_planner_tasks_status ON planner_tasks(status);
CREATE INDEX IF NOT EXISTS idx_planner_tasks_due ON planner_tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_planner_tasks_reminder ON planner_tasks(reminder_at) WHERE reminder_at IS NOT NULL AND reminder_fired = 0;

CREATE TABLE IF NOT EXISTS planner_events (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  start_at        INTEGER NOT NULL,
  end_at          INTEGER NOT NULL,
  all_day         INTEGER NOT NULL DEFAULT 0,
  location        TEXT,
  source_provider TEXT,
  source_id       TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_planner_events_start ON planner_events(start_at);
CREATE INDEX IF NOT EXISTS idx_planner_events_provider ON planner_events(source_provider, source_id);
