-- The study plan: a run of days, each with blocks (an exam under a clock, its
-- grading, a quiz drawn from named pools, a session another tool runs). One
-- plan at a time, as the JSON the user imported.
CREATE TABLE IF NOT EXISTS ws_plan (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- What happened to each block: the problems drawn for it (fixed once made),
-- the quiz session it started, and when it counted as done.
CREATE TABLE IF NOT EXISTS ws_plan_block (
  day TEXT NOT NULL,
  block_id TEXT NOT NULL,
  draw TEXT NOT NULL DEFAULT '[]',
  session_id TEXT NOT NULL DEFAULT '',
  done_at INTEGER,
  PRIMARY KEY (day, block_id)
);

-- A graded exam question: the points it carried, the points lost, and why.
CREATE TABLE IF NOT EXISTS ws_exam_grade (
  item_id INTEGER PRIMARY KEY,
  points REAL NOT NULL,
  lost REAL NOT NULL,
  cause TEXT NOT NULL DEFAULT '',
  graded_at INTEGER NOT NULL
);

-- The points an exam question carries, from the workbook's point sheet.
ALTER TABLE ws_items ADD COLUMN points REAL;
