-- Media Organizer: Scan roots table for file-watcher auto-scan
-- Tracks which directories have been scanned so we can watch them and delta-scan on relaunch.

CREATE TABLE IF NOT EXISTS mo_scan_roots (
  id          INTEGER PRIMARY KEY,
  path        TEXT    UNIQUE NOT NULL,
  last_scan_at TEXT   NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
