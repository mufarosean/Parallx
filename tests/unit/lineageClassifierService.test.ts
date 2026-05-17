import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Emitter } from '../../src/platform/events.js';
import {
  LineageClassifierService,
  parseLineageResponse,
} from '../../src/services/lineageClassifierService.js';
import { MindMapRefreshOrchestrator } from '../../src/services/mindMapRefreshOrchestrator.js';

// ── parseLineageResponse (pure helper) ─────────────────────────────────

describe('parseLineageResponse', () => {
  it('parses a clean JSON object with extends + confidence', () => {
    expect(parseLineageResponse('{"relationship":"extends","confidence":0.82}'))
      .toEqual({ relationship: 'extends', confidence: 0.82 });
  });

  it('parses refutes', () => {
    expect(parseLineageResponse('{"relationship":"refutes","confidence":0.7}'))
      .toEqual({ relationship: 'refutes', confidence: 0.7 });
  });

  it('parses none', () => {
    expect(parseLineageResponse('{"relationship":"none","confidence":0.4}'))
      .toEqual({ relationship: 'none', confidence: 0.4 });
  });

  it('extracts the JSON object from surrounding prose (some small models prepend text)', () => {
    const raw = 'Here is my answer: {"relationship":"extends","confidence":0.65} done.';
    expect(parseLineageResponse(raw)).toEqual({ relationship: 'extends', confidence: 0.65 });
  });

  it('clamps confidence values above 1', () => {
    expect(parseLineageResponse('{"relationship":"extends","confidence":1.5}'))
      .toEqual({ relationship: 'extends', confidence: 1 });
  });

  it('clamps negative confidence to zero', () => {
    expect(parseLineageResponse('{"relationship":"extends","confidence":-0.2}'))
      .toEqual({ relationship: 'extends', confidence: 0 });
  });

  it('treats unknown relationship values as none', () => {
    expect(parseLineageResponse('{"relationship":"contradicts","confidence":0.9}'))
      .toEqual({ relationship: 'none', confidence: 0.9 });
  });

  it('treats missing confidence as zero', () => {
    expect(parseLineageResponse('{"relationship":"extends"}'))
      .toEqual({ relationship: 'extends', confidence: 0 });
  });

  it('falls back to none/0 on malformed JSON', () => {
    expect(parseLineageResponse('not json at all'))
      .toEqual({ relationship: 'none', confidence: 0 });
    expect(parseLineageResponse('{relationship: bad}'))
      .toEqual({ relationship: 'none', confidence: 0 });
  });

  it('falls back to none/0 on empty or non-string input', () => {
    expect(parseLineageResponse('')).toEqual({ relationship: 'none', confidence: 0 });
    expect(parseLineageResponse(undefined as any)).toEqual({ relationship: 'none', confidence: 0 });
    expect(parseLineageResponse(null as any)).toEqual({ relationship: 'none', confidence: 0 });
  });
});

// ── LineageClassifierService integration ────────────────────────────────

interface MockDb {
  isOpen: boolean;
  semanticGraphSources: Map<string, string>;
  refreshPassState: Map<string, string>;
  refreshHistory: Map<string, any>;
  semanticGraphEdges: any[];
  lineageCache: Map<string, { relationship: string; confidence: number }>;
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

function _cacheKey(s: string, t: string, sh: string, th: string) {
  return `${s}|${t}|${sh}|${th}`;
}

function createMockDb(seedEdges: any[] = []): MockDb {
  const onDidOpen = new Emitter<string>();
  const onDidClose = new Emitter<void>();
  const sources = new Map<string, string>();
  const passState = new Map<string, string>();
  const history = new Map<string, any>();
  const edges = [...seedEdges];
  const lineageCache = new Map<string, { relationship: string; confidence: number }>();

  const db: MockDb = {
    isOpen: true,
    semanticGraphSources: sources,
    refreshPassState: passState,
    refreshHistory: history,
    semanticGraphEdges: edges,
    lineageCache,
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
      if (s.includes('DELETE FROM semantic_graph_edges') && s.includes('extends')) {
        const [origin_type, origin_id] = params as [string, string];
        for (let i = edges.length - 1; i >= 0; i--) {
          if (edges[i].origin_type === origin_type && edges[i].origin_id === origin_id
              && (edges[i].kind === 'extends' || edges[i].kind === 'refutes')) {
            edges.splice(i, 1);
          }
        }
        return { changes: 0, lastInsertRowid: 0 };
      }
      if (s.includes('INSERT OR REPLACE INTO semantic_graph_edges')) {
        const [
          source_node_id, target_node_id, source_type, source_id,
          target_type, target_id, origin_type, origin_id, score, kind,
          target_content_hash,
        ] = params as any[];
        edges.push({
          source_node_id, target_node_id, source_type, source_id,
          target_type, target_id, origin_type, origin_id, score, kind,
          direction: 'forward',
          target_content_hash,
        });
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (s.includes('INSERT OR REPLACE INTO lineage_classification_cache')) {
        const [
          source_node_id, target_node_id, source_content_hash, target_content_hash,
          relationship, confidence,
        ] = params as [string, string, string, string, string, number];
        lineageCache.set(
          _cacheKey(source_node_id, target_node_id, source_content_hash, target_content_hash),
          { relationship, confidence },
        );
        return { changes: 1, lastInsertRowid: 0 };
      }
      return { changes: 0, lastInsertRowid: 0 };
    }),
    get: vi.fn(async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      if (s.includes('FROM lineage_classification_cache')) {
        const [source_node_id, target_node_id, source_content_hash, target_content_hash] = params as [string, string, string, string];
        const hit = lineageCache.get(_cacheKey(source_node_id, target_node_id, source_content_hash, target_content_hash));
        return hit ?? null;
      }
      return null;
    }),
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
      if (s.includes('FROM semantic_graph_edges') && s.includes('partner_node_id')) {
        // _findCandidatePartners query
        const [sourceNodeId] = params as [string];
        const seen = new Set<string>();
        const out: any[] = [];
        for (const e of edges) {
          if (!['similar-to', 'references', 'co-occurrence'].includes(e.kind)) continue;
          let partner;
          if (e.source_node_id === sourceNodeId) {
            partner = { partner_node_id: e.target_node_id, partner_type: e.target_type, partner_id: e.target_id };
          } else if (e.target_node_id === sourceNodeId) {
            partner = { partner_node_id: e.source_node_id, partner_type: e.source_type, partner_id: e.source_id };
          } else continue;
          const key = `${partner.partner_type}:${partner.partner_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(partner);
        }
        return out;
      }
      if (s.includes('FROM refresh_history')) {
        const limit = (params as [number])?.[0] ?? 10;
        return Array.from(history.values()).slice(0, limit);
      }
      return [];
    }),
    runTransaction: vi.fn(async () => []),
  };
  return db;
}

function createMockVectorStore() {
  const onDidUpdateIndex = new Emitter<any>();
  return {
    onDidUpdateIndex: onDidUpdateIndex.event,
    upsert: vi.fn(),
    deleteSource: vi.fn(),
    search: vi.fn(),
    vectorSearch: vi.fn(),
    getContentHash: vi.fn(async (sourceType: string, sourceId: string) => {
      // Mirror what's in the db's semanticGraphSources
      // Tests will override this via mockImplementation when needed
      return null;
    }),
    getIndexedAtMap: vi.fn(),
    getIndexedSources: vi.fn().mockResolvedValue([]),
    getStats: vi.fn(),
    getDocumentSummaries: vi.fn(),
    getEmbeddings: vi.fn(),
    getSourceCentroid: vi.fn(),
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

function createMockLanguageModels(modelId: string = 'mock-model', response: string = '{"relationship":"none","confidence":0}') {
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

describe('LineageClassifierService', () => {
  let db: MockDb;
  let vectorStore: ReturnType<typeof createMockVectorStore>;
  let workspaceService: ReturnType<typeof createMockWorkspace>;
  let orchestrator: MindMapRefreshOrchestrator;

  beforeEach(() => {
    db = createMockDb();
    vectorStore = createMockVectorStore();
    workspaceService = createMockWorkspace();
    orchestrator = new MindMapRefreshOrchestrator(db as any);
  });

  it('registers a "lineage" pass with the orchestrator on construction', () => {
    const lm = createMockLanguageModels();
    new LineageClassifierService(db as any, vectorStore as any, lm as any, workspaceService as any, orchestrator);
    expect(orchestrator.getRegisteredPasses()).toEqual([
      { id: 'lineage', displayName: 'Lineage classification' },
    ]);
  });

  it('classifies candidate pairs and writes an extends edge for extends responses', async () => {
    // Workspace: source A (page) has a similar-to edge to source B (page).
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    db.semanticGraphEdges.push({
      source_node_id: 'page:a',
      target_node_id: 'page:b',
      source_type: 'page_block',
      source_id: 'a',
      target_type: 'page_block',
      target_id: 'b',
      origin_type: 'page_block',
      origin_id: 'a',
      kind: 'similar-to',
      direction: 'undirected',
    });
    vectorStore.getContentHash.mockImplementation(async (st: string, sid: string) => {
      if (st === 'page_block' && sid === 'a') return 'hash-a';
      if (st === 'page_block' && sid === 'b') return 'hash-b';
      return null;
    });
    vectorStore.getSourceChunks.mockResolvedValue([{ text: 'Paper content here.', contextPrefix: '' }]);
    const lm = createMockLanguageModels('mock-model', '{"relationship":"extends","confidence":0.85}');
    new LineageClassifierService(db as any, vectorStore as any, lm as any, workspaceService as any, orchestrator);

    const result = await orchestrator.startRefresh();
    expect(result.status).toBe('completed');

    // Should have written an extends edge from A → B
    const extendsEdges = db.semanticGraphEdges.filter((e) => e.kind === 'extends');
    expect(extendsEdges.length).toBeGreaterThan(0);
    const e = extendsEdges.find((x) => x.source_node_id === 'page:a' && x.target_node_id === 'page:b');
    expect(e).toBeDefined();
    expect(e.direction).toBe('forward');
  });

  it('does NOT write an edge when classification is none', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    db.semanticGraphEdges.push({
      source_node_id: 'page:a',
      target_node_id: 'page:b',
      source_type: 'page_block',
      source_id: 'a',
      target_type: 'page_block',
      target_id: 'b',
      origin_type: 'page_block',
      origin_id: 'a',
      kind: 'similar-to',
      direction: 'undirected',
    });
    vectorStore.getContentHash.mockImplementation(async (st: string, sid: string) =>
      sid === 'a' ? 'hash-a' : sid === 'b' ? 'hash-b' : null);
    vectorStore.getSourceChunks.mockResolvedValue([{ text: 'Independent doc.', contextPrefix: '' }]);
    const lm = createMockLanguageModels('mock-model', '{"relationship":"none","confidence":0.9}');
    new LineageClassifierService(db as any, vectorStore as any, lm as any, workspaceService as any, orchestrator);

    await orchestrator.startRefresh();

    const extendsOrRefutes = db.semanticGraphEdges.filter((e) => e.kind === 'extends' || e.kind === 'refutes');
    expect(extendsOrRefutes).toHaveLength(0);
  });

  it('does NOT write an edge when confidence is below threshold even if relationship is extends', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    db.semanticGraphEdges.push({
      source_node_id: 'page:a', target_node_id: 'page:b',
      source_type: 'page_block', source_id: 'a',
      target_type: 'page_block', target_id: 'b',
      origin_type: 'page_block', origin_id: 'a',
      kind: 'similar-to', direction: 'undirected',
    });
    vectorStore.getContentHash.mockImplementation(async (st: string, sid: string) =>
      sid === 'a' ? 'hash-a' : sid === 'b' ? 'hash-b' : null);
    vectorStore.getSourceChunks.mockResolvedValue([{ text: 'Content here.', contextPrefix: '' }]);
    // Confidence 0.3 is below the 0.55 threshold.
    const lm = createMockLanguageModels('mock-model', '{"relationship":"extends","confidence":0.3}');
    new LineageClassifierService(db as any, vectorStore as any, lm as any, workspaceService as any, orchestrator);

    await orchestrator.startRefresh();

    const extendsOrRefutes = db.semanticGraphEdges.filter((e) => e.kind === 'extends' || e.kind === 'refutes');
    expect(extendsOrRefutes).toHaveLength(0);
  });

  it('reuses cached classifications when source and target content hashes match', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    db.semanticGraphEdges.push({
      source_node_id: 'page:a', target_node_id: 'page:b',
      source_type: 'page_block', source_id: 'a',
      target_type: 'page_block', target_id: 'b',
      origin_type: 'page_block', origin_id: 'a',
      kind: 'similar-to', direction: 'undirected',
    });
    db.lineageCache.set(_cacheKey('page:a', 'page:b', 'hash-a', 'hash-b'), {
      relationship: 'extends',
      confidence: 0.9,
    });
    vectorStore.getContentHash.mockImplementation(async (st: string, sid: string) =>
      sid === 'a' ? 'hash-a' : sid === 'b' ? 'hash-b' : null);
    const lm = createMockLanguageModels('mock-model', '{"relationship":"none","confidence":0.0}');
    new LineageClassifierService(db as any, vectorStore as any, lm as any, workspaceService as any, orchestrator);

    await orchestrator.startRefresh();

    // The LLM should NOT have been called because cache was hit.
    expect(lm.sendChatRequestForModel).not.toHaveBeenCalled();
    // The cached extends classification should have produced an edge.
    const extendsEdges = db.semanticGraphEdges.filter((e) => e.kind === 'extends');
    expect(extendsEdges.length).toBeGreaterThan(0);
  });

  it('skips classification (treats as none) when no active model is set', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    db.semanticGraphEdges.push({
      source_node_id: 'page:a', target_node_id: 'page:b',
      source_type: 'page_block', source_id: 'a',
      target_type: 'page_block', target_id: 'b',
      origin_type: 'page_block', origin_id: 'a',
      kind: 'similar-to', direction: 'undirected',
    });
    vectorStore.getContentHash.mockImplementation(async (st: string, sid: string) =>
      sid === 'a' ? 'hash-a' : sid === 'b' ? 'hash-b' : null);
    vectorStore.getSourceChunks.mockResolvedValue([{ text: 'Some content.', contextPrefix: '' }]);
    const lm = createMockLanguageModels();
    lm.getActiveModel = vi.fn(() => undefined);
    new LineageClassifierService(db as any, vectorStore as any, lm as any, workspaceService as any, orchestrator);

    await orchestrator.startRefresh();
    // No LLM call, no edges
    expect(lm.sendChatRequestForModel).not.toHaveBeenCalled();
    expect(db.semanticGraphEdges.filter((e) => e.kind === 'extends' || e.kind === 'refutes')).toHaveLength(0);
  });

  it('honors cancellation between pairs', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    db.semanticGraphSources.set('page_block:c', 'hash-c');
    // A has similarity edges to both B and C → two candidate pairs
    db.semanticGraphEdges.push(
      {
        source_node_id: 'page:a', target_node_id: 'page:b',
        source_type: 'page_block', source_id: 'a',
        target_type: 'page_block', target_id: 'b',
        origin_type: 'page_block', origin_id: 'a',
        kind: 'similar-to', direction: 'undirected',
      },
      {
        source_node_id: 'page:a', target_node_id: 'page:c',
        source_type: 'page_block', source_id: 'a',
        target_type: 'page_block', target_id: 'c',
        origin_type: 'page_block', origin_id: 'a',
        kind: 'similar-to', direction: 'undirected',
      },
    );
    vectorStore.getContentHash.mockImplementation(async (st: string, sid: string) =>
      ({ a: 'hash-a', b: 'hash-b', c: 'hash-c' } as any)[sid] ?? null);
    vectorStore.getSourceChunks.mockResolvedValue([{ text: 'Content.', contextPrefix: '' }]);

    let llmCalls = 0;
    const lm = createMockLanguageModels();
    lm.sendChatRequestForModel = vi.fn(() => {
      llmCalls += 1;
      // Cancel right after the first LLM call kicks off.
      orchestrator.cancelRefresh();
      return mockChatStream('{"relationship":"none","confidence":0.0}');
    });
    new LineageClassifierService(db as any, vectorStore as any, lm as any, workspaceService as any, orchestrator);

    const result = await orchestrator.startRefresh();
    expect(result.status).toBe('cancelled');
    // Only the first pair's LLM call should have fired before cancel took effect.
    expect(llmCalls).toBeLessThanOrEqual(1);
  });
});
