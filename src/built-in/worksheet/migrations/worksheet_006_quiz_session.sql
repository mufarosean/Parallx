-- The running quiz, stored so an app restart or a tool reload resumes it
-- where it was (docs/PROBLEM_BANK.md 3b). One open session at a time.
-- item_ids and skipped are JSON arrays of ws_items ids; position is the
-- index being served; attempts rated inside the quiz carry its id in
-- ws_attempts.session_id.
CREATE TABLE IF NOT EXISTS ws_quiz_session (
  id TEXT PRIMARY KEY,
  item_ids TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  skipped TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
