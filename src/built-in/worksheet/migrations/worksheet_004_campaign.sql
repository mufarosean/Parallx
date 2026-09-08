-- The campaign (docs/PROBLEM_BANK.md): every problem in the bank in N days.
-- One campaign at a time; the daily draw is fixed per day so the dashboard
-- never reshuffles what today asks for.
CREATE TABLE IF NOT EXISTS ws_campaign (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  start_day TEXT NOT NULL,
  days INTEGER NOT NULL,
  daily_target INTEGER NOT NULL,
  started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ws_daily_draw (
  day TEXT PRIMARY KEY,
  item_ids TEXT NOT NULL
);
