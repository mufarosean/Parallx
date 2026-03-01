-- 007_page_property_values.sql
--
-- Property values table (one row per page per property).
-- Part of Milestone 8 — Notion-Like Database System.

-- Property values (one row per page per property)
CREATE TABLE IF NOT EXISTS page_property_values (
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT 'null',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (page_id, property_id, database_id),
  FOREIGN KEY (property_id, database_id)
    REFERENCES database_properties(id, database_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ppv_page ON page_property_values(page_id);
CREATE INDEX IF NOT EXISTS idx_ppv_db ON page_property_values(database_id);
