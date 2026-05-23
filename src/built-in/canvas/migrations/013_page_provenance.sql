-- 013_page_provenance.sql
--
-- M81 Slice C (provenance subset) — record where a canvas page came from.
-- Both columns are nullable; existing rows and any future code path that
-- does not opt in keep NULL provenance ("origin unknown / not recorded").
--
-- - created_by: stable identifier of the actor that created the page
--   ('user', 'ai-chat', 'template:<id>', extension-id, etc.).
-- - source_tool: the tool that produced it ('canvas_create_page',
--   'canvas_compose_page', 'duplicate', 'template', etc.) when an
--   AI/automation pathway created the page.

ALTER TABLE pages ADD COLUMN created_by TEXT;
ALTER TABLE pages ADD COLUMN source_tool TEXT;
