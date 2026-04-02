-- Media Organizer: Initial schema (D1)
-- All tables prefixed with mo_ for namespace isolation in shared workspace DB.
-- Adapted from stash: pkg/sqlite/tables.go, pkg/sqlite/migrations/

-- ═══════════════════════════════════════════════════════════════════════════════
-- ENTITY TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mo_folders (
  id          INTEGER PRIMARY KEY,
  path        TEXT    UNIQUE NOT NULL,
  parent_folder_id INTEGER REFERENCES mo_folders(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mo_files (
  id          INTEGER PRIMARY KEY,
  basename    TEXT    NOT NULL,
  size        INTEGER NOT NULL,
  mod_time    TEXT    NOT NULL,
  folder_id   INTEGER NOT NULL REFERENCES mo_folders(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mo_video_files (
  id          INTEGER PRIMARY KEY,
  file_id     INTEGER UNIQUE NOT NULL REFERENCES mo_files(id) ON DELETE CASCADE,
  duration    REAL,
  width       INTEGER,
  height      INTEGER,
  codec       TEXT,
  bit_rate    INTEGER,
  frame_rate  REAL
);

CREATE TABLE IF NOT EXISTS mo_image_files (
  id          INTEGER PRIMARY KEY,
  file_id     INTEGER UNIQUE NOT NULL REFERENCES mo_files(id) ON DELETE CASCADE,
  width       INTEGER,
  height      INTEGER,
  format      TEXT
);

CREATE TABLE IF NOT EXISTS mo_fingerprints (
  id          INTEGER PRIMARY KEY,
  file_id     INTEGER NOT NULL REFERENCES mo_files(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,
  value       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(file_id, type)
);

CREATE TABLE IF NOT EXISTS mo_tags (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT    DEFAULT '',
  image_path  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS mo_tags_relations (
  parent_id   INTEGER NOT NULL REFERENCES mo_tags(id) ON DELETE CASCADE,
  child_id    INTEGER NOT NULL REFERENCES mo_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_id, child_id),
  CHECK(parent_id != child_id)
);

CREATE TABLE IF NOT EXISTS mo_photos (
  id            INTEGER PRIMARY KEY,
  title         TEXT    DEFAULT '',
  rating        INTEGER DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
  curated       INTEGER DEFAULT 0,
  details       TEXT    DEFAULT '',
  camera_make   TEXT,
  camera_model  TEXT,
  lens          TEXT,
  iso           INTEGER,
  aperture      REAL,
  shutter_speed TEXT,
  focal_length  REAL,
  gps_latitude  REAL,
  gps_longitude REAL,
  taken_at      TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mo_videos (
  id          INTEGER PRIMARY KEY,
  title       TEXT    DEFAULT '',
  rating      INTEGER DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
  curated     INTEGER DEFAULT 0,
  details     TEXT    DEFAULT '',
  duration    REAL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mo_albums (
  id          INTEGER PRIMARY KEY,
  title       TEXT    NOT NULL,
  description TEXT    DEFAULT '',
  rating      INTEGER DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
  folder_id   INTEGER REFERENCES mo_folders(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- JOIN TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mo_photos_files (
  photo_id    INTEGER NOT NULL REFERENCES mo_photos(id) ON DELETE CASCADE,
  file_id     INTEGER NOT NULL REFERENCES mo_files(id) ON DELETE CASCADE,
  is_primary  INTEGER DEFAULT 1,
  PRIMARY KEY (photo_id, file_id)
);

CREATE TABLE IF NOT EXISTS mo_videos_files (
  video_id    INTEGER NOT NULL REFERENCES mo_videos(id) ON DELETE CASCADE,
  file_id     INTEGER NOT NULL REFERENCES mo_files(id) ON DELETE CASCADE,
  is_primary  INTEGER DEFAULT 1,
  PRIMARY KEY (video_id, file_id)
);

CREATE TABLE IF NOT EXISTS mo_photos_tags (
  photo_id    INTEGER NOT NULL REFERENCES mo_photos(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES mo_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, tag_id)
);

CREATE TABLE IF NOT EXISTS mo_videos_tags (
  video_id    INTEGER NOT NULL REFERENCES mo_videos(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES mo_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (video_id, tag_id)
);

CREATE TABLE IF NOT EXISTS mo_albums_tags (
  album_id    INTEGER NOT NULL REFERENCES mo_albums(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES mo_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (album_id, tag_id)
);

CREATE TABLE IF NOT EXISTS mo_albums_photos (
  album_id    INTEGER NOT NULL REFERENCES mo_albums(id) ON DELETE CASCADE,
  photo_id    INTEGER NOT NULL REFERENCES mo_photos(id) ON DELETE CASCADE,
  position    INTEGER DEFAULT 0,
  PRIMARY KEY (album_id, photo_id)
);

CREATE TABLE IF NOT EXISTS mo_albums_videos (
  album_id    INTEGER NOT NULL REFERENCES mo_albums(id) ON DELETE CASCADE,
  video_id    INTEGER NOT NULL REFERENCES mo_videos(id) ON DELETE CASCADE,
  position    INTEGER DEFAULT 0,
  PRIMARY KEY (album_id, video_id)
);

CREATE TABLE IF NOT EXISTS mo_photos_custom_fields (
  entity_id   INTEGER NOT NULL REFERENCES mo_photos(id) ON DELETE CASCADE,
  field_name  TEXT    NOT NULL,
  field_value TEXT,
  PRIMARY KEY (entity_id, field_name)
);

CREATE TABLE IF NOT EXISTS mo_videos_custom_fields (
  entity_id   INTEGER NOT NULL REFERENCES mo_videos(id) ON DELETE CASCADE,
  field_name  TEXT    NOT NULL,
  field_value TEXT,
  PRIMARY KEY (entity_id, field_name)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Folder lookups
CREATE INDEX IF NOT EXISTS idx_mo_folders_parent ON mo_folders(parent_folder_id);

-- File lookups
CREATE INDEX IF NOT EXISTS idx_mo_files_folder   ON mo_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_mo_files_basename  ON mo_files(basename);

-- Fingerprint dedup
CREATE INDEX IF NOT EXISTS idx_mo_fingerprints_file      ON mo_fingerprints(file_id);
CREATE INDEX IF NOT EXISTS idx_mo_fingerprints_type_value ON mo_fingerprints(type, value);

-- Tag hierarchy traversal
CREATE INDEX IF NOT EXISTS idx_mo_tags_relations_parent ON mo_tags_relations(parent_id);
CREATE INDEX IF NOT EXISTS idx_mo_tags_relations_child  ON mo_tags_relations(child_id);

-- Photo queries
CREATE INDEX IF NOT EXISTS idx_mo_photos_rating   ON mo_photos(rating);
CREATE INDEX IF NOT EXISTS idx_mo_photos_curated  ON mo_photos(curated);
CREATE INDEX IF NOT EXISTS idx_mo_photos_taken_at ON mo_photos(taken_at);

-- Video queries
CREATE INDEX IF NOT EXISTS idx_mo_videos_rating  ON mo_videos(rating);
CREATE INDEX IF NOT EXISTS idx_mo_videos_curated ON mo_videos(curated);

-- Album queries
CREATE INDEX IF NOT EXISTS idx_mo_albums_folder ON mo_albums(folder_id);

-- Join table FKs (reverse side)
CREATE INDEX IF NOT EXISTS idx_mo_photos_files_file   ON mo_photos_files(file_id);
CREATE INDEX IF NOT EXISTS idx_mo_videos_files_file   ON mo_videos_files(file_id);
CREATE INDEX IF NOT EXISTS idx_mo_photos_tags_tag     ON mo_photos_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_mo_videos_tags_tag     ON mo_videos_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_mo_albums_tags_tag     ON mo_albums_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_mo_albums_photos_photo ON mo_albums_photos(photo_id);
CREATE INDEX IF NOT EXISTS idx_mo_albums_videos_video ON mo_albums_videos(video_id);

-- Video/image file FK
CREATE INDEX IF NOT EXISTS idx_mo_video_files_file ON mo_video_files(file_id);
CREATE INDEX IF NOT EXISTS idx_mo_image_files_file ON mo_image_files(file_id);
