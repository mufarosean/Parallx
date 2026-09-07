-- Browser: bookmarks, history, downloads and open tabs. Everything local.

CREATE TABLE IF NOT EXISTS br_bookmarks (
  id          INTEGER PRIMARY KEY,
  url         TEXT    NOT NULL UNIQUE,
  title       TEXT    DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS br_history (
  id            INTEGER PRIMARY KEY,
  url           TEXT    NOT NULL UNIQUE,
  title         TEXT    DEFAULT '',
  visits        INTEGER NOT NULL DEFAULT 1,
  last_visit_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_br_history_last ON br_history(last_visit_at DESC);

CREATE TABLE IF NOT EXISTS br_downloads (
  id          TEXT    PRIMARY KEY,
  url         TEXT    NOT NULL,
  filename    TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  total       INTEGER,
  received    INTEGER,
  state       TEXT    NOT NULL,
  started_at  TEXT    NOT NULL,
  finished_at TEXT
);

-- Open tabs remember their address so a restored tab comes back to its page.
CREATE TABLE IF NOT EXISTS br_tabs (
  instance_id TEXT    PRIMARY KEY,
  url         TEXT    NOT NULL,
  title       TEXT    DEFAULT '',
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
