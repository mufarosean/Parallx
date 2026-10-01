-- Clip projects (docs/CLIPS.md, Phase 2): a project gathers videos and keeps
-- every edit made to them until the project is deleted. Quick clips (open a
-- video, cut a GIF) are not stored here; they still live only in memory.
--
-- mo_clip_projects          a named project and the video it last showed.
-- mo_clip_project_sources   a video in a project, in bin order, with the
--                           editor's state for it (the same snapshot the
--                           clip queue stores) and its queued clips, as JSON.
--                           Deleting a project deletes these rows, never the
--                           video files.

CREATE TABLE IF NOT EXISTS mo_clip_projects (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  active_source_id INTEGER,
  sequence_json    TEXT    NOT NULL DEFAULT '[]',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mo_clip_project_sources (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES mo_clip_projects(id) ON DELETE CASCADE,
  path        TEXT    NOT NULL,
  duration    REAL    NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  state_json  TEXT,
  queue_json  TEXT    NOT NULL DEFAULT '[]',
  added_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_mo_clip_project_sources_project
  ON mo_clip_project_sources (project_id, position);
