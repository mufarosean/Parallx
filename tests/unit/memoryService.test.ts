// Unit tests for MemoryService — M10 Phase 5 Tasks 5.1 + 5.2

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryService } from '../../src/services/memoryService';
import type { ConversationMemory, UserPreference } from '../../src/services/memoryService';

// ── Mock Database ──

interface MockRow {
  [key: string]: unknown;
}

function createMockDb() {
  const tables = new Map<string, MockRow[]>();
  let _isOpen = true;

  return {
    get isOpen() { return _isOpen; },
    set isOpen(v: boolean) { _isOpen = v; },
    _tables: tables,

    async run(sql: string, params?: unknown[]): Promise<void> {
      // CREATE TABLE — initialise empty table if not exists
      const createMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
      if (createMatch) {
        const name = createMatch[1];
        if (!tables.has(name)) { tables.set(name, []); }
        return;
      }

      // INSERT OR REPLACE into conversation_memories
      if (sql.includes('INSERT OR REPLACE INTO conversation_memories')) {
        const p = params ?? [];
        const rows = tables.get('conversation_memories') ?? [];
        const existing = rows.findIndex((r) => r['session_id'] === p[0]);
        const row = { session_id: p[0], summary: p[1], message_count: p[2], created_at: new Date().toISOString() };
        if (existing >= 0) { rows[existing] = row; } else { rows.push(row); }
        tables.set('conversation_memories', rows);
        return;
      }

      // INSERT INTO user_preferences
      if (sql.includes('INSERT INTO user_preferences')) {
        const p = params ?? [];
        const rows = tables.get('user_preferences') ?? [];
        rows.push({ key: p[0], value: p[1], frequency: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        tables.set('user_preferences', rows);
        return;
      }

      // UPDATE user_preferences
      if (sql.includes('UPDATE user_preferences')) {
        const p = params ?? [];
        const rows = tables.get('user_preferences') ?? [];
        const idx = rows.findIndex((r) => r['key'] === p[1]);
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], value: p[0], frequency: (rows[idx]['frequency'] as number) + 1, updated_at: new Date().toISOString() };
        }
        return;
      }

      // DELETE
      if (sql.includes('DELETE FROM conversation_memories') && !params?.length) {
        tables.set('conversation_memories', []);
        return;
      }
      if (sql.includes('DELETE FROM user_preferences') && params?.length) {
        const rows = tables.get('user_preferences') ?? [];
        tables.set('user_preferences', rows.filter((r) => r['key'] !== params![0]));
        return;
      }
      if (sql.includes('DELETE FROM user_preferences') && !params?.length) {
        tables.set('user_preferences', []);
        return;
      }
    },

    async get<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
      if (sql.includes('FROM conversation_memories WHERE session_id')) {
        const rows = tables.get('conversation_memories') ?? [];
        return rows.find((r) => r['session_id'] === params?.[0]) as T | undefined;
      }
      if (sql.includes('FROM user_preferences WHERE key')) {
        const rows = tables.get('user_preferences') ?? [];
        return rows.find((r) => r['key'] === params?.[0]) as T | undefined;
      }
      return undefined;
    },

    async all<T>(sql: string, _params?: unknown[]): Promise<T[]> {
      if (sql.includes('FROM conversation_memories')) {
        return (tables.get('conversation_memories') ?? []) as T[];
      }
      if (sql.includes('FROM user_preferences')) {
        return (tables.get('user_preferences') ?? []) as T[];
      }
      return [];
    },
  };
}

// ── Mock Embedding Service ──

function createMockEmbeddingService() {
  return {
    dispose: vi.fn(),
    async embedQuery(_text: string): Promise<number[]> {
      return new Array(768).fill(0.1);
    },
    async embedDocument(_text: string): Promise<number[]> {
      return new Array(768).fill(0.2);
    },
    async embedDocumentBatch(_texts: string[]): Promise<number[][]> {
      return _texts.map(() => new Array(768).fill(0.2));
    },
  };
}

// ── Mock Vector Store ──

function createMockVectorStore() {
  const storedChunks: { sourceType: string; sourceId: string; chunks: unknown[] }[] = [];

  return {
    dispose: vi.fn(),
    _storedChunks: storedChunks,
    async upsert(sourceType: string, sourceId: string, chunks: unknown[], _contentHash: string): Promise<void> {
      storedChunks.push({ sourceType, sourceId, chunks });
    },
    async search(
      _embedding: number[],
      _queryText: string,
      _options?: { topK?: number; sourceFilter?: string; includeKeyword?: boolean },
    ): Promise<{ rowid: number; sourceType: string; sourceId: string; chunkIndex: number; chunkText: string; contextPrefix: string; score: number; sources: string }[]> {
      // Return memory chunks if sourceFilter matches
      if (_options?.sourceFilter === 'memory') {
        return storedChunks
          .filter((c) => c.sourceType === 'memory')
          .map((c, i) => ({
            rowid: i + 1,
            sourceType: 'memory',
            sourceId: c.sourceId,
            chunkIndex: 0,
            chunkText: `Summary for session ${c.sourceId}`,
            contextPrefix: `[Conversation Memory — Session ${c.sourceId.slice(0, 8)}]`,
            score: 0.9 - i * 0.1,
            sources: 'vector',
          }));
      }
      return [];
    },
  };
}

// ── Test Suite ──

describe('MemoryService', () => {
  let db: ReturnType<typeof createMockDb>;
  let embeddingService: ReturnType<typeof createMockEmbeddingService>;
  let vectorStore: ReturnType<typeof createMockVectorStore>;
  let service: MemoryService;

  beforeEach(() => {
    db = createMockDb();
    embeddingService = createMockEmbeddingService();
    vectorStore = createMockVectorStore();
    service = new MemoryService(db as any, embeddingService as any, vectorStore as any);
  });

  // ── Task 5.1: Conversation Memory ──

  describe('isSessionEligibleForSummary', () => {
    it('returns false for sessions with fewer than 3 messages', () => {
      expect(service.isSessionEligibleForSummary(0)).toBe(false);
      expect(service.isSessionEligibleForSummary(1)).toBe(false);
      expect(service.isSessionEligibleForSummary(2)).toBe(false);
    });

    it('returns true for sessions with 3 or more messages', () => {
      expect(service.isSessionEligibleForSummary(3)).toBe(true);
      expect(service.isSessionEligibleForSummary(10)).toBe(true);
    });
  });

  describe('storeMemory', () => {
    it('stores a summary in the database and vector store', async () => {
      await service.storeMemory('session-1', 'User discussed TypeScript patterns', 5);

      // DB should have the memory
      const has = await service.hasMemory('session-1');
      expect(has).toBe(true);

      // Vector store should have received an upsert
      expect(vectorStore._storedChunks.length).toBe(1);
      expect(vectorStore._storedChunks[0].sourceType).toBe('memory');
      expect(vectorStore._storedChunks[0].sourceId).toBe('session-1');
    });

    it('fires onDidUpdateMemory event', async () => {
      const events: string[] = [];
      service.onDidUpdateMemory((id) => events.push(id));

      await service.storeMemory('s-1', 'summary text', 3);

      expect(events).toEqual(['s-1']);
    });
  });

  describe('hasMemory', () => {
    it('returns false when no memory exists', async () => {
      expect(await service.hasMemory('nonexistent')).toBe(false);
    });

    it('returns true after storing a memory', async () => {
      await service.storeMemory('s-2', 'discussion about RAG', 4);
      expect(await service.hasMemory('s-2')).toBe(true);
    });
  });

  describe('recallMemories', () => {
    it('returns empty array for empty query', async () => {
      const result = await service.recallMemories('');
      expect(result).toEqual([]);
    });

    it('retrieves stored memories via vector search', async () => {
      await service.storeMemory('s-3', 'discussion about embeddings', 5);

      const memories = await service.recallMemories('embedding models');
      expect(memories.length).toBeGreaterThan(0);
      expect(memories[0].sessionId).toBe('s-3');
    });
  });

  describe('formatMemoryContext', () => {
    it('returns empty string for no memories', () => {
      expect(service.formatMemoryContext([])).toBe('');
    });

    it('formats memories into a readable block', () => {
      const memories: ConversationMemory[] = [
        { sessionId: 's-1', summary: 'Discussed TypeScript interfaces', messageCount: 5, createdAt: '2025-01-15' },
        { sessionId: 's-2', summary: 'Explored RAG architecture', messageCount: 8, createdAt: '2025-01-16' },
      ];

      const formatted = service.formatMemoryContext(memories);

      expect(formatted).toContain('[Conversation Memory]');
      expect(formatted).toContain('Discussed TypeScript interfaces');
      expect(formatted).toContain('Explored RAG architecture');
      expect(formatted).toContain('2025-01-15');
    });
  });

  describe('getAllMemories', () => {
    it('returns all stored memories', async () => {
      await service.storeMemory('s-a', 'First session', 3);
      await service.storeMemory('s-b', 'Second session', 4);

      const all = await service.getAllMemories();
      expect(all.length).toBe(2);
    });
  });

  // ── Task 5.2: User Preference Learning ──

  describe('extractAndStorePreferences', () => {
    it('detects "I prefer" patterns', async () => {
      const prefs = await service.extractAndStorePreferences('I prefer TypeScript over JavaScript.');
      expect(prefs.length).toBeGreaterThan(0);
      expect(prefs[0].value).toContain('TypeScript');
    });

    it('detects "always use" patterns', async () => {
      const prefs = await service.extractAndStorePreferences('Always use functional components.');
      expect(prefs.length).toBeGreaterThan(0);
      expect(prefs[0].value).toContain('functional components');
    });

    it('detects "default to" patterns', async () => {
      const prefs = await service.extractAndStorePreferences('Default to dark theme.');
      expect(prefs.length).toBeGreaterThan(0);
    });

    it('returns empty array for text without preferences', async () => {
      const prefs = await service.extractAndStorePreferences('Hello, how are you?');
      expect(prefs).toEqual([]);
    });

    it('increments frequency on repeated preferences', async () => {
      await service.extractAndStorePreferences('I prefer TypeScript.');
      const second = await service.extractAndStorePreferences('I prefer TypeScript.');
      expect(second.length).toBeGreaterThan(0);
      expect(second[0].frequency).toBe(2);
    });

    it('fires onDidUpdatePreferences event', async () => {
      const events: UserPreference[] = [];
      service.onDidUpdatePreferences((pref) => events.push(pref));

      await service.extractAndStorePreferences('I prefer dark mode.');

      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('getPreferences', () => {
    it('returns empty array when no preferences exist', async () => {
      expect(await service.getPreferences()).toEqual([]);
    });

    it('returns stored preferences ordered by frequency', async () => {
      // Store two preferences
      await service.extractAndStorePreferences('I prefer TypeScript.');
      await service.extractAndStorePreferences('I prefer TypeScript.'); // bump frequency
      await service.extractAndStorePreferences('Always use ESLint.');

      const prefs = await service.getPreferences();
      expect(prefs.length).toBe(2);
    });
  });

  describe('formatPreferencesForPrompt', () => {
    it('returns empty string for no preferences', () => {
      expect(service.formatPreferencesForPrompt([])).toBe('');
    });

    it('includes confirmed preferences (frequency >= 2)', () => {
      const prefs: UserPreference[] = [
        { key: 'preference_typescript', value: 'TypeScript', frequency: 3, createdAt: '2025-01-15', updatedAt: '2025-01-16' },
        { key: 'preference_dark', value: 'dark mode', frequency: 1, createdAt: '2025-01-15', updatedAt: '2025-01-15' },
      ];

      const formatted = service.formatPreferencesForPrompt(prefs);

      expect(formatted).toContain('User preferences');
      expect(formatted).toContain('TypeScript');
      // Frequency < 2 should be excluded when confirmed ones exist
      expect(formatted).not.toContain('dark mode');
    });

    it('falls back to recent preferences when none are confirmed', () => {
      const prefs: UserPreference[] = [
        { key: 'preference_a', value: 'value A', frequency: 1, createdAt: '2025-01-15', updatedAt: '2025-01-15' },
      ];

      const formatted = service.formatPreferencesForPrompt(prefs);
      expect(formatted).toContain('value A');
    });
  });

  describe('deletePreference', () => {
    it('removes a specific preference', async () => {
      await service.extractAndStorePreferences('I prefer TypeScript.');
      const before = await service.getPreferences();
      expect(before.length).toBeGreaterThan(0);

      await service.deletePreference(before[0].key);
      const after = await service.getPreferences();
      expect(after.length).toBe(0);
    });
  });

  describe('clearAll', () => {
    it('removes all memories and preferences', async () => {
      await service.storeMemory('s-1', 'test summary', 3);
      await service.extractAndStorePreferences('I prefer TypeScript.');

      await service.clearAll();

      const memories = await service.getAllMemories();
      const prefs = await service.getPreferences();
      expect(memories).toEqual([]);
      expect(prefs).toEqual([]);
    });
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('handles database not open gracefully', async () => {
      db.isOpen = false;
      // Should not throw — just return defaults
      const eligible = service.isSessionEligibleForSummary(5);
      expect(eligible).toBe(true); // This is a pure function, no DB needed

      // DB-dependent methods should return empty/false
      const memories = await service.recallMemories('test');
      expect(memories).toEqual([]);
    });

    it('ignores very short preference values', async () => {
      const prefs = await service.extractAndStorePreferences('I prefer X.'); // "X" is only 1 char
      expect(prefs).toEqual([]);
    });

    it('ignores very long text without preference patterns', async () => {
      const longText = 'This is a really long message about various topics ' +
        'that does not contain any preference patterns whatsoever. '.repeat(20);
      const prefs = await service.extractAndStorePreferences(longText);
      expect(prefs).toEqual([]);
    });
  });
});
