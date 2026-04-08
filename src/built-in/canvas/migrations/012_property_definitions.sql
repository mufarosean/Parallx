-- 012_property_definitions.sql
--
-- Workspace-level property definitions for the Obsidian-style property system.
-- Each definition describes a named property type that can be attached to any page.

CREATE TABLE IF NOT EXISTS property_definitions (
  name       TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
