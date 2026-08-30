-- 010_document_summaries.sql
--
-- Adds a summary column to indexing_metadata for per-document content
-- summaries. These summaries are injected into the workspace digest so
-- the AI knows what each file contains, not just its name.
-- Part of Milestone 15 — AI Knowledge Enhancement.

ALTER TABLE indexing_metadata ADD COLUMN summary TEXT;
