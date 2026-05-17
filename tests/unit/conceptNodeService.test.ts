import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Emitter } from '../../src/platform/events.js';
import {
  ConceptNodeService,
  cleanLabel,
} from '../../src/services/conceptNodeService.js';
import { MindMapRefreshOrchestrator } from '../../src/services/mindMapRefreshOrchestrator.js';

// ── cleanLabel (pure helper) ──────────────────────────────────────────

describe('cleanLabel', () => {
  it('returns the label unchanged when already clean', () => {
    expect(cleanLabel('Existentialism')).toBe('Existentialism');
    expect(cleanLabel('Bayesian Statistics')).toBe('Bayesian Statistics');
  });

  it('strips wrapping quotes', () => {
    expect(cleanLabel('"Existentialism"')).toBe('Existentialism');
    expect(cleanLabel("'Bayesian Statistics'")).toBe('Bayesian Statistics');
    expect(cleanLabel('`Topic`')).toBe('Topic');
  });

  it('strips trailing punctuation', () => {
    expect(cleanLabel('Existentialism.')).toBe('Existentialism');
    expect(cleanLabel('Topic,')).toBe('Topic');
    expect(cleanLabel('Topic!')).toBe('Topic');
  });

  it('takes only the first non-empty line', () => {
    expect(cleanLabel('Existentialism\nA branch of philosophy.')).toBe('Existentialism');
    expect(cleanLabel('\n\nTopic\n')).toBe('Topic');
  });

  it('returns "Unlabelled cluster" on empty input', () => {
    expect(cleanLabel('')).toBe('Unlabelled cluster');
    expect(cleanLabel('   ')).toBe('Unlabelled cluster');
  });

  it('returns "Unlabelled cluster" on non-string input', () => {
    expect(cleanLabel(undefined as any)).toBe('Unlabelled cluster');
    expect(cleanLabel(null as any)).toBe('Unlabelled cluster');
  });

  it('truncates labels longer than 50 chars', () => {
    const long = 'This is an extremely long topic name that goes on and on past the limit';
    const out = cleanLabel(long);
    expect(out.length).toBeLessThanOrEqual(50);
  });
});

// ── ConceptNodeService integration ─────────────────────────────────────

interface MockDb {
  isOpen: boolean;
  semanticGraphSources: Map<string, string>;
  refreshPassState: Map<string, string>;
  refreshHistory: Map<string, any>;
  conceptNodes: Map<string, any>;
  conceptNodeMembers: any[];
  semanticGraphEdges: any[];
  run: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
  runTransaction: ReturnType<typeof vi.fn>;
  onDidOpen: any;
  onDidClose: any;
}

function _migratedPragma() {
  return [
    { name: 'source_node_id', pk: 1 },
    { name: 'target_node_id', pk: 2 },
    { name: 'kind', pk: 3 },
    { name: 'direction', pk: 0 },
  ];
}

function createMockDb(): MockDb {
  const onDidOpen = new Emitter<string>();
  const onDidClose = new Emitter<void>();
  const sources = new Map<string, string>();
  const passState = new Map<string, string>();
  const history = new Map<string, any>();
  const conceptNodes = new Map<string, any>();
  const conceptNodeMembers: any[] = [];
  const semanticGraphEdges: any[] = [];

  const db: MockDb = {
    isOpen: true,
    semanticGraphSources: sources,
    refreshPassState: passState,
    refreshHistory: history,
    conceptNodes,
    conceptNodeMembers,
    semanticGraphEdges,
    onDidOpen: onDidOpen.event,
    onDidClose: onDidClose.event,
    run: vi.fn(async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      if (s.includes('CREATE TABLE') || s.includes('CREATE INDEX')) return { changes: 0, lastInsertRowid: 0 };
      if (s.includes('INSERT INTO refresh_history')) {
        const [id, started_at] = params as [string, string];
        history.set(id, { id, started_at, completed_at: null, status: 'running', sources_processed: 0, error_message: null });
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (s.includes('UPDATE refresh_history')) {
        const [completed_at, status, sources_processed, error_message, id] = params as [string, string, number, string | null, string];
        const row = history.get(id);
        if (row) { row.completed_at = completed_at; row.status = status; row.sources_processed = sources_processed; row.error_message = error_message; }
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (s.includes('INSERT OR REPLACE INTO refresh_pass_state')) {
        const [pass_id, source_type, source_id, last_processed_hash] = params as [string, string, string, string];
        passState.set(`${pass_id}:${source_type}:${source_id}`, last_processed_hash);
        return { changes: 1, lastInsertRowid: 0 };
      }
      return { changes: 0, lastInsertRowid: 0 };
    }),
    get: vi.fn(async () => null),
    all: vi.fn(async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      if (s.includes('PRAGMA table_info')) return _migratedPragma();
      if (s.includes('FROM semantic_graph_sources s') && s.includes('refresh_pass_state')) {
        const [passId] = params as [string];
        const out: any[] = [];
        for (const [key, hash] of sources.entries()) {
          const [type, id] = key.split(':');
          const last = passState.get(`${passId}:${type}:${id}`);
          if (last !== hash) out.push({ source_type: type, source_id: id, current_hash: hash, last_processed_hash: last ?? null });
        }
        return out;
      }
      if (s.includes('FROM refresh_history')) {
        return Array.from(history.values()).slice(0, 10);
      }
      if (s.includes('FROM concept_nodes')) {
        return Array.from(conceptNodes.values());
      }
      if (s.includes('FROM concept_node_members')) {
        const [conceptId] = params as [string];
        return conceptNodeMembers.filter((m) => m.concept_id === conceptId);
      }
      if (s.includes('FROM source_distinctive_terms')) {
        // Return a few distinctive terms — the actual values don't matter
        // because the LLM mock returns a fixed label.
        return [{ term: 'TermA', count: 3 }, { term: 'TermB', count: 2 }];
      }
      return [];
    }),
    runTransaction: vi.fn(async (ops: any[]) => {
      // Apply the ops to our in-memory mock so tests can assert state.
      for (const op of ops) {
        const sql = String(op.sql);
        const params = op.params as any[];
        if (sql.includes('DELETE FROM semantic_graph_edges')) {
          if (sql.includes("kind = 'member-of'") && sql.includes('origin_id = ?')) {
            for (let i = semanticGraphEdges.length - 1; i >= 0; i--) {
              if (semanticGraphEdges[i].kind === 'member-of' && semanticGraphEdges[i].origin_id === params[0]) {
                semanticGraphEdges.splice(i, 1);
              }
            }
          }
        } else if (sql.includes('DELETE FROM concept_node_members')) {
          const [conceptId] = params;
          for (let i = conceptNodeMembers.length - 1; i >= 0; i--) {
            if (conceptNodeMembers[i].concept_id === conceptId) conceptNodeMembers.splice(i, 1);
          }
        } else if (sql.includes('DELETE FROM concept_nodes')) {
          const [stableId] = params;
          conceptNodes.delete(stableId);
        } else if (sql.includes('INSERT INTO concept_nodes') || sql.includes('INSERT OR REPLACE INTO concept_nodes')) {
          const [stable_id, label, member_count, member_hash, user_renamed] = params;
          conceptNodes.set(stable_id, {
            stable_id, label, member_count, member_hash, user_renamed, user_deleted: 0,
          });
        } else if (sql.includes('INSERT INTO concept_node_members')) {
          const [concept_id, source_type, source_id] = params;
          conceptNodeMembers.push({ concept_id, source_type, source_id });
        } else if (sql.includes('INSERT OR REPLACE INTO semantic_graph_edges') && sql.includes("'member-of'")) {
          const [source_node_id, target_node_id, source_type, source_id, target_type, target_id, origin_type, origin_id, score] = params;
          semanticGraphEdges.push({
            source_node_id, target_node_id, source_type, source_id,
            target_type, target_id, origin_type, origin_id, score,
            kind: 'member-of', direction: 'forward',
          });
        }
      }
      return [];
    }),
  };
  return db;
}

function createMockVectorStore(centroids: Map<string, number[]> = new Map()) {
  return {
    onDidUpdateIndex: new Emitter().event,
    upsert: vi.fn(),
    deleteSource: vi.fn(),
    search: vi.fn(),
    vectorSearch: vi.fn(),
    getContentHash: vi.fn(),
    getIndexedAtMap: vi.fn(),
    getIndexedSources: vi.fn(async () => {
      const out: any[] = [];
      for (const key of centroids.keys()) {
        const [sourceType, sourceId] = key.split(':');
        out.push({ sourceType, sourceId, contentHash: `hash-${sourceId}`, chunkCount: 1, indexedAt: 'now' });
      }
      return out;
    }),
    getStats: vi.fn(),
    getDocumentSummaries: vi.fn(),
    getEmbeddings: vi.fn(),
    getSourceCentroid: vi.fn(async (sourceType: string, sourceId: string) => {
      const vec = centroids.get(`${sourceType}:${sourceId}`);
      if (!vec) return undefined;
      return { sourceType, sourceId, vector: vec, chunkCount: 1 };
    }),
    getSourceChunks: vi.fn().mockResolvedValue([]),
    getStructuralCompanions: vi.fn(),
    purgeAll: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockWorkspace() {
  return {
    folders: [{ uri: { toString: () => 'file:///workspace' }, name: 'workspace', index: 0 }],
    dispose: vi.fn(),
  };
}

async function* mockChatStream(text: string): AsyncIterable<{ content: string; done: boolean }> {
  yield { content: text, done: true };
}

function createMockLanguageModels(modelId: string = 'mock', response: string = 'Existentialism') {
  return {
    onDidChangeProviders: new Emitter().event,
    onDidChangeModels: new Emitter().event,
    registerProvider: vi.fn(),
    getProviders: vi.fn(() => []),
    getModels: vi.fn(async () => []),
    getActiveModel: vi.fn(() => modelId),
    setActiveModel: vi.fn(),
    setStorage: vi.fn(async () => {}),
    setDefaultModel: vi.fn(),
    sendChatRequest: vi.fn(),
    sendChatRequestForModel: vi.fn(() => mockChatStream(response)),
    checkStatus: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('ConceptNodeService', () => {
  let db: MockDb;
  let orchestrator: MindMapRefreshOrchestrator;

  beforeEach(() => {
    db = createMockDb();
    orchestrator = new MindMapRefreshOrchestrator(db as any);
  });

  it('registers a concept-clustering pass on construction', () => {
    const vs = createMockVectorStore();
    const lm = createMockLanguageModels();
    const ws = createMockWorkspace();
    new ConceptNodeService(db as any, vs as any, lm as any, ws as any, orchestrator);
    expect(orchestrator.getRegisteredPasses()).toEqual([
      { id: 'concept-clustering', displayName: 'Concept clustering' },
    ]);
  });

  it('clusters three close sources and writes a concept_node with label + member-of edges', async () => {
    // Three sources with very similar centroids → one cluster.
    const centroids = new Map([
      ['page_block:a', [1, 0, 0]],
      ['page_block:b', [0.99, 0.05, 0]],
      ['page_block:c', [0.98, 0.1, 0]],
    ]);
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    db.semanticGraphSources.set('page_block:c', 'hash-c');
    const vs = createMockVectorStore(centroids);
    const lm = createMockLanguageModels('mock-model', 'Bayesian Statistics');
    const ws = createMockWorkspace();
    new ConceptNodeService(db as any, vs as any, lm as any, ws as any, orchestrator);

    const result = await orchestrator.startRefresh();
    expect(result.status).toBe('completed');

    // One concept node materialised
    expect(db.conceptNodes.size).toBe(1);
    const [first] = Array.from(db.conceptNodes.values());
    expect(first.label).toBe('Bayesian Statistics');
    expect(first.member_count).toBe(3);

    // Three member-of edges
    const memberOfEdges = db.semanticGraphEdges.filter((e) => e.kind === 'member-of');
    expect(memberOfEdges).toHaveLength(3);
    for (const e of memberOfEdges) {
      expect(e.target_type).toBe('concept-node');
      expect(e.direction).toBe('forward');
    }
  });

  it('does NOT cluster when fewer than minPoints similar sources exist', async () => {
    // Two sources — DBSCAN minPoints is 3, so no cluster forms.
    const centroids = new Map([
      ['page_block:a', [1, 0, 0]],
      ['page_block:b', [0.99, 0.01, 0]],
    ]);
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    const vs = createMockVectorStore(centroids);
    const lm = createMockLanguageModels();
    const ws = createMockWorkspace();
    new ConceptNodeService(db as any, vs as any, lm as any, ws as any, orchestrator);

    await orchestrator.startRefresh();

    expect(db.conceptNodes.size).toBe(0);
    expect(db.semanticGraphEdges.filter((e) => e.kind === 'member-of')).toHaveLength(0);
  });

  it('carries over an existing cluster label when >=70% of members are retained', async () => {
    // Seed an existing cluster: A, B, C with label "OldName"
    db.conceptNodes.set('concept-existing', {
      stable_id: 'concept-existing',
      label: 'Existentialism',
      member_count: 3,
      member_hash: 'oldhash',
      user_renamed: 0,
      user_deleted: 0,
    });
    db.conceptNodeMembers.push(
      { concept_id: 'concept-existing', source_type: 'page_block', source_id: 'a' },
      { concept_id: 'concept-existing', source_type: 'page_block', source_id: 'b' },
      { concept_id: 'concept-existing', source_type: 'page_block', source_id: 'c' },
    );

    // New clustering finds A, B, C, D together — 3 of original 3 are still
    // grouped (100% retention, above the 70% threshold) so the existing
    // label carries over.
    const centroids = new Map([
      ['page_block:a', [1, 0, 0]],
      ['page_block:b', [0.99, 0.05, 0]],
      ['page_block:c', [0.98, 0.1, 0]],
      ['page_block:d', [0.97, 0.05, 0]],
    ]);
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    db.semanticGraphSources.set('page_block:c', 'hash-c');
    db.semanticGraphSources.set('page_block:d', 'hash-d');
    const vs = createMockVectorStore(centroids);
    const lm = createMockLanguageModels('mock-model', 'WrongFreshLabel'); // should NOT be called
    const ws = createMockWorkspace();
    new ConceptNodeService(db as any, vs as any, lm as any, ws as any, orchestrator);

    await orchestrator.startRefresh();

    // Carry-over: same stable_id, same label, member_count updated to 4
    const node = db.conceptNodes.get('concept-existing');
    expect(node).toBeDefined();
    expect(node.label).toBe('Existentialism');
    expect(node.member_count).toBe(4);
    // The LLM was NOT called because no fresh cluster needed labelling.
    expect(lm.sendChatRequestForModel).not.toHaveBeenCalled();
  });

  it('user-deleted clusters stay deleted across refreshes', async () => {
    // Existing user-deleted cluster
    db.conceptNodes.set('concept-deleted', {
      stable_id: 'concept-deleted',
      label: 'Bad Cluster',
      member_count: 3,
      member_hash: 'h',
      user_renamed: 0,
      user_deleted: 1,
    });
    db.conceptNodeMembers.push(
      { concept_id: 'concept-deleted', source_type: 'page_block', source_id: 'a' },
      { concept_id: 'concept-deleted', source_type: 'page_block', source_id: 'b' },
      { concept_id: 'concept-deleted', source_type: 'page_block', source_id: 'c' },
    );

    // Re-clustering finds the same membership again
    const centroids = new Map([
      ['page_block:a', [1, 0, 0]],
      ['page_block:b', [0.99, 0.05, 0]],
      ['page_block:c', [0.98, 0.1, 0]],
    ]);
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    db.semanticGraphSources.set('page_block:c', 'hash-c');
    const vs = createMockVectorStore(centroids);
    const lm = createMockLanguageModels('mock-model', 'New Label');
    const ws = createMockWorkspace();
    new ConceptNodeService(db as any, vs as any, lm as any, ws as any, orchestrator);

    await orchestrator.startRefresh();

    // The deleted cluster persists (user_deleted = 1) — NOT removed.
    expect(db.conceptNodes.has('concept-deleted')).toBe(true);
    // A NEW cluster is formed because the deleted one was skipped from
    // carry-over matching. The new cluster gets a fresh stable_id + label.
    const allNodes = Array.from(db.conceptNodes.values());
    const newCluster = allNodes.find((n) => n.stable_id !== 'concept-deleted');
    expect(newCluster).toBeDefined();
    expect(newCluster.label).toBe('New Label');
  });

  it('does not run when no sources have changed', async () => {
    // Two sources, but both already marked as processed at their current hash.
    const centroids = new Map([
      ['page_block:a', [1, 0, 0]],
      ['page_block:b', [0.99, 0.01, 0]],
      ['page_block:c', [0.98, 0.05, 0]],
    ]);
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    db.semanticGraphSources.set('page_block:c', 'hash-c');
    db.refreshPassState.set('concept-clustering:page_block:a', 'hash-a');
    db.refreshPassState.set('concept-clustering:page_block:b', 'hash-b');
    db.refreshPassState.set('concept-clustering:page_block:c', 'hash-c');
    const vs = createMockVectorStore(centroids);
    const lm = createMockLanguageModels();
    const ws = createMockWorkspace();
    new ConceptNodeService(db as any, vs as any, lm as any, ws as any, orchestrator);

    await orchestrator.startRefresh();

    // No work — getIndexedSources should NOT have been called
    expect(vs.getIndexedSources).not.toHaveBeenCalled();
    expect(db.conceptNodes.size).toBe(0);
  });
});
