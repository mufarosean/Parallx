-- Mark For Later (docs/PROBLEM_BANK.md): the problems the student flagged
-- inside one quiz to come back to before completing it, an exam's mark for
-- review. Stored on the quiz, unlike a star, which is stored on the problem.
-- JSON list of item ids; NULL reads as none.
ALTER TABLE ws_quiz_session ADD COLUMN marked TEXT;
