-- The roster (roster.ts): one tagged set of problems, worked down day by day.
-- The student quizzes what is still starred and unstars what they get right,
-- so the star log is what tells each day apart: every real change, with when.
CREATE TABLE IF NOT EXISTS ws_roster (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tag TEXT NOT NULL,
  start_day TEXT NOT NULL,
  end_day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ws_star_log (
  item_id INTEGER NOT NULL,
  starred INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ws_star_log_item ON ws_star_log(item_id, at);
