-- Character Studio: one row per character. `data` is the character as JSON
-- (body and detail sliders, look); `thumbnail` a small PNG data URL of the face.
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  thumbnail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_characters_updated ON characters(updated_at);
