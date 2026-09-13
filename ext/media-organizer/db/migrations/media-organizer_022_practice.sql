-- Practice (M104, docs/Parallx_Milestone_104.md): timed drawing from the
-- library. Daily Study and Practice Sessions are one engine; both write here.
--
-- mo_practice_presets   a saved setup: where the pictures come from (pool_json),
--                       how the run is sized, and the per-run options.
-- mo_practice_sessions  one row per run. kind: daily | practice.
-- mo_practice_draws     one row per picture shown in a run. Rows are inserted
--                       as 'pending' when the run is drawn and deleted at the
--                       end if the picture was never shown, so a finished run
--                       holds exactly the pictures that were drawn.
--                       outcome: pending | done | skipped.
-- mo_practice_daily     the picture of the day, one row per local day, so the
--                       same picture shows however often the app reopens.
--
-- The picker reads last-drawn times from mo_practice_draws; nothing keeps a
-- separate tally, and there is no streak (O2).

CREATE TABLE IF NOT EXISTS mo_practice_presets (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL UNIQUE,
  pool_json       TEXT    NOT NULL DEFAULT '{"kind":"all"}',
  sizing          TEXT    NOT NULL DEFAULT 'count' CHECK(sizing IN ('count', 'total')),
  seconds_per     INTEGER NOT NULL DEFAULT 120,
  count           INTEGER NOT NULL DEFAULT 10,
  total_seconds   INTEGER NOT NULL DEFAULT 1200,
  options_json    TEXT    NOT NULL DEFAULT '{}',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mo_practice_sessions (
  id              INTEGER PRIMARY KEY,
  kind            TEXT    NOT NULL DEFAULT 'practice' CHECK(kind IN ('daily', 'practice')),
  preset_id       INTEGER REFERENCES mo_practice_presets(id) ON DELETE SET NULL,
  pool_json       TEXT    NOT NULL DEFAULT '{"kind":"all"}',
  seconds_per     INTEGER NOT NULL DEFAULT 120,
  options_json    TEXT    NOT NULL DEFAULT '{}',
  started_at      TEXT    NOT NULL,
  ended_at        TEXT,
  planned_seconds INTEGER NOT NULL DEFAULT 0,
  spent_seconds   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mo_practice_draws (
  id              INTEGER PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES mo_practice_sessions(id) ON DELETE CASCADE,
  photo_id        INTEGER NOT NULL REFERENCES mo_photos(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  planned_seconds INTEGER NOT NULL,
  spent_seconds   INTEGER NOT NULL DEFAULT 0,
  outcome         TEXT    NOT NULL DEFAULT 'pending' CHECK(outcome IN ('pending', 'done', 'skipped')),
  drawn_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_mo_practice_draws_photo   ON mo_practice_draws(photo_id, drawn_at);
CREATE INDEX IF NOT EXISTS idx_mo_practice_draws_session ON mo_practice_draws(session_id, position);

CREATE TABLE IF NOT EXISTS mo_practice_daily (
  day             TEXT    PRIMARY KEY,
  photo_id        INTEGER NOT NULL REFERENCES mo_photos(id) ON DELETE CASCADE,
  session_id      INTEGER REFERENCES mo_practice_sessions(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
