-- Quizzes are saved things (docs/PROBLEM_BANK.md): each has a name, several
-- may be open at once, none finishes by itself (only Complete Quiz on the
-- summary sets finished_at), and touched_at orders them by last use.
ALTER TABLE ws_quiz_session ADD COLUMN name TEXT;
ALTER TABLE ws_quiz_session ADD COLUMN touched_at INTEGER;
