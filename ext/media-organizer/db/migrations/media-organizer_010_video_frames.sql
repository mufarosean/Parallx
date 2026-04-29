-- Media Organizer M59 Phase 1: Video frame captures
-- Tracks frames captured from video files (Capture Frame action in player).
-- A captured frame is stored as a real photo on disk, AND linked to its source video here.
-- This enables a "Frames captured from this video" view in the detail editor.

CREATE TABLE IF NOT EXISTS mo_video_frames (
  id              INTEGER PRIMARY KEY,
  video_id        INTEGER NOT NULL,         -- FK → mo_videos.id (the source video)
  photo_id        INTEGER NOT NULL,         -- FK → mo_photos.id (the captured frame as a photo)
  timestamp_sec   REAL    NOT NULL,         -- where in the video the frame was captured
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (video_id) REFERENCES mo_videos(id) ON DELETE CASCADE,
  FOREIGN KEY (photo_id) REFERENCES mo_photos(id) ON DELETE CASCADE,
  UNIQUE(video_id, photo_id)
);

CREATE INDEX IF NOT EXISTS idx_mo_video_frames_video ON mo_video_frames(video_id);
CREATE INDEX IF NOT EXISTS idx_mo_video_frames_photo ON mo_video_frames(photo_id);
