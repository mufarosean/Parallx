-- M59 Phase 9 / F14 — Manual sort within album.
-- The `position` column already lives on both join tables (since 001_initial.sql),
-- but no covering index exists for the album-ordered fetch path used by
-- AlbumQueries.loadPhotos / loadVideos. This adds a (album_id, position)
-- index so the ORDER BY is index-served as albums grow large.

CREATE INDEX IF NOT EXISTS idx_mo_albums_photos_album_pos
  ON mo_albums_photos(album_id, position);

CREATE INDEX IF NOT EXISTS idx_mo_albums_videos_album_pos
  ON mo_albums_videos(album_id, position);
