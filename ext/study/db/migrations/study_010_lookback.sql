-- The weekly look back on Home says what slipped last week and offers ways
-- to absorb it. The Monday of the week he last answered it for is kept here,
-- so the offer is made once a week and never again for the same week.
ALTER TABLE st_plans ADD COLUMN lookback_week TEXT NOT NULL DEFAULT '';
