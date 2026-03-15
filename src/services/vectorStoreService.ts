// vectorStoreService.ts — IVectorStoreService implementation (M10 Task 1.2)
//
// Manages the vec_embeddings (sqlite-vec vec0) and fts_chunks (FTS5) tables.
// Provides upsert, delete, and dual-index search (vector + keyword).
// All database operations go through DatabaseService IPC to the main process.
//
// Key design decisions:
//   - Embeddings stored as BLOB (Float32Array binary) in vec0 table
//   - FTS5 mirrors vec_embeddings for keyword/BM25 retrieval
//   - Dual writes: every upsert writes to BOTH vec_embeddings AND fts_chunks
//   - indexing_metadata table tracks content hashes for incremental re-indexing
//   - Reciprocal Rank Fusion merges vector + keyword results
//
// References:
//   - docs/Parallx_Milestone_10.md DR-3 (sqlite-vec), DR-4 (FTS5), DR-5 (RRF)

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { IDatabaseService, IVectorStoreService } from './serviceTypes.js';
import type { Chunk } from './chunkingService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Smoothing constant for Reciprocal Rank Fusion (Cormack et al., 2009). */
const RRF_K = 60;

/** Default number of candidates to retrieve from each index before fusion.
 * Increased from 20 to 40 to provide a larger candidate pool for RRF fusion
 * and LLM re-ranking (Anthropic recommends top-150 → rerank → top-20).
 */
const DEFAULT_CANDIDATE_K = 40;

/** Default final top-K after fusion. */
const DEFAULT_TOP_K = 10;

/** Minimum RRF score threshold (chunks below this are dropped). */
const DEFAULT_MIN_SCORE = 0.0;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A chunk with its embedding vector, ready for storage. */
export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

export type RetrievalExtractionPipeline = 'canvas' | 'docling' | 'docling-ocr' | 'legacy' | 'text';

export interface SourceIndexMetadata {
  documentKind?: string;
  extractionPipeline?: RetrievalExtractionPipeline;
  extractionFallback?: boolean;
  classificationConfidence?: number;
  classificationReason?: string;
}

/** A single search result from the vector store. */
export interface SearchResult {
  /** Auto-assigned rowid from vec_embeddings. */
  rowid: number;
  /** Source type: 'page_block' or 'file_chunk'. */
  sourceType: string;
  /** Source identifier (page UUID or file path). */
  sourceId: string;
  /** Chunk position within the source. */
  chunkIndex: number;
  /** Original chunk text. */
  chunkText: string;
  /** Structural context prefix. */
  contextPrefix: string;
  /** Fused relevance score (higher = more relevant). */
  score: number;
  /** Which retrieval methods contributed to this result. */
  sources: string[];
  /** Nested heading breadcrumb for this chunk, if one exists. */
  headingPath?: string;
  /** Immediate structural parent breadcrumb for this chunk, if one exists. */
  parentHeadingPath?: string;
  /** Coarse structural role used by later retrieval/ranking passes. */
  structuralRole?: string;
  /** Source-level retrieval metadata persisted during indexing. */
  documentKind?: string;
  extractionPipeline?: RetrievalExtractionPipeline;
  extractionFallback?: boolean;
  classificationConfidence?: number;
  classificationReason?: string;
}

/** Options for search queries. */
export interface SearchOptions {
  /** Max results to return after fusion (default: 10). */
  topK?: number;
  /** Filter by source type ('page_block', 'file_chunk'). */
  sourceFilter?: string;
  /** Restrict search to an explicit set of source IDs (workspace-relative file paths or page IDs). */
  sourceIds?: string[];
  /** Restrict search to sources whose source_id starts with one of these prefixes (scope filtering). */
  pathPrefixes?: string[];
  /** Minimum RRF score threshold. */
  minScore?: number;
  /** Whether to include keyword (FTS5 BM25) search. */
  includeKeyword?: boolean;
}

export interface KeywordSearchTrace {
  query: string;
  fallbackQuery?: string;
  fallbackUsed: boolean;
  andResultCount: number;
  finalResultCount: number;
}

export interface HybridSearchTrace {
  queryText: string;
  topK: number;
  candidateK: number;
  sourceFilter?: string;
  sourceIds?: string[];
  pathPrefixes?: string[];
  includeKeyword: boolean;
  vectorResultCount: number;
  keywordResultCount: number;
  fusedResultCount: number;
  finalResultCount: number;
  keywordTrace?: KeywordSearchTrace;
}

interface StructuralCompanionRow {
  rowid: number;
  source_type: string;
  source_id: string;
  chunk_index: number;
  chunk_text: string;
  context_prefix: string;
  heading_path?: string;
  parent_heading_path?: string;
  structural_role?: string;
  document_kind?: string;
  extraction_pipeline?: RetrievalExtractionPipeline;
  extraction_fallback?: number | boolean;
  classification_confidence?: number;
  classification_reason?: string;
}

/** Indexing metadata for a source (page or file). */
export interface IndexingMeta {
  sourceType: string;
  sourceId: string;
  contentHash: string;
  chunkCount: number;
  indexedAt: string;
  /** Brief content summary (first ~200 chars of extracted text). */
  summary?: string;
  documentKind?: string;
  extractionPipeline?: RetrievalExtractionPipeline;
  extractionFallback?: boolean;
  classificationConfidence?: number;
  classificationReason?: string;
}

/** Statistics about the vector store. */
export interface VectorStoreStats {
  totalChunks: number;
  totalSources: number;
  bySourceType: Record<string, number>;
  /** Number of distinct sources (pages/files) per source_type. */
  sourceCountByType: Record<string, number>;
}

// ─── VectorStoreService ──────────────────────────────────────────────────────

/**
 * Service managing the dual vector + keyword index.
 *
 * Wraps the vec_embeddings (sqlite-vec vec0) and fts_chunks (FTS5) tables,
 * providing upsert, delete, search, and hybrid retrieval with RRF fusion.
 */
export class VectorStoreService extends Disposable implements IVectorStoreService {

  private readonly _db: IDatabaseService;
  private _lastSearchTrace: HybridSearchTrace | undefined;

  // ── Events ──

  private readonly _onDidUpdateIndex = this._register(new Emitter<{ sourceId: string; chunkCount: number }>());
  readonly onDidUpdateIndex: Event<{ sourceId: string; chunkCount: number }> = this._onDidUpdateIndex.event;

  constructor(databaseService: IDatabaseService) {
    super();
    this._db = databaseService;
  }

  // ── Upsert ──

  /**
   * Upsert embedded chunks for a source (page or file).
   * Deletes all existing chunks for the source, then inserts new ones.
   * Writes to both vec_embeddings and fts_chunks atomically.
   *
   * @param sourceType — 'page_block' or 'file_chunk'
   * @param sourceId — page UUID or file path
   * @param chunks — chunks with embeddings to store
   * @param contentHash — hash of the full source content
   * @param summary — optional brief content summary for the workspace digest
   */
  async upsert(
    sourceType: string,
    sourceId: string,
    chunks: EmbeddedChunk[],
    contentHash: string,
    summary?: string,
    sourceMetadata?: SourceIndexMetadata,
  ): Promise<void> {
    // Build transaction operations: delete old, insert new
    const operations: { type: 'run'; sql: string; params?: unknown[] }[] = [];

    // 1. Delete existing chunks for this source from both tables
    operations.push({
      type: 'run',
      sql: 'DELETE FROM fts_chunks WHERE source_type = ? AND source_id = ?',
      params: [sourceType, sourceId],
    });
    operations.push({
      type: 'run',
      sql: 'DELETE FROM chunk_metadata WHERE source_type = ? AND source_id = ?',
      params: [sourceType, sourceId],
    });

    // For vec0, we need to delete by rowid. First find existing rowids.
    // Since vec0 doesn't support WHERE on auxiliary columns directly for DELETE,
    // we handle this by deleting via rowid lookup.
    const existingRows = await this._db.all<{ rowid: number }>(
      `SELECT rowid FROM vec_embeddings WHERE source_type = ? AND source_id = ?`,
      [sourceType, sourceId],
    );

    for (const row of existingRows) {
      operations.push({
        type: 'run',
        sql: 'DELETE FROM vec_embeddings WHERE rowid = ?',
        params: [row.rowid],
      });
    }

    // 2. Insert new chunks
    //    - vec0 auto-generates rowid (explicit rowid rejected by sqlite-vec 0.1.7-alpha.2)
    //    - chunk_index stored as TEXT (vec0 rejects INTEGER aux columns in this build)
    //    - fts_chunks.chunk_id uses '$lastRowId' sentinel, resolved by runTransaction
    //      to the auto-assigned rowid from the preceding vec_embeddings INSERT
    for (const chunk of chunks) {
      // Convert embedding to Float32Array binary for sqlite-vec
      const embeddingBlob = float32ArrayToBuffer(chunk.embedding);

      operations.push({
        type: 'run',
        sql: `INSERT INTO vec_embeddings(embedding, source_type, source_id, chunk_index, chunk_text, context_prefix, content_hash)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          embeddingBlob,
          chunk.sourceType,
          chunk.sourceId,
          String(chunk.chunkIndex),
          chunk.text,
          chunk.contextPrefix,
          chunk.contentHash,
        ],
      });

      operations.push({
        type: 'run',
        sql: `INSERT INTO chunk_metadata(chunk_id, source_type, source_id, chunk_index, heading_path, parent_heading_path, structural_role)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          '$lastRowId',
          chunk.sourceType,
          chunk.sourceId,
          chunk.chunkIndex,
          chunk.headingPath ?? null,
          chunk.parentHeadingPath ?? null,
          chunk.structuralRole ?? null,
        ],
      });

      // BM25 metadata enrichment (M16 Task 3.1): prepend contextPrefix to
      // FTS5 content so keyword search can match on page titles, section
      // headings, and file paths — not just the chunk body text.
      const ftsContent = chunk.contextPrefix
        ? `${chunk.contextPrefix} ${chunk.text}`
        : chunk.text;

      operations.push({
        type: 'run',
        sql: `INSERT INTO fts_chunks(chunk_id, source_type, source_id, content)
              VALUES (?, ?, ?, ?)`,
        params: ['$lastRowId', chunk.sourceType, chunk.sourceId, ftsContent],
      });
    }

    // 3. Upsert indexing metadata (with optional content summary)
    operations.push({
      type: 'run',
      sql: `INSERT OR REPLACE INTO indexing_metadata(
              source_type,
              source_id,
              content_hash,
              chunk_count,
              indexed_at,
              summary,
              document_kind,
              extraction_pipeline,
              extraction_fallback,
              classification_confidence,
              classification_reason
            ) VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)`,
      params: [
        sourceType,
        sourceId,
        contentHash,
        chunks.length,
        summary ?? null,
        sourceMetadata?.documentKind ?? null,
        sourceMetadata?.extractionPipeline ?? null,
        sourceMetadata?.extractionFallback ? 1 : 0,
        sourceMetadata?.classificationConfidence ?? null,
        sourceMetadata?.classificationReason ?? null,
      ],
    });

    // Execute all in one transaction
    await this._db.runTransaction(operations);

    this._onDidUpdateIndex.fire({ sourceId, chunkCount: chunks.length });
  }

  // ── Delete ──

  /**
   * Delete all chunks for a source.
   */
  async deleteSource(sourceType: string, sourceId: string): Promise<void> {
    const operations: { type: 'run'; sql: string; params?: unknown[] }[] = [];

    // Find existing rowids for vec0 deletion
    const existingRows = await this._db.all<{ rowid: number }>(
      `SELECT rowid FROM vec_embeddings WHERE source_type = ? AND source_id = ?`,
      [sourceType, sourceId],
    );

    for (const row of existingRows) {
      operations.push({
        type: 'run',
        sql: 'DELETE FROM vec_embeddings WHERE rowid = ?',
        params: [row.rowid],
      });
    }

    operations.push({
      type: 'run',
      sql: 'DELETE FROM fts_chunks WHERE source_type = ? AND source_id = ?',
      params: [sourceType, sourceId],
    });
    operations.push({
      type: 'run',
      sql: 'DELETE FROM chunk_metadata WHERE source_type = ? AND source_id = ?',
      params: [sourceType, sourceId],
    });
    operations.push({
      type: 'run',
      sql: 'DELETE FROM indexing_metadata WHERE source_type = ? AND source_id = ?',
      params: [sourceType, sourceId],
    });

    if (operations.length > 0) {
      await this._db.runTransaction(operations);
    }
  }

  /**
   * Delete ALL data from vec_embeddings, fts_chunks, and indexing_metadata.
   * Used by the pipeline-version mechanism to force a full re-index.
   */
  async purgeAll(): Promise<void> {
    // vec0 virtual tables don't support unqualified DELETE (no WHERE clause).
    // We must delete row-by-row via rowid.
    const rows = await this._db.all<{ rowid: number }>(
      'SELECT rowid FROM vec_embeddings',
      [],
    );

    const operations: { type: 'run'; sql: string; params?: unknown[] }[] = [];

    for (const row of rows) {
      operations.push({
        type: 'run',
        sql: 'DELETE FROM vec_embeddings WHERE rowid = ?',
        params: [row.rowid],
      });
    }

    operations.push({ type: 'run', sql: 'DELETE FROM fts_chunks' });
    operations.push({ type: 'run', sql: 'DELETE FROM chunk_metadata' });
    operations.push({ type: 'run', sql: 'DELETE FROM indexing_metadata' });

    if (operations.length > 0) {
      await this._db.runTransaction(operations);
    }
  }

  // ── Search ──

  /**
   * Hybrid search: vector similarity + keyword BM25, merged via RRF.
   *
   * @param queryEmbedding — embedding of the user's query (from EmbeddingService.embedQuery)
   * @param queryText — raw query text for FTS5 keyword search
   * @param options — search options
   * @returns fused results sorted by relevance
   */
  async search(
    queryEmbedding: number[],
    queryText: string,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const topK = options.topK ?? DEFAULT_TOP_K;
    const includeKeyword = options.includeKeyword ?? true;
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const candidateK = DEFAULT_CANDIDATE_K;

    // 1. Vector similarity search
    const vectorResults = await this._vectorSearch(queryEmbedding, candidateK, options.sourceFilter, options.sourceIds, options.pathPrefixes);

    // 2. Keyword search (FTS5 BM25)
    let keywordResults: VectorRow[] = [];
    let keywordTrace: KeywordSearchTrace | undefined;
    if (includeKeyword && queryText.trim()) {
      const keywordSearch = await this._keywordSearch(queryText, candidateK, options.sourceFilter, options.sourceIds, options.pathPrefixes);
      keywordResults = keywordSearch.results;
      keywordTrace = keywordSearch.trace;
    }

    // 3. Reciprocal Rank Fusion
    const rankedLists = new Map<string, VectorRow[]>();
    rankedLists.set('vector', vectorResults);
    if (keywordResults.length > 0) {
      rankedLists.set('keyword', keywordResults);
    }

    const fused = reciprocalRankFusion(rankedLists, RRF_K, topK);

    // When only the vector path fired (keyword returned nothing), each
    // result's RRF score is halved compared to dual-path results because
    // it only gets one 1/(k+rank+1) contribution instead of two.
    // Scale ×2 so the scores stay comparable to the min-score threshold.
    if (keywordResults.length === 0) {
      for (const r of fused) { r.score *= 2; }
    }

    // 4. Filter by minimum score and return
    const finalResults = fused
      .filter((r) => r.score >= minScore)
      .slice(0, topK);

    this._lastSearchTrace = {
      queryText,
      topK,
      candidateK,
      sourceFilter: options.sourceFilter,
      sourceIds: options.sourceIds ? [...options.sourceIds] : undefined,
      pathPrefixes: options.pathPrefixes ? [...options.pathPrefixes] : undefined,
      includeKeyword,
      vectorResultCount: vectorResults.length,
      keywordResultCount: keywordResults.length,
      fusedResultCount: fused.length,
      finalResultCount: finalResults.length,
      keywordTrace,
    };

    return finalResults;
  }

  getLastSearchTrace(): HybridSearchTrace | undefined {
    return this._lastSearchTrace ? structuredClone(this._lastSearchTrace) : undefined;
  }

  /**
   * Vector-only search (no keyword component).
   * Useful for "find similar" operations.
   */
  async vectorSearch(
    queryEmbedding: number[],
    topK: number = DEFAULT_TOP_K,
    sourceFilter?: string,
  ): Promise<SearchResult[]> {
    const rows = await this._vectorSearch(queryEmbedding, topK, sourceFilter, undefined);
    return rows.map((r) => ({
      rowid: r.rowid,
      sourceType: r.source_type,
      sourceId: r.source_id,
      chunkIndex: Number(r.chunk_index),
      chunkText: r.chunk_text,
      contextPrefix: r.context_prefix,
      score: 1 - ((r.distance ?? 0) / 2), // Cosine similarity 0–1 (sqlite-vec distance is 0–2)
      sources: ['vector'],
      headingPath: r.heading_path,
      parentHeadingPath: r.parent_heading_path,
      structuralRole: r.structural_role,
      documentKind: r.document_kind,
      extractionPipeline: r.extraction_pipeline,
      extractionFallback: toBoolean(r.extraction_fallback),
      classificationConfidence: r.classification_confidence,
      classificationReason: r.classification_reason,
    }));
  }

  // ── Indexing Metadata ──

  /**
   * Get the stored content hash for a source (for incremental re-indexing).
   * Returns null if the source has not been indexed.
   */
  async getContentHash(sourceType: string, sourceId: string): Promise<string | null> {
    const row = await this._db.get<{ content_hash: string }>(
      'SELECT content_hash FROM indexing_metadata WHERE source_type = ? AND source_id = ?',
      [sourceType, sourceId],
    );
    return row?.content_hash ?? null;
  }

  /**
   * Bulk-fetch indexed_at timestamps for all sources of a given type.
   * Returns a Map of source_id → epoch ms. Used by the indexing pipeline
   * for mtime-based fast skipping (avoids reading + hashing unchanged files).
   */
  async getIndexedAtMap(sourceType: string): Promise<Map<string, number>> {
    const rows = await this._db.all<{ source_id: string; indexed_at: string }>(
      'SELECT source_id, indexed_at FROM indexing_metadata WHERE source_type = ?',
      [sourceType],
    );
    const map = new Map<string, number>();
    for (const row of rows) {
      // indexed_at is SQLite datetime (UTC, no TZ suffix) — append 'Z' for correct parse
      const ms = new Date(row.indexed_at + 'Z').getTime();
      if (!isNaN(ms)) { map.set(row.source_id, ms); }
    }
    return map;
  }

  async getStructuralCompanions(
    anchor: SearchResult,
    options?: { limit?: number },
  ): Promise<SearchResult[]> {
    const limit = Math.max(1, Math.min(4, options?.limit ?? 2));
    const sectionKeys = [
      anchor.headingPath,
      anchor.parentHeadingPath,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    if (sectionKeys.length === 0) {
      return [];
    }

    const placeholders = sectionKeys.map(() => '?').join(', ');
    const rows = await this._db.all<StructuralCompanionRow>(
      `SELECT ve.rowid,
              ve.source_type,
              ve.source_id,
              ve.chunk_index,
              ve.chunk_text,
              ve.context_prefix,
              cm.heading_path,
              cm.parent_heading_path,
              cm.structural_role,
              im.document_kind,
              im.extraction_pipeline,
              im.extraction_fallback,
              im.classification_confidence,
              im.classification_reason
         FROM vec_embeddings ve
         LEFT JOIN chunk_metadata cm ON cm.chunk_id = ve.rowid
         LEFT JOIN indexing_metadata im ON im.source_type = ve.source_type AND im.source_id = ve.source_id
        WHERE ve.source_type = ?
          AND ve.source_id = ?
          AND ve.rowid != ?
          AND (
            cm.heading_path IN (${placeholders})
            OR cm.parent_heading_path IN (${placeholders})
          )
        ORDER BY ABS(CAST(ve.chunk_index AS INTEGER) - ?) ASC,
                 CASE WHEN cm.heading_path = ? THEN 0 ELSE 1 END ASC,
                 CASE WHEN cm.parent_heading_path = ? THEN 0 ELSE 1 END ASC,
                 CAST(ve.chunk_index AS INTEGER) ASC
        LIMIT ?`,
      [
        anchor.sourceType,
        anchor.sourceId,
        anchor.rowid,
        ...sectionKeys,
        ...sectionKeys,
        anchor.chunkIndex,
        anchor.headingPath ?? '',
        anchor.parentHeadingPath ?? '',
        limit,
      ],
    );

    return rows.map((row) => ({
      rowid: row.rowid,
      sourceType: row.source_type,
      sourceId: row.source_id,
      chunkIndex: Number(row.chunk_index),
      chunkText: row.chunk_text,
      contextPrefix: row.context_prefix,
      score: 0,
      sources: ['structure-expand'],
      headingPath: row.heading_path,
      parentHeadingPath: row.parent_heading_path,
      structuralRole: row.structural_role,
      documentKind: row.document_kind,
      extractionPipeline: row.extraction_pipeline,
      extractionFallback: toBoolean(row.extraction_fallback),
      classificationConfidence: row.classification_confidence,
      classificationReason: row.classification_reason,
    }));
  }

  /**
   * Get all indexed sources with their metadata.
   */
  async getIndexedSources(): Promise<IndexingMeta[]> {
    const rows = await this._db.all<IndexingMeta>(
      'SELECT source_type as sourceType, source_id as sourceId, content_hash as contentHash, chunk_count as chunkCount, indexed_at as indexedAt, summary, document_kind as documentKind, extraction_pipeline as extractionPipeline, CAST(extraction_fallback AS INTEGER) as extractionFallback, classification_confidence as classificationConfidence, classification_reason as classificationReason FROM indexing_metadata ORDER BY indexed_at DESC',
    );
    return rows;
  }

  /**
   * Get document summaries for all indexed file sources.
   * Returns a Map of source_id (workspace-relative path) → summary string.
   * Used by the workspace digest to annotate files with content descriptions.
   */
  async getDocumentSummaries(): Promise<Map<string, string>> {
    const rows = await this._db.all<{ source_id: string; summary: string }>(
      `SELECT source_id, summary FROM indexing_metadata WHERE summary IS NOT NULL AND summary != ''`,
    );
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.source_id, row.summary);
    }
    return map;
  }

  /**
   * Get aggregate statistics about the vector store.
   */
  async getStats(): Promise<VectorStoreStats> {
    try {
      const total = await this._db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM indexing_metadata',
      );
      const sources = await this._db.all<{ source_type: string; count: number; chunks: number }>(
        'SELECT source_type, COUNT(*) as count, SUM(chunk_count) as chunks FROM indexing_metadata GROUP BY source_type',
      );

      const bySourceType: Record<string, number> = {};
      const sourceCountByType: Record<string, number> = {};
      let totalChunks = 0;
      for (const s of sources) {
        bySourceType[s.source_type] = s.chunks;
        sourceCountByType[s.source_type] = s.count;
        totalChunks += s.chunks;
      }

      return {
        totalChunks,
        totalSources: total?.count ?? 0,
        bySourceType,
        sourceCountByType,
      };
    } catch {
      return { totalChunks: 0, totalSources: 0, bySourceType: {}, sourceCountByType: {} };
    }
  }

  // ── Embedding Lookup (M16 Task 2.1) ──

  /**
   * Fetch stored embedding vectors for the given rowids.
   * Used by cosine re-ranking to compute query-candidate similarity
   * without re-embedding. Returns a Map of rowid → Float32 embedding.
   */
  async getEmbeddings(rowids: number[]): Promise<Map<number, number[]>> {
    if (rowids.length === 0) { return new Map(); }

    const result = new Map<number, number[]>();

    // Batch fetch — sqlite-vec stores embeddings as BLOB (Float32Array bytes)
    // Process in batches of 100 to avoid SQLite variable limits
    const batchSize = 100;
    for (let i = 0; i < rowids.length; i += batchSize) {
      const batch = rowids.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const sql = `SELECT rowid, embedding FROM vec_embeddings WHERE rowid IN (${placeholders})`;

      try {
        const rows = await this._db.all<{ rowid: number; embedding: Uint8Array }>(
          sql,
          batch,
        );

        for (const row of rows) {
          // Convert raw bytes back to number[] via Float32Array view
          const f32 = new Float32Array(
            row.embedding.buffer,
            row.embedding.byteOffset,
            row.embedding.byteLength / 4,
          );
          result.set(row.rowid, Array.from(f32));
        }
      } catch {
        // Non-fatal — re-ranking will skip candidates without embeddings
      }
    }

    return result;
  }

  // ── Internal: Vector Search ──

  private async _vectorSearch(
    queryEmbedding: number[],
    topK: number,
    sourceFilter?: string,
    sourceIds?: string[],
    pathPrefixes?: string[],
  ): Promise<VectorRow[]> {
    const embeddingBlob = float32ArrayToBuffer(queryEmbedding);

    let sql: string;
    let params: unknown[];

    if (sourceFilter || (sourceIds?.length ?? 0) > 0 || (pathPrefixes?.length ?? 0) > 0) {
      // vec0 KNN with source_type filter via a subquery approach
      // Note: vec0 WHERE clause only supports embedding MATCH and k constraint
      // We filter after the KNN search
            sql = `SELECT vec_embeddings.rowid, distance, vec_embeddings.source_type, vec_embeddings.source_id,
              vec_embeddings.chunk_index, vec_embeddings.chunk_text, vec_embeddings.context_prefix,
              cm.heading_path, cm.parent_heading_path, cm.structural_role,
              im.document_kind, im.extraction_pipeline, im.extraction_fallback,
              im.classification_confidence, im.classification_reason
             FROM vec_embeddings
            LEFT JOIN chunk_metadata cm ON cm.chunk_id = vec_embeddings.rowid
            LEFT JOIN indexing_metadata im ON im.source_type = vec_embeddings.source_type AND im.source_id = vec_embeddings.source_id
             WHERE embedding MATCH ? AND k = ?
             ORDER BY distance`;
      const overfetchMultiplier = sourceIds && sourceIds.length > 0
        ? Math.max(4, sourceIds.length * 4)
        : pathPrefixes && pathPrefixes.length > 0 ? 3 : 2;
      params = [embeddingBlob, topK * overfetchMultiplier]; // Over-fetch to account for filtering
    } else {
            sql = `SELECT vec_embeddings.rowid, distance, vec_embeddings.source_type, vec_embeddings.source_id,
              vec_embeddings.chunk_index, vec_embeddings.chunk_text, vec_embeddings.context_prefix,
              cm.heading_path, cm.parent_heading_path, cm.structural_role,
              im.document_kind, im.extraction_pipeline, im.extraction_fallback,
              im.classification_confidence, im.classification_reason
             FROM vec_embeddings
            LEFT JOIN chunk_metadata cm ON cm.chunk_id = vec_embeddings.rowid
            LEFT JOIN indexing_metadata im ON im.source_type = vec_embeddings.source_type AND im.source_id = vec_embeddings.source_id
             WHERE embedding MATCH ? AND k = ?
             ORDER BY distance`;
      params = [embeddingBlob, topK];
    }

    const rows = await this._db.all<VectorRow>(sql, params);

    // Apply source filter if needed
    if (sourceFilter || (sourceIds?.length ?? 0) > 0 || (pathPrefixes?.length ?? 0) > 0) {
      const allowedSourceIds = sourceIds ? new Set(sourceIds) : undefined;
      return rows
        .filter((r) => {
          if (sourceFilter && r.source_type !== sourceFilter) { return false; }
          if (allowedSourceIds && !allowedSourceIds.has(r.source_id)) { return false; }
          if (pathPrefixes && pathPrefixes.length > 0 && !pathPrefixes.some((p) => r.source_id.startsWith(p))) { return false; }
          return true;
        })
        .slice(0, topK);
    }

    return rows;
  }

  // ── Internal: Keyword Search ──

  private async _keywordSearch(
    queryText: string,
    topK: number,
    sourceFilter?: string,
    sourceIds?: string[],
    pathPrefixes?: string[],
  ): Promise<{ results: VectorRow[]; trace: KeywordSearchTrace }> {
    // Sanitize query for FTS5 (escape special characters) — AND semantics
    const sanitized = sanitizeFts5Query(queryText);
    if (!sanitized) {
      return {
        results: [],
        trace: {
          query: '',
          fallbackUsed: false,
          andResultCount: 0,
          finalResultCount: 0,
        },
      };
    }

    const runFts = async (ftsQuery: string): Promise<VectorRow[]> => {
      let sql: string;
      let params: unknown[];
      const sourceIdPlaceholders = sourceIds?.map(() => '?').join(', ');

      if (sourceFilter || (sourceIds?.length ?? 0) > 0 || (pathPrefixes?.length ?? 0) > 0) {
        const whereClauses = ['fts_chunks MATCH ?'];
        params = [ftsQuery];

        if (sourceFilter) {
          whereClauses.push('f.source_type = ?');
          params.push(sourceFilter);
        }

        if (sourceIds && sourceIds.length > 0 && sourceIdPlaceholders) {
          whereClauses.push(`f.source_id IN (${sourceIdPlaceholders})`);
          params.push(...sourceIds);
        }

        if (pathPrefixes && pathPrefixes.length > 0) {
          const prefixClauses = pathPrefixes.map(() => 'f.source_id LIKE ?');
          whereClauses.push(`(${prefixClauses.join(' OR ')})`);
          params.push(...pathPrefixes.map((p) => p + '%'));
        }

        sql = `SELECT f.chunk_id as rowid, f.source_type, f.source_id, f.content,
             v.chunk_index, v.chunk_text, v.context_prefix, f.rank as distance,
             cm.heading_path, cm.parent_heading_path, cm.structural_role,
             im.document_kind, im.extraction_pipeline, im.extraction_fallback,
             im.classification_confidence, im.classification_reason
               FROM fts_chunks f
               JOIN vec_embeddings v ON v.rowid = f.chunk_id
           LEFT JOIN chunk_metadata cm ON cm.chunk_id = f.chunk_id
           LEFT JOIN indexing_metadata im ON im.source_type = f.source_type AND im.source_id = f.source_id
               WHERE ${whereClauses.join(' AND ')}
               ORDER BY f.rank
               LIMIT ?`;
        params.push(topK);
      } else {
        sql = `SELECT f.chunk_id as rowid, f.source_type, f.source_id, f.content,
             v.chunk_index, v.chunk_text, v.context_prefix, f.rank as distance,
             cm.heading_path, cm.parent_heading_path, cm.structural_role,
             im.document_kind, im.extraction_pipeline, im.extraction_fallback,
             im.classification_confidence, im.classification_reason
               FROM fts_chunks f
               JOIN vec_embeddings v ON v.rowid = f.chunk_id
           LEFT JOIN chunk_metadata cm ON cm.chunk_id = f.chunk_id
           LEFT JOIN indexing_metadata im ON im.source_type = f.source_type AND im.source_id = f.source_id
               WHERE fts_chunks MATCH ?
               ORDER BY f.rank
               LIMIT ?`;
        params = [ftsQuery, topK];
      }

      try {
        return await this._db.all<VectorRow>(sql, params);
      } catch {
        // FTS5 query syntax errors are non-fatal
        return [];
      }
    };

    // M16 Task 1.3: AND-first with OR fallback.
    // AND semantics provide precision; if too few results, broaden to OR.
    const andResults = await runFts(sanitized);

    if (andResults.length >= Math.ceil(topK / 2)) {
      return {
        results: andResults,
        trace: {
          query: sanitized,
          fallbackUsed: false,
          andResultCount: andResults.length,
          finalResultCount: andResults.length,
        },
      };
    }

    // AND returned too few results — try OR semantics for broader recall
    const orQuery = sanitizeFts5QueryOr(queryText);
    if (!orQuery || orQuery === sanitized) {
      return {
        results: andResults,
        trace: {
          query: sanitized,
          fallbackUsed: false,
          andResultCount: andResults.length,
          finalResultCount: andResults.length,
        },
      }; // OR wouldn't differ (single term or same query)
    }

    const orResults = await runFts(orQuery);
    const finalResults = orResults.length > andResults.length ? orResults : andResults;

    return {
      results: finalResults,
      trace: {
        query: sanitized,
        fallbackQuery: orQuery,
        fallbackUsed: finalResults === orResults,
        andResultCount: andResults.length,
        finalResultCount: finalResults.length,
      },
    };
  }
}

// ─── Internal Types ──────────────────────────────────────────────────────────

/** Raw row shape from vec_embeddings/fts_chunks queries. */
interface VectorRow {
  rowid: number;
  distance?: number;
  source_type: string;
  source_id: string;
  chunk_index: string | number;
  chunk_text: string;
  context_prefix: string;
  heading_path?: string;
  parent_heading_path?: string;
  structural_role?: string;
  document_kind?: string;
  extraction_pipeline?: RetrievalExtractionPipeline;
  extraction_fallback?: number | boolean | null;
  classification_confidence?: number;
  classification_reason?: string;
}

function toBoolean(value: number | boolean | null | undefined): boolean | undefined {
  if (value === null || value === undefined) { return undefined; }
  return typeof value === 'boolean' ? value : value !== 0;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a number[] embedding to a binary buffer for sqlite-vec.
 * sqlite-vec expects embeddings as raw Float32Array bytes.
 */
function float32ArrayToBuffer(embedding: number[]): Uint8Array {
  const f32 = new Float32Array(embedding);
  // Create a standalone copy — do NOT share the Float32Array's backing
  // ArrayBuffer, as Electron IPC structured clone may truncate or
  // misalign views on shared buffers.
  const bytes = new Uint8Array(f32.byteLength);
  bytes.set(new Uint8Array(f32.buffer));
  return bytes;
}

/**
 * Common English stopwords that add noise to keyword search.
 * These appear in nearly every document and dilute BM25 relevance.
 *
 * M16: Removed domain-useful words (page, section, table, figure, note,
 * chapter, book, part, example, find, show, help, use, work, read, look,
 * call, give) that carry meaning in knowledge-base search contexts.
 */
const FTS5_STOPWORDS = new Set([
  // articles, prepositions, conjunctions
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'after', 'before', 'up', 'down', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
  'or', 'if', 'while', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'it', 'its',
  // pronouns
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'they', 'them', 'their',
  // common verbs & fillers that appear everywhere but carry no search value
  'tell', 'talk', 'make', 'know', 'think', 'want', 'need',
  'get', 'go', 'come', 'take', 'say', 'ask', 'try',
  'based', 'using', 'see', 'also', 'like', 'number', 'numbers',
]);

/**
 * Check if a word is a stopword, with simple de-pluralisation.
 * "books" → strip 's' → "book" → in stopword set → true.
 * Prevents common plurals from polluting keyword search.
 */
function isStopword(word: string): boolean {
  const w = word.toLowerCase();
  if (FTS5_STOPWORDS.has(w)) { return true; }
  // Simple de-plural: strip trailing 's' (not 'ss' — "less", "pass")
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) {
    return FTS5_STOPWORDS.has(w.slice(0, -1));
  }
  return false;
}

/**
 * Sanitize a user query for FTS5 MATCH syntax.
 *
 * Uses AND semantics (implicit in FTS5) so that multi-term queries match only
 * documents containing ALL content terms, dramatically reducing noise.
 *
 * The vector similarity path provides broad recall — the keyword path's job is
 * precision.  When AND is too strict and returns nothing, the vector results
 * still come through via score compensation in search().
 *
 * Stopwords are filtered with simple de-pluralisation ("books" → "book" →
 * stopword) to prevent common words from polluting results.
 *
 * FTS5 treats space-separated quoted terms as implicit AND:
 *   "FSI" "Shona" "vocabulary" → matches docs containing ALL three terms
 *
 * Reference: https://www.sqlite.org/fts5.html §3
 */
function sanitizeFts5Query(query: string): string {
  // Remove FTS5 special chars, wrap individual terms in quotes
  const cleaned = query
    .replace(/[*"():^~{}[\]]/g, ' ')
    .trim();

  if (!cleaned) { return ''; }

  // Split into words
  const allTerms = cleaned.split(/\s+/).filter(Boolean);
  if (allTerms.length === 0) { return ''; }

  // Filter out stopwords (with de-pluralisation) — keep only content-bearing terms
  const contentTerms = allTerms.filter((t) => !isStopword(t));

  // If ALL terms were stopwords, keep the originals to avoid empty query
  const terms = contentTerms.length > 0 ? contentTerms : allTerms;

  // Single term → just wrap in quotes
  if (terms.length === 1) {
    return `"${terms[0]}"`;
  }

  // AND semantics (implicit in FTS5 — space-separated quoted terms).
  // The vector path handles recall; the keyword path adds precision.
  return terms.map((t) => `"${t}"`).join(' ');
}

/**
 * Sanitize query with OR semantics for FTS5 fallback.
 * Used when AND returns too few results (M16 Task 1.3).
 *
 * OR semantics match documents containing ANY of the terms,
 * providing broader recall at the cost of precision.
 */
function sanitizeFts5QueryOr(query: string): string {
  const cleaned = query
    .replace(/[*"():^~{}[\]]/g, ' ')
    .trim();

  if (!cleaned) { return ''; }

  const allTerms = cleaned.split(/\s+/).filter(Boolean);
  if (allTerms.length === 0) { return ''; }

  const contentTerms = allTerms.filter((t) => !isStopword(t));
  const terms = contentTerms.length > 0 ? contentTerms : allTerms;

  if (terms.length === 1) {
    return `"${terms[0]}"`;
  }

  // OR semantics — explicit OR keyword between quoted terms
  return terms.map((t) => `"${t}"`).join(' OR ');
}

/**
 * Reciprocal Rank Fusion — merges multiple ranked result lists.
 *
 * Formula: RRF(d) = Σ 1/(k + rank(d))
 * Source: Cormack, Clarke & Butt (2009), SIGIR
 *
 * @param rankedLists — map of list name → ordered results
 * @param k — smoothing constant (default 60)
 * @param topN — max results to return
 */
function reciprocalRankFusion(
  rankedLists: Map<string, VectorRow[]>,
  k: number,
  topN: number,
): SearchResult[] {
  const scores = new Map<number, SearchResult>();

  for (const [listName, results] of rankedLists) {
    for (let rank = 0; rank < results.length; rank++) {
      const row = results[rank];
      const contribution = 1 / (k + rank + 1); // rank is 0-based → +1

      const existing = scores.get(row.rowid);
      if (existing) {
        existing.score += contribution;
        existing.sources.push(listName);
      } else {
        scores.set(row.rowid, {
          rowid: row.rowid,
          sourceType: row.source_type,
          sourceId: row.source_id,
          chunkIndex: Number(row.chunk_index),
          chunkText: row.chunk_text,
          contextPrefix: row.context_prefix,
          score: contribution,
          sources: [listName],
          headingPath: row.heading_path,
          parentHeadingPath: row.parent_heading_path,
          structuralRole: row.structural_role,
          documentKind: row.document_kind,
          extractionPipeline: row.extraction_pipeline,
          extractionFallback: toBoolean(row.extraction_fallback),
          classificationConfidence: row.classification_confidence,
          classificationReason: row.classification_reason,
        });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

export { float32ArrayToBuffer, sanitizeFts5Query, sanitizeFts5QueryOr, isStopword, reciprocalRankFusion };
