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

/** Default number of candidates to retrieve from each index before fusion. */
const DEFAULT_CANDIDATE_K = 20;

/** Default final top-K after fusion. */
const DEFAULT_TOP_K = 10;

/** Minimum RRF score threshold (chunks below this are dropped). */
const DEFAULT_MIN_SCORE = 0.0;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A chunk with its embedding vector, ready for storage. */
export interface EmbeddedChunk extends Chunk {
  embedding: number[];
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
}

/** Options for search queries. */
export interface SearchOptions {
  /** Max results to return after fusion (default: 10). */
  topK?: number;
  /** Filter by source type ('page_block', 'file_chunk'). */
  sourceFilter?: string;
  /** Minimum RRF score threshold. */
  minScore?: number;
  /** Whether to include keyword (FTS5 BM25) search. */
  includeKeyword?: boolean;
}

/** Indexing metadata for a source (page or file). */
export interface IndexingMeta {
  sourceType: string;
  sourceId: string;
  contentHash: string;
  chunkCount: number;
  indexedAt: string;
}

/** Statistics about the vector store. */
export interface VectorStoreStats {
  totalChunks: number;
  totalSources: number;
  bySourceType: Record<string, number>;
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

  // ── Rowid counter ──
  // vec0 virtual tables require explicit rowid management.
  private _nextRowId = 1;
  private _rowIdInitialized = false;

  // ── Events ──

  private readonly _onDidUpdateIndex = this._register(new Emitter<{ sourceId: string; chunkCount: number }>());
  readonly onDidUpdateIndex: Event<{ sourceId: string; chunkCount: number }> = this._onDidUpdateIndex.event;

  constructor(databaseService: IDatabaseService) {
    super();
    this._db = databaseService;
  }

  // ── Initialization ──

  /**
   * Initialize the rowid counter from the current max rowid in vec_embeddings.
   * Must be called after database is open and migrations have run.
   */
  async initialize(): Promise<void> {
    if (this._rowIdInitialized) { return; }

    try {
      const result = await this._db.get<{ max_id: number | null }>(
        'SELECT MAX(rowid) as max_id FROM vec_embeddings',
      );
      this._nextRowId = (result?.max_id ?? 0) + 1;
      this._rowIdInitialized = true;
    } catch {
      // Table might not exist yet — migration hasn't run
      this._nextRowId = 1;
      this._rowIdInitialized = true;
    }
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
   */
  async upsert(
    sourceType: string,
    sourceId: string,
    chunks: EmbeddedChunk[],
    contentHash: string,
  ): Promise<void> {
    await this.initialize();

    // Build transaction operations: delete old, insert new
    const operations: { type: 'run'; sql: string; params?: unknown[] }[] = [];

    // 1. Delete existing chunks for this source from both tables
    operations.push({
      type: 'run',
      sql: 'DELETE FROM fts_chunks WHERE source_type = ? AND source_id = ?',
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
    for (const chunk of chunks) {
      const rowId = this._nextRowId++;

      // Convert embedding to Float32Array binary for sqlite-vec
      const embeddingBlob = float32ArrayToBuffer(chunk.embedding);

      operations.push({
        type: 'run',
        sql: `INSERT INTO vec_embeddings(rowid, embedding, source_type, source_id, chunk_index, chunk_text, context_prefix, content_hash)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          rowId,
          embeddingBlob,
          chunk.sourceType,
          chunk.sourceId,
          chunk.chunkIndex,
          chunk.text,
          chunk.contextPrefix,
          chunk.contentHash,
        ],
      });

      operations.push({
        type: 'run',
        sql: `INSERT INTO fts_chunks(chunk_id, source_type, source_id, content)
              VALUES (?, ?, ?, ?)`,
        params: [rowId, chunk.sourceType, chunk.sourceId, chunk.text],
      });
    }

    // 3. Upsert indexing metadata
    operations.push({
      type: 'run',
      sql: `INSERT OR REPLACE INTO indexing_metadata(source_type, source_id, content_hash, chunk_count, indexed_at)
            VALUES (?, ?, ?, ?, datetime('now'))`,
      params: [sourceType, sourceId, contentHash, chunks.length],
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
      sql: 'DELETE FROM indexing_metadata WHERE source_type = ? AND source_id = ?',
      params: [sourceType, sourceId],
    });

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
    const vectorResults = await this._vectorSearch(queryEmbedding, candidateK, options.sourceFilter);

    // 2. Keyword search (FTS5 BM25)
    let keywordResults: VectorRow[] = [];
    if (includeKeyword && queryText.trim()) {
      keywordResults = await this._keywordSearch(queryText, candidateK, options.sourceFilter);
    }

    // 3. Reciprocal Rank Fusion
    const rankedLists = new Map<string, VectorRow[]>();
    rankedLists.set('vector', vectorResults);
    if (keywordResults.length > 0) {
      rankedLists.set('keyword', keywordResults);
    }

    const fused = reciprocalRankFusion(rankedLists, RRF_K, topK);

    // 4. Filter by minimum score and return
    return fused
      .filter((r) => r.score >= minScore)
      .slice(0, topK);
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
    const rows = await this._vectorSearch(queryEmbedding, topK, sourceFilter);
    return rows.map((r, i) => ({
      rowid: r.rowid,
      sourceType: r.source_type,
      sourceId: r.source_id,
      chunkIndex: r.chunk_index,
      chunkText: r.chunk_text,
      contextPrefix: r.context_prefix,
      score: 1 / (RRF_K + i + 1), // Convert rank to RRF-like score
      sources: ['vector'],
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
   * Get all indexed sources with their metadata.
   */
  async getIndexedSources(): Promise<IndexingMeta[]> {
    const rows = await this._db.all<IndexingMeta>(
      'SELECT source_type as sourceType, source_id as sourceId, content_hash as contentHash, chunk_count as chunkCount, indexed_at as indexedAt FROM indexing_metadata ORDER BY indexed_at DESC',
    );
    return rows;
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
      let totalChunks = 0;
      for (const s of sources) {
        bySourceType[s.source_type] = s.chunks;
        totalChunks += s.chunks;
      }

      return {
        totalChunks,
        totalSources: total?.count ?? 0,
        bySourceType,
      };
    } catch {
      return { totalChunks: 0, totalSources: 0, bySourceType: {} };
    }
  }

  // ── Internal: Vector Search ──

  private async _vectorSearch(
    queryEmbedding: number[],
    topK: number,
    sourceFilter?: string,
  ): Promise<VectorRow[]> {
    const embeddingBlob = float32ArrayToBuffer(queryEmbedding);

    let sql: string;
    let params: unknown[];

    if (sourceFilter) {
      // vec0 KNN with source_type filter via a subquery approach
      // Note: vec0 WHERE clause only supports embedding MATCH and k constraint
      // We filter after the KNN search
      sql = `SELECT rowid, distance, source_type, source_id, chunk_index, chunk_text, context_prefix
             FROM vec_embeddings
             WHERE embedding MATCH ? AND k = ?
             ORDER BY distance`;
      params = [embeddingBlob, topK * 2]; // Over-fetch to account for filtering
    } else {
      sql = `SELECT rowid, distance, source_type, source_id, chunk_index, chunk_text, context_prefix
             FROM vec_embeddings
             WHERE embedding MATCH ? AND k = ?
             ORDER BY distance`;
      params = [embeddingBlob, topK];
    }

    const rows = await this._db.all<VectorRow>(sql, params);

    // Apply source filter if needed
    if (sourceFilter) {
      return rows
        .filter((r) => r.source_type === sourceFilter)
        .slice(0, topK);
    }

    return rows;
  }

  // ── Internal: Keyword Search ──

  private async _keywordSearch(
    queryText: string,
    topK: number,
    sourceFilter?: string,
  ): Promise<VectorRow[]> {
    // Sanitize query for FTS5 (escape special characters)
    const sanitized = sanitizeFts5Query(queryText);
    if (!sanitized) { return []; }

    let sql: string;
    let params: unknown[];

    if (sourceFilter) {
      sql = `SELECT f.chunk_id as rowid, f.source_type, f.source_id, f.content,
                    v.chunk_index, v.chunk_text, v.context_prefix, f.rank as distance
             FROM fts_chunks f
             JOIN vec_embeddings v ON v.rowid = f.chunk_id
             WHERE fts_chunks MATCH ? AND f.source_type = ?
             ORDER BY f.rank
             LIMIT ?`;
      params = [sanitized, sourceFilter, topK];
    } else {
      sql = `SELECT f.chunk_id as rowid, f.source_type, f.source_id, f.content,
                    v.chunk_index, v.chunk_text, v.context_prefix, f.rank as distance
             FROM fts_chunks f
             JOIN vec_embeddings v ON v.rowid = f.chunk_id
             WHERE fts_chunks MATCH ?
             ORDER BY f.rank
             LIMIT ?`;
      params = [sanitized, topK];
    }

    try {
      return await this._db.all<VectorRow>(sql, params);
    } catch {
      // FTS5 query syntax errors are non-fatal
      return [];
    }
  }
}

// ─── Internal Types ──────────────────────────────────────────────────────────

/** Raw row shape from vec_embeddings/fts_chunks queries. */
interface VectorRow {
  rowid: number;
  distance?: number;
  source_type: string;
  source_id: string;
  chunk_index: number;
  chunk_text: string;
  context_prefix: string;
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
 * Sanitize a user query for FTS5 MATCH syntax.
 * Wraps terms in quotes to avoid FTS5 syntax errors.
 */
function sanitizeFts5Query(query: string): string {
  // Remove FTS5 special chars, wrap individual terms in quotes
  const cleaned = query
    .replace(/[*"():^~{}[\]]/g, ' ')
    .trim();

  if (!cleaned) { return ''; }

  // Split into words and wrap each in quotes for exact matching
  const terms = cleaned.split(/\s+/).filter(Boolean);
  if (terms.length === 0) { return ''; }

  // Use OR between terms for broader recall
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
          chunkIndex: row.chunk_index,
          chunkText: row.chunk_text,
          contextPrefix: row.context_prefix,
          score: contribution,
          sources: [listName],
        });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

export { float32ArrayToBuffer, sanitizeFts5Query, reciprocalRankFusion };
