-- Progress snapshots (docs/PROBLEM_BANK.md): one row per day, the bank's
-- attempted % and score at the end of that day. 'workbook' rows come from
-- the imported workbook's own timeline; 'attempts' rows are derived here.
CREATE TABLE IF NOT EXISTS ws_progress (
  day TEXT PRIMARY KEY,
  attempted REAL NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'attempts'
);
