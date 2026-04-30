-- M59 Phase 9 / F13 — Hierarchical albums.
-- Self-referencing FK: an album may live inside another album.
-- ON DELETE SET NULL preserves orphaned children at the root level rather
-- than cascading their destruction; user-data preservation is the priority.

ALTER TABLE mo_albums ADD COLUMN parent_album_id INTEGER NULL REFERENCES mo_albums(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mo_albums_parent ON mo_albums(parent_album_id);
