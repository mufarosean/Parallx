-- Planner two-way sync (Google Calendar / Tasks) — M82 follow-up.
--
-- synced_at: local ms-epoch when the row was last reconciled with its provider.
--   A row is a "push candidate" when synced_at IS NULL (created locally, never
--   pushed) or updated_at > synced_at (edited locally since the last reconcile).
--   It is stamped with the LOCAL clock at apply/push time, so echo detection is
--   independent of any skew between the local clock and Google's `updated`.
ALTER TABLE planner_events ADD COLUMN synced_at INTEGER;
ALTER TABLE planner_tasks  ADD COLUMN synced_at INTEGER;

-- Parity with idx_planner_events_provider, for source-id dedupe on tasks.
CREATE INDEX IF NOT EXISTS idx_planner_tasks_provider
  ON planner_tasks(source_provider, source_id);

-- Tombstones: a row deleted locally that still needs its remote mirror removed.
-- Written on delete when the row carried a source_id; cleared once the provider
-- confirms the upstream delete. kind = 'event' | 'task'. remote_parent holds the
-- container the delete targets (Google calendar id for events, tasklist id for
-- tasks) since the row is gone by the time the orchestrator pushes the delete.
CREATE TABLE IF NOT EXISTS planner_sync_deletions (
  provider      TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,
  remote_parent TEXT,
  deleted_at    INTEGER NOT NULL,
  PRIMARY KEY (provider, source_id)
);
