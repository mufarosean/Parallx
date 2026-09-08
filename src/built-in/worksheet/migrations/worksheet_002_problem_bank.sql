-- Problem Bank (docs/PROBLEM_BANK.md): one sheet per problem, as it was in
-- the workbook, with the vocabulary of the ProblemTrack workbook it replaces.
--
-- ws_items
--   sheet_json    the whole sheet (solution included) as a Univer snapshot;
--                 '' for legacy givens/solution items
--   solution_col  first column of the worked solution (hidden until reveal), -1 = none
--   work_row      the "SHOW ALL WORK" row; the student's area starts below it, -1 = none
--   paper         e.g. brosius, clark (lower-case key; display names in code)
--   source        rf | cas | custom | generated | other
--   kind          quant | qual | essay
--   quadrant      the vendor's priority: 1 easy+likely, 2 hard+likely, 3 easy+unlikely, 4 hard+unlikely, 0 unknown
--   sheet_name    the workbook sheet the item came from, to recognise a re-import
-- ws_attempts
--   seconds       time spent on the attempt
--   session_id    the quiz the attempt belongs to, '' outside a quiz
--   imported      1 when the grade came from the workbook's own self-rating, not from work done here
ALTER TABLE ws_items ADD COLUMN sheet_json TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_items ADD COLUMN solution_col INTEGER NOT NULL DEFAULT -1;
ALTER TABLE ws_items ADD COLUMN work_row INTEGER NOT NULL DEFAULT -1;
ALTER TABLE ws_items ADD COLUMN paper TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_items ADD COLUMN source TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_items ADD COLUMN kind TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_items ADD COLUMN quadrant INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ws_items ADD COLUMN sheet_name TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_attempts ADD COLUMN seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ws_attempts ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ws_attempts ADD COLUMN imported INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ws_items_paper ON ws_items(paper);
CREATE INDEX IF NOT EXISTS idx_ws_items_sheet ON ws_items(source_label, sheet_name);
