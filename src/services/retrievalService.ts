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
import type { SearchResult, SearchOptions, HybridSearchTrace } from './vectorStoreService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default number of final chunks to return. */
const DEFAULT_TOP_K = 20;

/** Phase C adaptive candidate generation defaults. */
const SIMPLE_OVERFETCH_FACTOR = 3;
const EXACT_OVERFETCH_FACTOR = 2;
const HARD_OVERFETCH_FACTOR = 5;
const HARD_QUERY_TERM_THRESHOLD = 12;
const MAX_QUERY_VARIANTS = 4;
const MAX_SEARCH_TOP_K = 60;

const KEYWORD_FOCUS_STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'at', 'be', 'call', 'can', 'cite', 'cited', 'do', 'does', 'for',
  'from', 'get', 'have', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'please',
  'point', 'right', 'should', 'show', 'source', 'sources', 'tell', 'that', 'the', 'their', 'them',
  'there', 'these', 'this', 'those', 'to', 'under', 'what', 'when', 'where', 'which', 'who', 'would',
  'your', 'yours', 'policy', 'according', 'about', 'with', 'now', 'into', 'just', 'want', 'like',
]);

/** Minimum RRF score — chunks below this are dropped.
 *
 * With RRF k=60, the maximum single-path rank score is 1/61 ≈ 0.0164.
 * After two-path fusion (vector + keyword), a top-1 result in both paths
 * scores ~0.033. A threshold of 0.01 is lenient — it filters only clear
 * noise while letting the AI see more context and decide what's relevant.
 */
const DEFAULT_MIN_SCORE = 0.01;

/** Max chunks from the same source before dedup kicks in. */
const DEFAULT_MAX_PER_SOURCE = 5;

/** Default token budget for retrieved context.
 *  0 = auto (computed from model context window at call time).
 */
const DEFAULT_TOKEN_BUDGET = 0;

/** Rough token estimator: chars / 4 (same as defaultParticipant). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Minimum cosine similarity between query embedding and candidate embedding
 * for a chunk to survive cosine re-ranking. 0.20 is lenient — it removes
 * only clearly unrelated candidates. Set to 0 to disable cosine filtering
 * entirely and let the AI see everything above the RRF score threshold.
 *
 * Reference: docs/Parallx_Milestone_16.md Phase 2 — Cosine Re-ranking
 */
const DEFAULT_MIN_COSINE_SCORE = 0.20;

/**
 * Default relative score drop-off ratio. 0 = disabled (no drop-off filter).
 * When > 0, results below topScore × ratio are dropped.
 */
const DEFAULT_DROPOFF_RATIO = 0;

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

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeQueryKey(text: string): string {
  return collapseWhitespace(text).replace(/[?!;:.]+$/g, '').toLowerCase();
}

function stripFormattingRequests(query: string): string {
  return collapseWhitespace(
    query
      .replace(/please\s+cite\s+(?:your\s+)?sources?/gi, ' ')
      .replace(/with\s+(?:source\s+)?citations?/gi, ' ')
      .replace(/(?:and\s+)?cite\s+(?:your\s+)?sources?/gi, ' '),
  );
}

function normalizeLexicalToken(token: string): string {
  return token
    .replace(/[’']/g, "'")
    .replace(/'s$/i, '')
    .replace(/^[^a-z0-9$%]+|[^a-z0-9$%]+$/gi, '')
    .toLowerCase();
}

function extractCriticalIdentifiers(query: string): string[] {
  const identifiers: string[] = [];
  const patterns = [
    /"([^"]+)"/g,
    /'([^']+)'/g,
    /(\$\d[\d,]*(?:\.\d+)?)/g,
    /(\b\d+(?:\.\d+)?%)/g,
    /(\([0-9]{3}\)\s*[0-9]{3}-[0-9]{4}\b)/g,
    /(\b[0-9]{3}-[0-9]{3}-[0-9]{4}\b)/g,
    /(\b[A-Z]{2,}(?:[-_][A-Z0-9]+)*\b)/g,
    /(\b[a-zA-Z0-9_-]+\.[a-z0-9]{1,8}\b)/g,
  ];

  for (const pattern of patterns) {
    for (const match of query.matchAll(pattern)) {
      const value = collapseWhitespace(match[1] ?? match[0] ?? '');
      if (value) {
        identifiers.push(value);
      }
    }
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const identifier of identifiers) {
    const key = identifier.toLowerCase();
    if (seen.has(key)) { continue; }
    seen.add(key);
    deduped.push(identifier);
  }

  return deduped;
}

function stripPromptFiller(query: string): string {
  let rewritten = collapseWhitespace(query);
  rewritten = rewritten.replace(/^(?:please\s+)?(?:can|could|would|will)\s+you\s+/i, '');
  rewritten = rewritten.replace(/^(?:please\s+)?(?:show|tell|find|look up|summarize|explain)\s+(?:me\s+)?/i, '');
  return collapseWhitespace(rewritten.replace(/[?]+$/g, ''));
}

function buildGuardedRewrite(query: string, identifiers: readonly string[]): string | undefined {
  const rewritten = stripPromptFiller(query);
  if (!rewritten || normalizeQueryKey(rewritten) === normalizeQueryKey(query)) {
    return undefined;
  }

  const lowered = rewritten.toLowerCase();
  const missing = identifiers.filter((identifier) => !lowered.includes(identifier.toLowerCase()));
  return collapseWhitespace(missing.length > 0 ? `${rewritten} ${missing.join(' ')}` : rewritten);
}

function buildKeywordFocusedQuery(query: string, identifiers: readonly string[]): string | undefined {
  const cleaned = collapseWhitespace(
    stripFormattingRequests(query)
      .replace(/under\s+my\s+policy/gi, ' ')
      .replace(/according\s+to\s+my\s+policy/gi, ' ')
      .replace(/[?!.,:;()[\]{}]/g, ' '),
  );

  const tokens = cleaned
    .split(/\s+/)
    .map((token) => normalizeLexicalToken(token.trim()))
    .filter((token) => token.length > 0);

  const filtered = tokens.filter((token) => {
    const lowered = token.toLowerCase();
    if (identifiers.some((identifier) => identifier.toLowerCase() === lowered)) {
      return true;
    }
    if (/^\d+$/.test(token)) { return false; }
    return token.length >= 3 && !KEYWORD_FOCUS_STOPWORDS.has(lowered);
  });

  if (filtered.length < 2) {
    return undefined;
  }

  const focused = collapseWhitespace(filtered.join(' '));
  return normalizeQueryKey(focused) === normalizeQueryKey(query) ? undefined : focused;
}

function extractFocusTerms(query: string, identifiers: readonly string[]): string[] {
  const tokens = stripFormattingRequests(query)
    .replace(/[?!.,:;()[\]{}]/g, ' ')
    .split(/\s+/)
    .map((token) => normalizeLexicalToken(token.trim()))
    .filter((token) => token.length >= 3 && !KEYWORD_FOCUS_STOPWORDS.has(token));

  const merged = [...identifiers.map((identifier) => identifier.toLowerCase()), ...tokens];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const token of merged) {
    if (seen.has(token)) { continue; }
    seen.add(token);
    deduped.push(token);
  }
  return deduped;
}

function decomposeQuery(query: string): string[] {
  const lowered = query.toLowerCase();
  if (/\b(compare|difference|versus|vs\.?|between)\b/i.test(lowered)) {
    return [];
  }

  const firstPass = query
    .split(/[;?]+/)
    .flatMap((part) => part.split(/\s+(?:then|after that|afterwards|next|finally)\s+/i))
    .flatMap((part) => part.split(/\s+(?:and|also)\s+(?=(?:how|what|where|who|when|which|should|can|do|does|is|are|call|contact|file|report|find|get)\b)/i))
    .map((part) => collapseWhitespace(part))
    .filter((part) => part.length > 0);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const part of firstPass) {
    if (part.split(/\s+/).length < 4) { continue; }
    const key = normalizeQueryKey(part);
    if (!key || key === normalizeQueryKey(query) || seen.has(key)) { continue; }
    seen.add(key);
    deduped.push(part);
  }

  return deduped;
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
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

export interface RetrievalQueryPlanTrace {
  rawQuery: string;
  complexity: 'simple' | 'hard';
  strategy: 'single' | 'decomposed';
  exactMatchBias: boolean;
  identifiers: string[];
  reasons: string[];
  candidateMultiplier: number;
  perQueryTopK: number;
  variants: Array<{
    text: string;
    reason: 'raw' | 'rewrite' | 'decomposition' | 'identifier-focus';
    keywordQuery?: string;
  }>;
}

export interface RetrievalTrace {
  query: string;
  topK: number;
  minScore: number;
  maxPerSource: number;
  tokenBudget: number;
  cosineThreshold: number;
  dropoffRatio: number;
  rawCandidateCount: number;
  afterScoreFilterCount: number;
  afterDropoffCount: number;
  afterCosineCount: number;
  afterDedupCount: number;
  finalCount: number;
  scoreThresholdDrops: number;
  dropoffDrops: number;
  cosineDrops: number;
  dedupDrops: number;
  tokenBudgetDrops: number;
  tokenBudgetUsed: number;
  queryPlan?: RetrievalQueryPlanTrace;
  finalChunks: Array<{
    sourceType: string;
    sourceId: string;
    score: number;
    tokenCount: number;
  }>;
  vectorStoreTrace?: HybridSearchTrace;
  vectorStoreTraces?: HybridSearchTrace[];
}

interface PlannedQueryVariant {
  text: string;
  reason: 'raw' | 'rewrite' | 'decomposition' | 'identifier-focus';
  keywordQuery?: string;
}

interface RetrievalQueryPlan {
  complexity: 'simple' | 'hard';
  strategy: 'single' | 'decomposed';
  exactMatchBias: boolean;
  identifiers: string[];
  reasons: string[];
  candidateMultiplier: number;
  perQueryTopK: number;
  variants: PlannedQueryVariant[];
}

interface IVectorStoreTraceAccessor {
  getLastSearchTrace?(): HybridSearchTrace | undefined;
}

// ─── RetrievalService ────────────────────────────────────────────────────────

/**
 * Query-time retrieval service.
 *
 * Embeds a user query, runs hybrid search through the VectorStoreService,
 * applies post-retrieval filtering (score threshold, cosine re-ranking,
 * dedup, token budget), and returns ranked context chunks.
 */
/** Config provider shape — all retrieval settings from AI Settings. */
interface IRetrievalConfigProvider {
  getEffectiveConfig(): {
    retrieval: {
      ragTopK: number;
      ragMaxPerSource: number;
      ragTokenBudget: number;
      ragScoreThreshold: number;
      ragCosineThreshold: number;
      ragDropoffRatio: number;
    };
    model?: { contextWindow?: number };
  };
}

export class RetrievalService extends Disposable implements IRetrievalService {

  private readonly _embeddingService: IEmbeddingService;
  private readonly _vectorStore: IVectorStoreService;
  private _configProvider?: IRetrievalConfigProvider;
  private _lastTrace: RetrievalTrace | undefined;

  constructor(
    embeddingService: IEmbeddingService,
    vectorStore: IVectorStoreService,
  ) {
    super();
    this._embeddingService = embeddingService;
    this._vectorStore = vectorStore;
  }

  /** Bind a config provider (M20: UnifiedAIConfigService) for runtime defaults. */
  setConfigProvider(provider: IRetrievalConfigProvider): void {
    this._configProvider = provider;
  }

  // ── Public API ──

  /**
   * Retrieve relevant context chunks for a user query.
   *
   * Pipeline:
   *   1. Embed query (search_query prefix)
   *   2. Hybrid search (vector + keyword via VectorStoreService, 3× overfetch)
   *   3. Score threshold filter (absolute + optional relative drop-off)
   *   4. Cosine re-ranking (optional, drops below cosine threshold)
   *   5. Source deduplication (cap chunks per source)
   *   6. Token budget enforcement (auto-scales to model context window)
   */
  async retrieve(query: string, options?: RetrievalOptions): Promise<RetrievedContext[]> {
    if (!query.trim()) { return []; }

    const cfg = this._configProvider?.getEffectiveConfig();
    const cfgRetrieval = cfg?.retrieval;
    const topK = options?.topK ?? cfgRetrieval?.ragTopK ?? DEFAULT_TOP_K;
    const minScore = options?.minScore ?? cfgRetrieval?.ragScoreThreshold ?? DEFAULT_MIN_SCORE;
    const maxPerSource = options?.maxPerSource ?? cfgRetrieval?.ragMaxPerSource ?? DEFAULT_MAX_PER_SOURCE;
    const cosineThreshold = cfgRetrieval?.ragCosineThreshold ?? DEFAULT_MIN_COSINE_SCORE;
    const dropoffRatio = cfgRetrieval?.ragDropoffRatio ?? DEFAULT_DROPOFF_RATIO;
    const queryPlan = this._buildQueryPlan(query, topK);

    // Token budget: 0 = auto (30% of model context window, floor 3000).
    const rawBudget = options?.tokenBudget ?? cfgRetrieval?.ragTokenBudget ?? DEFAULT_TOKEN_BUDGET;
    let tokenBudget: number;
    if (rawBudget > 0) {
      tokenBudget = rawBudget;
    } else {
      const ctxWindow = cfg?.model?.contextWindow ?? 0;
      tokenBudget = ctxWindow > 0 ? Math.floor(ctxWindow * 0.30) : 8000;
    }

    // 1. Embed the user query
    const queryEmbedding = await this._embeddingService.embedQuery(query);

    // 2. Phase C candidate generation — stay on the fast path for simple
    //    exact questions, but widen and decompose harder questions.
    const { results: candidateResults, traces: vectorStoreTraces } = await this._collectCandidates(
      query,
      queryEmbedding,
      queryPlan,
      options,
    );
    const rawResults = this._applyIntentAwareSourceBoost(
      this._applyLexicalFocusBoost(candidateResults, queryPlan),
      query,
      queryPlan,
    );
    const vectorStoreTrace = vectorStoreTraces.at(-1);

    // 3. Score threshold filter (RRF scores)
    let filtered = rawResults.filter((r) => r.score >= minScore);
    const afterScoreFilterCount = filtered.length;

    // 3b. Relative score drop-off (configurable, 0 = disabled).
    //     When enabled, drops results below topScore × dropoffRatio.
    if (dropoffRatio > 0 && filtered.length > 1) {
      const topScore = filtered[0].score;
      const dropoffThreshold = topScore * dropoffRatio;
      filtered = filtered.filter((r) => r.score >= dropoffThreshold);
    }
    const afterDropoffCount = filtered.length;

    // 4. Cosine re-ranking (configurable threshold, 0 = disabled).
    if (cosineThreshold > 0 && filtered.length > 0) {
      filtered = await this._cosineRerank(queryEmbedding, filtered, cosineThreshold);
    }
    const afterCosineCount = filtered.length;

    // 5. Source deduplication — cap chunks from any single source
    filtered = this._deduplicateSources(filtered, maxPerSource);
    const afterDedupCount = filtered.length;

    // 6. Token budget enforcement
    const budgeted = this._applyTokenBudget(filtered, tokenBudget);

    // 7. Map to RetrievedContext and trim to topK
    const finalResults = budgeted.results.slice(0, topK).map((r) => ({
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      contextPrefix: r.contextPrefix,
      text: r.chunkText,
      score: r.score,
      sources: r.sources,
      tokenCount: estimateTokens(r.chunkText),
    }));

    this._lastTrace = {
      query,
      topK,
      minScore,
      maxPerSource,
      tokenBudget,
      cosineThreshold,
      dropoffRatio,
      queryPlan: {
        rawQuery: query,
        complexity: queryPlan.complexity,
        strategy: queryPlan.strategy,
        exactMatchBias: queryPlan.exactMatchBias,
        identifiers: [...queryPlan.identifiers],
        reasons: [...queryPlan.reasons],
        candidateMultiplier: queryPlan.candidateMultiplier,
        perQueryTopK: queryPlan.perQueryTopK,
        variants: queryPlan.variants.map((variant) => ({
          text: variant.text,
          reason: variant.reason,
          keywordQuery: variant.keywordQuery,
        })),
      },
      rawCandidateCount: rawResults.length,
      afterScoreFilterCount,
      afterDropoffCount,
      afterCosineCount,
      afterDedupCount,
      finalCount: finalResults.length,
      scoreThresholdDrops: rawResults.length - afterScoreFilterCount,
      dropoffDrops: afterScoreFilterCount - afterDropoffCount,
      cosineDrops: afterDropoffCount - afterCosineCount,
      dedupDrops: afterCosineCount - afterDedupCount,
      tokenBudgetDrops: afterDedupCount - budgeted.results.length,
      tokenBudgetUsed: budgeted.tokensUsed,
      finalChunks: finalResults.map((chunk) => ({
        sourceType: chunk.sourceType,
        sourceId: chunk.sourceId,
        score: chunk.score,
        tokenCount: chunk.tokenCount,
      })),
      vectorStoreTrace,
      vectorStoreTraces,
    };

    return finalResults;
  }

  getLastTrace(): RetrievalTrace | undefined {
    return this._lastTrace ? structuredClone(this._lastTrace) : undefined;
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

  private _buildQueryPlan(query: string, topK: number): RetrievalQueryPlan {
    const normalized = collapseWhitespace(query);
    const analysisQuery = stripFormattingRequests(normalized);
    const identifiers = extractCriticalIdentifiers(normalized);
    const termCount = analysisQuery.split(/\s+/).filter(Boolean).length;
    const reasons: string[] = [];

    const hasCrossSourceSignal = /\b(across|cross-source|multiple|both|all|workflow|steps|process|follow-up|continue)\b/i.test(analysisQuery);
    const hasSequentialSignal = /\b(then|after that|afterwards|next|finally)\b/i.test(analysisQuery);
    const questionHeadMatches = analysisQuery.match(/\b(what|how|where|who|when|which)\b/gi) ?? [];
    const isCompactFollowUp = /^(?:and\s+)?what\s+about\b/i.test(analysisQuery)
      || /^(?:and\s+)?(?:collision|comprehensive|liability|uninsured|underinsured|um|uim)\b/i.test(analysisQuery);
    const hasMultipleQuestionHeads =
      questionHeadMatches.length >= 2
      || (!isCompactFollowUp && /\b(?:and|also)\s+(?:what|how|where|who|when|which|should|can)\b/i.test(analysisQuery));
    const isLongQuestion = termCount >= HARD_QUERY_TERM_THRESHOLD;
    const exactMatchBias = identifiers.length > 0;

    if (hasCrossSourceSignal) { reasons.push('cross-source-signal'); }
    if (hasSequentialSignal) { reasons.push('sequential-signal'); }
    if (hasMultipleQuestionHeads) { reasons.push('multi-clause-question'); }
    if (isLongQuestion && !exactMatchBias) { reasons.push('long-query'); }
    if (exactMatchBias) { reasons.push('identifier-sensitive'); }

    const complexity: 'simple' | 'hard' =
      hasCrossSourceSignal || hasSequentialSignal || hasMultipleQuestionHeads || (isLongQuestion && !exactMatchBias)
        ? 'hard'
        : 'simple';

    const variants: PlannedQueryVariant[] = [{ text: normalized, reason: 'raw' }];
    const rewrite = buildGuardedRewrite(normalized, identifiers);
    if (complexity === 'hard' && rewrite) {
      variants.push({ text: rewrite, reason: 'rewrite' });
    }

    const keywordFocused = !exactMatchBias
      ? buildKeywordFocusedQuery(rewrite ?? normalized, identifiers)
      : undefined;

    if (complexity === 'simple' && keywordFocused) {
      variants[0] = { ...variants[0], keywordQuery: keywordFocused };
      reasons.push('keyword-focused-lexical');
    }

    if (complexity === 'hard') {
      for (const part of decomposeQuery(analysisQuery)) {
        variants.push({
          text: part,
          reason: 'decomposition',
          keywordQuery: !exactMatchBias ? buildKeywordFocusedQuery(part, identifiers) : undefined,
        });
      }
      if (identifiers.length >= 2) {
        variants.push({ text: identifiers.join(' '), reason: 'identifier-focus' });
      }
    }

    const seen = new Set<string>();
    const dedupedVariants: PlannedQueryVariant[] = [];
    for (const variant of variants) {
      const key = normalizeQueryKey(variant.text);
      if (!key || seen.has(key)) { continue; }
      seen.add(key);
      dedupedVariants.push({
        text: collapseWhitespace(variant.text),
        reason: variant.reason,
        keywordQuery: variant.keywordQuery,
      });
      if (dedupedVariants.length >= MAX_QUERY_VARIANTS) { break; }
    }

    const strategy: 'single' | 'decomposed' = dedupedVariants.length > 1 ? 'decomposed' : 'single';
    const candidateMultiplier = complexity === 'hard'
      ? HARD_OVERFETCH_FACTOR
      : exactMatchBias
        ? EXACT_OVERFETCH_FACTOR
        : SIMPLE_OVERFETCH_FACTOR;
    const perQueryTopK = strategy === 'single'
      ? Math.min(MAX_SEARCH_TOP_K, Math.max(topK * candidateMultiplier, topK + 4))
      : Math.min(MAX_SEARCH_TOP_K, Math.max(8, Math.ceil((topK * candidateMultiplier) / dedupedVariants.length) + 2));

    return {
      complexity,
      strategy,
      exactMatchBias,
      identifiers,
      reasons,
      candidateMultiplier,
      perQueryTopK,
      variants: dedupedVariants,
    };
  }

  private async _collectCandidates(
    rawQuery: string,
    rawQueryEmbedding: number[],
    queryPlan: RetrievalQueryPlan,
    options?: RetrievalOptions,
  ): Promise<{ results: SearchResult[]; traces: HybridSearchTrace[] }> {
    const traces: HybridSearchTrace[] = [];

    if (queryPlan.variants.length === 1) {
      const singleResult = await this._runSingleSearch(
        rawQuery,
        queryPlan.variants[0].keywordQuery,
        rawQueryEmbedding,
        queryPlan.perQueryTopK,
        options,
      );
      if (singleResult.trace) {
        traces.push(singleResult.trace);
      }
      return { results: singleResult.results, traces };
    }

    const merged = new Map<string, SearchResult>();
    for (const variant of queryPlan.variants) {
      const queryEmbedding = normalizeQueryKey(variant.text) === normalizeQueryKey(rawQuery)
        ? rawQueryEmbedding
        : await this._embeddingService.embedQuery(variant.text);
      const variantResult = await this._runSingleSearch(
        variant.text,
        variant.keywordQuery,
        queryEmbedding,
        queryPlan.perQueryTopK,
        options,
      );
      if (variantResult.trace) {
        traces.push(variantResult.trace);
      }
      for (const result of variantResult.results) {
        const key = `${result.rowid}:${result.sourceType}:${result.sourceId}:${result.chunkIndex}`;
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, { ...result, sources: [...result.sources] });
          continue;
        }
        existing.score = Math.max(existing.score, result.score);
        existing.sources = Array.from(new Set([...existing.sources, ...result.sources]));
      }
    }

    return {
      results: Array.from(merged.values()).sort((a, b) => b.score - a.score),
      traces,
    };
  }

  private _applyLexicalFocusBoost(
    results: SearchResult[],
    queryPlan: RetrievalQueryPlan,
  ): SearchResult[] {
    if (queryPlan.exactMatchBias) {
      return results;
    }

    const focusSeed = queryPlan.variants[0]?.keywordQuery ?? queryPlan.variants[0]?.text ?? '';
    const focusTerms = extractFocusTerms(focusSeed, queryPlan.identifiers);
    if (focusTerms.length === 0) {
      return results;
    }

    return results.map((result) => {
      const context = [result.contextPrefix, result.headingPath, result.parentHeadingPath]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' ')
        .toLowerCase();

      if (!context) {
        return result;
      }

      const matchedTerms = focusTerms.filter((term) => context.includes(term));
      if (matchedTerms.length === 0) {
        return result;
      }

      const coverage = matchedTerms.length / focusTerms.length;
      const contextBoost = Math.min(0.012, coverage * 0.012);
      return { ...result, score: result.score + contextBoost };
    }).sort((a, b) => b.score - a.score);
  }

  private _applyIntentAwareSourceBoost(
    results: SearchResult[],
    query: string,
    queryPlan: RetrievalQueryPlan,
  ): SearchResult[] {
    const normalizedQuery = normalizeQueryKey(stripFormattingRequests(query));
    const isSimple = queryPlan.complexity === 'simple';
    const wantsAgentContact = matchesAny(normalizedQuery, [
      /\bagent\b/,
      /\bcontact\b/,
      /\bphone\b/,
      /\bnumber\b/,
      /\bcall\b/,
    ]) && !matchesAny(normalizedQuery, [
      /\brepair\b/,
      /\bshop\b/,
      /\broadside\b/,
      /\bclaims\s+line\b/,
    ]);
    const wantsRepairShops = matchesAny(normalizedQuery, [/\brepair\b/, /\bshop\b/, /\bshops\b/]);
    const wantsDeductible = matchesAny(normalizedQuery, [/\bdeductible\b/, /\bcollision\b/, /\bcomprehensive\b/]);
    const wantsWorkspaceDocs = matchesAny(normalizedQuery, [/\bdocuments?\b/, /\bfiles?\b/, /\bworkspace\b/, /\bcontents?\b/]);

    return results.map((result) => {
      let adjustedScore = result.score;
      const sourceMeta = [
        result.sourceId,
        result.contextPrefix,
        result.headingPath,
        result.parentHeadingPath,
        result.chunkText.slice(0, 180),
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' ')
        .toLowerCase();

      if (isSimple && result.sourceType === 'concept') {
        adjustedScore -= 0.008;
      }

      if (wantsAgentContact) {
        if (sourceMeta.includes('agent contacts') || sourceMeta.includes('your agent') || sourceMeta.includes('sarah')) {
          adjustedScore += 0.016;
        }
        if (sourceMeta.includes('claims guide') || sourceMeta.includes('quick reference')) {
          adjustedScore -= 0.003;
        }
      }

      if (wantsRepairShops) {
        if (sourceMeta.includes('preferred repair') || sourceMeta.includes('repair shop')) {
          adjustedScore += 0.016;
        }
        if (sourceMeta.includes('agent contacts')) {
          adjustedScore += 0.004;
        }
      }

      if (wantsDeductible) {
        if (sourceMeta.includes('collision coverage') || sourceMeta.includes('comprehensive coverage') || sourceMeta.includes('deductible')) {
          adjustedScore += 0.010;
        }
        if (result.sourceId.toLowerCase() === 'auto insurance policy.md') {
          adjustedScore += 0.004;
        }
      }

      if (wantsWorkspaceDocs) {
        if (result.sourceType === 'file_chunk' && /\.md$/i.test(result.sourceId)) {
          adjustedScore += 0.010;
        }
        if (/ai-config\.json$/i.test(result.sourceId)) {
          adjustedScore -= 0.020;
        }
      }

      return adjustedScore === result.score
        ? result
        : { ...result, score: adjustedScore };
    }).sort((a, b) => b.score - a.score);
  }

  private async _runSingleSearch(
    queryText: string,
    keywordQueryText: string | undefined,
    queryEmbedding: number[],
    searchTopK: number,
    options?: RetrievalOptions,
  ): Promise<{ results: SearchResult[]; trace?: HybridSearchTrace }> {
    const searchOptions: SearchOptions = {
      topK: searchTopK,
      sourceFilter: options?.sourceFilter,
      minScore: 0,
      includeKeyword: options?.includeKeyword ?? true,
    };

    const results = await this._vectorStore.search(
      queryEmbedding,
      keywordQueryText ?? queryText,
      searchOptions,
    );
    const trace = (this._vectorStore as IVectorStoreTraceAccessor).getLastSearchTrace?.();
    return { results, trace };
  }

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
  private _applyTokenBudget(results: SearchResult[], tokenBudget: number): { results: SearchResult[]; tokensUsed: number } {
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

    return { results: budgeted, tokensUsed };
  }

  // ── Cosine Re-Ranking (M16 Task 2.2) ──

  /**
   * Re-rank candidates by cosine similarity between the query embedding
   * and each candidate's stored embedding. Drops candidates below the
   * configured cosine threshold and re-sorts by cosine similarity (descending).
   *
   * This is a lightweight, zero-latency re-ranker that uses already-computed
   * embeddings — no additional model calls. It catches false positives from
   * keyword-only matches that passed the RRF score threshold but aren't
   * actually semantically related to the query.
   */
  private async _cosineRerank(
    queryEmbedding: number[],
    candidates: SearchResult[],
    minCosine: number = DEFAULT_MIN_COSINE_SCORE,
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
        scored.push({ result: candidate, cosine: minCosine });
        continue;
      }
      const sim = cosineSimilarity(queryEmbedding, emb);
      if (sim >= minCosine) {
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
