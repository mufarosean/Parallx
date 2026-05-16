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
import { extractWorkspaceReferences } from './referenceExtractor.js';

export type SemanticGraphSourceType = 'page_block' | 'file_chunk';

/**
 * Edge kinds in the semantic / mind-map graph (M76).
 *
 * `similar-to` (M68 baseline) is the only kind written today; M76 phases 2
 * and 4 add the others. The kind taxonomy is fixed up-front so the schema
 * and rendering can be in place before the producers are wired.
 */
export type SemanticGraphEdgeKind =
  | 'similar-to'
  | 'references'
  | 'co-occurrence'
  | 'same-folder'
  | 'same-author'
  | 'same-date'
  | 'extends'
  | 'refutes'
  | 'member-of';

/**
 * Edge directionality. `undirected` edges have no semantic direction —
 * `(A, B)` and `(B, A)` mean the same thing and are canonicalised to one
 * row at write time. `forward` edges mean source → target and must not be
 * canonicalised.
 */
export type SemanticGraphEdgeDirection = 'undirected' | 'forward';

export interface NodeChunk {
  text: string;
  contextPrefix: string;
}

export interface SemanticGraphEdge {
  sourceNodeId: string;
  targetNodeId: string;
  sourceType: SemanticGraphSourceType;
  sourceId: string;
  targetType: SemanticGraphSourceType;
  targetId: string;
  score: number;
  kind: SemanticGraphEdgeKind;
  direction: SemanticGraphEdgeDirection;
  sourceContentHash?: string;
  targetContentHash?: string;
  updatedAt: string;
}

export interface SemanticGraphEdgeOptions {
  maxEdges?: number;
  minScore?: number;
  kinds?: readonly SemanticGraphEdgeKind[];
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

/**
 * Return the parent folder of a workspace-relative file path, or null for a
 * top-level file. Path separators are normalized to forward slashes. Empty
 * input and unparseable paths return null. Used by the same-folder edge
 * producer (M76 Phase 2).
 */
function _parentFolder(filePath: string): string | null {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
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
    const kindFilter = options.kinds && options.kinds.length > 0 ? options.kinds : undefined;

    const params: unknown[] = [minScore];
    let kindClause = '';
    if (kindFilter) {
      kindClause = ` AND kind IN (${kindFilter.map(() => '?').join(',')})`;
      params.push(...kindFilter);
    }
    params.push(maxEdges);

    const rows = await this._db.all<{
      sourceNodeId: string;
      targetNodeId: string;
      sourceType: SemanticGraphSourceType;
      sourceId: string;
      targetType: SemanticGraphSourceType;
      targetId: string;
      score: number;
      kind: SemanticGraphEdgeKind;
      direction: SemanticGraphEdgeDirection;
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
              direction,
              source_content_hash as sourceContentHash,
              target_content_hash as targetContentHash,
              updated_at as updatedAt
         FROM semantic_graph_edges
        WHERE score >= ?${kindClause}
        ORDER BY score DESC
        LIMIT ?`,
      params,
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

  async getNodeChunks(nodeId: string, maxChunks: number = 20): Promise<NodeChunk[]> {
    if (!this._db.isOpen) {
      return [];
    }
    const source = this._nodeIdToSource(nodeId);
    if (!source) {
      return [];
    }
    return this._vectorStore.getSourceChunks(source.sourceType, source.sourceId, maxChunks);
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
    // Base M76 schema. PRIMARY KEY is (source_node_id, target_node_id, kind)
    // so a single A↔B pair can carry multiple edge kinds (e.g. both
    // similar-to AND references). New installs get this shape directly;
    // existing installs run the PK widening migration below.
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
        kind TEXT NOT NULL DEFAULT 'similar-to',
        direction TEXT NOT NULL DEFAULT 'undirected',
        source_content_hash TEXT,
        target_content_hash TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (source_node_id, target_node_id, kind)
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
    // M76 migration: existing installs may have an older shape. One PRAGMA
    // read drives both the column-existence check and the PK shape check.
    // Indexes are created AFTER the migrations so that the PK rebuild (which
    // drops and recreates the table) doesn't leave dangling index references.
    const cols = await this._db.all<{ name: string; pk: number }>(
      "PRAGMA table_info(semantic_graph_edges)",
    );
    const hasDirection = cols.some((c) => c.name === 'direction');
    if (!hasDirection) {
      await this._db.run(
        "ALTER TABLE semantic_graph_edges ADD COLUMN direction TEXT NOT NULL DEFAULT 'undirected'",
      );
    }
    await this._db.run("UPDATE semantic_graph_edges SET kind = 'similar-to' WHERE kind = 'semantic'");

    // PK widening migration: M68/M76-Phase-1 used PK (source_node_id, target_node_id);
    // Phase 2 requires (source_node_id, target_node_id, kind) so a pair can
    // carry multiple kinds. SQLite has no ALTER PRIMARY KEY, so this is a
    // standard "rebuild and rename" migration: create new table, copy rows,
    // drop old, rename new. Idempotent — detects current PK via PRAGMA.
    // SQLite reports pk > 0 for primary key columns (ordinal); 0 for non-PK.
    const pkColumnNames = cols.filter((c) => (c.pk ?? 0) > 0).map((c) => c.name).sort();
    const expectedPk = ['kind', 'source_node_id', 'target_node_id'];
    const pkAlreadyWide = JSON.stringify(pkColumnNames) === JSON.stringify(expectedPk);
    if (!pkAlreadyWide) {
      await this._db.runTransaction([
        {
          type: 'run',
          sql: `CREATE TABLE semantic_graph_edges_new (
            source_node_id TEXT NOT NULL,
            target_node_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            origin_type TEXT NOT NULL,
            origin_id TEXT NOT NULL,
            score REAL NOT NULL,
            kind TEXT NOT NULL DEFAULT 'similar-to',
            direction TEXT NOT NULL DEFAULT 'undirected',
            source_content_hash TEXT,
            target_content_hash TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (source_node_id, target_node_id, kind)
          )`,
        },
        {
          type: 'run',
          sql: `INSERT INTO semantic_graph_edges_new (
            source_node_id, target_node_id, source_type, source_id,
            target_type, target_id, origin_type, origin_id, score,
            kind, direction, source_content_hash, target_content_hash, updated_at
          ) SELECT
            source_node_id, target_node_id, source_type, source_id,
            target_type, target_id, origin_type, origin_id, score,
            kind, direction, source_content_hash, target_content_hash, updated_at
          FROM semantic_graph_edges`,
        },
        { type: 'run', sql: 'DROP TABLE semantic_graph_edges' },
        { type: 'run', sql: 'ALTER TABLE semantic_graph_edges_new RENAME TO semantic_graph_edges' },
      ]);
    }

    // M76 concept node tables. Empty until Phase 5 wires the clusterer; the
    // tables exist now so Phase 1 schema is the final shape and downstream
    // code can read them without conditional existence checks.
    await this._db.run(`
      CREATE TABLE IF NOT EXISTS concept_nodes (
        stable_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        member_count INTEGER NOT NULL,
        member_hash TEXT NOT NULL,
        user_renamed INTEGER NOT NULL DEFAULT 0,
        user_deleted INTEGER NOT NULL DEFAULT 0,
        last_clustered_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await this._db.run(`
      CREATE TABLE IF NOT EXISTS concept_node_members (
        concept_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        PRIMARY KEY (concept_id, source_type, source_id),
        FOREIGN KEY (concept_id) REFERENCES concept_nodes(stable_id) ON DELETE CASCADE
      )
    `);

    // Indexes are last so the PK rebuild migration doesn't leave them
    // dangling. CREATE INDEX IF NOT EXISTS is safe on both fresh installs
    // and post-migration tables.
    await this._db.run('CREATE INDEX IF NOT EXISTS idx_semantic_graph_edges_origin ON semantic_graph_edges(origin_type, origin_id)');
    await this._db.run('CREATE INDEX IF NOT EXISTS idx_semantic_graph_edges_score ON semantic_graph_edges(score DESC)');
    await this._db.run('CREATE INDEX IF NOT EXISTS idx_semantic_graph_edges_kind ON semantic_graph_edges(kind)');

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

    const sourceNodeId = this._sourceToNodeId(sourceType, sourceId);
    if (!sourceNodeId) {
      return false;
    }

    const centroid = await this._vectorStore.getSourceCentroid(sourceType, sourceId);
    if (!centroid) {
      // No centroid → no chunks → wipe all kinds for this source so stale
      // edges don't linger after the source disappears from the index.
      await this._replaceSourceEdges(sourceType, sourceId, 'similar-to', 'undirected', contentHash, []);
      await this._recomputeReferenceEdges(sourceType, sourceId, sourceNodeId);
      await this._recomputeSameFolderEdges(sourceType, sourceId, sourceNodeId);
      return true;
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

    await this._replaceSourceEdges(sourceType, sourceId, 'similar-to', 'undirected', contentHash, edges.map((edge) => {
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

    // M76 Phase 2 — additional edge kinds derived from the same source. Each
    // producer is independent and shares the per-kind upsert in
    // _replaceSourceEdges so its edges don't interfere with similarity.
    await this._recomputeReferenceEdges(sourceType, sourceId, sourceNodeId);
    await this._recomputeSameFolderEdges(sourceType, sourceId, sourceNodeId);

    return true;
  }

  /**
   * M76 Phase 2 — extract `references` edges from a source's text. Scans the
   * source's stored chunks for `parallx://` URIs that resolve to indexed
   * workspace items and emits a directed edge per resolved reference.
   *
   * Skip cost is low — getSourceChunks is a DB read of already-indexed text;
   * the regex extraction is pure; target validity is verified via the
   * already-cached content hash.
   */
  private async _recomputeReferenceEdges(
    sourceType: SemanticGraphSourceType,
    sourceId: string,
    sourceNodeId: string,
  ): Promise<void> {
    // Pull a generous chunk window — references typically live in the head
    // and tail of a document, but for safety we read up to 200 chunks. For
    // workspaces with documents in the multi-thousand-chunk range, tail
    // references may be missed; the user can fix this with explicit links.
    const chunks = await this._vectorStore.getSourceChunks(sourceType, sourceId, 200);
    if (chunks.length === 0) {
      await this._replaceSourceEdges(sourceType, sourceId, 'references', 'forward', null, []);
      return;
    }

    const text = chunks.map((c) => c.text).join('\n');
    const refs = extractWorkspaceReferences(text);
    if (refs.length === 0) {
      await this._replaceSourceEdges(sourceType, sourceId, 'references', 'forward', null, []);
      return;
    }

    const edges: Array<{
      sourceNodeId: string;
      targetNodeId: string;
      sourceType: SemanticGraphSourceType;
      sourceId: string;
      targetType: SemanticGraphSourceType;
      targetId: string;
      sourceContentHash?: string;
      targetContentHash?: string;
      score: number;
    }> = [];

    for (const ref of refs) {
      // Skip self-references — a page that mentions its own parallx URI
      // (e.g. a "share this link" block) shouldn't produce a self-edge.
      if (ref.targetType === sourceType && ref.targetId === sourceId) continue;

      // Verify the target is actually indexed. getContentHash returning a
      // value means the source exists in the vector index.
      const targetContentHash = await this._vectorStore.getContentHash(ref.targetType, ref.targetId);
      if (!targetContentHash) continue;

      const targetNodeId = this._sourceToNodeId(ref.targetType, ref.targetId);
      if (!targetNodeId) continue;

      edges.push({
        sourceNodeId,
        targetNodeId,
        sourceType,
        sourceId,
        targetType: ref.targetType,
        targetId: ref.targetId,
        targetContentHash,
        // References are explicit so they get a score of 1.0 — distinct from
        // similarity's continuous score. The renderer can use this to draw
        // references at full opacity vs similarity edges at score-scaled
        // opacity. Producers that emit fuzzier signals can use < 1.0 here.
        score: 1.0,
      });
    }

    await this._replaceSourceEdges(sourceType, sourceId, 'references', 'forward', null, edges);
  }

  /**
   * M76 Phase 2 — emit `same-folder` edges between files that live in the
   * same parent directory. Pages don't have folders (they have parent
   * pages, which Phase 4+ may treat similarly), so this producer is a
   * no-op for page sources.
   *
   * Edges are undirected (canonicalised by node id) and capped per source
   * to avoid runaway density in folders containing hundreds of files. The
   * cap is symmetric: pathological folders silently lose edges past the
   * cap but the graph stays renderable.
   *
   * Limitation: adding a new sibling B does not trigger A to recompute
   * its same-folder edges — only A's own content change does. The new
   * sibling's recompute will write the canonical (A, B) row from B's
   * origin, so the edge still appears, but A's origin remains unaware.
   * This is acceptable for Phase 2; a full sibling-aware reactor is a
   * future polish.
   */
  private async _recomputeSameFolderEdges(
    sourceType: SemanticGraphSourceType,
    sourceId: string,
    sourceNodeId: string,
  ): Promise<void> {
    // Same-folder is file-scoped only. Page sources get an empty wipe so
    // any previously-mis-classified rows clear cleanly.
    if (sourceType !== 'file_chunk') {
      await this._replaceSourceEdges(sourceType, sourceId, 'same-folder', 'undirected', null, []);
      return;
    }

    const folder = _parentFolder(sourceId);
    if (folder === null) {
      // Top-level file — no folder to share with anyone.
      await this._replaceSourceEdges(sourceType, sourceId, 'same-folder', 'undirected', null, []);
      return;
    }

    const allSources = await this._vectorStore.getIndexedSources();
    const siblings: { sourceId: string; nodeId: string }[] = [];
    for (const s of allSources) {
      if (s.sourceType !== 'file_chunk') continue;
      if (s.sourceId === sourceId) continue;
      if (_parentFolder(s.sourceId) !== folder) continue;
      const nodeId = this._sourceToNodeId('file_chunk', s.sourceId);
      if (!nodeId) continue;
      siblings.push({ sourceId: s.sourceId, nodeId });
      // Cap per source to keep dense folders renderable.
      if (siblings.length >= 25) break;
    }

    const edges = siblings.map((sib) => {
      const pair = canonicalizeSemanticEdgePair(
        { nodeId: sourceNodeId, sourceType: 'file_chunk', sourceId },
        { nodeId: sib.nodeId, sourceType: 'file_chunk', sourceId: sib.sourceId },
      );
      return {
        sourceNodeId: pair.source.nodeId,
        targetNodeId: pair.target.nodeId,
        sourceType: pair.source.sourceType,
        sourceId: pair.source.sourceId,
        targetType: pair.target.sourceType,
        targetId: pair.target.sourceId,
        score: 1.0,
      };
    });

    await this._replaceSourceEdges(sourceType, sourceId, 'same-folder', 'undirected', null, edges);
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

  /**
   * Per-kind upsert. Deletes existing edges with this (origin, kind) tuple
   * and writes the new set. Multi-kind producers call this once per kind
   * for the same source — each call is independent so a source can
   * simultaneously produce 'similar-to' edges, 'references' edges, and
   * metadata edges without interfering.
   *
   * `contentHash` is recorded on `semantic_graph_sources` so the similarity
   * recompute can skip unchanged sources. Other kinds may pass `null` if
   * they don't gate on content hash.
   */
  private async _replaceSourceEdges(
    sourceType: SemanticGraphSourceType,
    sourceId: string,
    kind: SemanticGraphEdgeKind,
    direction: SemanticGraphEdgeDirection,
    contentHash: string | null,
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
        sql: 'DELETE FROM semantic_graph_edges WHERE origin_type = ? AND origin_id = ? AND kind = ?',
        params: [sourceType, sourceId, kind],
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
                direction,
                source_content_hash,
                target_content_hash,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
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
          kind,
          direction,
          edge.sourceContentHash ?? null,
          edge.targetContentHash ?? null,
        ],
      });
    }

    if (contentHash !== null) {
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
    }

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

  private _nodeIdToSource(nodeId: string): { sourceType: SemanticGraphSourceType; sourceId: string } | undefined {
    if (nodeId.startsWith('page:')) {
      return { sourceType: 'page_block', sourceId: nodeId.slice(5) };
    }
    if (nodeId.startsWith('file:')) {
      const root = this._workspaceRootUri();
      if (!root) return undefined;
      const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
      const uri = nodeId.slice(5);
      if (!uri.startsWith(normalizedRoot)) return undefined;
      const rel = uri.slice(normalizedRoot.length).replace(/^\/+/, '');
      return { sourceType: 'file_chunk', sourceId: rel };
    }
    return undefined;
  }

  private _workspaceRootUri(): string | undefined {
    const root = this._workspaceService.folders[0]?.uri;
    return root ? root.toString() : undefined;
  }
}
