-- 013_page_version_history.sql — canvas page version history.
--
-- Periodic content checkpoints per page (Google-Docs-style history), captured on
-- a ~5-minute interval for pages that changed, plus a pre-restore snapshot.
-- Browsable + restorable from the page ⋯ menu. Retention is capped per page
-- (canvas.versionHistory.maxPerPage, default 50) by app-side pruning.
--
-- ON DELETE CASCADE: a page's history is removed when the page is deleted.
CREATE TABLE IF NOT EXISTS page_revisions (
  id                     TEXT PRIMARY KEY,
  page_id                TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  content                TEXT NOT NULL,
  content_schema_version INTEGER NOT NULL DEFAULT 2,
  title                  TEXT,
  source                 TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'ai' | 'restore'
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_page_revisions_page
  ON page_revisions(page_id, created_at DESC);
