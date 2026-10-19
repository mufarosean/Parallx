-- A quiz opens every problem on a clean sheet (quizSheet.ts): unfinished
-- work from before the quiz is set aside, kept but no longer the open
-- attempt, so the quiz's own work starts a new one.
ALTER TABLE ws_attempts ADD COLUMN set_aside_at INTEGER NOT NULL DEFAULT 0;
