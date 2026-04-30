-- M59 P5: soft-delete trash on mo_photos and mo_videos
-- A photo/video with deleted_at set is "in the trash" — hidden from default
-- views but still in DB until purged. The "Empty Trash" command moves the
-- backing files to OS recycle bin and hard-deletes the rows.
--
-- Note: doc originally specified mo_files.deleted_at, but a single user-
-- visible item (mo_photos / mo_videos row) may have multiple backing files.
-- Trashing the user-visible item is the correct semantic.

ALTER TABLE mo_photos ADD COLUMN deleted_at TEXT;
ALTER TABLE mo_videos ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_mo_photos_deleted_at ON mo_photos(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mo_videos_deleted_at ON mo_videos(deleted_at) WHERE deleted_at IS NOT NULL;
