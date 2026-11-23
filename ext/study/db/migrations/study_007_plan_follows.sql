-- A phase can follow the exam (its Phases row has Follows: Whole plan, or
-- Before exam): Study writes its Start and End when the plan's dates move.
-- To tell that from his own edit of those dates, Study keeps what it last
-- left in each following row: phase row id -> { follows, start, end }.
ALTER TABLE st_plans ADD COLUMN follows_json TEXT NOT NULL DEFAULT '{}';
