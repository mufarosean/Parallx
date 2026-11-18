-- A session can hold questions of more than one subject (the marked set, the
-- weak spots): its Work Log row is one per subject it touched, so the record
-- of which row is whose is kept by session and subject, not by session alone.
CREATE TABLE IF NOT EXISTS st_subject_logs_by_subject (
  session_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL DEFAULT 0,
  row_id TEXT NOT NULL DEFAULT '',
  written_json TEXT NOT NULL DEFAULT '{}',   -- the values last written, so only what changed is written again
  PRIMARY KEY (session_id, subject_id)
);
INSERT OR IGNORE INTO st_subject_logs_by_subject (session_id, subject_id, row_id, written_json)
  SELECT session_id, subject_id, row_id, written_json FROM st_subject_logs;
DROP TABLE st_subject_logs;
ALTER TABLE st_subject_logs_by_subject RENAME TO st_subject_logs;
