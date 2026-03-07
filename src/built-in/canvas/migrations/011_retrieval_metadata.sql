-- 011_retrieval_metadata.sql
--
-- Adds richer retrieval metadata for Milestone 23. The base vector index keeps
-- chunk text + embeddings; this migration adds additive tables/columns for
-- structural ancestry and extraction/classification quality signals.

CREATE TABLE IF NOT EXISTS chunk_metadata (
  chunk_id INTEGER PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  heading_path TEXT,
  parent_heading_path TEXT,
  structural_role TEXT
);

CREATE INDEX IF NOT EXISTS idx_chunk_metadata_source
  ON chunk_metadata(source_type, source_id, chunk_index);

ALTER TABLE indexing_metadata ADD COLUMN document_kind TEXT;
ALTER TABLE indexing_metadata ADD COLUMN extraction_pipeline TEXT;
ALTER TABLE indexing_metadata ADD COLUMN extraction_fallback INTEGER NOT NULL DEFAULT 0;
ALTER TABLE indexing_metadata ADD COLUMN classification_confidence REAL;
ALTER TABLE indexing_metadata ADD COLUMN classification_reason TEXT;
