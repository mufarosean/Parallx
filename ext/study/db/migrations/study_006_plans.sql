-- A plan: a canvas page under a subject's page with four databases (Plan,
-- Week, Phases, Days), the person's own tables. Study keeps where they are
-- and, for each Days row, the cells it last wrote there (Type, Phase, Work,
-- Floor, Standard, Stretch, Edited), so a cell he changed is told from one
-- the rules changed, and only differences are written.
CREATE TABLE IF NOT EXISTS st_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  page_id TEXT NOT NULL DEFAULT '',
  plan_db TEXT NOT NULL DEFAULT '',
  week_db TEXT NOT NULL DEFAULT '',
  phases_db TEXT NOT NULL DEFAULT '',
  days_db TEXT NOT NULL DEFAULT '',
  written_json TEXT NOT NULL DEFAULT '{}',   -- Days row id -> the cells Study last wrote
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_st_plans_subject ON st_plans(subject_id);
