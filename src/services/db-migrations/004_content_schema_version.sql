-- 004_content_schema_version.sql — versioned content metadata for Canvas pages
-- Adds explicit schema-version metadata for stored page content envelopes.

ALTER TABLE pages ADD COLUMN content_schema_version INTEGER NOT NULL DEFAULT 2;
