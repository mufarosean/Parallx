-- M59 Phase 2: simple key/value settings table for the extension.
-- Stores things like autoWebpMode (off|suggest|auto). Centralized so we
-- don't need to introduce a new migration every time a setting is added.

CREATE TABLE IF NOT EXISTS mo_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Default to "suggest" — we already ship the manual review command.
INSERT OR IGNORE INTO mo_settings (key, value) VALUES ('autoWebpMode', 'suggest');
