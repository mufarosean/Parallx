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
import type {
  ILanguageModelsService,
  IChatMessage,
} from './chatTypes.js';
import type { SearchResult, SearchOptions } from './vectorStoreService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default number of final chunks to return. */
const DEFAULT_TOP_K = 10;

/** Minimum RRF score — chunks below this are dropped.
 *
 * With RRF k=60, the maximum single-path rank score is 1/61 ≈ 0.0164.
 * After two-path fusion (vector + keyword), a top-1 result in both paths
 * scores ~0.033. A threshold of 0.02 requires a chunk to rank reasonably
 * well in at least one retrieval path, filtering out obvious noise while
 * preserving any result that genuinely matched the query.
 *
 * Previous value 0.01 let through rank-40+ garbage from a single path.
 */
const DEFAULT_MIN_SCORE = 0.02;

/** Max chunks from the same source before dedup kicks in. */
const DEFAULT_MAX_PER_SOURCE = 3;

/** Default token budget for retrieved context (chars / 4 heuristic). */
const DEFAULT_TOKEN_BUDGET = 4000;

/** Minimum LLM relevance score (0-10) for a chunk to survive re-ranking.
 * Chunks scoring below this are dropped as irrelevant.
 */
const RERANK_MIN_RELEVANCE = 4;

/** Maximum characters of chunk text sent to the LLM for re-ranking.
 * Longer chunks are truncated to save tokens during the scoring pass.
 */
const RERANK_MAX_CHUNK_CHARS = 600;

/** Timeout per re-ranking LLM call in milliseconds. */
const RERANK_TIMEOUT_MS = 8000;

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
  /** Minimum relevance score (default: 0.01). */
  minScore?: number;
  /** Whether to include FTS5 keyword search (default: true). */
  includeKeyword?: boolean;
  /** Max chunks from one source (default: 3). */
  maxPerSource?: number;
  /** Max total tokens of context to return (default: 4000). */
  tokenBudget?: number;
  /**
   * Whether to apply LLM re-ranking to candidates (default: true when LM available).
   * Re-ranking uses the active Ollama chat model to score each candidate chunk's
   * relevance to the query, filtering out irrelevant noise.
   */
  rerank?: boolean;
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
  private readonly _languageModelsService: ILanguageModelsService | undefined;

  constructor(
    embeddingService: IEmbeddingService,
    vectorStore: IVectorStoreService,
    languageModelsService?: ILanguageModelsService,
  ) {
    super();
    this._embeddingService = embeddingService;
    this._vectorStore = vectorStore;
    this._languageModelsService = languageModelsService;
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
    // LLM re-ranking is disabled for real-time chat — it adds N serial LLM
    // calls (one per chunk) which adds 5-15s of hidden latency before the user
    // sees any response. The planner already classifies intent and generates
    // targeted queries; the RRF score threshold handles the rest.
    // Re-ranking infrastructure is preserved for potential async/background use.
    const shouldRerank = false;

    // 1. Embed the user query
    const queryEmbedding = await this._embeddingService.embedQuery(query);

    // 2. Hybrid search — ask for slightly more candidates than topK to
    //    allow for filtering by score threshold and source dedup.
    const overfetchFactor = 2;
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

    // 4. LLM re-ranking — score each candidate's relevance to the query
    if (shouldRerank && filtered.length > 0) {
      filtered = await this._rerankChunks(query, filtered);
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

    for (const chunk of chunks) {
      sections.push('---');
      const source = chunk.contextPrefix || chunk.sourceId;
      sections.push(`Source: ${source}`);
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

  // ── LLM Re-Ranking ──

  /**
   * Re-rank candidate chunks using LLM pointwise relevance scoring.
   *
   * Sends each (query, chunk) pair to the active Ollama chat model for a
   * relevance score 0-10. Chunks below RERANK_MIN_RELEVANCE are dropped.
   * Surviving chunks are re-sorted by relevance score (descending).
   *
   * Falls back to the original list if the LLM is unavailable or all calls fail.
   *
   * Reference: Anthropic Contextual Retrieval (2024), Galileo reranking research (2024)
   */
  private async _rerankChunks(query: string, candidates: SearchResult[]): Promise<SearchResult[]> {
    if (!this._languageModelsService || candidates.length === 0) {
      return candidates;
    }

    // Check if the LLM is available
    const modelId = this._languageModelsService.getActiveModel();
    if (!modelId) {
      return candidates;
    }

    // Score each candidate in parallel with a timeout
    const scored: Array<{ result: SearchResult; relevance: number }> = [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);

    try {
      const scorePromises = candidates.map(async (result) => {
        try {
          const relevance = await this._scoreChunk(query, result, controller.signal);
          return { result, relevance };
        } catch {
          // If scoring fails for one chunk, give it a neutral score (keeps it if it was high-RRF)
          return { result, relevance: -1 };
        }
      });

      const results = await Promise.all(scorePromises);

      for (const { result, relevance } of results) {
        if (relevance >= RERANK_MIN_RELEVANCE) {
          scored.push({ result, relevance });
        } else if (relevance === -1) {
          // LLM call failed — keep the chunk with a below-threshold marker
          // so it doesn't disappear silently, but ranks lower
          scored.push({ result, relevance: RERANK_MIN_RELEVANCE - 1 });
        }
        // Otherwise: relevance < RERANK_MIN_RELEVANCE → dropped as irrelevant
      }
    } finally {
      clearTimeout(timeout);
    }

    // If re-ranking produced no results (all below threshold), fall back to original
    if (scored.length === 0) {
      return candidates;
    }

    // Sort by relevance score descending, then by original RRF score as tiebreaker
    scored.sort((a, b) => {
      if (b.relevance !== a.relevance) { return b.relevance - a.relevance; }
      return b.result.score - a.result.score;
    });

    return scored.map((s) => s.result);
  }

  /**
   * Score a single chunk's relevance to a query using the LLM.
   *
   * Uses a minimalist prompt for fast inference. Requests JSON format
   * for reliable parsing. Returns a number 0-10.
   */
  private async _scoreChunk(
    query: string,
    result: SearchResult,
    signal: AbortSignal,
  ): Promise<number> {
    const chunkPreview = result.chunkText.length > RERANK_MAX_CHUNK_CHARS
      ? result.chunkText.slice(0, RERANK_MAX_CHUNK_CHARS) + '...'
      : result.chunkText;

    const sourceInfo = result.contextPrefix || result.sourceId;

    const messages: IChatMessage[] = [
      {
        role: 'system',
        content: 'You are a relevance scoring assistant. Given a search query and a text passage, rate how relevant the passage is to answering the query. Reply with ONLY a JSON object: {"score": N} where N is an integer from 0 (completely irrelevant) to 10 (perfectly relevant).',
      },
      {
        role: 'user',
        content: `Query: ${query}\n\nSource: ${sourceInfo}\nPassage: ${chunkPreview}`,
      },
    ];

    let fullResponse = '';

    for await (const chunk of this._languageModelsService!.sendChatRequest(
      messages,
      { temperature: 0, maxTokens: 20, format: 'json' },
      signal,
    )) {
      fullResponse += chunk.content;
      if (chunk.done) { break; }
    }

    // Parse the JSON response
    const trimmed = fullResponse.trim();
    try {
      const parsed = JSON.parse(trimmed);
      const score = Number(parsed.score);
      if (Number.isFinite(score) && score >= 0 && score <= 10) {
        return Math.round(score);
      }
    } catch {
      // Try to extract a bare number if JSON parsing fails
      const numMatch = trimmed.match(/\d+/);
      if (numMatch) {
        const score = Number(numMatch[0]);
        if (score >= 0 && score <= 10) { return score; }
      }
    }

    return -1; // Parse failure
  }
}
