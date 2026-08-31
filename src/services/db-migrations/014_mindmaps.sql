-- 014_mindmaps.sql — mindmap documents (docs/MINDMAP_BRIEF.md).
--
-- A mindmap IS a page (mindmaps.id = pages.id), exactly the database pattern
-- from 006: title/icon/sidebar/archival citizenship comes from the pages row,
-- and this table carries only what is mindmap-specific — the graph document.
--
-- `data` is one JSON blob ({version, nodes[], edges[]}); maps are small
-- (tens of nodes) and single-writer, so a normalized node/edge schema would
-- buy nothing but join ceremony. Same storage philosophy as pages.content.
--
-- ON DELETE CASCADE: deleting the page removes the map. The renderer-side
-- service ALSO deletes explicitly on the page-deleted event (the database
-- tables' self-healing pattern) because SQLite FK enforcement may be off.
CREATE TABLE IF NOT EXISTS mindmaps (
  id         TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
