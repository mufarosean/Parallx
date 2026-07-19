// Unit tests for chatSessionPersistence.ts — M9.2 Cap 9 Task 9.1

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ensureChatTables,
  saveSession,
  loadSessions,
  loadSessionMetas,
  loadSessionMessages,
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

    async runTransaction(operations: Array<{ type: string; sql: string; params?: unknown[] }>): Promise<unknown[]> {
      for (const op of operations) {
        db._runCalls.push({ sql: op.sql, params: op.params });
      }
      return operations.map(() => ({ changes: 0 }));
    },

    isOpen: true,
  };

  return db;
}

function createTestSession(): IChatSession {
  return {
    id: 'test-session-1',
    title: 'Test Session',
    mode: ChatMode.Agent,
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

    it('collapses duplicated replay chains when restoring sessions', async () => {
      db.all = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
        db._allCalls.push({ sql, params });

        if (sql.includes('FROM chat_sessions')) {
          return [{
            id: 'session-1',
            title: 'Session',
            mode: 'agent',
            model_id: 'qwen',
            created_at: 1,
            updated_at: 2,
          }] as T[];
        }

        if (sql.includes('FROM chat_messages')) {
          return [
            {
              role: 'user',
              content: 'Hello',
              parts_json: JSON.stringify({ requestId: 'req-1', attempt: 0 }),
              model_id: '',
              is_complete: 1,
              timestamp: 10,
              sort_order: 0,
            },
            {
              role: 'assistant',
              content: 'Original answer',
              parts_json: JSON.stringify([{ kind: ChatContentPartKind.Markdown, content: 'Original answer' }]),
              model_id: 'qwen',
              is_complete: 1,
              timestamp: 11,
              sort_order: 1,
            },
            {
              role: 'user',
              content: 'Hello',
              parts_json: JSON.stringify({ requestId: 'req-2', attempt: 1, replayOfRequestId: 'req-1' }),
              model_id: '',
              is_complete: 1,
              timestamp: 12,
              sort_order: 2,
            },
            {
              role: 'assistant',
              content: 'Regenerated answer',
              parts_json: JSON.stringify([{ kind: ChatContentPartKind.Markdown, content: 'Regenerated answer' }]),
              model_id: 'qwen',
              is_complete: 1,
              timestamp: 13,
              sort_order: 3,
            },
            {
              role: 'user',
              content: 'What next?',
              parts_json: JSON.stringify({ requestId: 'req-3', attempt: 0 }),
              model_id: '',
              is_complete: 1,
              timestamp: 14,
              sort_order: 4,
            },
            {
              role: 'assistant',
              content: 'Next answer',
              parts_json: JSON.stringify([{ kind: ChatContentPartKind.Markdown, content: 'Next answer' }]),
              model_id: 'qwen',
              is_complete: 1,
              timestamp: 15,
              sort_order: 5,
            },
          ] as T[];
        }

        return [];
      };

      const sessions = await loadSessions(db, 'ws-1');

      expect(sessions).toHaveLength(1);
      expect(sessions[0].messages).toHaveLength(2);
      expect(sessions[0].messages[0].request.requestId).toBe('req-2');
      expect(sessions[0].messages[0].request.replayOfRequestId).toBe('req-1');
      expect(sessions[0].messages[0].response.parts[0]).toMatchObject({
        kind: ChatContentPartKind.Markdown,
        content: 'Regenerated answer',
      });
      expect(sessions[0].messages[1].request.requestId).toBe('req-3');
    });

    it('persists the healed session back to storage after collapsing replay chains', async () => {
      db.all = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
        db._allCalls.push({ sql, params });

        if (sql.includes('FROM chat_sessions')) {
          return [{
            id: 'session-1',
            title: 'Session',
            mode: 'agent',
            model_id: 'qwen',
            created_at: 1,
            updated_at: 2,
          }] as T[];
        }

        if (sql.includes('FROM chat_messages')) {
          return [
            {
              role: 'user',
              content: 'Hello',
              parts_json: JSON.stringify({ requestId: 'req-1', attempt: 0 }),
              model_id: '',
              is_complete: 1,
              timestamp: 10,
              sort_order: 0,
            },
            {
              role: 'assistant',
              content: 'Original answer',
              parts_json: JSON.stringify([{ kind: ChatContentPartKind.Markdown, content: 'Original answer' }]),
              model_id: 'qwen',
              is_complete: 1,
              timestamp: 11,
              sort_order: 1,
            },
            {
              role: 'user',
              content: 'Hello',
              parts_json: JSON.stringify({ requestId: 'req-2', attempt: 1, replayOfRequestId: 'req-1' }),
              model_id: '',
              is_complete: 1,
              timestamp: 12,
              sort_order: 2,
            },
            {
              role: 'assistant',
              content: 'Regenerated answer',
              parts_json: JSON.stringify([{ kind: ChatContentPartKind.Markdown, content: 'Regenerated answer' }]),
              model_id: 'qwen',
              is_complete: 1,
              timestamp: 13,
              sort_order: 3,
            },
          ] as T[];
        }

        return [];
      };

      await loadSessions(db, 'ws-1');

      expect(db._runCalls.some((call) => call.sql.includes('DELETE FROM chat_messages WHERE session_id = ?'))).toBe(true);
      expect(db._runCalls.filter((call) => call.sql.includes('INSERT INTO chat_messages')).length).toBe(2);
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

  // ── Deferred hydration (startup fast path) ──

  describe('loadSessionMetas', () => {
    function stubSessionRows(): void {
      db.all = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
        db._allCalls.push({ sql, params });

        if (sql.includes('FROM chat_sessions')) {
          return [
            { id: 'session-1', title: 'S1', mode: 'agent', model_id: 'qwen', context_window_override: null, plan_json: null, created_at: 1, updated_at: 2 },
            { id: 'session-2', title: 'New Chat', mode: 'agent', model_id: 'qwen', context_window_override: null, plan_json: null, created_at: 3, updated_at: 4 },
          ] as T[];
        }

        if (sql.includes('FROM chat_messages')) {
          // Preview aggregate — only session-1 has persisted messages
          return [{ session_id: 'session-1', preview: 'How do I study reserving?' }] as T[];
        }

        return [];
      };
    }

    it('issues no per-session message queries (fixed 2-query cost)', async () => {
      stubSessionRows();
      await loadSessionMetas(db, 'ws-1');

      // One chat_sessions query + one aggregate preview query — regardless
      // of session count. The old loadSessions path was 1 + N.
      expect(db._allCalls.length).toBe(2);
      expect(db._allCalls[1].sql).toContain('GROUP BY session_id');
    });

    it('flags sessions with persisted messages as pending-load with a preview', async () => {
      stubSessionRows();
      const sessions = await loadSessionMetas(db, 'ws-1');

      expect(sessions).toHaveLength(2);
      const s1 = sessions.find((s) => s.id === 'session-1')!;
      expect(s1.messagesPendingLoad).toBe(true);
      expect(s1.previewText).toBe('How do I study reserving?');
      expect(s1.messages).toHaveLength(0);
    });

    it('leaves message-less sessions unflagged (empty array is already truth)', async () => {
      stubSessionRows();
      const sessions = await loadSessionMetas(db, 'ws-1');

      const s2 = sessions.find((s) => s.id === 'session-2')!;
      expect(s2.messagesPendingLoad).toBeUndefined();
      expect(s2.previewText).toBeUndefined();
    });
  });

  describe('loadSessionMessages', () => {
    it('reconstructs and normalizes pairs for one session', async () => {
      db.all = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
        db._allCalls.push({ sql, params });
        if (sql.includes('FROM chat_messages')) {
          return [
            { role: 'user', content: 'Hello', parts_json: JSON.stringify({ requestId: 'req-1', attempt: 0 }), model_id: '', is_complete: 1, timestamp: 10, sort_order: 0 },
            { role: 'assistant', content: 'Hi', parts_json: JSON.stringify([{ kind: ChatContentPartKind.Markdown, content: 'Hi' }]), model_id: 'qwen', is_complete: 1, timestamp: 11, sort_order: 1 },
          ] as T[];
        }
        return [];
      };

      const { messages, changed } = await loadSessionMessages(db, 'session-1');

      expect(changed).toBe(false);
      expect(messages).toHaveLength(1);
      expect(messages[0].request.requestId).toBe('req-1');
      expect(messages[0].response.parts[0]).toMatchObject({ kind: ChatContentPartKind.Markdown, content: 'Hi' });
      expect(db._allCalls[0].params).toContain('session-1');
    });
  });

  describe('saveSession while messagesPendingLoad', () => {
    it('writes only the session row — never touches chat_messages', async () => {
      const session = createTestSession();
      session.title = 'Renamed while unhydrated';
      session.messagesPendingLoad = true;
      // messages: [] is the un-loaded placeholder — a full save would DELETE
      // every persisted message and insert nothing (history wipe).

      await saveSession(db, session, 'ws-1');

      const sqls = db._runCalls.map((c) => c.sql);
      expect(sqls.some((s) => s.includes('chat_sessions'))).toBe(true);
      expect(sqls.some((s) => s.includes('chat_messages'))).toBe(false);

      const insert = db._runCalls.find((c) => c.sql.includes('chat_sessions'))!;
      expect(insert.params).toContain('Renamed while unhydrated');
      expect(insert.params).toContain('ws-1');
    });

    it('rewrites messages normally once the flag is cleared', async () => {
      const session = createTestSession();
      session.messagesPendingLoad = false;
      session.messages = [
        {
          request: { text: 'Hello', requestId: 'req-1', participantId: 'parallx.chat.default', attempt: 0, timestamp: Date.now() },
          response: { parts: [{ kind: ChatContentPartKind.Markdown, content: 'Hi' }], isComplete: true },
        },
      ];

      await saveSession(db, session, 'ws-1');

      const sqls = db._runCalls.map((c) => c.sql);
      expect(sqls.some((s) => s.includes('DELETE FROM chat_messages'))).toBe(true);
      expect(sqls.some((s) => s.includes('INSERT INTO chat_messages'))).toBe(true);
    });
  });

  // ── M85: durable session plan (the planning organ) ──

  describe('session plan persistence', () => {
    it('schema includes plan_json column', async () => {
      await ensureChatTables(db);
      const createSessionSql = db._runCalls
        .map((c) => c.sql)
        .find((s) => s.includes('CREATE TABLE') && s.includes('chat_sessions'));
      expect(createSessionSql).toContain('plan_json');
    });

    it('saveSession serializes the plan into plan_json', async () => {
      const session = createTestSession();
      session.plan = {
        goal: 'Ship it',
        steps: [{ text: 'one', status: 'done' }, { text: 'two', status: 'active' }],
        note: 'two is in flight',
        updatedAt: 42,
      };
      await saveSession(db, session, 'ws-1');

      const insertCalls = db._runCalls.filter((c) =>
        c.sql.includes('chat_sessions') && c.sql.includes('INSERT'),
      );
      expect(insertCalls.length).toBe(1);
      expect(insertCalls[0].sql).toContain('plan_json');
      const planParam = (insertCalls[0].params as unknown[]).find(
        (p) => typeof p === 'string' && (p as string).includes('"goal":"Ship it"'),
      );
      expect(planParam).toBeDefined();
      expect(JSON.parse(planParam as string).steps).toHaveLength(2);
    });

    it('saveSession writes null plan_json when no plan', async () => {
      const session = createTestSession();
      await saveSession(db, session, 'ws-1');
      const insertCalls = db._runCalls.filter((c) =>
        c.sql.includes('chat_sessions') && c.sql.includes('INSERT'),
      );
      // plan_json is the 7th param (index 6): id, workspace, title, mode,
      // model, ctx-override, plan_json, created, updated
      expect((insertCalls[0].params as unknown[])[6]).toBeNull();
    });

    it('loadSessions hydrates the plan from plan_json', async () => {
      db.all = async <T>(sql: string): Promise<T[]> => {
        if (sql.includes('FROM chat_sessions')) {
          return [{
            id: 'session-1',
            title: 'S',
            mode: 'agent',
            model_id: 'qwen',
            context_window_override: null,
            plan_json: JSON.stringify({ goal: 'G', steps: [{ text: 'a', status: 'pending' }], updatedAt: 7 }),
            created_at: 1,
            updated_at: 2,
          }] as T[];
        }
        return [];
      };

      const sessions = await loadSessions(db, 'ws-1');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].plan?.goal).toBe('G');
      expect(sessions[0].plan?.steps).toHaveLength(1);
    });

    it('loadSessions tolerates corrupt plan_json', async () => {
      db.all = async <T>(sql: string): Promise<T[]> => {
        if (sql.includes('FROM chat_sessions')) {
          return [{
            id: 'session-1',
            title: 'S',
            mode: 'agent',
            model_id: 'qwen',
            context_window_override: null,
            plan_json: '{not valid json',
            created_at: 1,
            updated_at: 2,
          }] as T[];
        }
        return [];
      };

      const sessions = await loadSessions(db, 'ws-1');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].plan).toBeUndefined();
    });
  });
});
