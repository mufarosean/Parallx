-- M59 Phase 3: Full-text search via FTS5 virtual tables.
-- Two tables — one per media type — keyed by photo/video id (rowid).
-- Columns are denormalized aggregates of title + details + tag names + folder name(s).
-- Rebuilt by moRebuildSearchIndex() after scans / tag changes / photo updates.

CREATE VIRTUAL TABLE IF NOT EXISTS mo_photos_fts USING fts5(
  title,
  details,
  tags_text,
  folder_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS mo_videos_fts USING fts5(
  title,
  details,
  tags_text,
  folder_text,
  tokenize = 'unicode61 remove_diacritics 2'
);
