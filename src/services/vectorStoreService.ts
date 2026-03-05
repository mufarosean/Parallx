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
  /** Brief content summary (first ~200 chars of extracted text). */
  summary?: string;
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
  ): Promise<void> {
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
        sql: `INSERT INTO fts_chunks(chunk_id, source_type, source_id, content)
              VALUES (?, ?, ?, ?)`,
        params: ['$lastRowId', chunk.sourceType, chunk.sourceId, chunk.text],
      });
    }

    // 3. Upsert indexing metadata (with optional content summary)
    operations.push({
      type: 'run',
      sql: `INSERT OR REPLACE INTO indexing_metadata(source_type, source_id, content_hash, chunk_count, indexed_at, summary)
            VALUES (?, ?, ?, ?, datetime('now'), ?)`,
      params: [sourceType, sourceId, contentHash, chunks.length, summary ?? null],
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

    // When only the vector path fired (keyword returned nothing), each
    // result's RRF score is halved compared to dual-path results because
    // it only gets one 1/(k+rank+1) contribution instead of two.
    // Scale ×2 so the scores stay comparable to the min-score threshold.
    if (keywordResults.length === 0) {
      for (const r of fused) { r.score *= 2; }
    }

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
      chunkIndex: Number(r.chunk_index),
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

  /**
   * Get all indexed sources with their metadata.
   */
  async getIndexedSources(): Promise<IndexingMeta[]> {
    const rows = await this._db.all<IndexingMeta>(
      'SELECT source_type as sourceType, source_id as sourceId, content_hash as contentHash, chunk_count as chunkCount, indexed_at as indexedAt, summary FROM indexing_metadata ORDER BY indexed_at DESC',
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
    // Sanitize query for FTS5 (escape special characters) — AND semantics
    const sanitized = sanitizeFts5Query(queryText);
    if (!sanitized) { return []; }

    const runFts = async (ftsQuery: string): Promise<VectorRow[]> => {
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
        params = [ftsQuery, sourceFilter, topK];
      } else {
        sql = `SELECT f.chunk_id as rowid, f.source_type, f.source_id, f.content,
                      v.chunk_index, v.chunk_text, v.context_prefix, f.rank as distance
               FROM fts_chunks f
               JOIN vec_embeddings v ON v.rowid = f.chunk_id
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
      return andResults;
    }

    // AND returned too few results — try OR semantics for broader recall
    const orQuery = sanitizeFts5QueryOr(queryText);
    if (!orQuery || orQuery === sanitized) {
      return andResults; // OR wouldn't differ (single term or same query)
    }

    const orResults = await runFts(orQuery);
    return orResults.length > andResults.length ? orResults : andResults;
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
        });
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

export { float32ArrayToBuffer, sanitizeFts5Query, sanitizeFts5QueryOr, isStopword, reciprocalRankFusion };
