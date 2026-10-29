// chatSessionWrites.test.ts — a chat's save against real SQLite (node:sqlite),
// foreign keys on, as electron/database.cjs runs them.
//
// Two faults this guards: the session row was written with INSERT OR
// REPLACE, whose delete cascaded to every message (a chat not yet loaded
// lost its history when renamed); and every save deleted and rewrote the
// whole chat, twice a second while an answer streamed.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ensureChatTables, saveSession, loadSessionMessages } from '../../src/services/chatSessionPersistence';
import type { IChatPersistenceDatabase, IChatPersistenceTxnOp } from '../../src/services/chatSessionPersistence';
import type { IChatSession } from '../../src/services/chatTypes';
import { ChatMode, ChatContentPartKind } from '../../src/services/chatTypes';
import { URI } from '../../src/platform/uri';

function realDb(): IChatPersistenceDatabase & { writes: string[]; failNext?: boolean } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = {
    writes: [] as string[],
    failNext: false,
    isOpen: true,
    async run(sql: string, params: unknown[] = []) { const r = sqlite.prepare(sql).run(...(params as never[])); return { changes: Number(r.changes) }; },
    async get<T>(sql: string, params: unknown[] = []) { return (sqlite.prepare(sql).get(...(params as never[])) ?? null) as T | null; },
    async all<T>(sql: string, params: unknown[] = []) { return sqlite.prepare(sql).all(...(params as never[])) as T[]; },
    async runTransaction(ops: IChatPersistenceTxnOp[]) {
      if (db.failNext) { db.failNext = false; throw new Error('disk full'); }
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        for (const op of ops) { db.writes.push(op.sql.trim().split(/\s+/).slice(0, 3).join(' ')); sqlite.prepare(op.sql).run(...((op.params ?? []) as never[])); }
        sqlite.exec('COMMIT');
      } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
      return [];
    },
  };
  return db;
}

function chat(texts: string[]): IChatSession {
  return {
    id: 'chat-1', title: 'Exam prep', mode: ChatMode.Agent, modelId: 'qwen3:32b', createdAt: 1,
    requestInProgress: false, pendingRequests: [], sessionResource: URI.parse('parallx-chat-session:///chat-1'),
    messages: texts.map((t, i) => ({
      request: { text: `Q${i}`, requestId: `r${i}`, participantId: 'parallx.chat.default', attempt: 0, timestamp: 100 + i },
      response: { parts: [{ kind: ChatContentPartKind.Markdown, content: t }], isComplete: true, modelId: 'qwen3:32b', timestamp: 200 + i },
    })),
  } as IChatSession;
}

const answers = async (db: IChatPersistenceDatabase) => (await loadSessionMessages(db, 'chat-1')).messages.map((m) => (m.response.parts[0] as { content: string }).content);

describe('saving a chat (real SQLite, foreign keys on)', () => {
  it('saving a chat whose messages are not loaded yet keeps its messages', async () => {
    const db = realDb();
    await ensureChatTables(db);
    await saveSession(db, chat(['one', 'two']));
    const unloaded = { ...chat([]), title: 'Renamed', messagesPendingLoad: true } as IChatSession;
    await saveSession(db, unloaded);
    expect(await answers(db)).toEqual(['one', 'two']);
    expect((await db.get<{ title: string }>('SELECT title FROM chat_sessions WHERE id = ?', ['chat-1']))?.title).toBe('Renamed');
  });

  it('a later save writes only the rows that changed, and drops rows past the end', async () => {
    const db = realDb();
    await ensureChatTables(db);
    await saveSession(db, chat(['one', 'two', 'three']));
    db.writes.length = 0;
    await saveSession(db, chat(['one', 'two', 'three, longer']));
    expect(db.writes.filter((w) => w.startsWith('INSERT INTO chat_messages'))).toHaveLength(1);
    expect(await answers(db)).toEqual(['one', 'two', 'three, longer']);

    await saveSession(db, chat(['one'])); // a chat cut back (an answer undone)
    expect(await answers(db)).toEqual(['one']);
  });

  it('after a failed save, the next one writes everything again', async () => {
    const db = realDb();
    await ensureChatTables(db);
    await saveSession(db, chat(['one']));
    db.failNext = true;
    await expect(saveSession(db, chat(['one', 'two']))).rejects.toThrow('disk full');
    db.writes.length = 0;
    await saveSession(db, chat(['one', 'two']));
    expect(db.writes.filter((w) => w.startsWith('INSERT INTO chat_messages'))).toHaveLength(4);
    expect(await answers(db)).toEqual(['one', 'two']);
  });
});
