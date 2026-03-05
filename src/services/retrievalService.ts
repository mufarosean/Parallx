// retrievalService.ts — IRetrievalService implementation (M10 Task 3.1)
//
// Query-time retrieval: embeds a user query, runs hybrid search (vector + keyword
// via VectorStoreService), applies post-retrieval filtering, and returns ranked
// context chunks ready for injection into the LLM prompt.
//
// Features:
//   - Embed query with 'search_query:' prefix (via EmbeddingService)
//   - Hybrid retrieval: vector cosine + FTS5 BM25, merged via RRF (in VectorStoreService)
//   - Score threshold filtering (drop low-relevance chunks)
//   - Source deduplication (cap chunks per source to avoid monopoly)
//   - Token budget management (don't exceed configured token limit)
//   - Source type filtering (pages only, files only, or all)
//
// References:
//   - docs/Parallx_Milestone_10.md Phase 3 Task 3.1

import { Disposable } from '../platform/lifecycle.js';
import type {
  IEmbeddingService,
  IVectorStoreService,
  IRetrievalService,
} from './serviceTypes.js';
import type { SearchResult, SearchOptions } from './vectorStoreService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default number of final chunks to return. */
const DEFAULT_TOP_K = 7;

/** Minimum RRF score — chunks below this are dropped.
 *
 * With RRF k=60, the maximum single-path rank score is 1/61 ≈ 0.0164.
 * After two-path fusion (vector + keyword), a top-1 result in both paths
 * scores ~0.033. A threshold of 0.02 requires a chunk to rank reasonably
 * well in at least one retrieval path, filtering out obvious noise while
 * preserving any result that genuinely matched the query.
 *
 * Previous value 0.01 let through rank-40+ garbage from a single path.
 * Raised to 0.025 to better filter irrelevant results when the index is
 * sparse or the query has low semantic overlap with indexed content.
 */
const DEFAULT_MIN_SCORE = 0.025;

/** Max chunks from the same source before dedup kicks in. */
const DEFAULT_MAX_PER_SOURCE = 2;

/** Default token budget for retrieved context (chars / 4 heuristic). */
const DEFAULT_TOKEN_BUDGET = 3000;

/** Rough token estimator: chars / 4 (same as defaultParticipant). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Minimum cosine similarity between query embedding and candidate embedding
 * for a chunk to survive cosine re-ranking. 0.30 is a lenient threshold
 * that removes only clearly unrelated candidates while preserving topical
 * matches that may have been boosted by keyword overlap.
 *
 * Reference: docs/Parallx_Milestone_16.md Phase 2 — Cosine Re-ranking
 */
const MIN_COSINE_SCORE = 0.30;

/**
 * Dot product of two equal-length vectors.
 * Used by cosineRerank to compute query-candidate similarity.
 */
export function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Cosine similarity between two vectors: dot(a,b) / (‖a‖ × ‖b‖).
 * Returns 0 if either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const dot = dotProduct(a, b);
  const magA = Math.sqrt(dotProduct(a, a));
  const magB = Math.sqrt(dotProduct(b, b));
  if (magA === 0 || magB === 0) { return 0; }
  return dot / (magA * magB);
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options for a retrieval query. */
export interface RetrievalOptions {
  /** Max chunks to return (default: 10). */
  topK?: number;
  /** Filter by source type ('page_block', 'file_chunk'). */
  sourceFilter?: string;
  /** Minimum relevance score (default: 0.01). */
  minScore?: number;
  /** Whether to include FTS5 keyword search (default: true). */
  includeKeyword?: boolean;
  /** Max chunks from one source (default: 3). */
  maxPerSource?: number;
  /** Max total tokens of context to return (default: 4000). */
  tokenBudget?: number;
}

/** A retrieved context chunk with source attribution. */
export interface RetrievedContext {
  /** Source type: 'page_block' or 'file_chunk'. */
  sourceType: string;
  /** Source identifier (page UUID or file path). */
  sourceId: string;
  /** Structural context prefix (page title, section heading). */
  contextPrefix: string;
  /** The chunk text content. */
  text: string;
  /** Relevance score from hybrid search. */
  score: number;
  /** Which retrieval methods contributed ('vector', 'keyword'). */
  sources: string[];
  /** Estimated token count for this chunk. */
  tokenCount: number;
}

// ─── RetrievalService ────────────────────────────────────────────────────────

/**
 * Query-time retrieval service.
 *
 * Embeds a user query, runs hybrid search through the VectorStoreService,
 * applies post-retrieval filtering (score threshold, cosine re-ranking,
 * dedup, token budget), and returns ranked context chunks.
 */
export class RetrievalService extends Disposable implements IRetrievalService {

  private readonly _embeddingService: IEmbeddingService;
  private readonly _vectorStore: IVectorStoreService;

  constructor(
    embeddingService: IEmbeddingService,
    vectorStore: IVectorStoreService,
  ) {
    super();
    this._embeddingService = embeddingService;
    this._vectorStore = vectorStore;
  }

  // ── Public API ──

  /**
   * Retrieve relevant context chunks for a user query.
   *
   * Pipeline:
   *   1. Embed query (search_query prefix)
   *   2. Hybrid search (vector + keyword via VectorStoreService, 3× overfetch)
   *   3. Score threshold filter (absolute + relative drop-off)
   *   4. Cosine re-ranking (query↔candidate similarity, drops < 0.30)
   *   5. Source deduplication (cap chunks per source)
   *   6. Token budget enforcement
   */
  async retrieve(query: string, options?: RetrievalOptions): Promise<RetrievedContext[]> {
    if (!query.trim()) { return []; }

    const topK = options?.topK ?? DEFAULT_TOP_K;
    const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
    const maxPerSource = options?.maxPerSource ?? DEFAULT_MAX_PER_SOURCE;
    const tokenBudget = options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

    // 1. Embed the user query
    const queryEmbedding = await this._embeddingService.embedQuery(query);

    // 2. Hybrid search — ask for more candidates than topK to allow
    //    for cosine re-ranking, score threshold, and source dedup.
    const overfetchFactor = 3;
    const searchOptions: SearchOptions = {
      topK: topK * overfetchFactor,
      sourceFilter: options?.sourceFilter,
      minScore: 0, // We'll apply our own threshold after
      includeKeyword: options?.includeKeyword ?? true,
    };

    const rawResults = await this._vectorStore.search(
      queryEmbedding,
      query,
      searchOptions,
    );

    // 3. Score threshold filter (RRF scores)
    let filtered = rawResults.filter((r) => r.score >= minScore);

    // 3b. Relative score drop-off — drop results below 60% of the top
    //     score.  This catches noise that barely clears the absolute
    //     threshold when there's a clear quality gap between the best
    //     result and the rest.
    if (filtered.length > 1) {
      const topScore = filtered[0].score;
      const dropoffThreshold = topScore * 0.6;
      filtered = filtered.filter((r) => r.score >= dropoffThreshold);
    }

    // 4. Cosine re-ranking — compute query↔candidate cosine similarity
    //    using stored embeddings. Drops candidates below MIN_COSINE_SCORE.
    //    This catches keyword-boosted noise that isn't semantically close.
    if (filtered.length > 0) {
      filtered = await this._cosineRerank(queryEmbedding, filtered);
    }

    // 5. Source deduplication — cap chunks from any single source
    filtered = this._deduplicateSources(filtered, maxPerSource);

    // 6. Token budget enforcement
    const budgeted = this._applyTokenBudget(filtered, tokenBudget);

    // 7. Map to RetrievedContext and trim to topK
    return budgeted.slice(0, topK).map((r) => ({
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      contextPrefix: r.contextPrefix,
      text: r.chunkText,
      score: r.score,
      sources: r.sources,
      tokenCount: estimateTokens(r.chunkText),
    }));
  }

  /**
   * Format retrieved context for injection into a chat message.
   *
   * Produces a human-readable block with source attribution and actionable
   * file paths the model can use with read_file:
   * ```
   * [Retrieved Context]
   * ---
   * Source: Backend Architecture > Authentication
   * Path: docs/architecture.md
   * We chose JWT with refresh tokens...
   * ---
   * ```
   */
  formatContext(chunks: RetrievedContext[]): string {
    if (chunks.length === 0) { return ''; }

    const sections: string[] = ['[Retrieved Context]'];
    // Track unique sources for citation numbering.
    // Multiple chunks from the same source share one citation number.
    const sourceIndex = new Map<string, number>();
    let nextIndex = 1;

    for (const chunk of chunks) {
      const sourceKey = `${chunk.sourceType}:${chunk.sourceId}`;
      if (!sourceIndex.has(sourceKey)) {
        sourceIndex.set(sourceKey, nextIndex++);
      }
      const idx = sourceIndex.get(sourceKey)!;

      sections.push('---');
      const source = chunk.contextPrefix || chunk.sourceId;
      sections.push(`[${idx}] Source: ${source}`);
      // Include the workspace-relative path for file chunks so the model
      // can use read_file or search_files to follow up on this source.
      if (chunk.sourceType === 'file_chunk' && chunk.sourceId) {
        sections.push(`Path: ${chunk.sourceId}`);
      }
      sections.push(chunk.text);
    }

    sections.push('---');
    return sections.join('\n');
  }

  // ── Multi-query Retrieval (M12 Task 2.1) ──

  /**
   * Run multiple queries in parallel, merge results, deduplicate, and
   * apply token budget. This is the multi-query retrieval pipeline used
   * by the retrieval planner.
   *
   * Pipeline:
   *   1. Run retrieve() for each query in parallel
   *   2. Merge all results, dedup by sourceType:sourceId:text hash (keep highest score)
   *   3. Re-sort by score descending
   *   4. Apply source dedup and token budget
   *   5. Return merged, ranked results
   */
  async retrieveMulti(queries: string[], options?: RetrievalOptions): Promise<RetrievedContext[]> {
    if (queries.length === 0) { return []; }

    // Single query → just use regular retrieve
    if (queries.length === 1) {
      return this.retrieve(queries[0], options);
    }

    const topK = options?.topK ?? DEFAULT_TOP_K;
    const maxPerSource = options?.maxPerSource ?? DEFAULT_MAX_PER_SOURCE;
    const tokenBudget = options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

    // 1. Run all queries in parallel — each gets a smaller per-query budget
    const perQueryOptions: RetrievalOptions = {
      ...options,
      topK: Math.max(5, Math.ceil(topK / queries.length) + 2), // Over-fetch per query
      maxPerSource: maxPerSource + 1, // Allow slightly more per query for dedup
      tokenBudget: tokenBudget * 2, // Don't budget-constrain individual queries
    };

    const allResults = await Promise.all(
      queries.map((q) => this.retrieve(q, perQueryOptions).catch(() => [] as RetrievedContext[])),
    );

    // 2. Merge and deduplicate — keep highest-scoring instance of each chunk
    const deduped = new Map<string, RetrievedContext>();
    for (const results of allResults) {
      for (const chunk of results) {
        // Key by source + first 100 chars of text to catch same content from different queries
        const key = `${chunk.sourceType}:${chunk.sourceId}:${chunk.text.slice(0, 100)}`;
        const existing = deduped.get(key);
        if (!existing || chunk.score > existing.score) {
          deduped.set(key, chunk);
        }
      }
    }

    // 3. Re-sort by score descending
    let merged = Array.from(deduped.values()).sort((a, b) => b.score - a.score);

    // 4. Apply source deduplication (cap chunks per source globally)
    const sourceCounts = new Map<string, number>();
    merged = merged.filter((chunk) => {
      const key = `${chunk.sourceType}:${chunk.sourceId}`;
      const count = sourceCounts.get(key) ?? 0;
      if (count >= maxPerSource) { return false; }
      sourceCounts.set(key, count + 1);
      return true;
    });

    // 5. Apply token budget
    let tokensUsed = 0;
    const budgeted: RetrievedContext[] = [];
    for (const chunk of merged) {
      const tokens = estimateTokens(chunk.text);
      if (tokensUsed + tokens > tokenBudget && budgeted.length > 0) {
        break;
      }
      budgeted.push(chunk);
      tokensUsed += tokens;
    }

    return budgeted.slice(0, topK);
  }

  // ── Internal ──

  /**
   * Cap the number of chunks from any single source.
   * This prevents one page/file from monopolizing the context window.
   */
  private _deduplicateSources(results: SearchResult[], maxPerSource: number): SearchResult[] {
    const sourceCounts = new Map<string, number>();
    const deduped: SearchResult[] = [];

    for (const result of results) {
      const key = `${result.sourceType}:${result.sourceId}`;
      const count = sourceCounts.get(key) ?? 0;

      if (count < maxPerSource) {
        deduped.push(result);
        sourceCounts.set(key, count + 1);
      }
    }

    return deduped;
  }

  /**
   * Enforce a token budget — include chunks in score order until the budget is exhausted.
   */
  private _applyTokenBudget(results: SearchResult[], tokenBudget: number): SearchResult[] {
    let tokensUsed = 0;
    const budgeted: SearchResult[] = [];

    for (const result of results) {
      const chunkTokens = estimateTokens(result.chunkText);
      if (tokensUsed + chunkTokens > tokenBudget && budgeted.length > 0) {
        // Allow at least one chunk even if it exceeds budget
        break;
      }
      budgeted.push(result);
      tokensUsed += chunkTokens;
    }

    return budgeted;
  }

  // ── Cosine Re-Ranking (M16 Task 2.2) ──

  /**
   * Re-rank candidates by cosine similarity between the query embedding
   * and each candidate's stored embedding. Drops candidates below
   * MIN_COSINE_SCORE and re-sorts by cosine similarity (descending).
   *
   * This is a lightweight, zero-latency re-ranker that uses already-computed
   * embeddings — no additional model calls. It catches false positives from
   * keyword-only matches that passed the RRF score threshold but aren't
   * actually semantically related to the query.
   */
  private async _cosineRerank(
    queryEmbedding: number[],
    candidates: SearchResult[],
  ): Promise<SearchResult[]> {
    // Fetch stored embeddings for all candidate rowids
    const rowids = candidates.map((c) => c.rowid);
    const embeddings = await this._vectorStore.getEmbeddings(rowids);

    // Score each candidate by cosine similarity
    const scored: Array<{ result: SearchResult; cosine: number }> = [];
    for (const candidate of candidates) {
      const emb = embeddings.get(candidate.rowid);
      if (!emb) {
        // No stored embedding (shouldn't happen) — keep with neutral score
        scored.push({ result: candidate, cosine: MIN_COSINE_SCORE });
        continue;
      }
      const sim = cosineSimilarity(queryEmbedding, emb);
      if (sim >= MIN_COSINE_SCORE) {
        scored.push({ result: candidate, cosine: sim });
      }
      // else: dropped — not semantically close enough
    }

    // Sort by cosine similarity (descending), tie-break by RRF score
    scored.sort((a, b) => {
      if (Math.abs(b.cosine - a.cosine) > 0.001) { return b.cosine - a.cosine; }
      return b.result.score - a.result.score;
    });

    return scored.map((s) => s.result);
  }
}
