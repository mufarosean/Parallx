-- Dashboard (M71) — page + widget instance tables.
--
-- Schema notes:
--   * Stored in the shared workspace SQLite DB. Tables prefixed dashboard_*.
--   * `dashboard_pages` rows are mostly user-facing metadata.
--   * `dashboard_widgets` is the per-instance store: layout, config, cached
--     output, and refresh policy live here. Widgets own their own data
--     elsewhere — this table is *not* a junk drawer.
--   * Cascade delete on page removal so an orphaned widget can never exist.
--   * row+col+span are stored as integers (12-column grid). Position is a
--     stable ordering tiebreaker for same-cell placement.

CREATE TABLE IF NOT EXISTS dashboard_pages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id                  TEXT PRIMARY KEY,
  page_id             TEXT NOT NULL REFERENCES dashboard_pages(id) ON DELETE CASCADE,
  widget_type_id      TEXT NOT NULL,
  row                 INTEGER NOT NULL DEFAULT 0,
  col                 INTEGER NOT NULL DEFAULT 0,
  row_span            INTEGER NOT NULL DEFAULT 1,
  col_span            INTEGER NOT NULL DEFAULT 4,
  position            INTEGER NOT NULL DEFAULT 0,
  config_json         TEXT NOT NULL DEFAULT '{}',
  refresh_policy_json TEXT NOT NULL DEFAULT '{"kind":"manual"}',
  cached_output       TEXT,
  cached_at           INTEGER,
  status              TEXT NOT NULL DEFAULT 'ok',
  error_message       TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_page ON dashboard_widgets(page_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_status ON dashboard_widgets(status);
