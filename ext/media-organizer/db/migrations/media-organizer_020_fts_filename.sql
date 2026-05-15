-- M59 P3 follow-up: add filename to the FTS5 index.
--
-- Original tables (012) indexed title + details + tags_text + folder_text.
-- Filenames were intentionally excluded, on the assumption that the title
-- column would already carry the basename. That assumption is wrong for
-- libraries imported from disk: the title often gets cleaned up (extension
-- stripped, separators normalized) so typing the literal filename in the
-- toolbar search yields zero hits.
--
-- FTS5 virtual tables cannot ALTER ADD COLUMN, so we DROP + recreate.
-- Both tables get a new `filename_text` column. The next start runs
-- moRebuildSearchIndex() which repopulates from the live DB rows, so no
-- data is lost — the index is derived from mo_files anyway.

DROP TABLE IF EXISTS mo_photos_fts;
DROP TABLE IF EXISTS mo_videos_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS mo_photos_fts USING fts5(
  title,
  details,
  tags_text,
  folder_text,
  filename_text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS mo_videos_fts USING fts5(
  title,
  details,
  tags_text,
  folder_text,
  filename_text,
  tokenize = 'unicode61 remove_diacritics 2'
);
