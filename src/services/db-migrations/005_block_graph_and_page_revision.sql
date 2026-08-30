-- 005_block_graph_and_page_revision.sql
--
-- Phase 1 migration toward a Notion-like block ownership model.
-- 1) Adds per-page revision for optimistic concurrency (prevents stale last-write-wins).
-- 2) Adds normalized block graph tables (authoritative block ownership layer foundation).

ALTER TABLE pages ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS canvas_blocks (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  parent_block_id TEXT REFERENCES canvas_blocks(id) ON DELETE CASCADE,
  block_type TEXT NOT NULL,
  props_json TEXT NOT NULL DEFAULT '{}',
  content_json TEXT NOT NULL DEFAULT '[]',
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_canvas_blocks_page_parent_sort
  ON canvas_blocks(page_id, parent_block_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_canvas_blocks_parent
  ON canvas_blocks(parent_block_id);
