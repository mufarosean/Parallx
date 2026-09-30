-- Image editor (docs/IMAGE_EDITOR.md): presets the user saved.
--
-- mo_edit_presets  a named look: the slider values, tone curve, colour mixer
--                  and colour grading of an edit, as JSON. Not the crop and
--                  not removals, which belong to one photo. The looks that
--                  come with the editor live in the code, not here.

CREATE TABLE IF NOT EXISTS mo_edit_presets (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  look_json  TEXT    NOT NULL DEFAULT '{}',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
