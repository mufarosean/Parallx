-- 018_synced_blocks.sql — the content of synced blocks.
--
-- A synced block shows the same content wherever it is placed; editing one
-- copy changes them all.  The content is kept as a page of its own that is
-- never shown as a page (not in the sidebar, Recent, Favorites or page
-- lists): this table names those pages.  Each copy of the block holds the
-- page's id (`syncedRef.attrs.syncId`).
CREATE TABLE IF NOT EXISTS synced_blocks (
  page_id    TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
