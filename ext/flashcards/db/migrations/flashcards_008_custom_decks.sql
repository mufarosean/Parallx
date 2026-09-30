-- Custom decks: a named view over cards from any deck. A card joins one by carrying
-- the deck's tag. It stays in its own deck and keeps its one schedule.
CREATE TABLE IF NOT EXISTS fc_custom_decks (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  tag         TEXT    NOT NULL UNIQUE,
  description TEXT    NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
