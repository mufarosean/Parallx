-- A subject: a canvas page with its Units, Questions and Work Log databases
-- (canvas databases, the person's own tables). Study keeps only where they
-- are and how the Questions columns map; the rows themselves are the record.
CREATE TABLE IF NOT EXISTS st_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  page_id TEXT NOT NULL DEFAULT '',
  units_db TEXT NOT NULL DEFAULT '',
  questions_db TEXT NOT NULL DEFAULT '',
  log_db TEXT NOT NULL DEFAULT '',
  notes_db TEXT NOT NULL DEFAULT '',
  sources_folder TEXT NOT NULL DEFAULT '',
  mapping_json TEXT NOT NULL DEFAULT '{}',   -- {answer: {id, name}, unit, attempts, correct, lastResult, lastAnswered}
  bank_id INTEGER NOT NULL DEFAULT 0,        -- the st_banks row its questions are drawn through
  folded INTEGER NOT NULL DEFAULT 0,         -- its units are hidden in the sidebar
  created_at INTEGER NOT NULL
);

-- What an answered session item has already added to its question's row, so
-- a verdict changed later corrects the row and an attempt is never counted twice.
CREATE TABLE IF NOT EXISTS st_subject_marks (
  item_id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL DEFAULT 0,
  subject_id INTEGER NOT NULL DEFAULT 0,
  row_id TEXT NOT NULL DEFAULT '',
  correct INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT ''            -- right | partly | wrong
);
CREATE INDEX IF NOT EXISTS idx_st_subject_marks_session ON st_subject_marks(session_id);

-- The Work Log row of a session, so a resumed session updates its own row.
CREATE TABLE IF NOT EXISTS st_subject_logs (
  session_id INTEGER PRIMARY KEY,
  subject_id INTEGER NOT NULL DEFAULT 0,
  row_id TEXT NOT NULL DEFAULT '',
  written_json TEXT NOT NULL DEFAULT '{}'    -- the values last written, so only what changed is written again
);
