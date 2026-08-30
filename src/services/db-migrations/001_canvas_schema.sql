-- 001_canvas_schema.sql — Canvas pages table
-- Creates the core pages table for the Canvas note-taking tool.
-- Pages form a tree via parent_id (self-referential FK with CASCADE delete).
-- sort_order is REAL for O(1) insertion between siblings.

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  icon TEXT DEFAULT NULL,
  content TEXT DEFAULT '{}',
  sort_order REAL NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id);
CREATE INDEX IF NOT EXISTS idx_pages_sort ON pages(parent_id, sort_order);
