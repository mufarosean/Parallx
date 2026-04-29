-- M59 Phase 3: smart albums (saved searches).
-- query_json contains the parsed query state (free text, tags, rating, date range, etc.).

CREATE TABLE IF NOT EXISTS mo_smart_albums (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  query_json  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mo_smart_albums_name ON mo_smart_albums(name);
