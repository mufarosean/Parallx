-- Planner (calendar milestone) — calendars, per-item colour, event recurrence.
--
--   * planner_calendars groups events + tasks Google-style ("Personal",
--     "Tasks", "Birthdays", …) with a colour and a visibility toggle.
--   * calendar_id is carried on BOTH events and tasks so tasks render on the
--     calendar grid and can be toggled with their calendar.
--   * color (nullable) is a per-item override; otherwise the calendar colour
--     applies.
--   * recurrence holds an RRULE string on events; instances are expanded at
--     read time (no materialised rows).
--   * source_provider/source_id mirror the existing sync columns so a future
--     Google provider maps calendars 1:1.

CREATE TABLE IF NOT EXISTS planner_calendars (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#4c8bf5',
  visible         INTEGER NOT NULL DEFAULT 1,
  is_default      INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  source_provider TEXT,
  source_id       TEXT,
  created_at      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT 0
);

-- Two built-in calendars with stable ids. INSERT OR IGNORE = re-seed is a noop.
INSERT OR IGNORE INTO planner_calendars
  (id, name, color, visible, is_default, sort_order, created_at, updated_at)
VALUES
  ('cal-personal', 'Personal', '#4c8bf5', 1, 1, 0, 0, 0),
  ('cal-tasks',    'Tasks',    '#3fb950', 1, 0, 1, 0, 0);

-- Events: calendar, per-event colour override, recurrence rule.
ALTER TABLE planner_events ADD COLUMN calendar_id TEXT;
ALTER TABLE planner_events ADD COLUMN color TEXT;
ALTER TABLE planner_events ADD COLUMN recurrence TEXT;

-- Tasks: calendar + per-task colour override.
ALTER TABLE planner_tasks ADD COLUMN calendar_id TEXT;
ALTER TABLE planner_tasks ADD COLUMN color TEXT;

-- Backfill existing rows onto the built-in calendars.
UPDATE planner_events SET calendar_id = 'cal-personal' WHERE calendar_id IS NULL;
UPDATE planner_tasks  SET calendar_id = 'cal-tasks'    WHERE calendar_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_planner_events_calendar ON planner_events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_planner_events_recurrence ON planner_events(recurrence) WHERE recurrence IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planner_tasks_calendar ON planner_tasks(calendar_id);
