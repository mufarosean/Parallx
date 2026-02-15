-- 002_page_properties.sql — Canvas page properties table
-- Stores arbitrary key-value properties per page (future use: metadata UI).
-- Unique constraint on (page_id, key) prevents duplicate properties.

CREATE TABLE IF NOT EXISTS page_properties (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'text',
  value TEXT DEFAULT NULL,
  UNIQUE(page_id, key)
);

CREATE INDEX IF NOT EXISTS idx_props_page ON page_properties(page_id);
