-- M59 Phase 9 / F12 — Lightroom-style color labels.
-- Five flag values supported by convention: red, yellow, green, blue, purple.
-- Stored as TEXT (NULL = no label) for forward-compatibility with custom labels.
-- Indexed because color label is a primary triage/filter axis.

ALTER TABLE mo_photos ADD COLUMN color_label TEXT NULL;
ALTER TABLE mo_videos ADD COLUMN color_label TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_mo_photos_color_label ON mo_photos(color_label);
CREATE INDEX IF NOT EXISTS idx_mo_videos_color_label ON mo_videos(color_label);
