// Unit tests for chatSessionPersistence.ts — M9.2 Cap 9 Task 9.1

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ensureChatTables,
  saveSession,
  loadSessions,
  adoptOrphanedSessions,
  deletePersistedSession,
} from '../../src/services/chatSessionPersistence';
import type { IChatPersistenceDatabase } from '../../src/services/chatSessionPersistence';
import type { IChatSession } from '../../src/services/chatTypes';
import { ChatMode, ChatContentPartKind } from '../../src/services/chatTypes';
import { URI } from '../../src/platform/uri';

// ── Mock database ──

function createMockDb(): IChatPersistenceDatabase & {
  _tables: Map<string, unknown[]>;
  _runCalls: Array<{ sql: string; params?: unknown[] }>;
  _allCalls: Array<{ sql: string; params?: unknown[] }>;
  _getCalls: Array<{ sql: string; params?: unknown[] }>;
} {
  const tables = new Map<string, unknown[]>();

  const db: IChatPersistenceDatabase & {
    _tables: Map<string, unknown[]>;
    _runCalls: Array<{ sql: string; params?: unknown[] }>;
    _allCalls: Array<{ sql: string; params?: unknown[] }>;
  } = {
    _tables: tables,
    _runCalls: [],
    _allCalls: [],
    _getCalls: [],

    async run(sql: string, params?: unknown[]): Promise<void> {
      db._runCalls.push({ sql, params });
    },

    async get<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
      db._getCalls.push({ sql, params });
      return undefined;
    },

    async all<T>(sql: string, params?: unknown[]): Promise<T[]> {
      db._allCalls.push({ sql, params });
      return [];
    },

    async runTransaction(fn: (tx: { run: (sql: string, params?: unknown[]) => Promise<void> }) => Promise<void>): Promise<void> {
      const tx = {
        async run(sql: string, params?: unknown[]): Promise<void> {
          db._runCalls.push({ sql, params });
        },
      };
      await fn(tx);
    },

    isOpen: true,
  };

  return db;
}

function createTestSession(): IChatSession {
  return {
    id: 'test-session-1',
    title: 'Test Session',
    mode: ChatMode.Ask,
    modelId: 'llama3.1:8b',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    requestInProgress: false,
    sessionResource: URI.parse('parallx-chat-session:///test-session-1'),
  };
}

describe('chatSessionPersistence', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  describe('ensureChatTables', () => {
    it('creates chat_sessions and chat_messages tables', async () => {
      await ensureChatTables(db);

      const createStatements = db._runCalls
        .map((c) => c.sql)
        .filter((s) => s.includes('CREATE TABLE'));

      expect(createStatements.length).toBeGreaterThanOrEqual(2);
      expect(createStatements.some((s) => s.includes('chat_sessions'))).toBe(true);
      expect(createStatements.some((s) => s.includes('chat_messages'))).toBe(true);
    });

    it('creates index on chat_messages.session_id', async () => {
      await ensureChatTables(db);

      const indexStatements = db._runCalls
        .map((c) => c.sql)
        .filter((s) => s.includes('CREATE INDEX'));

      expect(indexStatements.some((s) => s.includes('session_id'))).toBe(true);
    });
  });

  describe('saveSession', () => {
    it('calls runTransaction with insert/replace statements', async () => {
      const session = createTestSession();
      session.messages = [
        {
          request: { text: 'Hello', requestId: 'req-1', participantId: 'parallx.chat.default', attempt: 0, timestamp: Date.now() },
          response: {
            parts: [{ kind: ChatContentPartKind.Markdown, content: 'Hi there!' }],
            isComplete: true,
          },
        },
      ];

      await saveSession(db, session);

      // Should have run INSERT/REPLACE for session + DELETE + INSERT for messages
      const sqlStatements = db._runCalls.map((c) => c.sql);
      expect(sqlStatements.some((s) => s.includes('chat_sessions'))).toBe(true);
    });

    it('serializes parts as JSON', async () => {
      const session = createTestSession();
      session.messages = [
        {
          request: { text: 'Test', requestId: 'req-2', participantId: 'parallx.chat.default', attempt: 0, timestamp: Date.now() },
          response: {
            parts: [
              { kind: ChatContentPartKind.Markdown, content: 'Response text' },
              { kind: ChatContentPartKind.Warning, message: 'A warning' },
            ],
            isComplete: true,
          },
        },
      ];

      await saveSession(db, session);

      // Find insert that contains JSON-serialized parts
      const messageInserts = db._runCalls.filter((c) =>
        c.sql.includes('chat_messages') && c.params,
      );
      expect(messageInserts.length).toBeGreaterThan(0);
    });

    it('serializes user request metadata into parts_json', async () => {
      const session = createTestSession();
      session.messages = [
        {
          request: {
            text: 'Hello',
            requestId: 'req-serial',
            participantId: 'parallx.chat.default',
            attachments: [{ kind: 'image', id: 'img-1', name: 'Pasted image', fullPath: 'parallx-image://1', isImplicit: false, mimeType: 'image/png', data: 'abc123' }],
            attempt: 1,
            replayOfRequestId: 'req-0',
            timestamp: Date.now(),
          },
          response: {
            parts: [{ kind: ChatContentPartKind.Markdown, content: 'Hi there!' }],
            isComplete: true,
          },
        },
      ];

      await saveSession(db, session);
      const userInsert = db._runCalls.find((call) => Array.isArray(call.params) && call.params[1] === 'user');
      expect(userInsert).toBeTruthy();
      expect(String(userInsert?.params?.[3])).toContain('req-serial');
      expect(String(userInsert?.params?.[3])).toContain('Pasted image');
    });
  });

  describe('deletePersistedSession', () => {
    it('deletes session by ID', async () => {
      await deletePersistedSession(db, 'session-1');

      const deleteStatements = db._runCalls.filter((c) =>
        c.sql.includes('DELETE') && c.sql.includes('chat_sessions'),
      );
      expect(deleteStatements.length).toBe(1);
      expect(deleteStatements[0].params).toContain('session-1');
    });
  });

  describe('loadSessions', () => {
    it('returns empty array when no sessions exist', async () => {
      const sessions = await loadSessions(db);
      expect(sessions).toEqual([]);
    });

    it('passes workspace_id filter to SQL query', async () => {
      await loadSessions(db, 'ws-abc');
      const selectCalls = db._allCalls.filter((c) => c.sql.includes('chat_sessions'));
      expect(selectCalls.length).toBe(1);
      expect(selectCalls[0].params).toContain('ws-abc');
      expect(selectCalls[0].sql).toContain('workspace_id');
    });

    it('defaults workspace_id to empty string', async () => {
      await loadSessions(db);
      const selectCalls = db._allCalls.filter((c) => c.sql.includes('chat_sessions'));
      expect(selectCalls.length).toBe(1);
      expect(selectCalls[0].params).toContain('');
    });
  });

  describe('workspace scoping', () => {
    it('saveSession includes workspace_id in the insert', async () => {
      const session = createTestSession();
      await saveSession(db, session, 'ws-123');

      const insertCalls = db._runCalls.filter((c) =>
        c.sql.includes('chat_sessions') && c.sql.includes('INSERT'),
      );
      expect(insertCalls.length).toBe(1);
      expect(insertCalls[0].params).toContain('ws-123');
    });

    it('saveSession defaults workspace_id to empty string', async () => {
      const session = createTestSession();
      await saveSession(db, session);

      const insertCalls = db._runCalls.filter((c) =>
        c.sql.includes('chat_sessions') && c.sql.includes('INSERT'),
      );
      expect(insertCalls.length).toBe(1);
      // workspace_id is the second param (after session id)
      expect(insertCalls[0].params![1]).toBe('');
    });

    it('schema includes workspace_id column', async () => {
      await ensureChatTables(db);

      const createSessionSql = db._runCalls
        .map((c) => c.sql)
        .find((s) => s.includes('CREATE TABLE') && s.includes('chat_sessions'));

      expect(createSessionSql).toContain('workspace_id');
    });

    it('schema includes workspace index', async () => {
      await ensureChatTables(db);

      const indexSql = db._runCalls
        .map((c) => c.sql)
        .filter((s) => s.includes('CREATE INDEX') && s.includes('workspace'));

      expect(indexSql.length).toBeGreaterThan(0);
    });

    it('adoptOrphanedSessions only adopts legacy unassigned sessions', async () => {
      db.get = async <T>(sql: string, params?: unknown[]) => {
        db._getCalls.push({ sql, params });
        return { cnt: 2 } as T;
      };

      await adoptOrphanedSessions(db, 'ws-new');

      expect(db._getCalls).toHaveLength(1);
      expect(db._getCalls[0].sql).toContain("workspace_id = ''");

      const updateCalls = db._runCalls.filter((c) => c.sql.includes('UPDATE chat_sessions SET workspace_id'));
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].sql).toContain("workspace_id = ''");
      expect(updateCalls[0].params).toEqual(['ws-new']);
    });
  });
});
