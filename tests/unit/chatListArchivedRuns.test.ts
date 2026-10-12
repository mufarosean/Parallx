// The chat list leaves archived autonomous runs out. Heartbeat, cron,
// dashboard and helper runs are archived into the same tables as chats,
// tagged by origin; the list the app restores at startup is
// loadSessionMetas, run here against real SQLite.
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ChatMode, type IChatSession } from '../../src/services/chatTypes';
import {
  archiveSession,
  ensureChatTables,
  loadSessionMetas,
  saveSession,
  type IChatPersistenceDatabase,
} from '../../src/services/chatSessionPersistence';
import { URI } from '../../src/platform/uri';

function realDb(): IChatPersistenceDatabase {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  return {
    isOpen: true,
    run: async (sql, params = []) => ({ changes: Number(sqlite.prepare(sql).run(...params as any[]).changes) }),
    get: async (sql, params = []) => sqlite.prepare(sql).get(...params as any[]) as any,
    all: async (sql, params = []) => sqlite.prepare(sql).all(...params as any[]) as any,
  };
}

function session(id: string, question: string): IChatSession {
  return {
    id, sessionResource: URI.parse(`parallx-chat-session:///${id}`),
    title: id, createdAt: 1788880000000, mode: ChatMode.Agent, modelId: 'fixture-model',
    messages: [{
      request: { text: question, requestId: `${id}-r1`, attempt: 0, timestamp: 1788880000000 },
      response: { parts: [{ kind: 'markdown', content: 'Done.' }] as any, isComplete: true, modelId: 'fixture-model', timestamp: 1788880001000 },
    }],
    requestInProgress: false, pendingRequests: [],
  } as unknown as IChatSession;
}

describe('the chat list and archived runs', () => {
  it('lists the chats of the workspace and none of its archived runs', async () => {
    const db = realDb();
    await ensureChatTables(db);
    await saveSession(db, session('real-chat', 'What changed?'), 'ws1');
    await archiveSession(db, session('heartbeat-run', 'Check the plan'), 'heartbeat', 'ws1');
    await archiveSession(db, session('cron-run', 'Morning brief'), 'cron', 'ws1');

    const listed = await loadSessionMetas(db, 'ws1');
    expect(listed.map((s) => s.id)).toEqual(['real-chat']);
    expect(listed[0].previewText).toBe('What changed?');
  });
});
