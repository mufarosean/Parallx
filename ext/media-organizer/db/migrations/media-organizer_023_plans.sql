-- Painting plans (M104 Part B, docs/Parallx_Milestone_104.md): the step
-- before the canvas, worked out on the photo.
--
-- mo_plans          one painting: its source photo, canvas size in inches,
--                   the kept variation and notes. The photo is never changed.
-- mo_plan_variants  a recipe of non-destructive adjustments (crop, light,
--                   colour, values, overlays, palette) as JSON; several per plan.
-- mo_plan_media     the process shelf: progress photos and clips attached to
--                   the plan (role process) and exported plan pictures (output).

CREATE TABLE IF NOT EXISTS mo_plans (
  id          INTEGER PRIMARY KEY,
  title       TEXT    NOT NULL DEFAULT 'Painting',
  photo_id    INTEGER NOT NULL REFERENCES mo_photos(id) ON DELETE CASCADE,
  canvas_w    REAL    NOT NULL DEFAULT 16,
  canvas_h    REAL    NOT NULL DEFAULT 20,
  variant_id  INTEGER,
  notes       TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mo_plans_photo ON mo_plans(photo_id);

CREATE TABLE IF NOT EXISTS mo_plan_variants (
  id          INTEGER PRIMARY KEY,
  plan_id     INTEGER NOT NULL REFERENCES mo_plans(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL DEFAULT 'Variation',
  recipe_json TEXT    NOT NULL DEFAULT '{}',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mo_plan_variants_plan ON mo_plan_variants(plan_id, position);

CREATE TABLE IF NOT EXISTS mo_plan_media (
  id          INTEGER PRIMARY KEY,
  plan_id     INTEGER NOT NULL REFERENCES mo_plans(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK(kind IN ('photo', 'video')),
  item_id     INTEGER NOT NULL,
  role        TEXT    NOT NULL DEFAULT 'process' CHECK(role IN ('process', 'output')),
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mo_plan_media_plan ON mo_plan_media(plan_id, position);
