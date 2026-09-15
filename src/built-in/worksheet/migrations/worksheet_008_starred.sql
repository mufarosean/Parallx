-- Starred problems (docs/PROBLEM_BANK.md). A star is a bookmark the student
-- puts on the problem itself, from its sheet, the quiz overview or the bank,
-- and it stays there across quizzes, so a quiz of everything starred is one
-- click on Home, the Dashboard or the quiz builder.
CREATE TABLE IF NOT EXISTS ws_star (
  item_id INTEGER PRIMARY KEY,
  starred_at INTEGER NOT NULL
);
