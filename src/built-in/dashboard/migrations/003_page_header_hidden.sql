-- 003_page_header_hidden.sql
--
-- Persist the per-page "header hidden" UI state in the workspace DB so it
-- survives relaunch and travels with the workspace. Previously this lived in
-- renderer localStorage under an unprefixed key, which M53 does not migrate —
-- so the state was effectively lost between launches. 0 = shown, 1 = hidden.

ALTER TABLE dashboard_pages ADD COLUMN header_hidden INTEGER NOT NULL DEFAULT 0;
