-- The Work Log rows Study wrote from what a tool reported (the core's work
-- providers) or from its own reading and discussion clocks: one row per
-- source, unit and local day. `written_json` is what Study last wrote, so a
-- row he changed is known as his (`his` = 1: never written again, and no
-- second row made); `pending_json` is what a write in flight is about to
-- make of the row, so a write cut short is not read as his edit.
CREATE TABLE IF NOT EXISTS st_work_rows (
  subject_id   INTEGER NOT NULL,
  source       TEXT    NOT NULL,             -- tool:<provider id> | study:reading | study:discussion
  unit_row     TEXT    NOT NULL,             -- the unit's row in Units
  day          TEXT    NOT NULL,             -- the local day, YYYY-MM-DD
  row_id       TEXT    NOT NULL DEFAULT '',  -- the row in the Work Log
  written_json TEXT    NOT NULL DEFAULT '{}',
  pending_json TEXT    NOT NULL DEFAULT '',
  his          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject_id, source, unit_row, day)
);

-- Study's own time that is not a session: seconds with a unit's PDF showing
-- (Reading) or in a chat opened from a unit (Discussion), counted by the
-- app's clock, by local day and unit.
CREATE TABLE IF NOT EXISTS st_work_time (
  day        TEXT    NOT NULL,
  subject_id INTEGER NOT NULL,
  unit_row   TEXT    NOT NULL,
  kind       TEXT    NOT NULL,               -- Reading | Discussion
  seconds    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, subject_id, unit_row, kind)
);

-- The chats he opened from a unit (its Discuss in Chat, or a question's): the
-- conversation, and the unit its time counts for.
CREATE TABLE IF NOT EXISTS st_unit_chats (
  session_id TEXT    PRIMARY KEY,
  subject_id INTEGER NOT NULL,
  unit_row   TEXT    NOT NULL,
  at         INTEGER NOT NULL DEFAULT 0
);
