-- Colour Study (colour-study.js): a sheet for learning to mix a colour from the
-- painter's paints. A sheet stands alone: it needs no photo and no plan, so it
-- has its own table. state_json is the sheet as it stands (the wheel, the
-- harmony, the palette, the colour studied, the mix, the paints turned off,
-- notes); picture is a copy of the picture brought in, as a data URL, kept so
-- the sheet outlives the plan or photo it came from.

CREATE TABLE IF NOT EXISTS mo_colour_sheets (
  id          INTEGER PRIMARY KEY,
  title       TEXT    NOT NULL DEFAULT 'Colour Study',
  state_json  TEXT    NOT NULL DEFAULT '{}',
  picture     TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
