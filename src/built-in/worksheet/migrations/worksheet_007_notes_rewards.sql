-- Notes and rewards (docs/PROBLEM_BANK.md).
-- ws_problem_note: one note per problem, written from the quiz overview and
-- kept across quizzes, so a mistake has somewhere to be remembered.
-- ws_reward: when each reward was first earned; the ids are defined in
-- rewards.ts and their XP is added on top of the campaign's XP.
CREATE TABLE IF NOT EXISTS ws_problem_note (
  item_id INTEGER PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ws_reward (
  id TEXT PRIMARY KEY,
  unlocked_at INTEGER NOT NULL
);
