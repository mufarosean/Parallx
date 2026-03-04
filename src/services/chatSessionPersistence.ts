// chatSessionPersistence.ts — SQLite persistence for chat sessions (M9 Cap 9 Task 9.1)
//
// Serializes/deserializes chat sessions and messages to SQLite tables.
// Uses IDatabaseService for all SQL operations.
//
// Tables:
//   chat_sessions — session metadata (id, title, mode, modelId, timestamps)
//   chat_messages — ordered messages with serialized content parts
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/chatService/chatService.ts — _persistSession()

import { URI } from '../platform/uri.js';
import type {
  IChatSession,
  IChatUserMessage,
  IChatAssistantResponse,
  IChatRequestResponsePair,
  IChatContentPart,
} from './chatTypes.js';
import { ChatMode } from './chatTypes.js';

// ── Database interface (subset of IDatabaseService) ──

/**
 * Minimal database interface required by the persistence layer.
 * Decoupled from the full IDatabaseService to keep the module testable.
 */
export interface IChatPersistenceDatabase {
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  readonly isOpen: boolean;
}

// ── Schema ──

const CHAT_SESSION_SCHEME = 'parallx-chat-session';

const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT '',
  title       TEXT NOT NULL DEFAULT 'New Chat',
  mode        TEXT NOT NULL DEFAULT 'ask',
  model_id    TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
)`;

const CREATE_MESSAGES_TABLE = `
CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  parts_json  TEXT NOT NULL DEFAULT '[]',
  model_id    TEXT NOT NULL DEFAULT '',
  is_complete INTEGER NOT NULL DEFAULT 0,
  timestamp   INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
)`;

const CREATE_MESSAGES_INDEX = `
CREATE INDEX IF NOT EXISTS idx_chat_messages_session
ON chat_messages(session_id, sort_order)`;

const CREATE_SESSIONS_WORKSPACE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace_updated
ON chat_sessions(workspace_id, updated_at DESC)`;

// ── Public API ──

/**
 * Ensure chat persistence tables exist.
 * Safe to call multiple times (IF NOT EXISTS).
 */
export async function ensureChatTables(db: IChatPersistenceDatabase): Promise<void> {
  if (!db.isOpen) { return; }
  await db.run(CREATE_SESSIONS_TABLE);
  // Migration path for databases created before workspace scoping.
  try {
    await db.run(`ALTER TABLE chat_sessions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists or ALTER not required.
  }
  await db.run(CREATE_MESSAGES_TABLE);
  await db.run(CREATE_MESSAGES_INDEX);
  await db.run(CREATE_SESSIONS_WORKSPACE_INDEX);
}

/**
 * Persist a session and all its messages.
 * Uses REPLACE INTO for idempotent upsert.
 */
export async function saveSession(
  db: IChatPersistenceDatabase,
  session: IChatSession,
  workspaceId?: string,
): Promise<void> {
  if (!db.isOpen) { return; }
  const scopedWorkspaceId = workspaceId ?? session.workspaceId ?? '';

  // Upsert session row
  await db.run(
    `INSERT OR REPLACE INTO chat_sessions (id, workspace_id, title, mode, model_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [session.id, scopedWorkspaceId, session.title, session.mode, session.modelId, session.createdAt, Date.now()],
  );

  // Delete existing messages for this session (full replace)
  await db.run(`DELETE FROM chat_messages WHERE session_id = ?`, [session.id]);

  // Insert all message pairs
  for (let i = 0; i < session.messages.length; i++) {
    const pair = session.messages[i];

    // User message
    await db.run(
      `INSERT INTO chat_messages (session_id, role, content, parts_json, model_id, is_complete, timestamp, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        'user',
        pair.request.text,
        JSON.stringify([]), // User messages don't have parts
        '',
        1,
        pair.request.timestamp,
        i * 2,
      ],
    );

    // Assistant response
    await db.run(
      `INSERT INTO chat_messages (session_id, role, content, parts_json, model_id, is_complete, timestamp, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        'assistant',
        _extractTextContent(pair.response.parts),
        JSON.stringify(pair.response.parts),
        pair.response.modelId,
        pair.response.isComplete ? 1 : 0,
        pair.response.timestamp,
        i * 2 + 1,
      ],
    );
  }
}

/**
 * Load all persisted sessions from the database.
 * Returns fully hydrated IChatSession objects.
 */
export async function loadSessions(db: IChatPersistenceDatabase, workspaceId: string): Promise<IChatSession[]> {
  if (!db.isOpen) { return []; }

  const rows = await db.all<{
    id: string;
    workspace_id: string;
    title: string;
    mode: string;
    model_id: string;
    created_at: number;
    updated_at: number;
  }>(
    `SELECT id, workspace_id, title, mode, model_id, created_at, updated_at
     FROM chat_sessions
     WHERE workspace_id = ?
     ORDER BY updated_at DESC`,
    [workspaceId],
  );

  const sessions: IChatSession[] = [];

  for (const row of rows) {
    const messageRows = await db.all<{
      role: string;
      content: string;
      parts_json: string;
      model_id: string;
      is_complete: number;
      timestamp: number;
      sort_order: number;
    }>(`SELECT role, content, parts_json, model_id, is_complete, timestamp, sort_order
        FROM chat_messages WHERE session_id = ? ORDER BY sort_order`, [row.id]);

    // Reconstruct request/response pairs
    const messages: IChatRequestResponsePair[] = [];
    let pendingUser: IChatUserMessage | undefined;

    for (const msg of messageRows) {
      if (msg.role === 'user') {
        pendingUser = {
          text: msg.content,
          timestamp: msg.timestamp,
        };
      } else if (msg.role === 'assistant' && pendingUser) {
        let parts: IChatContentPart[] = [];
        try {
          parts = JSON.parse(msg.parts_json);
        } catch {
          // Corrupted parts — fallback to empty
        }

        const response: IChatAssistantResponse = {
          parts,
          isComplete: msg.is_complete === 1,
          modelId: msg.model_id,
          timestamp: msg.timestamp,
        };

        messages.push({
          request: pendingUser,
          response,
        });
        pendingUser = undefined;
      }
    }

    const sessionResource = URI.from({ scheme: CHAT_SESSION_SCHEME, path: `/${row.id}` });

    sessions.push({
      id: row.id,
      workspaceId: row.workspace_id,
      sessionResource,
      createdAt: row.created_at,
      title: row.title,
      mode: _parseMode(row.mode),
      modelId: row.model_id,
      messages,
      requestInProgress: false,
      pendingRequests: [],
    });
  }

  return sessions;
}

/**
 * Delete a session and its messages from the database.
 * Messages are cascade-deleted via the foreign key.
 */
export async function deletePersistedSession(
  db: IChatPersistenceDatabase,
  sessionId: string,
  workspaceId?: string,
): Promise<void> {
  if (!db.isOpen) { return; }
  if (workspaceId !== undefined) {
    await db.run(`DELETE FROM chat_sessions WHERE id = ? AND workspace_id = ?`, [sessionId, workspaceId]);
    return;
  }
  await db.run(`DELETE FROM chat_sessions WHERE id = ?`, [sessionId]);
}

// ── Helpers ──

function _extractTextContent(parts: readonly IChatContentPart[]): string {
  return parts
    .map((p) => {
      if ('content' in p && typeof p.content === 'string') { return p.content; }
      if ('code' in p && typeof p.code === 'string') { return p.code; }
      if ('message' in p && typeof p.message === 'string') { return p.message; }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 1000); // Truncate for the content column (used for search, not rendering)
}

function _parseMode(mode: string): ChatMode {
  if (mode === 'edit') { return ChatMode.Edit; }
  if (mode === 'agent') { return ChatMode.Agent; }
  return ChatMode.Ask;
}

// ── Cross-session search (M11 Task 4.5) ──

/**
 * Search result from cross-session keyword search.
 */
export interface ISessionSearchResult {
  sessionId: string;
  sessionTitle: string;
  matchingRole: 'user' | 'assistant';
  matchingContent: string;
  timestamp: number;
  createdAt: number;
}

/**
 * Full-text search across all past chat sessions.
 * Searches both user messages and assistant response content.
 * Returns results sorted by relevance (most recent first).
 */
export async function searchSessions(
  db: IChatPersistenceDatabase,
  workspaceId: string,
  query: string,
  limit: number = 20,
): Promise<ISessionSearchResult[]> {
  if (!db.isOpen || !query.trim()) { return []; }

  const likePattern = `%${query.trim()}%`;

  const rows = await db.all<{
    session_id: string;
    title: string;
    role: string;
    content: string;
    timestamp: number;
    created_at: number;
  }>(
    `SELECT m.session_id, s.title, m.role, m.content, m.timestamp, s.created_at
     FROM chat_messages m
     JOIN chat_sessions s ON s.id = m.session_id
     WHERE s.workspace_id = ? AND m.content LIKE ?
     ORDER BY m.timestamp DESC
     LIMIT ?`,
    [workspaceId, likePattern, limit],
  );

  return rows.map((r) => ({
    sessionId: r.session_id,
    sessionTitle: r.title,
    matchingRole: r.role as 'user' | 'assistant',
    matchingContent: _extractSearchSnippet(r.content, query),
    timestamp: r.timestamp,
    createdAt: r.created_at,
  }));
}

/**
 * Extract a snippet around the search query match.
 */
function _extractSearchSnippet(content: string, query: string): string {
  const lower = content.toLowerCase();
  const queryLower = query.toLowerCase();
  const idx = lower.indexOf(queryLower);
  if (idx === -1) { return content.slice(0, 100); }

  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + query.length + 60);
  let snippet = content.slice(start, end);
  if (start > 0) { snippet = '...' + snippet; }
  if (end < content.length) { snippet += '...'; }
  return snippet;
}

// ── Semantic session search (M11 Task 4.6) ──

/**
 * Semantic search result — from vector-based memory search with session metadata.
 */
export interface ISemanticSessionSearchResult {
  sessionId: string;
  sessionTitle: string;
  summary: string;
  messageCount: number;
  createdAt: string;
  /** Similarity score from vector search. */
  score?: number;
}

/**
 * Search sessions semantically using conversation memory embeddings.
 * Accepts pre-recalled memories from the MemoryService and enriches
 * them with session titles from the sessions table.
 *
 * Usage:
 *   const memories = await memoryService.recallMemories(query, { topK: 10 });
 *   const results = await searchSessionsSemantic(db, memories);
 */
export async function searchSessionsSemantic(
  db: IChatPersistenceDatabase,
  workspaceId: string,
  memories: ReadonlyArray<{ sessionId: string; summary: string; messageCount: number; createdAt: string }>,
): Promise<ISemanticSessionSearchResult[]> {
  if (!db.isOpen || memories.length === 0) { return []; }

  const results: ISemanticSessionSearchResult[] = [];

  for (const mem of memories) {
    const row = await db.get<{ title: string }>(
      'SELECT title FROM chat_sessions WHERE id = ? AND workspace_id = ?',
      [mem.sessionId, workspaceId],
    );

    if (!row) {
      continue;
    }

    results.push({
      sessionId: mem.sessionId,
      sessionTitle: row.title,
      summary: mem.summary,
      messageCount: mem.messageCount,
      createdAt: mem.createdAt,
    });
  }

  return results;
}
