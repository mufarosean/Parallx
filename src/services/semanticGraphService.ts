// semanticGraphService.ts - cached semantic edges for Workspace Graph (M68)
//
// This service is intentionally built on stored vector data only. It does not
// depend on IEmbeddingService and must not call Ollama or any chat/model path.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type {
  IDatabaseService,
  IIndexingPipelineService,
  IVectorStoreService,
  IWorkspaceService,
} from './serviceTypes.js';
import type { SearchResult } from './vectorStoreService.js';

export type SemanticGraphSourceType = 'page_block' | 'file_chunk';

export interface SemanticGraphEdge {
  sourceNodeId: string;
  targetNodeId: string;
  sourceType: SemanticGraphSourceType;
  sourceId: string;
  targetType: SemanticGraphSourceType;
  targetId: string;
  score: number;
  kind: 'semantic';
  sourceContentHash?: string;
  targetContentHash?: string;
  updatedAt: string;
}

export interface SemanticGraphEdgeOptions {
  maxEdges?: number;
  minScore?: number;
}

export interface SemanticGraphStats {
  cachedEdges: number;
  cachedSources: number;
  queuedSources: number;
  isProcessing: boolean;
}

export interface SemanticGraphServiceOptions {
  debounceMs?: number;
  processYieldMs?: number;
  retryWhileIndexingMs?: number;
  topLinksPerSource?: number;
  candidateK?: number;
  minScore?: number;
  maxCachedEdges?: number;
}

const SOURCE_TYPES = new Set<string>(['page_block', 'file_chunk']);
const DEFAULT_DEBOUNCE_MS = 5_000;
const DEFAULT_PROCESS_YIELD_MS = 25;
const DEFAULT_RETRY_WHILE_INDEXING_MS = 5_000;
const DEFAULT_TOP_LINKS_PER_SOURCE = 3;
const DEFAULT_MIN_SCORE = 0.72;
const DEFAULT_MAX_CACHED_EDGES = 500;
const DEFAULT_CANDIDATE_K = 60;

export function isSemanticGraphSourceType(value: string): value is SemanticGraphSourceType {
  return SOURCE_TYPES.has(value);
}

export function semanticSourceToNodeId(
  sourceType: SemanticGraphSourceType,
  sourceId: string,
  workspaceRootUri?: string,
): string | undefined {
  if (sourceType === 'page_block') {
    return `page:${sourceId}`;
  }
  if (!workspaceRootUri) {
    return undefined;
  }
  const root = workspaceRootUri.endsWith('/') ? workspaceRootUri.slice(0, -1) : workspaceRootUri;
  const rel = sourceId.replace(/\\/g, '/').replace(/^\/+/, '');
  return `file:${root}/${rel}`;
}

export function canonicalizeSemanticEdgePair<T extends {
  nodeId: string;
  sourceType: SemanticGraphSourceType;
  sourceId: string;
  contentHash?: string;
}>(a: T, b: T): { source: T; target: T } {
  return a.nodeId <= b.nodeId
    ? { source: a, target: b }
    : { source: b, target: a };
}

export class SemanticGraphService extends Disposable {
  private readonly _onDidChangeEdges = this._register(new Emitter<void>());
  readonly onDidChangeEdges: Event<void> = this._onDidChangeEdges.event;

  private readonly _debounceMs: number;
  private readonly _processYieldMs: number;
  private readonly _retryWhileIndexingMs: number;
  private readonly _topLinksPerSource: number;
  private readonly _candidateK: number;
  private readonly _minScore: number;
  private readonly _maxCachedEdges: number;

  private _schemaReady = false;
  private _started = false;
  private _disposed = false;
  private _processing = false;
  private _initialBackfillQueued = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private readonly _queue = new Map<string, { sourceType: SemanticGraphSourceType; sourceId: string }>();

  constructor(
    private readonly _db: IDatabaseService,
    private readonly _vectorStore: IVectorStoreService,
    private readonly _indexingPipeline: IIndexingPipelineService,
    private readonly _workspaceService: IWorkspaceService,
    options: SemanticGraphServiceOptions = {},
  ) {
    super();
    this._debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this._processYieldMs = options.processYieldMs ?? DEFAULT_PROCESS_YIELD_MS;
    this._retryWhileIndexingMs = options.retryWhileIndexingMs ?? DEFAULT_RETRY_WHILE_INDEXING_MS;
    this._topLinksPerSource = options.topLinksPerSource ?? DEFAULT_TOP_LINKS_PER_SOURCE;
    this._candidateK = options.candidateK ?? DEFAULT_CANDIDATE_K;
    this._minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    this._maxCachedEdges = options.maxCachedEdges ?? DEFAULT_MAX_CACHED_EDGES;

    this._register(this._indexingPipeline.onDidIndexSource((result) => {
      if (result.status !== 'indexed') {
        return;
      }
      this.scheduleSource(result.type === 'page' ? 'page_block' : 'file_chunk', result.sourceId);
    }));
    this._register(this._indexingPipeline.onDidCompleteInitialIndex(() => {
      if (this._started) {
        void this.rebuildChangedSources();
      }
    }));
    this._register(this._db.onDidOpen(() => {
      this._schemaReady = false;
      this._initialBackfillQueued = false;
      if (this._started) {
        this.ensureCacheStarted();
      }
    }));
    this._register(this._db.onDidClose(() => {
      this._schemaReady = false;
      this._queue.clear();
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    }));
  }

  ensureCacheStarted(): void {
    this._started = true;
    void this._ensureSchema()
      .then(() => this._scheduleInitialBackfill())
      .catch((err) => console.warn('[SemanticGraphService] cache start failed:', err));
  }

  scheduleSource(sourceType: SemanticGraphSourceType, sourceId: string): void {
    if (!this._started || this._disposed || !isSemanticGraphSourceType(sourceType) || !sourceId) {
      return;
    }
    this._queue.set(`${sourceType}:${sourceId}`, { sourceType, sourceId });
    this._scheduleDrain(this._debounceMs);
  }

  async rebuildChangedSources(): Promise<void> {
    if (this._disposed || !this._db.isOpen) {
      return;
    }
    await this._ensureSchema();
    const sources = await this._vectorStore.getIndexedSources();
    for (const source of sources) {
      if (!isSemanticGraphSourceType(source.sourceType)) {
        continue;
      }
      this._queue.set(`${source.sourceType}:${source.sourceId}`, {
        sourceType: source.sourceType,
        sourceId: source.sourceId,
      });
    }
    this._scheduleDrain(0);
  }

  async getCachedEdges(options: SemanticGraphEdgeOptions = {}): Promise<SemanticGraphEdge[]> {
    if (!this._db.isOpen) {
      return [];
    }
    await this._ensureSchema();
    const maxEdges = Math.max(0, Math.floor(options.maxEdges ?? this._maxCachedEdges));
    if (maxEdges === 0) {
      return [];
    }
    const minScore = options.minScore ?? this._minScore;
    const rows = await this._db.all<{
      sourceNodeId: string;
      targetNodeId: string;
      sourceType: SemanticGraphSourceType;
      sourceId: string;
      targetType: SemanticGraphSourceType;
      targetId: string;
      score: number;
      kind: 'semantic';
      sourceContentHash?: string | null;
      targetContentHash?: string | null;
      updatedAt: string;
    }>(
      `SELECT source_node_id as sourceNodeId,
              target_node_id as targetNodeId,
              source_type as sourceType,
              source_id as sourceId,
              target_type as targetType,
              target_id as targetId,
              score,
              kind,
              source_content_hash as sourceContentHash,
              target_content_hash as targetContentHash,
              updated_at as updatedAt
         FROM semantic_graph_edges
        WHERE score >= ?
        ORDER BY score DESC
        LIMIT ?`,
      [minScore, maxEdges],
    );
    return rows.map((row) => ({
      ...row,
      sourceContentHash: row.sourceContentHash ?? undefined,
      targetContentHash: row.targetContentHash ?? undefined,
    }));
  }

  async getStats(): Promise<SemanticGraphStats> {
    if (!this._db.isOpen) {
      return { cachedEdges: 0, cachedSources: 0, queuedSources: this._queue.size, isProcessing: this._processing };
    }
    await this._ensureSchema();
    const edges = await this._db.get<{ count: number }>('SELECT COUNT(*) as count FROM semantic_graph_edges');
    const sources = await this._db.get<{ count: number }>('SELECT COUNT(*) as count FROM semantic_graph_sources');
    return {
      cachedEdges: edges?.count ?? 0,
      cachedSources: sources?.count ?? 0,
      queuedSources: this._queue.size,
      isProcessing: this._processing,
    };
  }

  override dispose(): void {
    this._disposed = true;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._queue.clear();
    super.dispose();
  }

  private async _ensureSchema(): Promise<void> {
    if (this._schemaReady || !this._db.isOpen) {
      return;
    }
    await this._db.run(`
      CREATE TABLE IF NOT EXISTS semantic_graph_edges (
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        origin_type TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        score REAL NOT NULL,
        kind TEXT NOT NULL DEFAULT 'semantic',
        source_content_hash TEXT,
        target_content_hash TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (source_node_id, target_node_id)
      )
    `);
    await this._db.run(`
      CREATE TABLE IF NOT EXISTS semantic_graph_sources (
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        content_hash TEXT,
        edge_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (source_type, source_id)
      )
    `);
    await this._db.run('CREATE INDEX IF NOT EXISTS idx_semantic_graph_edges_origin ON semantic_graph_edges(origin_type, origin_id)');
    await this._db.run('CREATE INDEX IF NOT EXISTS idx_semantic_graph_edges_score ON semantic_graph_edges(score DESC)');
    this._schemaReady = true;
  }

  private async _scheduleInitialBackfill(): Promise<void> {
    if (!this._db.isOpen || !this._indexingPipeline.isInitialIndexComplete || this._initialBackfillQueued) {
      return;
    }
    this._initialBackfillQueued = true;
    await this.rebuildChangedSources();
  }

  private _scheduleDrain(delayMs: number): void {
    if (this._disposed || this._timer || this._processing) {
      return;
    }
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._drainQueue().catch((err) => console.warn('[SemanticGraphService] queue drain failed:', err));
    }, delayMs);
  }

  private async _drainQueue(): Promise<void> {
    if (this._processing || this._disposed) {
      return;
    }
    if (this._indexingPipeline.isIndexing) {
      this._scheduleDrain(this._retryWhileIndexingMs);
      return;
    }

    this._processing = true;
    let changed = false;
    try {
      while (!this._disposed && this._queue.size > 0) {
        if (this._indexingPipeline.isIndexing) {
          this._scheduleDrain(this._retryWhileIndexingMs);
          break;
        }
        const next = this._queue.values().next().value as { sourceType: SemanticGraphSourceType; sourceId: string } | undefined;
        if (!next) {
          break;
        }
        this._queue.delete(`${next.sourceType}:${next.sourceId}`);
        const didChange = await this._recomputeSource(next.sourceType, next.sourceId);
        changed = changed || didChange;
        if (this._processYieldMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, this._processYieldMs));
        }
      }
    } finally {
      this._processing = false;
      if (changed) {
        this._onDidChangeEdges.fire();
      }
      if (this._queue.size > 0 && !this._timer) {
        this._scheduleDrain(this._debounceMs);
      }
    }
  }

  private async _recomputeSource(sourceType: SemanticGraphSourceType, sourceId: string): Promise<boolean> {
    if (!this._db.isOpen) {
      return false;
    }
    await this._ensureSchema();

    const contentHash = await this._vectorStore.getContentHash(sourceType, sourceId);
    if (!contentHash) {
      await this._deleteSourceCache(sourceType, sourceId);
      return true;
    }

    const state = await this._db.get<{ content_hash: string | null }>(
      'SELECT content_hash FROM semantic_graph_sources WHERE source_type = ? AND source_id = ?',
      [sourceType, sourceId],
    );
    if (state?.content_hash === contentHash) {
      return false;
    }

    const centroid = await this._vectorStore.getSourceCentroid(sourceType, sourceId);
    if (!centroid) {
      await this._replaceSourceEdges(sourceType, sourceId, contentHash, []);
      return true;
    }

    const sourceNodeId = this._sourceToNodeId(sourceType, sourceId);
    if (!sourceNodeId) {
      return false;
    }

    const candidates = await this._vectorStore.vectorSearch(centroid.vector, this._candidateK);
    const grouped = this._groupCandidates(sourceType, sourceId, candidates);
    const edges: Array<{
      targetType: SemanticGraphSourceType;
      targetId: string;
      targetNodeId: string;
      targetContentHash: string;
      score: number;
    }> = [];

    for (const group of grouped) {
      if (edges.length >= this._topLinksPerSource) {
        break;
      }
      const targetNodeId = this._sourceToNodeId(group.sourceType, group.sourceId);
      if (!targetNodeId) {
        continue;
      }
      const targetContentHash = await this._vectorStore.getContentHash(group.sourceType, group.sourceId);
      if (!targetContentHash) {
        continue;
      }
      edges.push({
        targetType: group.sourceType,
        targetId: group.sourceId,
        targetNodeId,
        targetContentHash,
        score: group.score,
      });
    }

    await this._replaceSourceEdges(sourceType, sourceId, contentHash, edges.map((edge) => {
      const pair = canonicalizeSemanticEdgePair(
        { nodeId: sourceNodeId, sourceType, sourceId, contentHash },
        {
          nodeId: edge.targetNodeId,
          sourceType: edge.targetType,
          sourceId: edge.targetId,
          contentHash: edge.targetContentHash,
        },
      );
      return {
        sourceNodeId: pair.source.nodeId,
        targetNodeId: pair.target.nodeId,
        sourceType: pair.source.sourceType,
        sourceId: pair.source.sourceId,
        targetType: pair.target.sourceType,
        targetId: pair.target.sourceId,
        sourceContentHash: pair.source.contentHash,
        targetContentHash: pair.target.contentHash,
        score: edge.score,
      };
    }));
    return true;
  }

  private _groupCandidates(
    sourceType: SemanticGraphSourceType,
    sourceId: string,
    candidates: SearchResult[],
  ): Array<{ sourceType: SemanticGraphSourceType; sourceId: string; score: number; matches: number }> {
    const grouped = new Map<string, { sourceType: SemanticGraphSourceType; sourceId: string; score: number; matches: number }>();
    for (const candidate of candidates) {
      if (!isSemanticGraphSourceType(candidate.sourceType)) {
        continue;
      }
      if (candidate.sourceType === sourceType && candidate.sourceId === sourceId) {
        continue;
      }
      if (candidate.score < this._minScore) {
        continue;
      }
      const key = `${candidate.sourceType}:${candidate.sourceId}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.score = Math.max(existing.score, candidate.score);
        existing.matches++;
      } else {
        grouped.set(key, {
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId,
          score: candidate.score,
          matches: 1,
        });
      }
    }
    return Array.from(grouped.values())
      .sort((a, b) => b.score - a.score || b.matches - a.matches)
      .slice(0, this._topLinksPerSource);
  }

  private async _replaceSourceEdges(
    sourceType: SemanticGraphSourceType,
    sourceId: string,
    contentHash: string,
    edges: Array<{
      sourceNodeId: string;
      targetNodeId: string;
      sourceType: SemanticGraphSourceType;
      sourceId: string;
      targetType: SemanticGraphSourceType;
      targetId: string;
      sourceContentHash?: string;
      targetContentHash?: string;
      score: number;
    }>,
  ): Promise<void> {
    const ops: { type: 'run'; sql: string; params?: unknown[] }[] = [
      {
        type: 'run',
        sql: 'DELETE FROM semantic_graph_edges WHERE origin_type = ? AND origin_id = ?',
        params: [sourceType, sourceId],
      },
    ];

    for (const edge of edges) {
      ops.push({
        type: 'run',
        sql: `INSERT OR REPLACE INTO semantic_graph_edges(
                source_node_id,
                target_node_id,
                source_type,
                source_id,
                target_type,
                target_id,
                origin_type,
                origin_id,
                score,
                kind,
                source_content_hash,
                target_content_hash,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'semantic', ?, ?, datetime('now'))`,
        params: [
          edge.sourceNodeId,
          edge.targetNodeId,
          edge.sourceType,
          edge.sourceId,
          edge.targetType,
          edge.targetId,
          sourceType,
          sourceId,
          edge.score,
          edge.sourceContentHash ?? null,
          edge.targetContentHash ?? null,
        ],
      });
    }

    ops.push({
      type: 'run',
      sql: `INSERT OR REPLACE INTO semantic_graph_sources(
              source_type,
              source_id,
              content_hash,
              edge_count,
              updated_at
            ) VALUES (?, ?, ?, ?, datetime('now'))`,
      params: [sourceType, sourceId, contentHash, edges.length],
    });

    await this._db.runTransaction(ops);
  }

  private async _deleteSourceCache(sourceType: SemanticGraphSourceType, sourceId: string): Promise<void> {
    await this._ensureSchema();
    await this._db.runTransaction([
      {
        type: 'run',
        sql: `DELETE FROM semantic_graph_edges
               WHERE (source_type = ? AND source_id = ?)
                  OR (target_type = ? AND target_id = ?)
                  OR (origin_type = ? AND origin_id = ?)`,
        params: [sourceType, sourceId, sourceType, sourceId, sourceType, sourceId],
      },
      {
        type: 'run',
        sql: 'DELETE FROM semantic_graph_sources WHERE source_type = ? AND source_id = ?',
        params: [sourceType, sourceId],
      },
    ]);
  }

  private _sourceToNodeId(sourceType: SemanticGraphSourceType, sourceId: string): string | undefined {
    return semanticSourceToNodeId(sourceType, sourceId, this._workspaceRootUri());
  }

  private _workspaceRootUri(): string | undefined {
    const root = this._workspaceService.folders[0]?.uri;
    return root ? root.toString() : undefined;
  }
}
