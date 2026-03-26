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

const NON_IDENTIFIER_UPPERCASE_TOKENS = new Set([
  'ok',
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
    if (NON_IDENTIFIER_UPPERCASE_TOKENS.has(key)) { continue; }
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

function isInternalArtifactPath(sourceId: string): boolean {
  return /^\.parallx\//i.test(sourceId);
}

function queryExplicitlyTargetsInternalArtifacts(query: string): boolean {
  return matchesAny(query.toLowerCase(), [
    /\.parallx\//,
    /\bparallx\b/,
    /\bai-config(?:\.json)?\b/,
    /\bpermissions\.json\b/,
    /\bmemory\.md\b/,
    /\bmemory\s+file\b/,
    /\btranscript\b/,
    /\bsession\s+history\b/,
    /\bsession\s+log\b/,
  ]);
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options for a retrieval query. */
export interface RetrievalOptions {
  /** Max chunks to return (default: 10). */
  topK?: number;
  /** Filter by source type ('page_block', 'file_chunk'). */
  sourceFilter?: string;
  /** Restrict retrieval to an explicit set of source IDs when the user clearly targets named sources. */
  sourceIds?: string[];
  /** Restrict retrieval to sources whose source_id starts with one of these prefixes (scope filtering). */
  pathPrefixes?: string[];
  /** Minimum relevance score (default: 0.01). */
  minScore?: number;
  /** Whether to include FTS5 keyword search (default: true). */
  includeKeyword?: boolean;
  /** Max chunks from one source (default: 3). */
  maxPerSource?: number;
  /** Max total tokens of context to return (default: 4000). */
  tokenBudget?: number;
  /** Whether internal workspace artifacts such as `.parallx/*` may participate in generic retrieval. */
  internalArtifactPolicy?: 'exclude' | 'include';
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

export interface RetrievalDiagnosticCandidate {
  rowid: number;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  contextPrefix: string;
  headingPath?: string;
  parentHeadingPath?: string;
  structuralRole?: string;
  score: number;
  tokenCount: number;
  sources: string[];
  preview: string;
}

export interface RetrievalDroppedEvidenceTrace extends RetrievalDiagnosticCandidate {
  droppedAt: 'corpus-hygiene' | 'score-threshold' | 'dedup' | 'token-budget';
  detail?: string;
}

export interface RetrievalTrace {
  query: string;
  topK: number;
  minScore: number;
  maxPerSource: number;
  tokenBudget: number;
  rawCandidateCount: number;
  afterCorpusHygieneCount: number;
  afterScoreFilterCount: number;
  afterDedupCount: number;
  finalCount: number;
  corpusHygieneDrops: number;
  scoreThresholdDrops: number;
  dedupDrops: number;
  tokenBudgetDrops: number;
  tokenBudgetUsed: number;
  queryPlan?: RetrievalQueryPlanTrace;
  diagnostics?: {
    generatedQueries: RetrievalQueryPlanTrace['variants'];
    firstStageCandidates: RetrievalDiagnosticCandidate[];
    droppedEvidence: RetrievalDroppedEvidenceTrace[];
    finalPackedContextText: string;
    finalPackedContext: RetrievalDiagnosticCandidate[];
  };
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

const EXPLICIT_SOURCE_QUERY_PATTERNS: readonly RegExp[] = [
  /\baccording to\b/i,
  /\bin (?:the )?.*\b(?:book|document|file|pdf|guide|paper)\b/i,
  /\bfrom (?:the )?.*\b(?:book|document|file|pdf|guide|paper)\b/i,
  /\bwhich (?:book|document|file|pdf|guide|paper)\b/i,
  /\b(?:workflow|system|claims?)\s+architecture\b/i,
  /\b(?:architecture|schema|plan|spec(?:ification)?|report)\s+doc(?:ument)?\b/i,
];

const SOURCE_MATCH_STOPWORDS = new Set([
  'a', 'an', 'and', 'art', 'basic', 'book', 'books', 'by', 'cite', 'course', 'document', 'documents', 'file',
  'files', 'folder', 'guide', 'in', 'is', 'of', 'on', 'paper', 'pdf', 'please', 'source', 'sources', 'student',
  'text', 'the', 'this', 'to', 'which', 'work', 'workspace',
]);

function normalizeSourceMatchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.(pdf|docx|md|txt|epub|xlsx|xls)$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSourceMatch(text: string): string[] {
  return normalizeSourceMatchText(text)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !SOURCE_MATCH_STOPWORDS.has(token));
}

function shouldAttemptExplicitSourceResolution(query: string): boolean {
  return EXPLICIT_SOURCE_QUERY_PATTERNS.some((pattern) => pattern.test(query));
}

interface IVectorStoreTraceAccessor {
  getLastSearchTrace?(): HybridSearchTrace | undefined;
}

function summarizeCandidatePreview(text: string): string {
  return collapseWhitespace(text).slice(0, 160);
}

function toDiagnosticCandidate(result: SearchResult): RetrievalDiagnosticCandidate {
  return {
    rowid: result.rowid,
    sourceType: result.sourceType,
    sourceId: result.sourceId,
    chunkIndex: result.chunkIndex,
    contextPrefix: result.contextPrefix,
    headingPath: result.headingPath,
    parentHeadingPath: result.parentHeadingPath,
    structuralRole: result.structuralRole,
    score: result.score,
    tokenCount: estimateTokens(result.chunkText),
    sources: [...result.sources],
    preview: summarizeCandidatePreview(result.chunkText),
  };
}

// ─── RetrievalService ────────────────────────────────────────────────────────

/**
 * Query-time retrieval service.
 *
 * Embeds a user query, runs hybrid search through the VectorStoreService,
 * applies post-retrieval filtering (score threshold, dedup, token budget),
 * and returns ranked context chunks. No post-retrieval heuristic re-ranking.
 */
/** Config provider shape — all retrieval settings from AI Settings. */
interface IRetrievalConfigProvider {
  getEffectiveConfig(): {
    retrieval: {
      ragDecompositionMode?: 'auto' | 'off';
      ragCandidateBreadth?: 'balanced' | 'broad';
      ragTopK: number;
      ragMaxPerSource: number;
      ragTokenBudget: number;
      ragScoreThreshold: number;
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
   * Aligned with upstream OpenClaw pattern: hybrid search (RRF fusion),
   * then let the model decide relevance. No post-retrieval heuristic stages.
   *
   * Pipeline:
   *   1. Embed query (search_query prefix)
   *   2. Hybrid search (vector + keyword via VectorStoreService, RRF k=60)
   *   3. Internal artifact hygiene (exclude .parallx internals)
   *   4. Score threshold filter (basic RRF noise floor)
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
    const decompositionMode = cfgRetrieval?.ragDecompositionMode ?? 'auto';
    const candidateBreadth = cfgRetrieval?.ragCandidateBreadth ?? 'balanced';
    const queryPlan = this._buildQueryPlan(query, topK, decompositionMode, candidateBreadth);
    const explicitSourceIds = options?.sourceIds ?? await this._resolveExplicitSourceIds(query, queryPlan);

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

    // 2. Hybrid search — RRF fusion of vector + keyword candidates
    const { results: candidateResults, traces: vectorStoreTraces } = await this._collectCandidates(
      query,
      queryEmbedding,
      queryPlan,
      {
        ...options,
        sourceIds: explicitSourceIds,
      },
    );
    const vectorStoreTrace = vectorStoreTraces.at(-1);

    // 3. Internal artifact hygiene (.parallx files excluded from generic retrieval)
    const corpusHygieneResult = this._applyInternalArtifactHygiene(candidateResults, query, options);
    const rawResults = corpusHygieneResult.results;
    const rawCandidateCount = candidateResults.length;
    const afterCorpusHygieneCount = rawResults.length;

    // 4. Score threshold filter (RRF scores)
    const droppedEvidence: RetrievalDroppedEvidenceTrace[] = [...corpusHygieneResult.dropped];
    const filtered = rawResults.filter((r) => {
      if (r.score >= minScore) { return true; }
      droppedEvidence.push({
        ...toDiagnosticCandidate(r),
        droppedAt: 'score-threshold',
        detail: `score ${r.score.toFixed(4)} < minScore ${minScore.toFixed(4)}`,
      });
      return false;
    });
    const afterScoreFilterCount = filtered.length;

    // 5. Source deduplication — cap chunks from any single source
    const dedupResult = this._deduplicateSources(filtered, maxPerSource);
    droppedEvidence.push(...dedupResult.dropped);
    const afterDedupCount = dedupResult.results.length;

    // 6. Token budget enforcement
    const budgeted = this._applyTokenBudget(dedupResult.results, tokenBudget);
    droppedEvidence.push(...budgeted.dropped);

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
    const finalPackedContextText = this.formatContext(finalResults);

    this._lastTrace = {
      query,
      topK,
      minScore,
      maxPerSource,
      tokenBudget,
      rawCandidateCount,
      afterCorpusHygieneCount,
      afterScoreFilterCount,
      afterDedupCount,
      finalCount: finalResults.length,
      corpusHygieneDrops: rawCandidateCount - afterCorpusHygieneCount,
      scoreThresholdDrops: afterCorpusHygieneCount - afterScoreFilterCount,
      dedupDrops: afterScoreFilterCount - afterDedupCount,
      tokenBudgetDrops: afterDedupCount - budgeted.results.length,
      tokenBudgetUsed: budgeted.tokensUsed,
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
      diagnostics: {
        generatedQueries: queryPlan.variants.map((variant) => ({
          text: variant.text,
          reason: variant.reason,
          keywordQuery: variant.keywordQuery,
        })),
        firstStageCandidates: rawResults.map((result) => toDiagnosticCandidate(result)),
        droppedEvidence,
        finalPackedContextText,
        finalPackedContext: budgeted.results.slice(0, topK).map((result) => toDiagnosticCandidate(result)),
      },
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

  private _buildQueryPlan(
    query: string,
    topK: number,
    decompositionMode: 'auto' | 'off',
    candidateBreadth: 'balanced' | 'broad',
  ): RetrievalQueryPlan {
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
    const decompositionEnabled = decompositionMode !== 'off';
    const rewrite = decompositionEnabled ? buildGuardedRewrite(normalized, identifiers) : undefined;
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

    if (complexity === 'hard' && decompositionEnabled) {
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
    } else if (complexity === 'hard' && !decompositionEnabled) {
      reasons.push('decomposition-disabled');
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
    let candidateMultiplier = complexity === 'hard'
      ? HARD_OVERFETCH_FACTOR
      : exactMatchBias
        ? EXACT_OVERFETCH_FACTOR
        : SIMPLE_OVERFETCH_FACTOR;
    if (candidateBreadth === 'broad' && complexity === 'hard') {
      candidateMultiplier += 1;
      reasons.push('broad-candidate-breadth');
    }
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
      sourceIds: options?.sourceIds,
      pathPrefixes: options?.pathPrefixes,
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

  private async _resolveExplicitSourceIds(
    query: string,
    queryPlan: RetrievalQueryPlan,
  ): Promise<string[] | undefined> {
    if (!shouldAttemptExplicitSourceResolution(query)) {
      return undefined;
    }

    const indexedSources = await this._vectorStore.getIndexedSources().catch(() => []);
    const queryTokens = tokenizeSourceMatch(query);
    if (queryTokens.length < 2) {
      return undefined;
    }

    const scored = indexedSources
      .filter((source) => /file/i.test(source.sourceType))
      .map((source) => {
        const baseName = source.sourceId.replace(/\\/g, '/').split('/').pop() ?? source.sourceId;
        const sourceTokens = tokenizeSourceMatch(baseName);
        const matchedTokens = sourceTokens.filter((token) => queryTokens.includes(token));
        const normalizedBaseName = normalizeSourceMatchText(baseName);
        const normalizedQuery = normalizeSourceMatchText(query);
        const exactPhraseMatch = normalizedBaseName.length > 0 && normalizedQuery.includes(normalizedBaseName);
        const identifierOverlap = queryPlan.identifiers.filter((identifier) => normalizeSourceMatchText(identifier) && normalizedBaseName.includes(normalizeSourceMatchText(identifier))).length;
        const score = matchedTokens.length + (exactPhraseMatch ? 3 : 0) + identifierOverlap;
        return {
          sourceId: source.sourceId,
          score,
          matchedTokens,
          sourceTokens,
        };
      })
      .filter((candidate) => candidate.score >= 2 && candidate.matchedTokens.length >= Math.min(2, candidate.sourceTokens.length || 2))
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return undefined;
    }

    const topScore = scored[0].score;
    return scored
      .filter((candidate) => candidate.score >= Math.max(2, topScore - 1))
      .slice(0, 3)
      .map((candidate) => candidate.sourceId);
  }

  /**
   * Cap the number of chunks from any single source.
   * This prevents one page/file from monopolizing the context window.
   */
  private _deduplicateSources(results: SearchResult[], maxPerSource: number): { results: SearchResult[]; dropped: RetrievalDroppedEvidenceTrace[] } {
    const sourceCounts = new Map<string, number>();
    const deduped: SearchResult[] = [];
    const dropped: RetrievalDroppedEvidenceTrace[] = [];

    for (const result of results) {
      const key = `${result.sourceType}:${result.sourceId}`;
      const count = sourceCounts.get(key) ?? 0;

      if (count < maxPerSource) {
        deduped.push(result);
        sourceCounts.set(key, count + 1);
      } else {
        dropped.push({
          ...toDiagnosticCandidate(result),
          droppedAt: 'dedup',
          detail: `source cap reached for ${result.sourceType}:${result.sourceId} (maxPerSource=${maxPerSource})`,
        });
      }
    }

    return { results: deduped, dropped };
  }

  private _applyInternalArtifactHygiene(
    results: SearchResult[],
    query: string,
    options?: RetrievalOptions,
  ): { results: SearchResult[]; dropped: RetrievalDroppedEvidenceTrace[] } {
    const allowInternalArtifacts = options?.internalArtifactPolicy === 'include'
      || queryExplicitlyTargetsInternalArtifacts(query);

    if (allowInternalArtifacts) {
      return { results, dropped: [] };
    }

    const filtered: SearchResult[] = [];
    const dropped: RetrievalDroppedEvidenceTrace[] = [];

    for (const result of results) {
      if (result.sourceType === 'file_chunk' && isInternalArtifactPath(result.sourceId)) {
        dropped.push({
          ...toDiagnosticCandidate(result),
          droppedAt: 'corpus-hygiene',
          detail: `excluded internal artifact from generic retrieval (${result.sourceId})`,
        });
        continue;
      }
      filtered.push(result);
    }

    return { results: filtered, dropped };
  }

  /**
   * Enforce a token budget — prefer compact, complementary chunks over a pure
   * score-order walk when several candidates fit the remaining budget.
   */
  private _applyTokenBudget(results: SearchResult[], tokenBudget: number): { results: SearchResult[]; tokensUsed: number; dropped: RetrievalDroppedEvidenceTrace[] } {
    if (results.length === 0) {
      return { results: [], tokensUsed: 0, dropped: [] };
    }

    const totalTokens = results.reduce((sum, result) => sum + estimateTokens(result.chunkText), 0);
    if (totalTokens <= tokenBudget) {
      return { results: [...results], tokensUsed: totalTokens, dropped: [] };
    }

    const remaining = [...results];
    const budgeted: SearchResult[] = [];
    const dropped: RetrievalDroppedEvidenceTrace[] = [];
    let tokensUsed = 0;
    const seenSources = new Set<string>();
    const seenHeadings = new Set<string>();

    while (remaining.length > 0) {
      const fittingCandidates = remaining
        .map((result, index) => ({ result, index, tokens: estimateTokens(result.chunkText) }))
        .filter(({ tokens }) => tokensUsed + tokens <= tokenBudget);

      if (fittingCandidates.length === 0) {
        if (budgeted.length === 0) {
          const fallback = remaining[0];
          budgeted.push(fallback);
          tokensUsed = estimateTokens(fallback.chunkText);
          for (const skipped of remaining.slice(1)) {
            dropped.push({
              ...toDiagnosticCandidate(skipped),
              droppedAt: 'token-budget',
              detail: `no remaining token budget after forced first chunk (tokenBudget=${tokenBudget})`,
            });
          }
        }
        break;
      }

      let bestIndex = fittingCandidates[0].index;
      let bestPackScore = Number.NEGATIVE_INFINITY;

      for (const candidate of fittingCandidates) {
        const sourceKey = `${candidate.result.sourceType}:${candidate.result.sourceId}`;
        const headingKey = normalizeQueryKey(candidate.result.headingPath ?? candidate.result.contextPrefix ?? '');
        const densityScore = candidate.result.score / Math.max(1, Math.sqrt(candidate.tokens));

        let packScore = densityScore + (candidate.result.score * 0.20);
        if (!seenSources.has(sourceKey)) {
          packScore += 0.004;
        }
        if (headingKey && !seenHeadings.has(headingKey)) {
          packScore += 0.002;
        }

        if (packScore > bestPackScore) {
          bestPackScore = packScore;
          bestIndex = candidate.index;
        }
      }

      const [selected] = remaining.splice(bestIndex, 1);
      budgeted.push(selected);
      tokensUsed += estimateTokens(selected.chunkText);
      seenSources.add(`${selected.sourceType}:${selected.sourceId}`);
      const headingKey = normalizeQueryKey(selected.headingPath ?? selected.contextPrefix ?? '');
      if (headingKey) {
        seenHeadings.add(headingKey);
      }
    }

    for (const leftover of remaining) {
      dropped.push({
        ...toDiagnosticCandidate(leftover),
        droppedAt: 'token-budget',
        detail: `excluded by token budget (tokenBudget=${tokenBudget}, tokensUsed=${tokensUsed})`,
      });
    }

    return { results: budgeted, tokensUsed, dropped };
  }
}
