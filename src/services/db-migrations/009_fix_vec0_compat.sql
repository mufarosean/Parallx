-- 009_fix_vec0_compat.sql
--
-- Fix sqlite-vec 0.1.7-alpha.2 compatibility issues:
--   1. Explicit rowid in INSERT is rejected by this vec0 build
--      (always throws "Only integers are allows for primary key values").
--   2. INTEGER auxiliary columns are rejected (vec0 sees FLOAT from
--      better-sqlite3 binding).
--
-- Fix: Recreate vec_embeddings with chunk_index as TEXT.
-- Drop indexing_metadata to force a full clean re-index.

DROP TABLE IF EXISTS vec_embeddings;

CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
  embedding float[768] distance_metric=cosine,
  +source_type TEXT NOT NULL,
  +source_id TEXT NOT NULL,
  +chunk_index TEXT NOT NULL,
  +chunk_text TEXT NOT NULL,
  +context_prefix TEXT NOT NULL DEFAULT '',
  +content_hash TEXT NOT NULL
);

-- Force full re-index by clearing metadata
DELETE FROM indexing_metadata;
