// Unit tests for MemoryService — M10 Phase 5 Tasks 5.1 + 5.2, M17 P1.2

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryService, computeDecayScore } from '../../src/services/memoryService';
import type { ConversationMemory, UserPreference, LearningConcept } from '../../src/services/memoryService';

// ── Mock Database ──

interface MockRow {
  [key: string]: unknown;
}

let _conceptAutoId = 0;

function createMockDb() {
  const tables = new Map<string, MockRow[]>();
  let _isOpen = true;
  _conceptAutoId = 0;

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

      // CREATE INDEX — no-op
      if (sql.includes('CREATE INDEX')) { return; }

      // ALTER TABLE — no-op (migration)
      if (sql.includes('ALTER TABLE')) { return; }

      // INSERT OR REPLACE into conversation_memories
      if (sql.includes('INSERT OR REPLACE INTO conversation_memories')) {
        const p = params ?? [];
        const rows = tables.get('conversation_memories') ?? [];
        const existing = rows.findIndex((r) => r['session_id'] === p[0]);
        const row = {
          session_id: p[0], summary: p[1], message_count: p[2],
          created_at: new Date().toISOString(), last_accessed: new Date().toISOString(),
          importance: 0.5, decay_score: 1.0,
        };
        if (existing >= 0) { rows[existing] = { ...rows[existing], ...row }; } else { rows.push(row); }
        tables.set('conversation_memories', rows);
        return;
      }

      // UPDATE conversation_memories SET decay_score (recalculateDecayScores)
      if (sql.includes('UPDATE conversation_memories SET decay_score') && !sql.includes('last_accessed')) {
        const p = params ?? [];
        const rows = tables.get('conversation_memories') ?? [];
        const idx = rows.findIndex((r) => r['session_id'] === p[1]);
        if (idx >= 0) { rows[idx] = { ...rows[idx], decay_score: p[0] }; }
        return;
      }

      // UPDATE conversation_memories SET last_accessed (recallMemories)
      if (sql.includes('UPDATE conversation_memories SET last_accessed')) {
        const p = params ?? [];
        const rows = tables.get('conversation_memories') ?? [];
        const idx = rows.findIndex((r) => r['session_id'] === p[0]);
        if (idx >= 0) { rows[idx] = { ...rows[idx], last_accessed: new Date().toISOString() }; }
        return;
      }

      // DELETE FROM conversation_memories WHERE session_id (eviction)
      if (sql.includes('DELETE FROM conversation_memories WHERE session_id')) {
        const p = params ?? [];
        const rows = tables.get('conversation_memories') ?? [];
        tables.set('conversation_memories', rows.filter((r) => r['session_id'] !== p[0]));
        return;
      }

      // INSERT INTO learning_concepts (P1.2)
      if (sql.includes('INSERT INTO learning_concepts')) {
        const p = params ?? [];
        _conceptAutoId++;
        const rows = tables.get('learning_concepts') ?? [];
        rows.push({
          id: _conceptAutoId,
          concept: p[0],
          category: p[1],
          summary: p[2],
          mastery_level: p[3],
          encounter_count: 1,
          struggle_count: p[4],
          source_sessions: p[5],
          decay_score: 1.0,
          first_seen: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
        });
        tables.set('learning_concepts', rows);
        return;
      }

      // UPDATE learning_concepts (P1.2)
      if (sql.includes('UPDATE learning_concepts') && sql.includes('WHERE id')) {
        const p = params ?? [];
        const rows = tables.get('learning_concepts') ?? [];
        // Last param is the id for the WHERE clause
        const id = p[p.length - 1] as number;
        const idx = rows.findIndex((r) => r['id'] === id);
        if (idx >= 0) {
          // decay_score-only update (recalculateDecayScores)
          if (sql.includes('decay_score') && !sql.includes('summary') && !sql.includes('last_accessed')) {
            rows[idx] = { ...rows[idx], decay_score: p[0] };
          // last_accessed-only update
          } else if (sql.includes('last_accessed') && !sql.includes('summary')) {
            rows[idx] = { ...rows[idx], last_accessed: new Date().toISOString() };
          } else {
            // Full update
            rows[idx] = {
              ...rows[idx],
              summary: p[0],
              mastery_level: p[1],
              encounter_count: p[2],
              struggle_count: p[3],
              last_seen: new Date().toISOString(),
              source_sessions: p[4],
              decay_score: p[5],
              category: p[6] || rows[idx]['category'],
            };
          }
        }
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
      if (sql.includes('DELETE FROM learning_concepts WHERE id') && params?.length) {
        const rows = tables.get('learning_concepts') ?? [];
        tables.set('learning_concepts', rows.filter((r) => r['id'] !== params![0]));
        return;
      }
      if (sql.includes('DELETE FROM learning_concepts') && !params?.length) {
        tables.set('learning_concepts', []);
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
      if (sql.includes('FROM learning_concepts WHERE LOWER(concept)')) {
        const rows = tables.get('learning_concepts') ?? [];
        const key = String(params?.[0] ?? '').toLowerCase();
        return rows.find((r) => String(r['concept']).toLowerCase() === key) as T | undefined;
      }
      if (sql.includes('FROM user_preferences WHERE key')) {
        const rows = tables.get('user_preferences') ?? [];
        return rows.find((r) => r['key'] === params?.[0]) as T | undefined;
      }
      return undefined;
    },

    async all<T>(sql: string, _params?: unknown[]): Promise<T[]> {
      if (sql.includes('FROM conversation_memories')) {
        const rows = tables.get('conversation_memories') ?? [];
        // Eviction query: filter by julianday condition (mock approximation)
        if (sql.includes('julianday')) {
          // The mock can't evaluate julianday — filter by checking if last_accessed
          // is old enough. For the mock, we'll check against the params (days threshold).
          const daysThreshold = _params?.[0] as number | undefined;
          if (daysThreshold !== undefined) {
            const cutoff = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
            return rows.filter((r) => {
              const accessed = new Date(r['last_accessed'] as string || r['created_at'] as string).getTime();
              const decay = (r['decay_score'] as number) ?? 1.0;
              return accessed < cutoff && decay < 0.1;
            }) as T[];
          }
        }
        return rows as T[];
      }
      if (sql.includes('FROM learning_concepts')) {
        const rows = tables.get('learning_concepts') ?? [];
        // Eviction query for concepts
        if (sql.includes('julianday')) {
          const daysThreshold = _params?.[0] as number | undefined;
          if (daysThreshold !== undefined) {
            const cutoff = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
            return rows.filter((r) => {
              const accessed = new Date(r['last_accessed'] as string || r['first_seen'] as string).getTime();
              const encounter = (r['encounter_count'] as number) ?? 1;
              const decay = (r['decay_score'] as number) ?? 1.0;
              return accessed < cutoff && encounter === 1 && decay < 0.05;
            }) as T[];
          }
        }
        return rows as T[];
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
    async deleteSource(sourceType: string, sourceId: string): Promise<void> {
      // Remove matching entries from storedChunks
      for (let i = storedChunks.length - 1; i >= 0; i--) {
        if (storedChunks[i].sourceType === sourceType && storedChunks[i].sourceId === sourceId) {
          storedChunks.splice(i, 1);
        }
      }
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
      // Return concept chunks if sourceFilter matches (P1.2)
      if (_options?.sourceFilter === 'concept') {
        return storedChunks
          .filter((c) => c.sourceType === 'concept')
          .map((c, i) => ({
            rowid: 100 + i,
            sourceType: 'concept',
            sourceId: c.sourceId,
            chunkIndex: 0,
            chunkText: `Concept ${c.sourceId}`,
            contextPrefix: `[Learning Concept]`,
            score: 0.85 - i * 0.1,
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
    it('returns false for sessions with fewer than 2 messages', () => {
      expect(service.isSessionEligibleForSummary(0)).toBe(false);
      expect(service.isSessionEligibleForSummary(1)).toBe(false);
    });

    it('returns true for sessions with 2 or more messages', () => {
      expect(service.isSessionEligibleForSummary(2)).toBe(true);
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

  // ── M17 Task 1.1.5: getMemoryMessageCount + growth-based re-summarisation ──

  describe('getMemoryMessageCount', () => {
    it('returns null when no memory exists for a session', async () => {
      expect(await service.getMemoryMessageCount('nonexistent')).toBeNull();
    });

    it('returns stored message count after first summary', async () => {
      await service.storeMemory('s-mc', 'first summary', 3);
      expect(await service.getMemoryMessageCount('s-mc')).toBe(3);
    });

    it('returns updated message count after re-summary', async () => {
      await service.storeMemory('s-mc2', 'first summary', 3);
      expect(await service.getMemoryMessageCount('s-mc2')).toBe(3);

      await service.storeMemory('s-mc2', 'updated summary after growth', 6);
      expect(await service.getMemoryMessageCount('s-mc2')).toBe(6);
    });
  });

  describe('growth-based re-summarisation guard logic', () => {
    // Helper that mirrors defaultParticipant's guard logic (M17 Task 1.1.3)
    function shouldResummarize(storedCount: number | null, currentCount: number): boolean {
      return storedCount === null
        || currentCount >= storedCount * 2
        || currentCount >= storedCount + 10;
    }

    it('triggers first summary when no prior memory exists (storedCount === null)', () => {
      expect(shouldResummarize(null, 3)).toBe(true);
    });

    it('does NOT re-summarise when growth is small (5 msgs, stored 3 → <2×)', () => {
      expect(shouldResummarize(3, 5)).toBe(false);
    });

    it('re-summarises when conversation doubles (6 msgs, stored 3 → ≥2×)', () => {
      expect(shouldResummarize(3, 6)).toBe(true);
    });

    it('re-summarises when conversation grows by +10 (13 msgs, stored 3 → ≥3+10)', () => {
      expect(shouldResummarize(3, 13)).toBe(true);
    });

    it('does NOT re-summarise just below both thresholds (stored 8, current 15)', () => {
      expect(shouldResummarize(8, 15)).toBe(false); // 15 < 16 (2×) and 15 < 18 (+10)
    });

    it('re-summarises when +10 fires before 2× (stored 8, current 18)', () => {
      expect(shouldResummarize(8, 18)).toBe(true); // 18 ≥ 8+10
    });

    it('storeMemory updates existing row (re-summary path)', async () => {
      await service.storeMemory('s-grow', 'initial summary', 3);
      const firstHas = await service.hasMemory('s-grow');
      expect(firstHas).toBe(true);

      // Simulate growth-based re-summary
      await service.storeMemory('s-grow', 'updated summary covering more context', 6);
      const count = await service.getMemoryMessageCount('s-grow');
      expect(count).toBe(6);

      // Vector store should have 2 upserts (initial + update)
      const memoryUpserts = vectorStore._storedChunks.filter((c) => c.sourceId === 's-grow');
      expect(memoryUpserts.length).toBe(2);
    });
  });

  // ── M17 P1.2 Task 1.2.9: Concept-level memory tests ──

  describe('storeConcepts', () => {
    it('creates a new concept row on first store', async () => {
      await service.storeConcepts([
        { concept: 'Prophase I', category: 'biology', summary: 'First stage of meiosis I',
          masteryLevel: 0, encounterCount: 1, struggleCount: 0, firstSeen: '', lastSeen: '',
          lastAccessed: '', sourceSessions: '[]', decayScore: 1.0 },
      ], 'session-1');

      // Check DB has the row
      const row = await db.get<{ concept: string; encounter_count: number }>(
        'SELECT * FROM learning_concepts WHERE LOWER(concept) = ?',
        ['prophase i'],
      );
      expect(row).toBeDefined();
      expect(row!.encounter_count).toBe(1);

      // Check vector store received upsert
      const conceptUpserts = vectorStore._storedChunks.filter((c) => c.sourceType === 'concept');
      expect(conceptUpserts.length).toBe(1);
    });

    it('increments encounter_count on second store of same concept', async () => {
      const concept = {
        concept: 'Krebs Cycle', category: 'biology', summary: 'Citric acid cycle basics',
        masteryLevel: 0, encounterCount: 1, struggleCount: 0, firstSeen: '', lastSeen: '',
        lastAccessed: '', sourceSessions: '[]', decayScore: 1.0,
      };

      await service.storeConcepts([concept], 'session-1');
      await service.storeConcepts([{ ...concept, summary: 'A deeper understanding of the Krebs cycle pathway' }], 'session-2');

      const row = await db.get<{ encounter_count: number; summary: string; source_sessions: string }>(
        'SELECT * FROM learning_concepts WHERE LOWER(concept) = ?',
        ['krebs cycle'],
      );
      expect(row).toBeDefined();
      expect(row!.encounter_count).toBe(2);
      // Longer summary should win
      expect(row!.summary).toContain('deeper understanding');
      // Both sessions should be tracked
      const sessions = JSON.parse(row!.source_sessions);
      expect(sessions).toContain('session-1');
      expect(sessions).toContain('session-2');
    });

    it('decrements mastery when user struggles', async () => {
      const concept = {
        concept: 'Meiosis', category: 'biology', summary: 'Cell division',
        masteryLevel: 0.5, encounterCount: 1, struggleCount: 0, firstSeen: '', lastSeen: '',
        lastAccessed: '', sourceSessions: '[]', decayScore: 1.0,
      };

      await service.storeConcepts([concept], 'session-1');

      // Second encounter with struggle
      await service.storeConcepts([{ ...concept, struggleCount: 1 }], 'session-2');

      const row = await db.get<{ mastery_level: number; struggle_count: number }>(
        'SELECT * FROM learning_concepts WHERE LOWER(concept) = ?',
        ['meiosis'],
      );
      expect(row).toBeDefined();
      // First store to 0.5, struggle reduces by 0.05 → but initial store uses provided masteryLevel
      // After first store: mastery_level = 0.5 (from param). After struggle: 0.5 - 0.05 = 0.45
      expect(row!.mastery_level).toBeCloseTo(0.45, 2);
      expect(row!.struggle_count).toBe(1);
    });

    it('is case-insensitive for concept matching', async () => {
      const concept = {
        concept: 'DNA Replication', category: 'biology', summary: 'How DNA copies',
        masteryLevel: 0, encounterCount: 1, struggleCount: 0, firstSeen: '', lastSeen: '',
        lastAccessed: '', sourceSessions: '[]', decayScore: 1.0,
      };

      await service.storeConcepts([concept], 'session-1');
      await service.storeConcepts([{ ...concept, concept: 'dna replication' }], 'session-2');

      // Should have only 1 concept upserted twice in DB
      const row = await db.get<{ encounter_count: number }>(
        'SELECT * FROM learning_concepts WHERE LOWER(concept) = ?',
        ['dna replication'],
      );
      expect(row).toBeDefined();
      expect(row!.encounter_count).toBe(2);
    });
  });

  describe('recallConcepts', () => {
    it('returns empty array for empty query', async () => {
      const result = await service.recallConcepts('');
      expect(result).toEqual([]);
    });

    it('retrieves stored concepts via vector search', async () => {
      await service.storeConcepts([
        { concept: 'Mitosis', category: 'biology', summary: 'Cell division into identical cells',
          masteryLevel: 0.3, encounterCount: 2, struggleCount: 1, firstSeen: '', lastSeen: '',
          lastAccessed: '', sourceSessions: '[]', decayScore: 1.0 },
      ], 'session-1');

      const concepts = await service.recallConcepts('cell division process');
      expect(concepts.length).toBeGreaterThan(0);
      expect(concepts[0].concept).toBe('Mitosis');
      expect(concepts[0].masteryLevel).toBeDefined();
    });
  });

  describe('formatConceptContext', () => {
    it('returns empty string for no concepts', () => {
      expect(service.formatConceptContext([])).toBe('');
    });

    it('formats concepts into a readable block', () => {
      const now = new Date().toISOString();
      const concepts: LearningConcept[] = [
        { id: 1, concept: 'Prophase I', category: 'biology', summary: 'First stage of meiosis',
          masteryLevel: 0.3, encounterCount: 4, struggleCount: 2, firstSeen: now,
          lastSeen: now, lastAccessed: now, sourceSessions: '["s1","s2"]', decayScore: 1.0 },
      ];

      const formatted = service.formatConceptContext(concepts);

      expect(formatted).toContain('[Prior knowledge');
      expect(formatted).toContain('Prophase I');
      expect(formatted).toContain('biology');
      expect(formatted).toContain('encountered 4×');
      expect(formatted).toContain('struggles noted');
      expect(formatted).toContain('Mastery: 0.3/1.0');
    });
  });

  // ── M17 P1.3 Task 1.3.7: Decay & eviction tests ──

  describe('computeDecayScore', () => {
    it('returns ~baseImportance at t=0 (just now)', () => {
      const now = new Date().toISOString();
      const score = computeDecayScore(now, 1.0);
      expect(score).toBeCloseTo(1.0, 1);
    });

    it('returns ~0.5 at half-life (~23 days) with base=1.0', () => {
      const halfLifeAgo = new Date(Date.now() - 23 * 24 * 60 * 60 * 1000).toISOString();
      const score = computeDecayScore(halfLifeAgo, 1.0);
      expect(score).toBeCloseTo(0.5, 1);
    });

    it('is near zero at 90 days with base=1.0', () => {
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const score = computeDecayScore(ninetyDaysAgo, 1.0);
      expect(score).toBeLessThan(0.1);
    });

    it('scales with base importance', () => {
      const now = new Date().toISOString();
      expect(computeDecayScore(now, 0.5)).toBeCloseTo(0.5, 1);
      expect(computeDecayScore(now, 0.2)).toBeCloseTo(0.2, 1);
    });
  });

  describe('recalculateDecayScores', () => {
    it('runs without error on empty tables', async () => {
      await expect(service.recalculateDecayScores()).resolves.not.toThrow();
    });
  });

  describe('evictStaleContent', () => {
    it('returns zero evictions for fresh content', async () => {
      await service.storeMemory('fresh-1', 'recent discussion', 3);
      const result = await service.evictStaleContent();
      expect(result.memoriesEvicted).toBe(0);
      expect(result.conceptsEvicted).toBe(0);
    });

    it('runs without error on empty database', async () => {
      const result = await service.evictStaleContent();
      expect(result.memoriesEvicted).toBe(0);
      expect(result.conceptsEvicted).toBe(0);
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

    it('cleans up vector store entries on clearAll', async () => {
      await service.storeMemory('s-vec-1', 'summary one', 3);
      await service.storeMemory('s-vec-2', 'summary two', 4);

      // Vector store should have entries before clear
      expect(vectorStore._storedChunks.filter(c => c.sourceType === 'memory').length).toBeGreaterThan(0);

      await service.clearAll();

      // Vector store entries for memories should be cleaned up
      const remaining = vectorStore._storedChunks.filter(c => c.sourceType === 'memory');
      expect(remaining).toEqual([]);
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
