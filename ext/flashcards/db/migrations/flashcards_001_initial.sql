-- flashcards_001_initial.sql — decks, cards (SM-2 state inline), review log.
--
-- SM-2 state lives ON the card row (ease / interval / due / reps / lapses /
-- learning step) — the review log is append-only history used for stats and
-- retention, never for scheduling.

CREATE TABLE IF NOT EXISTS fc_decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fc_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES fc_decks(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  source_uri TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  suspended INTEGER NOT NULL DEFAULT 0,
  -- SM-2 scheduling state
  state TEXT NOT NULL DEFAULT 'new',          -- new | learning | review | relearning
  ease REAL NOT NULL DEFAULT 2.5,
  interval_days REAL NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT 0,          -- ms epoch; 0 = not yet scheduled
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  learning_step INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fc_cards_deck ON fc_cards(deck_id);
CREATE INDEX IF NOT EXISTS idx_fc_cards_due  ON fc_cards(due_at);
CREATE INDEX IF NOT EXISTS idx_fc_cards_state ON fc_cards(state);

CREATE TABLE IF NOT EXISTS fc_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES fc_cards(id) ON DELETE CASCADE,
  reviewed_at INTEGER NOT NULL,
  rating INTEGER NOT NULL,                    -- 1 Again / 2 Hard / 3 Good / 4 Easy
  interval_before REAL NOT NULL,
  interval_after REAL NOT NULL,
  ease_before REAL NOT NULL,
  ease_after REAL NOT NULL,
  state_before TEXT NOT NULL,
  state_after TEXT NOT NULL,
  ms_taken INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_fc_reviews_time ON fc_reviews(reviewed_at);
CREATE INDEX IF NOT EXISTS idx_fc_reviews_card ON fc_reviews(card_id);
