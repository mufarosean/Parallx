-- A solution laid out BELOW the question (a "SOLUTION" row after SHOW ALL WORK, as the
-- custom question bank does): its first row, hidden until reveal; -1 = none.
ALTER TABLE ws_items ADD COLUMN solution_row INTEGER NOT NULL DEFAULT -1;
