-- Media Organizer M59 Phase 1: WebP conversion review
-- Tracks animated WebP files that need conversion to MP4/GIF.
-- needs_conversion: 1 if animated webp detected, 0 otherwise
-- conversion_target: NULL | 'mp4' | 'gif' | 'skip' (user choice in review pane)
-- converted_from: original path before conversion (for restore within quarantine window)
-- converted_at: ISO timestamp when conversion happened

ALTER TABLE mo_files ADD COLUMN needs_conversion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mo_files ADD COLUMN conversion_target TEXT NULL;
ALTER TABLE mo_files ADD COLUMN converted_from TEXT NULL;
ALTER TABLE mo_files ADD COLUMN converted_at TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_mo_files_needs_conversion ON mo_files(needs_conversion) WHERE needs_conversion = 1;
