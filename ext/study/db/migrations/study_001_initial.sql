CREATE TABLE IF NOT EXISTS st_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- pdf | canvas | bank
  uri TEXT NOT NULL,                  -- file URI or path for pdf; canvas page id; '' for a bank
  label TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL DEFAULT '',
  outline_json TEXT NOT NULL DEFAULT '[]',   -- [{title, pageFrom, pageTo, level}]
  model TEXT NOT NULL DEFAULT '',            -- remembered per material
  context_setting INTEGER NOT NULL DEFAULT 0,
  answer_format TEXT NOT NULL DEFAULT '',    -- remembered per material; '' = setting
  created_at INTEGER NOT NULL,
  last_studied_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_st_materials_uri ON st_materials(kind, uri);

CREATE TABLE IF NOT EXISTS st_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES st_materials(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  page_from INTEGER NOT NULL,
  page_to INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  mapped_at INTEGER NOT NULL DEFAULT 0       -- when the concept map for it was last built
);
CREATE INDEX IF NOT EXISTS idx_st_sections_material ON st_sections(material_id, ord);

CREATE TABLE IF NOT EXISTS st_concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES st_materials(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',          -- one sentence, as the text states it
  page INTEGER NOT NULL DEFAULT 0,
  anchor_quote TEXT NOT NULL DEFAULT '',
  ord INTEGER NOT NULL DEFAULT 0,
  mastery REAL NOT NULL DEFAULT 0,
  answers INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  miss_streak INTEGER NOT NULL DEFAULT 0,
  right_choose_at INTEGER NOT NULL DEFAULT 0,  -- last right answer in choose format
  right_type_at INTEGER NOT NULL DEFAULT 0,    -- last right answer in type format
  last_answered_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_st_concepts_material ON st_concepts(material_id, section_id, ord);

CREATE TABLE IF NOT EXISTS st_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL DEFAULT 0,    -- 0 for a bank question not yet mapped
  concept_id INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL,                      -- mc | short | essay | numeric | formula | cloze
  stem TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',   -- mc: ["...", ...]
  answer TEXT NOT NULL DEFAULT '',           -- mc: index as text; short/essay: model answer; numeric: value; formula: LaTeX; cloze: term
  explanation TEXT NOT NULL DEFAULT '',      -- one or two sentences grounded in the anchor
  rubric_json TEXT NOT NULL DEFAULT '[]',    -- [{text, required}]
  rubric_origin TEXT NOT NULL DEFAULT '',    -- source | answer | report
  contradictions_json TEXT NOT NULL DEFAULT '[]', -- statements that mark an answer wrong (report "common errors")
  numeric_json TEXT NOT NULL DEFAULT '',     -- {inputs, solutionPy, expected, units, tolerance, executed, agreed}
  source_page INTEGER NOT NULL DEFAULT 0,
  source_quote TEXT NOT NULL DEFAULT '',
  source_uri TEXT NOT NULL DEFAULT '',       -- the PDF, the report, or '' (then the material's uri)
  origin TEXT NOT NULL DEFAULT 'generated',  -- generated | exam | rising-fellow | imported | provider
  origin_label TEXT NOT NULL DEFAULT '',     -- "CAS Exam 7 · 2019 Fall · Q5(b)"
  provider_id TEXT NOT NULL DEFAULT '',
  provider_ref TEXT NOT NULL DEFAULT '',
  bank_id INTEGER NOT NULL DEFAULT 0,
  checks_json TEXT NOT NULL DEFAULT '{}',    -- {anchor, support, distractor, numeric}: true | false | null (not run)
  difficulty TEXT NOT NULL DEFAULT '',       -- easy | medium | hard
  hidden INTEGER NOT NULL DEFAULT 0,         -- thumbs down
  edited INTEGER NOT NULL DEFAULT 0,
  run_id INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_st_questions_concept ON st_questions(concept_id, format, hidden);
CREATE INDEX IF NOT EXISTS idx_st_questions_material ON st_questions(material_id, hidden);

CREATE TABLE IF NOT EXISTS st_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  section_id INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  num_ctx INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',    -- running | done | stopped | failed
  written INTEGER NOT NULL DEFAULT 0,
  kept INTEGER NOT NULL DEFAULT 0,
  dropped_json TEXT NOT NULL DEFAULT '{}',   -- {anchor: n, support: n, distractor: n, numeric: n, parse: n}
  error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS st_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope_json TEXT NOT NULL,                  -- see §5 StScope
  mode TEXT NOT NULL,                        -- practice | test | learn | weak
  answer_format TEXT NOT NULL,               -- choose | type | mixed
  size INTEGER NOT NULL DEFAULT 20,
  model TEXT NOT NULL DEFAULT '',
  num_ctx INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,       -- index of the current item
  refreshes INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS st_session_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES st_sessions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL,
  draw INTEGER NOT NULL DEFAULT 0,           -- which refresh the item came in on
  ord INTEGER NOT NULL,
  format_used TEXT NOT NULL DEFAULT '',      -- mc | short | essay | numeric | formula | cloze (mixed resolves per item)
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | right | wrong | skipped
  chosen TEXT NOT NULL DEFAULT '',
  typed TEXT NOT NULL DEFAULT '',
  verdict_json TEXT NOT NULL DEFAULT '',
  retried INTEGER NOT NULL DEFAULT 0,
  answered_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_st_session_items ON st_session_items(session_id, draw, ord);

CREATE TABLE IF NOT EXISTS st_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  concept_id INTEGER NOT NULL DEFAULT 0,
  session_id INTEGER NOT NULL DEFAULT 0,
  format_used TEXT NOT NULL,
  correct INTEGER NOT NULL,                  -- 1 | 0
  rating INTEGER NOT NULL DEFAULT 0,         -- 1 Again | 2 Hard | 3 Good | 4 Easy, for typed; 1 or 3 for choose
  retried INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_st_answers_concept ON st_answers(concept_id, at);

CREATE TABLE IF NOT EXISTS st_banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                        -- file | provider | report
  path TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  exam TEXT NOT NULL DEFAULT '',             -- report: "CAS Exam 7"
  sitting TEXT NOT NULL DEFAULT '',          -- report: "2019 Fall"
  count INTEGER NOT NULL DEFAULT 0,
  imported_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS st_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
