-- Image editor (docs/IMAGE_EDITOR.md): the edit of a photo.
--
-- mo_photo_edits  one row per edited photo: the recipe (slider values, crop,
--                 turns) as JSON. The photo's file is never changed; the
--                 editor draws the recipe live and Save As Copy renders it
--                 into a new file beside the original. A recipe that changes
--                 nothing has no row.

CREATE TABLE IF NOT EXISTS mo_photo_edits (
  photo_id    INTEGER PRIMARY KEY REFERENCES mo_photos(id) ON DELETE CASCADE,
  recipe_json TEXT    NOT NULL DEFAULT '{}',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
