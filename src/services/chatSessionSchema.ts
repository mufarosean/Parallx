// chatSessionSchema.ts — the two chat tables and their indexes, as SQL.
//
// chatSessionPersistence.ts creates them (ensureChatTables) and upgrades
// older databases in place; the statements live here so the shape of the
// tables reads in one place.

export const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS chat_sessions (
  id                      TEXT PRIMARY KEY,
  workspace_id            TEXT NOT NULL DEFAULT '',
  title                   TEXT NOT NULL DEFAULT 'New Chat',
  mode                    TEXT NOT NULL DEFAULT 'agent',
  model_id                TEXT NOT NULL DEFAULT '',
  context_window_override INTEGER,
  plan_json               TEXT,
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL,
  origin                  TEXT
)`;

// archived autonomous runs (heartbeat/cron/dashboard/subagent) are
// stored in the SAME tables as chat, tagged by `origin`. NULL origin = an
// interactive chat (the only rows the chat list shows). Index supports the
// archive list + retention prune.
export const CREATE_SESSIONS_ORIGIN_INDEX = `
CREATE INDEX IF NOT EXISTS idx_chat_sessions_origin
ON chat_sessions(origin, updated_at DESC)
`;

export const CREATE_SESSIONS_WORKSPACE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace
ON chat_sessions(workspace_id, updated_at DESC)
`;

export const CREATE_MESSAGES_TABLE = `
CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  parts_json  TEXT NOT NULL DEFAULT '[]',
  model_id    TEXT NOT NULL DEFAULT '',
  is_complete INTEGER NOT NULL DEFAULT 0,
  timestamp   INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER
)`;

export const CREATE_MESSAGES_INDEX = `
CREATE INDEX IF NOT EXISTS idx_chat_messages_session
ON chat_messages(session_id, sort_order)`;
