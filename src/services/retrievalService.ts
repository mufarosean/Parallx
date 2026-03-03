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
const DEFAULT_TOP_K = 10;

/** Minimum RRF score — chunks below this are dropped. */
const DEFAULT_MIN_SCORE = 0.005;

/** Max chunks from the same source before dedup kicks in. */
const DEFAULT_MAX_PER_SOURCE = 3;

/** Default token budget for retrieved context (chars / 4 heuristic). */
const DEFAULT_TOKEN_BUDGET = 4000;

/** Rough token estimator: chars / 4 (same as defaultParticipant). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options for a retrieval query. */
export interface RetrievalOptions {
  /** Max chunks to return (default: 10). */
  topK?: number;
  /** Filter by source type ('page_block', 'file_chunk'). */
  sourceFilter?: string;
  /** Minimum relevance score (default: 0.005). */
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
 * applies post-retrieval filtering (score threshold, dedup, token budget),
 * and returns ranked context chunks.
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
   *   2. Hybrid search (vector + keyword via VectorStoreService)
   *   3. Score threshold filter
   *   4. Source deduplication (cap chunks per source)
   *   5. Token budget enforcement
   */
  async retrieve(query: string, options?: RetrievalOptions): Promise<RetrievedContext[]> {
    if (!query.trim()) { return []; }

    const topK = options?.topK ?? DEFAULT_TOP_K;
    const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
    const maxPerSource = options?.maxPerSource ?? DEFAULT_MAX_PER_SOURCE;
    const tokenBudget = options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

    // 1. Embed the user query
    const queryEmbedding = await this._embeddingService.embedQuery(query);

    // 2. Hybrid search — ask for more candidates than topK to allow filtering
    const searchOptions: SearchOptions = {
      topK: topK * 2, // Over-fetch to allow for dedup/score filtering
      sourceFilter: options?.sourceFilter,
      minScore: 0, // We'll apply our own threshold after
      includeKeyword: options?.includeKeyword ?? true,
    };

    const rawResults = await this._vectorStore.search(
      queryEmbedding,
      query,
      searchOptions,
    );

    // 3. Score threshold filter
    let filtered = rawResults.filter((r) => r.score >= minScore);

    // 4. Source deduplication — cap chunks from any single source
    filtered = this._deduplicateSources(filtered, maxPerSource);

    // 5. Token budget enforcement
    const budgeted = this._applyTokenBudget(filtered, tokenBudget);

    // 6. Map to RetrievedContext and trim to topK
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
   * Produces a human-readable block with source attribution:
   * ```
   * [Retrieved Context]
   * ---
   * Source: Backend Architecture > Authentication
   * We chose JWT with refresh tokens...
   * ---
   * ```
   */
  formatContext(chunks: RetrievedContext[]): string {
    if (chunks.length === 0) { return ''; }

    const sections: string[] = ['[Retrieved Context]'];

    for (const chunk of chunks) {
      sections.push('---');
      const source = chunk.contextPrefix || chunk.sourceId;
      sections.push(`Source: ${source}`);
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
}
