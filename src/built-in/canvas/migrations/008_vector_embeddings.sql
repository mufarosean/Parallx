-- 008_vector_embeddings.sql
--
-- Vector embeddings table (sqlite-vec vec0 virtual table) and FTS5 keyword
-- index for hybrid RAG retrieval.
-- Part of Milestone 10 — RAG-Powered AI Assistant.

-- ── Vector embeddings table ──────────────────────────────────────────────────
-- Uses sqlite-vec's vec0 virtual table module.
-- Stores 768-dimensional float32 vectors (nomic-embed-text v1.5).
-- Auxiliary columns (prefixed with +) are stored alongside vectors.

CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
  embedding float[768] distance_metric=cosine,
  +source_type TEXT NOT NULL,
  +source_id TEXT NOT NULL,
  +chunk_index INTEGER NOT NULL,
  +chunk_text TEXT NOT NULL,
  +context_prefix TEXT NOT NULL DEFAULT '',
  +content_hash TEXT NOT NULL
);

-- ── FTS5 keyword search index ────────────────────────────────────────────────
-- Mirrors vec_embeddings for BM25 keyword retrieval.
-- `rank` column provides built-in BM25 scoring (negative = better).

CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
  chunk_id UNINDEXED,
  source_type UNINDEXED,
  source_id UNINDEXED,
  content,
  tokenize = 'porter unicode61'
);

-- ── Indexing metadata ────────────────────────────────────────────────────────
-- Tracks what has been indexed and when, for incremental re-indexing.

CREATE TABLE IF NOT EXISTS indexing_metadata (
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  indexed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source_type, source_id)
);
