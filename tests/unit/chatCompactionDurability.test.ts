import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ChatDataService } from '../../src/built-in/chat/data/chatDataService';
import { ChatMode, type IChatSession } from '../../src/services/chatTypes';
import { ensureChatTables, saveSession, loadSessions, type IChatPersistenceDatabase } from '../../src/services/chatSessionPersistence';
import { WorkspaceTranscriptService } from '../../src/services/workspaceTranscriptService';
import { URI } from '../../src/platform/uri';

function compactedSession() {
  const session: IChatSession = {
    id: 'compacted-session', sessionResource: URI.parse('parallx-chat-session:///compacted-session'),
    title: 'Inventory task', createdAt: 1788880000000, mode: ChatMode.Agent, modelId: 'fixture-model',
    messages: [], messagesPendingLoad: true, requestInProgress: false, pendingRequests: [],
    plan: { goal: 'Inventory task', steps: [{ text: 'Write revised.md', status: 'pending' }], updatedAt: 1788880000000 },
  };
  new ChatDataService({ chatService: { getSession: () => session } } as any)
    .compactSession(session.id, 'Inventory exists. Next: revised.md. Preserve NEBULA-11.');
  return session;
}

/** An in-memory SQLite database behind the persistence interface. */
function realDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const db: IChatPersistenceDatabase = {
    isOpen: true,
    run: async (sql, params = []) => ({ changes: Number(sqlite.prepare(sql).run(...params as any[]).changes) }),
    get: async (sql, params = []) => sqlite.prepare(sql).get(...params as any[]) as any,
    all: async (sql, params = []) => sqlite.prepare(sql).all(...params as any[]) as any,
  };
  return { sqlite, db };
}

/** One answered turn with the counts the model reported for it. */
function answeredSession(): IChatSession {
  return {
    id: 'counted-session', sessionResource: URI.parse('parallx-chat-session:///counted-session'),
    title: 'Counted', createdAt: 1788880000000, mode: ChatMode.Agent, modelId: 'fixture-model',
    messages: [{
      request: { text: 'What changed?', requestId: 'r1', attempt: 0, timestamp: 1788880000000 },
      response: { parts: [{ kind: 'markdown', content: 'Two files.' }] as any, isComplete: true, modelId: 'fixture-model', timestamp: 1788880001000, promptTokens: 31_000, completionTokens: 900 },
    }],
    requestInProgress: false, pendingRequests: [],
  } as unknown as IChatSession;
}

describe('compacted conversation durability', () => {
  it('saves and reloads the compacted pair and latest plan through actual SQLite constraints', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys=ON');
    const db: IChatPersistenceDatabase = {
      isOpen: true,
      run: async (sql, params = []) => ({ changes: Number(sqlite.prepare(sql).run(...params as any[]).changes) }),
      get: async (sql, params = []) => sqlite.prepare(sql).get(...params as any[]) as any,
      all: async (sql, params = []) => sqlite.prepare(sql).all(...params as any[]) as any,
    };
    try {
      await ensureChatTables(db);
      const session = compactedSession();
      await saveSession(db, session, 'fixture-workspace');
      const [restored] = await loadSessions(db, 'fixture-workspace');
      expect(restored.plan).toEqual(session.plan);
      expect(restored.messages[0].response.modelId).toBe('fixture-model');
      expect(restored.messages[0].response.timestamp).toBeGreaterThan(0);
      expect(restored.messages[0].response.parts).toEqual(session.messages[0].response.parts);
    } finally { sqlite.close(); }
  });

  it('writes the compacted transcript with valid request and response timestamps', async () => {
    const fileService = { exists: vi.fn(async () => true), writeFile: vi.fn(async () => {}) };
    const workspaceService = { folders: [{ uri: URI.file('D:/synthetic-fixture') }] };
    const transcript = new WorkspaceTranscriptService(fileService as any, workspaceService as any);
    try {
      await transcript.writeSessionTranscript(compactedSession());
      expect(fileService.writeFile).toHaveBeenCalledOnce();
      const content = (fileService.writeFile.mock.calls[0] as unknown as [URI, string])[1];
      const lines = content.trim().split('\n').map(line => JSON.parse(line));
      expect(lines.filter(line => line.type === 'message').every(line => Number.isFinite(Date.parse(line.timestamp)))).toBe(true);
      expect(content).toContain('NEBULA-11');
    } finally { transcript.dispose(); }
  });
});

describe('reported token counts (the context meter\'s base) across a restart', () => {
  it('keep each answer\'s counts through a save and a reload', async () => {
    const { sqlite, db } = realDb();
    try {
      await ensureChatTables(db);
      await saveSession(db, answeredSession(), 'fixture-workspace');
      const [restored] = await loadSessions(db, 'fixture-workspace');
      expect(restored.messages[0].response.promptTokens).toBe(31_000);
      expect(restored.messages[0].response.completionTokens).toBe(900);
    } finally { sqlite.close(); }
  });

  it('upgrade an older chat_messages table in place; rows from before load without counts', async () => {
    const { sqlite, db } = realDb();
    try {
      sqlite.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', parts_json TEXT NOT NULL DEFAULT '[]', model_id TEXT NOT NULL DEFAULT '', is_complete INTEGER NOT NULL DEFAULT 0, timestamp INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)`);
      await ensureChatTables(db);
      const cols = (sqlite.prepare('PRAGMA table_info(chat_messages)').all() as { name: string }[]).map((c) => c.name);
      expect(cols).toEqual(expect.arrayContaining(['prompt_tokens', 'completion_tokens']));
      await saveSession(db, answeredSession(), 'fixture-workspace');
      expect((await loadSessions(db, 'fixture-workspace'))[0].messages[0].response.promptTokens).toBe(31_000);
      // As a row saved before the counts were kept.
      sqlite.prepare('UPDATE chat_messages SET prompt_tokens = NULL, completion_tokens = NULL').run();
      const [older] = await loadSessions(db, 'fixture-workspace');
      expect(older.messages[0].response.promptTokens).toBeUndefined();
      expect(older.messages[0].response.parts).toHaveLength(1);
    } finally { sqlite.close(); }
  });
});
