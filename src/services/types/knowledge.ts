// knowledge.ts — service interfaces for knowledge: the database, extraction, embeddings, chunks, the vector store, indexing, pages, the semantic graph, retrieval, memory, suggestions.
//
// One file of services/types/; serviceTypes.ts re-exports them all, so import
// from '../serviceTypes.js' as before.

import { createServiceIdentifier } from '../../platform/types.js';
import { IDisposable } from '../../platform/lifecycle.js';
import { Event } from '../../platform/events.js';

// ─── IDatabaseService ────────────────────────────────────────────────────────

/**
 * Service providing SQLite database access via IPC to the main process.
 * Database is scoped to the active workspace folder.
 */
export interface IDatabaseService extends IDisposable {
  /** Whether a database is currently open. */
  readonly isOpen: boolean;

  /** The path to the currently open database, or null. */
  readonly currentPath: string | null;

  /** Fires after a database is opened (payload: dbPath). */
  readonly onDidOpen: Event<string>;

  /** Fires after a database is closed. */
  readonly onDidClose: Event<void>;

  /** Open a database for the given workspace path. */
  openForWorkspace(workspacePath: string, migrationsDir?: string): Promise<void>;

  /** Close the current database. */
  close(): Promise<void>;

  /** Run migration scripts. */
  migrate(migrationsDir: string): Promise<void>;

  /** Execute a write statement. */
  run(sql: string, params?: unknown[]): Promise<import('../databaseService.js').DatabaseRunResult>;

  /** Execute a query returning a single row. */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;

  /** Execute a query returning all rows. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Execute multiple operations in a transaction. */
  runTransaction(operations: import('../databaseService.js').TransactionOp[]): Promise<unknown[]>;

  /**
   * Fires after any successful WRITE through this service or through a
   * tool bridge from asBridge() — the chokepoint every persistent SQL
   * mutation passes, and therefore the workspace data stream's source.
   */
  readonly onDidWrite: Event<import('../databaseService.js').DatabaseWriteEvent>;

  /**
   * The envelope-style bridge tools consume ({error, rows} results, no
   * throws). Routing tools through this — instead of the raw
   * window.parallxElectron.database — puts their writes on onDidWrite.
   */
  asBridge(): import('../databaseService.js').ToolDatabaseBridge;
}

export const IDatabaseService = createServiceIdentifier<IDatabaseService>('IDatabaseService');

// ─── IDocumentExtractionService ─────────────────────────────

/**
 * Pipeline type indicating which extraction method was used.
 */
export type ExtractionPipeline = 'docling' | 'docling-ocr' | 'legacy';

/**
 * Result of extracting structured content from a rich document.
 */
export interface DocumentExtractionResult {
  /** Structured Markdown output (or plain text for legacy). */
  markdown: string;
  /** Number of pages detected (0 if unknown). */
  pageCount: number;
  /** Number of tables recovered from the document. */
  tablesFound: number;
  /** Time in ms the extraction took. */
  elapsedMs: number;
  /** Diagnostic messages from the extraction pipeline. */
  diagnostics: string[];
  /** Which pipeline was used. */
  pipeline: ExtractionPipeline;
}

/**
 * Status of the Docling bridge service.
 */
export type DoclingBridgeStatus = 'unavailable' | 'starting' | 'available' | 'downloading-models' | 'error';

/**
 * Manages document extraction via the Docling bridge (primary) with
 * fallback to legacy extractors (pdf-parse, mammoth, SheetJS).
 *
 * Reference: docs/archive/milestones/Parallx_Milestone_21.md Phase A
 */
export interface IDocumentExtractionService extends IDisposable {
  /** Whether Docling is available on this system. */
  readonly isDoclingAvailable: boolean;

  /** Current bridge status. */
  readonly bridgeStatus: DoclingBridgeStatus;

  /** Event fired when Docling availability changes. */
  readonly onDidChangeAvailability: Event<boolean>;

  /** Event fired when bridge status changes. */
  readonly onDidChangeBridgeStatus: Event<DoclingBridgeStatus>;

  /**
   * Extract structured Markdown from a rich document.
   * Tries Docling first, falls back to legacy extractors.
   */
  extractDocument(filePath: string, options?: {
    ocr?: boolean;
  }): Promise<DocumentExtractionResult>;

  /**
   * Extract a batch of rich documents via Docling in a single round-trip.
   * Falls back to sequential extractDocument() calls if batch API is unavailable.
   *
   * @param files — Array of file paths with extraction options.
   * @returns Map from file path to extraction result (or error).
   */
  extractBatch(files: { path: string; ocr?: boolean }[]): Promise<Map<string, DocumentExtractionResult>>;

  /**
   * Initialize the service: detect Python, start Docling bridge.
   * Called once during workbench initialization.
   */
  initialize(): Promise<void>;
}

export const IDocumentExtractionService = createServiceIdentifier<IDocumentExtractionService>('IDocumentExtractionService');

// ─── IEmbeddingService ──────────────────────────────────────

/**
 * Generates text embeddings via Ollama's /api/embed endpoint.
 * Uses nomic-embed-text v1.5 with mandatory task prefixes.
 *
 * Reference: docs/archive/milestones/Parallx_Milestone_10.md DR-1, DR-2
 */
export interface IEmbeddingService extends IDisposable {
  /** Embed a single document text (adds 'search_document:' prefix). */
  embedDocument(text: string, contentHash?: string): Promise<number[]>;

  /** Embed a user query (adds 'search_query:' prefix). */
  embedQuery(query: string): Promise<number[]>;

  /** Embed multiple document texts in batch. */
  embedDocumentBatch(texts: string[], contentHashes?: string[], signal?: AbortSignal): Promise<number[][]>;

  /** Get model info (name, dimensions, installed status). */
  getModelInfo(): { name: string; dimensions: number; installed: boolean };

  /** Ensure the embedding model is installed (pulls if not). */
  ensureModel(signal?: AbortSignal): Promise<void>;

  /** Clear the in-memory embedding cache. */
  clearCache(): void;

  /** Current number of cached embeddings. */
  readonly cacheSize: number;

  /** Fires when an embedding batch starts. */
  readonly onDidStartEmbedding: Event<{ count: number }>;

  /** Fires when an embedding batch completes. */
  readonly onDidFinishEmbedding: Event<{ count: number; durationMs: number }>;

  /**
   * install (or clear) an off-thread transport that replaces the
   * in-process `/api/embed` fetch. Caching, retry, and prefixing all stay
   * on the main thread; the transport just owns the network round-trip +
   * JSON parse + dimension check.
   */
  setTransport?(transport: ((inputs: string[], signal?: AbortSignal) => Promise<number[][]>) | null): void;

  /** Ollama base URL (so transports can forward the same config). */
  readonly baseUrl?: string;

  /** embedding model name (so transports can forward the same config). */
  readonly model?: string;
}

export const IEmbeddingService = createServiceIdentifier<IEmbeddingService>('IEmbeddingService');

// ─── IChunkingService ───────────────────────────────────────

/**
 * Splits content into chunks suitable for embedding and retrieval.
 * Supports canvas pages (TipTap JSON) and workspace files.
 *
 * Reference: docs/archive/milestones/Parallx_Milestone_10.md DR-6, DR-8
 */
export interface IChunkingService extends IDisposable {
  /** Chunk a canvas page by TipTap block boundaries. */
  chunkPage(pageId: string, pageTitle: string, contentJson: string): Promise<import('../chunkingService.js').Chunk[]>;

  /** Chunk a workspace file by headings/paragraphs. */
  chunkFile(filePath: string, content: string, language?: string): Promise<import('../chunkingService.js').Chunk[]>;
}

export const IChunkingService = createServiceIdentifier<IChunkingService>('IChunkingService');

// ─── IVectorStoreService ────────────────────────────────────

/**
 * Manages the dual vector + keyword index (sqlite-vec vec0 + FTS5).
 * Provides upsert, delete, and hybrid search with RRF fusion.
 *
 * Reference: docs/archive/milestones/Parallx_Milestone_10.md DR-3, DR-4, DR-5
 */
export interface IVectorStoreService extends IDisposable {
  /** Upsert embedded chunks for a source. */
  upsert(
    sourceType: string,
    sourceId: string,
    chunks: import('../vectorStoreService.js').EmbeddedChunk[],
    contentHash: string,
    summary?: string,
    sourceMetadata?: import('../vectorStoreService.js').SourceIndexMetadata,
  ): Promise<void>;

  /**
   * batch upsert N sources into one `runTransaction` IPC.
   * Drops main-process IPC count by ≥10× during bulk indexing.
   */
  upsertMany?(
    records: ReadonlyArray<{
      sourceType: string;
      sourceId: string;
      chunks: import('../vectorStoreService.js').EmbeddedChunk[];
      contentHash: string;
      summary?: string;
      sourceMetadata?: import('../vectorStoreService.js').SourceIndexMetadata;
    }>,
  ): Promise<void>;

  /** Delete all chunks for a source. */
  deleteSource(sourceType: string, sourceId: string): Promise<void>;

  /** Hybrid search: vector + keyword, merged via RRF. */
  search(
    queryEmbedding: number[],
    queryText: string,
    options?: import('../vectorStoreService.js').SearchOptions,
  ): Promise<import('../vectorStoreService.js').SearchResult[]>;

  /** Vector-only search (for "find similar"). */
  vectorSearch(
    queryEmbedding: number[],
    topK?: number,
    sourceFilter?: string,
  ): Promise<import('../vectorStoreService.js').SearchResult[]>;

  /** Get stored content hash for incremental re-indexing. */
  getContentHash(sourceType: string, sourceId: string): Promise<string | null>;

  /** Bulk-fetch indexed_at timestamps: source_id → epoch ms. */
  getIndexedAtMap(sourceType: string): Promise<Map<string, number>>;

  /** Get all indexed sources. */
  getIndexedSources(): Promise<import('../vectorStoreService.js').IndexingMeta[]>;

  /** Get aggregate statistics. */
  getStats(): Promise<import('../vectorStoreService.js').VectorStoreStats>;

  /** Get document summaries for all indexed sources. Map<sourceId, summary>. */
  getDocumentSummaries(): Promise<Map<string, string>>;

  /** Batch-fetch stored embeddings by rowid. Returns Map<rowid, float[]>. */
  getEmbeddings(rowids: number[]): Promise<Map<number, number[]>>;

  /** Compute a centroid from stored vectors for one indexed source. Does not embed. */
  getSourceCentroid(sourceType: string, sourceId: string): Promise<import('../vectorStoreService.js').SourceCentroid | undefined>;

  /** evenly-sampled per-chunk embeddings for segment-level
   *  similarity (optional so lightweight fakes stay valid). Does not embed. */
  getSourceChunkVectors?(sourceType: string, sourceId: string, limit?: number): Promise<number[][]>;

  /** one title per indexed source (page titles from chunk context
   *  prefixes, file basenames otherwise). Optional, read-only. */
  getSourceTitles?(): Promise<Array<{ sourceType: string; sourceId: string; title: string }>>;

  /**
   * Fetch nearby section/page companion chunks for a retrieved anchor.
   * Used by retrieval-time structure-aware expansion on hard documents.
   */
  getStructuralCompanions(
    anchor: import('../vectorStoreService.js').SearchResult,
    options?: { limit?: number },
  ): Promise<import('../vectorStoreService.js').SearchResult[]>;

  /** Get trace information for the most recent hybrid search. */
  getLastSearchTrace?(): import('../vectorStoreService.js').HybridSearchTrace | undefined;

  /** Delete ALL data from vec_embeddings, fts_chunks, and indexing_metadata. */
  purgeAll(): Promise<void>;

  /** Fires when a source is indexed/re-indexed. */
  readonly onDidUpdateIndex: Event<{ sourceId: string; chunkCount: number }>;

  /** Fetch stored chunk texts for one indexed source, ordered by chunk index. */
  getSourceChunks(
    sourceType: string,
    sourceId: string,
    limit?: number,
  ): Promise<Array<{ text: string; contextPrefix: string; chunkIndex: number }>>;
}

export const IVectorStoreService = createServiceIdentifier<IVectorStoreService>('IVectorStoreService');

// ─── IIndexingPipelineService ─────────────────────────

/**
 * Orchestrates indexing of canvas pages and workspace files into the
 * vector store. Handles initial full-index on workspace open and
 * incremental re-indexing on saves/file changes.
 *
 * Reference: docs/archive/milestones/Parallx_Milestone_10.md Phase 2
 */
export interface IIndexingPipelineService extends IDisposable {
  /** Whether the pipeline is currently running. */
  readonly isIndexing: boolean;

  /** Current progress snapshot. */
  readonly progress: import('../indexingPipeline.js').IndexingProgress;

  /** Whether the initial full indexing has completed at least once. */
  readonly isInitialIndexComplete: boolean;

  /** Start the full indexing pipeline (pages + files). */
  start(): Promise<void>;

  /** Cancel in-progress indexing. */
  cancel(): void;

  /** Force re-index a single page (bypass debounce). */
  reindexPage(pageId: string): Promise<void>;

  /** Force re-index a single file (bypass debounce). */
  reindexFile(filePath: string): Promise<void>;

  /** Schedule a debounced page re-index. */
  schedulePageReindex(pageId: string): void;

  /** Schedule a debounced file re-index. */
  scheduleFileReindex(filePath: string): void;

  /**
   * Wire a feature-flag accessor (typically backed by
   * `AutonomyFeatureFlagsService`). When `'indexing.lazyMtime.enabled'`
   * returns true, page-side mtime fast-skip is active. Optional;
   * unwired pipelines fall back to the legacy content-hash check.
   */
  setFlagAccessor?(accessor: (flagId: string) => boolean): void;

  /** Fires when indexing progress changes. */
  readonly onDidChangeProgress: Event<import('../indexingPipeline.js').IndexingProgress>;

  /** Fires when a single source (page or file) finishes indexing. */
  readonly onDidIndexSource: Event<import('../indexingPipeline.js').IndexingSourceResult>;

  /** Fires when initial indexing completes. */
  readonly onDidCompleteInitialIndex: Event<{ pages: number; files: number; durationMs: number }>;
}

// ─── Canvas Page Query Service ────────────────────────────────────────

/**
 * Read-only canvas page query service exposed to the tool API.
 *
 * This is a minimal subset of ICanvasDataService — only the methods
 * needed to enumerate pages and listen for changes. No mutations,
 * no content, no auto-save. The canvas built-in registers the concrete
 * implementation onto the ServiceCollection during activation.
 */
export interface ICanvasPageQueryService {
  /** Get all non-archived pages (lightweight metadata only). */
  getRootPages(): Promise<{ id: string; parentId: string | null; title: string; icon: string | null; isFavorited: boolean; isArchived: boolean; createdAt: string; updatedAt: string }[]>;

  /** Get child pages of a parent. */
  getChildren(parentId: string): Promise<{ id: string; parentId: string | null; title: string; icon: string | null; isFavorited: boolean; isArchived: boolean; createdAt: string; updatedAt: string }[]>;

  /** Get the full page tree (hierarchical). */
  getPageTree(): Promise<{ id: string; parentId: string | null; title: string; icon: string | null; isFavorited: boolean; isArchived: boolean; createdAt: string; updatedAt: string; children: any[] }[]>;

  /** Fires when a page is created, updated, deleted, moved, or reordered. */
  readonly onDidChangePage: Event<{ kind: string; pageId: string; page?: { id: string; parentId: string | null; title: string; icon: string | null; isFavorited: boolean; isArchived: boolean; createdAt: string; updatedAt: string } }>;
}

export const ICanvasPageQueryService = createServiceIdentifier<ICanvasPageQueryService>('ICanvasPageQueryService');

export const IIndexingPipelineService = createServiceIdentifier<IIndexingPipelineService>('IIndexingPipelineService');

// ─── ISemanticGraphService ───────────────────────────────────────────

/**
 * Builds and serves cached semantic edges for Workspace Graph from stored
 * vector data. This service must not call embedding/model/Ollama paths.
 */
export interface ISemanticGraphService extends IDisposable {
  /** Fires when cached semantic graph edges change. */
  readonly onDidChangeEdges: Event<void>;

  /** Start low-priority cache initialization. Safe to call multiple times. */
  ensureCacheStarted(): void;

  /** Stop building the cache (its tool was turned off). Safe to call when stopped. */
  stopCache(): void;

  /** True while a tool keeps the cache running. */
  readonly isCacheStarted: boolean;

  /** Queue one indexed source for semantic-edge recompute. */
  scheduleSource(
    sourceType: import('../semanticGraphService.js').SemanticGraphSourceType,
    sourceId: string,
  ): void;

  /** Queue all indexed page/file sources whose cache may be stale. */
  rebuildChangedSources(): Promise<void>;

  /** Read cached semantic graph edges. Does not perform vector search. */
  getCachedEdges(
    options?: import('../semanticGraphService.js').SemanticGraphEdgeOptions,
  ): Promise<import('../semanticGraphService.js').SemanticGraphEdge[]>;

  /** Lightweight diagnostics for settings/logging surfaces. */
  getStats(): Promise<import('../semanticGraphService.js').SemanticGraphStats>;

  /**
   * Fetch stored chunk texts for a graph node id (e.g. `page:<id>` or `file:<uri>`).
   * Returns an empty array if the node has no indexed content. Never calls a model.
   */
  getNodeChunks(
    nodeId: string,
    maxChunks?: number,
  ): Promise<import('../semanticGraphService.js').NodeChunk[]>;

  /**
   * Concept nodes materialised by the clustering pass. Used
   * by the workspace-graph extension to render concept nodes with their
   * labels. Excludes user-deleted tombstone rows.
   */
  getConceptNodes(): Promise<import('../semanticGraphService.js').ConceptNodeRow[]>;

  /** Rename a concept node and mark it user_renamed. */
  renameConceptNode(stableId: string, newLabel: string): Promise<void>;

  /** Soft-delete a concept node — sticky across refreshes. */
  deleteConceptNode(stableId: string): Promise<void>;

  /** Merge `mergedId` into `survivorId`; survivor keeps label/id. */
  mergeConceptNodes(survivorId: string, mergedId: string): Promise<void>;

  /** Wipe all concept-clustering state for a clean restart. */
  forceFullReCluster(): Promise<void>;

  /** Compact diagnostics for /context and the settings panel. */
  getMindMapDiagnostics(): Promise<import('../semanticGraphService.js').IMindMapDiagnostics>;
}

export const ISemanticGraphService = createServiceIdentifier<ISemanticGraphService>('ISemanticGraphService');

// ─── IMindMapRefreshOrchestrator ────────────────────────────

/**
 * Owns the user-initiated, incremental refresh of LLM-driven mind-map
 * producers. Phase 4 (lineage) and Phase 5 (concept clustering) register
 * themselves here. Workspace-graph UI subscribes to status events.
 *
 * Never runs autonomously — only when something calls startRefresh().
 */
export interface IMindMapRefreshOrchestrator extends IDisposable {
  readonly onDidChangeStatus: Event<import('../mindMapRefreshOrchestrator.js').RefreshStatus>;
  readonly onDidComplete: Event<import('../mindMapRefreshOrchestrator.js').RefreshResult>;

  getStatus(): import('../mindMapRefreshOrchestrator.js').RefreshStatus;
  registerPass(pass: import('../mindMapRefreshOrchestrator.js').RefreshPass): IDisposable;
  getRegisteredPasses(): readonly { id: string; displayName: string }[];
  preview(): Promise<import('../mindMapRefreshOrchestrator.js').RefreshPreview>;
  startRefresh(): Promise<import('../mindMapRefreshOrchestrator.js').RefreshResult>;
  cancelRefresh(): void;
  getRefreshHistory(
    limit?: number,
  ): Promise<import('../mindMapRefreshOrchestrator.js').RefreshHistoryEntry[]>;
}

export const IMindMapRefreshOrchestrator = createServiceIdentifier<IMindMapRefreshOrchestrator>(
  'IMindMapRefreshOrchestrator',
);

// ─── IRetrievalService ─────────────────────────────────────

/**
 * Query-time retrieval: embeds user queries, runs hybrid search, applies
 * post-retrieval filtering (score threshold, dedup, token budget), and
 * returns ranked context chunks with source attribution.
 *
 * Reference: docs/archive/milestones/Parallx_Milestone_10.md Phase 3 Task 3.1
 */
export interface IRetrievalService extends IDisposable {
  /** Retrieve relevant context chunks for a query. */
  retrieve(
    query: string,
    options?: import('../retrievalService.js').RetrievalOptions,
  ): Promise<import('../retrievalService.js').RetrievedContext[]>;

  /** Format retrieved chunks for injection into a chat message. */
  formatContext(
    chunks: import('../retrievalService.js').RetrievedContext[],
  ): string;

  /** Get trace information for the most recent retrieval request. */
  getLastTrace?(): import('../retrievalService.js').RetrievalTrace | undefined;
}

export const IRetrievalService = createServiceIdentifier<IRetrievalService>('IRetrievalService');

// ─── IMemoryService ──────────────────────────────────

/**
 * Manages conversation memory and user preference learning.
 *
 * Task 5.1 — Conversation Memory:
 *   Stores LLM-generated summaries of past sessions, embeds them in the
 *   vector index, and retrieves relevant memories for new sessions.
 *
 * Task 5.2 — User Preference Learning:
 *   Extracts and persists preference statements from conversations,
 *   formats them for injection into the system prompt.
 */
export interface IMemoryService extends IDisposable {
  /** Fires when a conversation memory is stored or updated. */
  readonly onDidUpdateMemory: Event<string>;
  /** Fires when a user preference is created or updated. */
  readonly onDidUpdatePreferences: Event<import('../memoryService.js').UserPreference>;

  /** Whether a session has enough messages to summarise. */
  isSessionEligibleForSummary(messageCount: number): boolean;

  /** Whether a memory already exists for the given session. */
  hasMemory(sessionId: string): Promise<boolean>;

  /**
   * Get the message count stored with the last summary for a session.
   * Returns `null` if no memory exists. Used for growth-based re-summarization.
   */
  getMemoryMessageCount(sessionId: string): Promise<number | null>;

  /** Store a conversation summary (after LLM summarisation). */
  storeMemory(sessionId: string, summary: string, messageCount: number): Promise<void>;

  /** Retrieve relevant memories for a query via hybrid search. */
  recallMemories(
    query: string,
    options?: import('../memoryService.js').MemoryRetrievalOptions,
  ): Promise<import('../memoryService.js').ConversationMemory[]>;

  /** Format retrieved memories for injection into a chat message. */
  formatMemoryContext(memories: import('../memoryService.js').ConversationMemory[]): string;

  /** Get all stored memories. */
  getAllMemories(): Promise<import('../memoryService.js').ConversationMemory[]>;

  /** Delete a specific memory by session ID. */
  deleteMemory(sessionId: string): Promise<void>;

  /** Get all stored user preferences, ordered by frequency. */
  getPreferences(): Promise<import('../memoryService.js').UserPreference[]>;

  /** Format preferences for system prompt injection. */
  formatPreferencesForPrompt(preferences: import('../memoryService.js').UserPreference[]): string;

  /** Delete a specific preference by key. */
  deletePreference(key: string): Promise<void>;

  /** Clear all memories and preferences. */
  clearAll(): Promise<void>;

  // ── Decay & Eviction ──

  /** Recalculate decay scores for all memories. */
  recalculateDecayScores(): Promise<void>;

  /** Evict stale memories that have decayed below threshold. */
  evictStaleContent(): Promise<{ memoriesEvicted: number }>;
}

export const IMemoryService = createServiceIdentifier<IMemoryService>('IMemoryService');
