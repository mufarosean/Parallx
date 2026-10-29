// chatSessionWrites.ts — how a chat is written to the database.
//
// Two rules, each from a loss or a cost found in chatSessionPersistence.ts:
//
// - The session row is UPSERTED, never REPLACEd. chat_messages references
//   chat_sessions ON DELETE CASCADE with foreign keys on, and REPLACE deletes
//   the old row first: every message of the chat went with it. A chat whose
//   messages were not loaded yet (renamed, or its model changed, from the
//   list) lost its whole history that way.
// - A save writes only the message rows that changed since the last write.
//   Saves run every 500 ms while an answer streams, and each one deleted and
//   rewrote the whole chat, tool results and all.

import type { IChatPersistenceTxnOp } from './chatSessionPersistence.js';

const SESSION_COLUMNS = 'id, workspace_id, title, mode, model_id, context_window_override, plan_json, created_at, updated_at';
const SESSION_UPDATES = 'workspace_id = excluded.workspace_id, title = excluded.title, mode = excluded.mode, model_id = excluded.model_id, '
  + 'context_window_override = excluded.context_window_override, plan_json = excluded.plan_json, created_at = excluded.created_at, updated_at = excluded.updated_at';

/** Insert or update a chat's row, its messages untouched. */
export const SESSION_UPSERT_SQL = `INSERT INTO chat_sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ${SESSION_UPDATES}`;

/** The same for an archived run, which carries its origin. */
export const ARCHIVED_SESSION_UPSERT_SQL = `INSERT INTO chat_sessions (${SESSION_COLUMNS}, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ${SESSION_UPDATES}, origin = excluded.origin`;

/** A cheap 53-bit hash: what each row held when last written, without keeping its text. */
function hash(text: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Per database, per chat: each message row as last written (by its place, sort_order). */
const written = new WeakMap<object, Map<string, number[]>>();

export interface IMessageWrites {
  /** The writes that bring the database's rows to `rows`. */
  readonly ops: IChatPersistenceTxnOp[];
  /** Call once the writes are committed. */
  saved(): void;
  /** Call when they failed: the next save writes every row again. */
  failed(): void;
}

/**
 * The writes that make a chat's message rows match `rows` (row i has
 * sort_order i). The first save of a chat in this run rewrites them all;
 * later saves write only the rows that changed, and drop rows past the end.
 */
export function messageWrites(db: object, sessionId: string, rows: readonly IChatPersistenceTxnOp[]): IMessageWrites {
  const now = rows.map((r) => hash(JSON.stringify(r.params ?? [])));
  const before = written.get(db)?.get(sessionId);
  const ops: IChatPersistenceTxnOp[] = [];
  if (!before) {
    ops.push({ type: 'run', sql: 'DELETE FROM chat_messages WHERE session_id = ?', params: [sessionId] }, ...rows);
  } else {
    rows.forEach((row, i) => {
      if (before[i] === now[i]) return;
      ops.push({ type: 'run', sql: 'DELETE FROM chat_messages WHERE session_id = ? AND sort_order = ?', params: [sessionId, i] }, row);
    });
    if (before.length > rows.length) {
      ops.push({ type: 'run', sql: 'DELETE FROM chat_messages WHERE session_id = ? AND sort_order >= ?', params: [sessionId, rows.length] });
    }
  }
  return {
    ops,
    saved() {
      let map = written.get(db);
      if (!map) { map = new Map(); written.set(db, map); }
      map.set(sessionId, now);
    },
    failed() { forgetWrittenRows(db, sessionId); },
  };
}

/** After a chat's rows change some other way (deleted, pruned): the next save rewrites them. */
export function forgetWrittenRows(db: object, sessionId: string): void {
  written.get(db)?.delete(sessionId);
}
