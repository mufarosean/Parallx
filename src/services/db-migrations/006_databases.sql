-- 006_databases.sql
--
-- Database container, property schema, view config, and membership tables.
-- Part of Milestone 8 — Notion-Like Database System.

-- Database container — links a page to a database identity.
-- id = page_id (same UUID, see DD-0). page_id kept for explicit FK.
-- No title/icon columns — the page's title and icon are canonical (see DD-3).
CREATE TABLE IF NOT EXISTS databases (
  id          TEXT PRIMARY KEY,
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  description TEXT DEFAULT NULL,
  is_locked   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (id = page_id)
);

CREATE INDEX IF NOT EXISTS idx_databases_page ON databases(page_id);

-- Property schema (one row per property per database)
CREATE TABLE IF NOT EXISTS database_properties (
  id          TEXT NOT NULL,
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  config      TEXT NOT NULL DEFAULT '{}',
  sort_order  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, database_id)
);

CREATE INDEX IF NOT EXISTS idx_db_props ON database_properties(database_id);

-- Database views (one per view per database)
-- Frequently-queried fields are denormalized into columns for query performance.
-- `config` holds the remaining per-view JSON (visibleProperties, colorRules, cardSize, etc.).
CREATE TABLE IF NOT EXISTS database_views (
  id                   TEXT PRIMARY KEY,
  database_id          TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL DEFAULT 'Default view',
  type                 TEXT NOT NULL DEFAULT 'table',
  group_by             TEXT DEFAULT NULL,
  sub_group_by         TEXT DEFAULT NULL,
  board_group_property TEXT DEFAULT NULL,
  hide_empty_groups    INTEGER NOT NULL DEFAULT 0,
  filter_config        TEXT NOT NULL DEFAULT '{"conjunction":"and","rules":[]}',
  sort_config          TEXT NOT NULL DEFAULT '[]',
  config               TEXT NOT NULL DEFAULT '{}',
  sort_order           REAL NOT NULL DEFAULT 0,
  is_locked            INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_db_views ON database_views(database_id);

-- Database membership (which pages/rows belong to which database)
CREATE TABLE IF NOT EXISTS database_pages (
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  sort_order  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (database_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_db_pages ON database_pages(database_id);
CREATE INDEX IF NOT EXISTS idx_db_pages_page ON database_pages(page_id);
