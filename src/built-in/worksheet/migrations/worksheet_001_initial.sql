-- Worksheets (M99): practice items + attempts.
-- Items carry TWO full workbook snapshots: the item as presented (givens
-- pre-populated, fenced with borders — Athena does not lock cells, so
-- neither do we; Reset Sheet is the recovery path) and the model solution.

CREATE TABLE IF NOT EXISTS ws_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  question_md TEXT NOT NULL DEFAULT '',
  givens_json TEXT NOT NULL DEFAULT '',
  solution_json TEXT NOT NULL DEFAULT '',
  solution_notes_md TEXT NOT NULL DEFAULT '',
  source_uri TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  source_page INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- One OPEN attempt per item (completed = 0), continuously updated while the
-- user works; graded + closed at reveal time. History accrues as closed rows.
CREATE TABLE IF NOT EXISTS ws_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES ws_items(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  cells_json TEXT NOT NULL DEFAULT '',
  self_grade TEXT NOT NULL DEFAULT '',
  ai_review_md TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ws_attempts_item ON ws_attempts(item_id, completed);
