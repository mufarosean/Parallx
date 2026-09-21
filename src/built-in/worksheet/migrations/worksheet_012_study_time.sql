-- Study time (docs/PROBLEM_BANK.md): seconds with a problem on screen, or
-- with the quiz's own screens (item_id 0), while the student is active, per
-- day and per quiz (session_id '' outside a quiz). Written by the study clock
-- whatever the cells do; an idle stretch is taken back. Backfilled from the
-- attempt clocks, so the days before it keep their time.
CREATE TABLE IF NOT EXISTS ws_study_time (
  day TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, item_id, session_id)
);
INSERT INTO ws_study_time (day, item_id, session_id, seconds)
  SELECT date(updated_at / 1000, 'unixepoch', 'localtime'), item_id, COALESCE(session_id, ''), SUM(seconds)
  FROM ws_attempts
  WHERE seconds > 0 AND COALESCE(imported, 0) = 0
  GROUP BY 1, 2, 3;
