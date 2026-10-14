-- A painting plan's board (board.js): the plan's variations, palettes, pinned
-- mixes, library photos, notes, frames and arrows, laid out by hand on an
-- endless surface. One board per plan; its layout is JSON (items with their
-- place and size, and the view), since the board's item kinds grow without a
-- schema change. Deleting the plan deletes its board.

CREATE TABLE IF NOT EXISTS mo_plan_boards (
  plan_id     INTEGER PRIMARY KEY REFERENCES mo_plans(id) ON DELETE CASCADE,
  board_json  TEXT    NOT NULL DEFAULT '{}',
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
