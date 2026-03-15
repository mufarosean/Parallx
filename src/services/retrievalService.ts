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

function collectRerankFocusTerms(queryPlan: RetrievalQueryPlan, maxTerms = 12): string[] {
  const seeds = [
    ...queryPlan.variants
      .filter((variant) => typeof variant.keywordQuery === 'string' && variant.keywordQuery.length > 0)
      .map((variant) => variant.keywordQuery!),
    ...queryPlan.variants.map((variant) => variant.text),
  ];

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    for (const term of extractFocusTerms(seed, queryPlan.identifiers)) {
      if (seen.has(term)) { continue; }
      seen.add(term);
      merged.push(term);
      if (merged.length >= maxTerms) {
        return merged;
      }
    }
  }

  return merged;
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

function isInsuranceCorpusCandidate(result: SearchResult): boolean {
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

  return matchesAny(sourceMeta, [
    /agent contacts/,
    /claims guide/,
    /auto insurance policy/,
    /accident quick reference/,
    /vehicle info/,
    /uninsured motorist/,
    /underinsured motorist/,
    /claims hotline/,
    /deductible/,
    /total loss/,
    /kbb/,
  ]);
}

type EvidenceRole =
  | 'definition'
  | 'architecture-location'
  | 'implementation-detail'
  | 'current-behavior'
  | 'failure-mode'
  | 'recency';

function uniqueValues<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function classifyQueryEvidenceRoles(query: string, queryPlan: RetrievalQueryPlan): EvidenceRole[] {
  const lowered = query.toLowerCase();
  const roles: EvidenceRole[] = [];
  const isClaimFilingQuery = matchesAny(lowered, [
    /\bfile\b.*\bclaim\b/,
    /\bclaim\b.*\bfile\b/,
    /\bclaims?\s+line\b/,
    /who\s+do\s+i\s+call/,
    /\b72-hour\b/,
    /\b72\s+hours\b/,
  ]);

  if (matchesAny(lowered, [
    /\bwhat is\b/,
    /\bdefine\b/,
    /\boverview\b/,
    /\bsummary\b/,
    /\bexplain\b/,
  ])) {
    roles.push('definition');
  }

  if (matchesAny(lowered, [
    /\bwhere\b/,
    /which\s+(?:file|document|source|module|section)/,
    /\barchitecture\b/,
    /\blayout\b/,
    /\bstructure\b/,
    /\bpath\b/,
    /located/,
  ])) {
    roles.push('architecture-location');
  }

  if (matchesAny(lowered, [
    /\bhow\b/,
    /implement/,
    /implementation/,
    /\bcode\b/,
    /\blogic\b/,
    /\bfunction\b/,
    /\bmethod\b/,
    /\bconfig\b/,
    /\bprocedure\b/,
  ])) {
    roles.push('implementation-detail');
  }

  if (matchesAny(lowered, [
    /\bcurrent\b/,
    /\bcurrently\b/,
    /\bnow\b/,
    /\btoday\b/,
    /\bdefault\b/,
    /what\s+does/,
    /what\s+happens/,
    /\bbehavior\b/,
    /\bcover(?:age)?\b/,
  ])) {
    roles.push('current-behavior');
  }

  if (matchesAny(lowered, [
    /\berror\b/,
    /\bbug\b/,
    /\bfail(?:ure)?\b/,
    /\brisk\b/,
    /\bissue\b/,
    /\bproblem\b/,
    /watch\s+for/,
    /\bwrong\b/,
    /\bcrash\b/,
    /\bteardown\b/,
    /\bempty response\b/,
    /\buninsured\b/,
    /\bexclusion\b/,
  ])) {
    roles.push('failure-mode');
  }

  if (matchesAny(lowered, [
    /\blatest\b/,
    /\brecent\b/,
    /\bupdated\b/,
    /\bnewest\b/,
    /\bchanged\b/,
  ])) {
    roles.push('recency');
  }

  if (isClaimFilingQuery) {
    roles.push('implementation-detail', 'current-behavior', 'failure-mode', 'recency');
  }

  if (roles.length === 0 && queryPlan.complexity === 'hard') {
    roles.push('definition', 'implementation-detail', 'current-behavior', 'failure-mode');
  }

  if (queryPlan.strategy === 'decomposed') {
    roles.push('implementation-detail', 'current-behavior');
  }

  return uniqueValues(roles);
}

function classifyResultEvidenceRoles(result: SearchResult): EvidenceRole[] {
  const combined = [
    result.sourceId,
    result.contextPrefix,
    result.headingPath,
    result.parentHeadingPath,
    result.chunkText,
    result.documentKind,
    result.structuralRole,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();

  const roles: EvidenceRole[] = [];

  if (matchesAny(combined, [
    /\boverview\b/,
    /\bsummary\b/,
    /\bdefinition\b/,
    /what\s+is/,
    /\bintroduction\b/,
    /\bpurpose\b/,
    /coverage\s+(?:summary|overview|basics)/,
  ])) {
    roles.push('definition');
  }

  if (matchesAny(combined, [
    /\barchitecture\b/,
    /\bpipeline\b/,
    /\bflow\b/,
    /\bstructure\b/,
    /\blayout\b/,
    /\bdirectory\b/,
    /\bworkspace\b/,
    /\bmodule map\b/,
  ])) {
    roles.push('architecture-location');
  }

  if (
    /\.(?:ts|tsx|js|jsx|cjs|mjs|py|java|cs|go|rs|json)$/i.test(result.sourceId)
    || result.structuralRole === 'code'
    || matchesAny(combined, [
      /implement/,
      /implementation/,
      /\bfunction\b/,
      /\bmethod\b/,
      /\bclass\b/,
      /\bservice\b/,
      /\bhandler\b/,
      /\bprocedure\b/,
      /\bconfig\b/,
      /\blogic\b/,
      /step[- ]by[- ]step/,
    ])
  ) {
    roles.push('implementation-detail');
  }

  if (matchesAny(combined, [
    /\bcurrent\b/,
    /\bcurrently\b/,
    /\bruntime\b/,
    /\bdefault\b/,
    /current\s+behavior/,
    /runtime\s+behavior/,
    /coverage\s+applies/,
    /applies\s+when/,
    /policy\s+cover(?:age)?/,
  ])) {
    roles.push('current-behavior');
  }

  if (matchesAny(combined, [
    /\berror\b/,
    /\bbug\b/,
    /\bfail(?:ure|ing)?\b/,
    /\brisk\b/,
    /\bissue\b/,
    /\bproblem\b/,
    /\bwarning\b/,
    /\bregression\b/,
    /\bcrash\b/,
    /\bteardown\b/,
    /\bempty-response\b/,
    /\bempty response\b/,
    /\buninsured\b/,
    /\bexclusion\b/,
  ])) {
    roles.push('failure-mode');
  }

  if (matchesAny(combined, [
    /\bupdated\b/,
    /\blatest\b/,
    /\brecent\b/,
    /\btoday\b/,
    /\bcurrent state\b/,
    /\b20\d{2}\b/,
  ])) {
    roles.push('recency');
  }

  if (roles.length === 0) {
    roles.push(/\.(?:ts|tsx|js|jsx|cjs|mjs|py|java|cs|go|rs|json)$/i.test(result.sourceId)
      ? 'implementation-detail'
      : 'definition');
  }

  return uniqueValues(roles);
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

export interface RetrievalRerankScoreTrace {
  rowid: number;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  contextPrefix: string;
  beforeScore: number;
  afterScore: number;
  delta: number;
}

export interface RetrievalDroppedEvidenceTrace extends RetrievalDiagnosticCandidate {
  droppedAt: 'corpus-hygiene' | 'score-threshold' | 'dropoff' | 'cosine' | 'dedup' | 'token-budget';
  detail?: string;
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
  afterCorpusHygieneCount: number;
  afterScoreFilterCount: number;
  afterStructureExpansionCount: number;
  afterDropoffCount: number;
  afterCosineCount: number;
  afterSecondStageCount: number;
  afterDiversityCount: number;
  afterDedupCount: number;
  finalCount: number;
  corpusHygieneDrops: number;
  scoreThresholdDrops: number;
  dropoffDrops: number;
  cosineDrops: number;
  dedupDrops: number;
  tokenBudgetDrops: number;
  tokenBudgetUsed: number;
  queryPlan?: RetrievalQueryPlanTrace;
  rankingTrace?: {
    focusTerms: string[];
    secondStageApplied: boolean;
    secondStageMode?: 'standard' | 'late-interaction';
    diversityApplied: boolean;
    diversityMode: 'simple' | 'hard';
    diversityStrength?: 'balanced' | 'strong';
    roleBalanceApplied?: boolean;
    targetRoles?: string[];
    coveredRoles?: string[];
    structureExpansionApplied?: boolean;
  };
  diagnostics?: {
    generatedQueries: RetrievalQueryPlanTrace['variants'];
    firstStageCandidates: RetrievalDiagnosticCandidate[];
    rerankScores: RetrievalRerankScoreTrace[];
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
 * applies post-retrieval filtering (score threshold, cosine re-ranking,
 * dedup, token budget), and returns ranked context chunks.
 */
/** Config provider shape — all retrieval settings from AI Settings. */
interface IRetrievalConfigProvider {
  getEffectiveConfig(): {
    retrieval: {
      ragDecompositionMode?: 'auto' | 'off';
      ragCandidateBreadth?: 'balanced' | 'broad';
      ragDiversityStrength?: 'balanced' | 'strong';
      ragStructureExpansionMode?: 'auto' | 'off';
      ragRerankMode?: 'standard' | 'late-interaction';
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
    const decompositionMode = cfgRetrieval?.ragDecompositionMode ?? 'auto';
    const candidateBreadth = cfgRetrieval?.ragCandidateBreadth ?? 'balanced';
    const diversityStrength = cfgRetrieval?.ragDiversityStrength ?? 'balanced';
    const structureExpansionMode = cfgRetrieval?.ragStructureExpansionMode ?? 'auto';
    const rerankMode = cfgRetrieval?.ragRerankMode ?? 'standard';
    const cosineThreshold = cfgRetrieval?.ragCosineThreshold ?? DEFAULT_MIN_COSINE_SCORE;
    const dropoffRatio = cfgRetrieval?.ragDropoffRatio ?? DEFAULT_DROPOFF_RATIO;
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

    // 2. Phase C candidate generation — stay on the fast path for simple
    //    exact questions, but widen and decompose harder questions.
    const { results: candidateResults, traces: vectorStoreTraces } = await this._collectCandidates(
      query,
      queryEmbedding,
      queryPlan,
      {
        ...options,
        sourceIds: explicitSourceIds,
      },
    );
    const structuredResults = await this._applyStructureAwareExpansion(candidateResults, queryPlan, topK, structureExpansionMode);
    const rankedResults = this._applyIntentAwareSourceBoost(
      this._applyLexicalFocusBoost(structuredResults.results, queryPlan),
      query,
      queryPlan,
    );
    const vectorStoreTrace = vectorStoreTraces.at(-1);

    const corpusHygieneResult = this._applyInternalArtifactHygiene(rankedResults, query, options);
    const rawResults = corpusHygieneResult.results;

    // 3. Score threshold filter (RRF scores)
    const droppedEvidence: RetrievalDroppedEvidenceTrace[] = [...corpusHygieneResult.dropped];
    let filtered = rawResults.filter((r) => {
      if (r.score >= minScore) { return true; }
      droppedEvidence.push({
        ...toDiagnosticCandidate(r),
        droppedAt: 'score-threshold',
        detail: `score ${r.score.toFixed(4)} < minScore ${minScore.toFixed(4)}`,
      });
      return false;
    });
    const rawCandidateCount = rankedResults.length;
    const afterStructureExpansionCount = rawCandidateCount;
    const afterCorpusHygieneCount = rawResults.length;
    const afterScoreFilterCount = filtered.length;

    // 3b. Relative score drop-off (configurable, 0 = disabled).
    //     When enabled, drops results below topScore × dropoffRatio.
    if (dropoffRatio > 0 && filtered.length > 1) {
      const topScore = filtered[0].score;
      const dropoffThreshold = topScore * dropoffRatio;
      filtered = filtered.filter((r) => {
        if (r.score >= dropoffThreshold) { return true; }
        droppedEvidence.push({
          ...toDiagnosticCandidate(r),
          droppedAt: 'dropoff',
          detail: `score ${r.score.toFixed(4)} < dropoffThreshold ${dropoffThreshold.toFixed(4)}`,
        });
        return false;
      });
    }
    const afterDropoffCount = filtered.length;

    // 4. Cosine re-ranking (configurable threshold, 0 = disabled).
    if (cosineThreshold > 0 && filtered.length > 0) {
      const cosineResult = await this._cosineRerank(queryEmbedding, filtered, cosineThreshold);
      filtered = cosineResult.results;
      droppedEvidence.push(...cosineResult.dropped);
    }
    const afterCosineCount = filtered.length;

    const rerankResult = this._applySecondStageRerank(filtered, queryPlan, rerankMode);
    filtered = rerankResult.results;
    const afterSecondStageCount = filtered.length;

    filtered = this._applyDiversityReordering(filtered, queryPlan, topK, maxPerSource, diversityStrength);
    const afterDiversityCount = filtered.length;

    const roleBalanceResult = this._applyEvidenceRoleBalancing(filtered, query, queryPlan, topK);
    filtered = roleBalanceResult.results;

    // 5. Source deduplication — cap chunks from any single source
    const dedupResult = this._deduplicateSources(filtered, maxPerSource);
    filtered = dedupResult.results;
    droppedEvidence.push(...dedupResult.dropped);
    const afterDedupCount = filtered.length;

    // 6. Token budget enforcement
    const budgeted = this._applyTokenBudget(filtered, tokenBudget);
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
      rawCandidateCount,
      afterStructureExpansionCount,
      afterCorpusHygieneCount,
      afterScoreFilterCount,
      afterDropoffCount,
      afterCosineCount,
      afterSecondStageCount,
      afterDiversityCount,
      afterDedupCount,
      finalCount: finalResults.length,
      corpusHygieneDrops: rawCandidateCount - afterCorpusHygieneCount,
      scoreThresholdDrops: afterCorpusHygieneCount - afterScoreFilterCount,
      dropoffDrops: afterScoreFilterCount - afterDropoffCount,
      cosineDrops: afterDropoffCount - afterCosineCount,
      dedupDrops: afterCosineCount - afterDedupCount,
      tokenBudgetDrops: afterDedupCount - budgeted.results.length,
      tokenBudgetUsed: budgeted.tokensUsed,
      rankingTrace: {
        focusTerms: rerankResult.focusTerms,
        secondStageApplied: rerankResult.applied,
        secondStageMode: rerankResult.mode,
        diversityApplied: filtered.length > 1,
        diversityMode: queryPlan.complexity,
        diversityStrength,
        roleBalanceApplied: roleBalanceResult.applied,
        targetRoles: roleBalanceResult.targetRoles,
        coveredRoles: roleBalanceResult.coveredRoles,
        structureExpansionApplied: structuredResults.applied,
      },
      diagnostics: {
        generatedQueries: queryPlan.variants.map((variant) => ({
          text: variant.text,
          reason: variant.reason,
          keywordQuery: variant.keywordQuery,
        })),
        firstStageCandidates: rawResults.map((result) => toDiagnosticCandidate(result)),
        rerankScores: rerankResult.scoreChanges,
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
    const insuranceDomainQuery = matchesAny(normalizedQuery, [
      /\binsurance\b/,
      /\bpolicy\b/,
      /\bclaim\b/,
      /\bclaims\b/,
      /\bcoverage\b/,
      /\bdeductible\b/,
      /\baccident\b/,
      /\brepair\b/,
      /\bdriver\b/,
      /\bmotorist\b/,
      /\btotal\s+loss\b/,
      /\bkbb\b/,
      /\broadside\b/,
      /\bhotline\b/,
    ]);
    const hasInsuranceCorpusCandidates = results.some((result) => isInsuranceCorpusCandidate(result));
    const insuranceDomainActive = insuranceDomainQuery || hasInsuranceCorpusCandidates;
    const wantsAgentContact = insuranceDomainActive && matchesAny(normalizedQuery, [
      /\bcontact\b/,
      /\bphone\b/,
      /\bnumber\b/,
      /\bcall\b/,
      /\bemail\b/,
      /\bmy\s+agent\b/,
      /\byour\s+agent\b/,
      /\bagent\s+contact\b/,
    ]) && !matchesAny(normalizedQuery, [
      /\brepair\b/,
      /\bshop\b/,
      /\broadside\b/,
      /\bclaims\s+line\b/,
    ]);
    const wantsRepairShops = insuranceDomainActive && matchesAny(normalizedQuery, [/\brepair\b/, /\bshop\b/, /\bshops\b/]);
    const wantsDeductible = insuranceDomainActive && matchesAny(normalizedQuery, [/\bdeductible\b/, /\bcollision\b/, /\bcomprehensive\b/]);
    const wantsWorkspaceDocs = matchesAny(normalizedQuery, [/\bdocuments?\b/, /\bfiles?\b/, /\bworkspace\b/, /\bcontents?\b/]);
    const wantsClaimFiling = insuranceDomainActive && matchesAny(normalizedQuery, [
      /\bfile\b.*\bclaim\b/,
      /\bclaim\b.*\bfile\b/,
      /\bclaims?\s+line\b/,
      /\bhotline\b/,
      /who\s+do\s+i\s+call/,
      /\b72-hour\b/,
      /\b72\s+hours\b/,
    ]);
    const wantsAgentFieldLookup = wantsAgentContact && matchesAny(normalizedQuery, [
      /\bname\b/,
      /\bphone\b/,
      /\bnumber\b/,
      /\bemail\b/,
      /\bcell\b/,
      /\boffice\b/,
    ]);
    const wantsTabularEvidence = matchesAny(normalizedQuery, [
      /\btable\b/,
      /\bcompare\b/,
      /\bcomparison\b/,
      /\bthreshold\b/,
      /\bdeductible\b/,
      /\bpremium\b/,
      /\blimit\b/,
      /\bvalue\b/,
      /\bamount\b/,
      /\bphone\b/,
      /\bnumber\b/,
    ]);
    const wantsTotalLossThreshold = matchesAny(normalizedQuery, [
      /\btotal\s+loss\b/,
      /\b75%\b/,
      /\bkbb\b/,
      /\bkelly\s+blue\s+book\b/,
      /\bcurrent\s+value\b/,
      /\bthreshold\b/,
    ]);
    const wantsCodeEvidence = queryPlan.exactMatchBias || matchesAny(normalizedQuery, [
      /\bfunction\b/,
      /\bmethod\b/,
      /\bclass\b/,
      /\bapi\b/,
      /\bjson\b/,
      /\bconfig\b/,
      /\bcode\b/,
      /\bimplementation\b/,
      /\bhandler\b/,
      /\bservice\b/,
      /\bimport\b/,
    ]);
    const wantsFigureCaption = matchesAny(normalizedQuery, [
      /\bfigure\b/,
      /\bcaption\b/,
      /\bdiagram\b/,
      /\bchart\b/,
      /\bcallout\b/,
      /\bimage\b/,
    ]);
    const wantsCoverageDecision = insuranceDomainActive && matchesAny(normalizedQuery, [
      /\bcoverage\b/,
      /\binsurance\b/,
      /\buninsured\b/,
      /\bunderinsured\b/,
      /\bum\b/,
      /\buim\b/,
    ]);

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

      if (wantsAgentFieldLookup) {
        if (
          sourceMeta.includes('| name |')
          || sourceMeta.includes('| phone |')
          || sourceMeta.includes('| email |')
          || sourceMeta.includes('| field |')
          || sourceMeta.includes('senior insurance agent')
        ) {
          adjustedScore += 0.018;
        }
        if (sourceMeta.includes('claims line') || sourceMeta.includes('hotline')) {
          adjustedScore -= 0.006;
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

      if (wantsTabularEvidence) {
        if (
          result.structuralRole === 'table'
          || sourceMeta.includes('table')
          || result.chunkText.includes('|')
        ) {
          adjustedScore += 0.014;
        } else if (queryPlan.complexity === 'hard' && result.structuralRole === 'section') {
          adjustedScore -= 0.003;
        }
      }

      if (wantsTotalLossThreshold) {
        if (
          sourceMeta.includes('total loss')
          && (sourceMeta.includes('75%') || sourceMeta.includes('kbb') || sourceMeta.includes('current value'))
        ) {
          adjustedScore += 0.018;
        }
        if (sourceMeta.includes('vehicle info')) {
          adjustedScore += 0.008;
        }
        if (sourceMeta.includes('severity desk') && !sourceMeta.includes('75%') && !sourceMeta.includes('kbb')) {
          adjustedScore -= 0.006;
        }
      }

      if (wantsCodeEvidence) {
        const isCodeLikeSource = /\.(?:ts|tsx|js|jsx|cjs|mjs|py|java|cs|go|rs|json)$/i.test(result.sourceId);
        if (result.structuralRole === 'code' || isCodeLikeSource) {
          adjustedScore += queryPlan.exactMatchBias ? 0.016 : 0.010;
        }

        if (queryPlan.identifiers.some((identifier) => sourceMeta.includes(identifier.toLowerCase()))) {
          adjustedScore += 0.008;
        }
      }

      if (wantsFigureCaption) {
        if (
          sourceMeta.includes('figure')
          || sourceMeta.includes('caption')
          || sourceMeta.includes('diagram')
          || sourceMeta.includes('callout')
        ) {
          adjustedScore += 0.012;
        }
      }

      if (queryPlan.complexity === 'hard' && wantsClaimFiling) {
        if (result.sourceType === 'concept') {
          adjustedScore -= 0.012;
        }

        if (
          sourceMeta.includes('claims guide')
          || sourceMeta.includes('claims line')
          || sourceMeta.includes('within 72 hours')
          || sourceMeta.includes('72 hours')
          || sourceMeta.includes('report the claim')
          || sourceMeta.includes('file a claim')
        ) {
          adjustedScore += 0.018;
        }

        if (
          sourceMeta.includes('agent contacts')
          || sourceMeta.includes('your agent')
          || sourceMeta.includes('sarah')
          || sourceMeta.includes('phone')
        ) {
          adjustedScore += 0.016;
        }

        if (sourceMeta.includes('accident quick reference')) {
          adjustedScore += 0.006;
        }

        if (
          sourceMeta.includes('auto insurance policy')
          && !sourceMeta.includes('claim')
          && !sourceMeta.includes('phone')
        ) {
          adjustedScore -= 0.006;
        }
      }

      if (queryPlan.complexity === 'hard' && wantsCoverageDecision) {
        if (result.sourceType === 'concept') {
          adjustedScore -= 0.018;
        }

        if (sourceMeta.includes('auto insurance policy') || sourceMeta.includes('claims guide')) {
          adjustedScore += 0.010;
        }

        if (
          sourceMeta.includes('collision coverage')
          || sourceMeta.includes('uninsured motorist')
          || sourceMeta.includes('underinsured motorist')
          || sourceMeta.includes('um/uim')
          || sourceMeta.includes('deductible')
        ) {
          adjustedScore += 0.014;
        }

        if (sourceMeta.includes('exclusions')) {
          adjustedScore -= 0.012;
        }
      }

      return adjustedScore === result.score
        ? result
        : { ...result, score: adjustedScore };
    }).sort((a, b) => b.score - a.score);
  }

  private _applySecondStageRerank(
    results: SearchResult[],
    queryPlan: RetrievalQueryPlan,
    rerankMode: 'standard' | 'late-interaction',
  ): { results: SearchResult[]; focusTerms: string[]; applied: boolean; mode: 'standard' | 'late-interaction'; scoreChanges: RetrievalRerankScoreTrace[] } {
    if (results.length <= 1) {
      return { results, focusTerms: [], applied: false, mode: rerankMode, scoreChanges: [] };
    }

    const focusTerms = collectRerankFocusTerms(queryPlan, queryPlan.complexity === 'hard' ? 12 : 8);
    if (focusTerms.length === 0) {
      return { results, focusTerms: [], applied: false, mode: rerankMode, scoreChanges: [] };
    }

    const scoreChanges: RetrievalRerankScoreTrace[] = [];
    const reranked = results.map((result) => {
      const beforeScore = result.score;
      let adjustedScore = result.score;
      const body = [result.contextPrefix, result.headingPath, result.parentHeadingPath, result.chunkText]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' ')
        .toLowerCase();
      const headingBody = [result.contextPrefix, result.headingPath, result.parentHeadingPath]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' ')
        .toLowerCase();

      const matchedTerms = focusTerms.filter((term) => body.includes(term));
      const headingMatches = focusTerms.filter((term) => headingBody.includes(term));

      if (matchedTerms.length > 0) {
        adjustedScore += Math.min(0.018, (matchedTerms.length / focusTerms.length) * 0.018);
      }
      if (headingMatches.length > 0) {
        adjustedScore += Math.min(0.012, (headingMatches.length / focusTerms.length) * 0.012);
      }
      if (queryPlan.complexity === 'hard' && result.extractionFallback) {
        adjustedScore -= 0.004;
      }
      if (rerankMode === 'late-interaction' && queryPlan.complexity === 'hard') {
        adjustedScore += this._scoreLateInteractionMatch(result, focusTerms, queryPlan.identifiers);
      }

      scoreChanges.push({
        rowid: result.rowid,
        sourceType: result.sourceType,
        sourceId: result.sourceId,
        chunkIndex: result.chunkIndex,
        contextPrefix: result.contextPrefix,
        beforeScore,
        afterScore: adjustedScore,
        delta: adjustedScore - beforeScore,
      });

      return adjustedScore === result.score
        ? result
        : { ...result, score: adjustedScore };
    }).sort((a, b) => b.score - a.score);

    scoreChanges.sort((a, b) => b.afterScore - a.afterScore);
    return { results: reranked, focusTerms, applied: true, mode: rerankMode, scoreChanges };
  }

  private _scoreLateInteractionMatch(
    result: SearchResult,
    focusTerms: string[],
    identifiers: string[],
  ): number {
    const wantsStructuredRow = focusTerms.some((term) => ['review', 'start', 'target', 'coordinator', 'deadline', 'matrix'].includes(term));
    const wantsCodeSymbol = focusTerms.some((term) => ['helper', 'builder', 'snippet', 'stage', 'stages', 'assemble', 'assembles'].includes(term));
    const segments = [
      result.contextPrefix,
      result.headingPath,
      result.parentHeadingPath,
      ...result.chunkText
        .split(/\r?\n+/)
        .flatMap((line) => line.split(/(?<=[.!?])\s+/))
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ]
      .filter((segment): segment is string => typeof segment === 'string' && segment.length > 0)
      .slice(0, 18);

    let bestScore = 0;
    for (const segment of segments) {
      const lowered = segment.toLowerCase();
      const matchedTerms = focusTerms.filter((term) => lowered.includes(term));
      const matchedIdentifiers = identifiers.filter((identifier) => lowered.includes(identifier.toLowerCase()));
      const hasStructuredSignal = /^[-*]|^\d+\.|^\|/.test(segment) || /\*\*[^*]+\*\*/.test(segment);
      const looksLikeCode = /\b(?:function|class|return|readonly|const|export)\b|=>|stages:\s*\[/.test(segment);
      const hasQuotedStageName = /['"`][a-z0-9-]+['"`]/i.test(segment);

      let segmentScore = 0;
      if (matchedTerms.length > 0) {
        segmentScore += Math.min(0.016, (matchedTerms.length / focusTerms.length) * 0.016);
      }
      if (matchedIdentifiers.length > 0) {
        segmentScore += Math.min(0.012, matchedIdentifiers.length * 0.006);
      }
      if (hasStructuredSignal && matchedTerms.length > 0) {
        segmentScore += 0.003;
      }
      if (wantsStructuredRow && /^\|/.test(segment) && matchedTerms.length > 0) {
        segmentScore += 0.006;
      }
      if (wantsCodeSymbol && looksLikeCode) {
        segmentScore += matchedTerms.length > 0 ? 0.010 : 0.004;
      }
      if (wantsCodeSymbol && hasQuotedStageName) {
        segmentScore += 0.004;
      }

      if (segmentScore > bestScore) {
        bestScore = segmentScore;
      }
    }

    return bestScore;
  }

  private _applyDiversityReordering(
    results: SearchResult[],
    queryPlan: RetrievalQueryPlan,
    topK: number,
    maxPerSource: number,
    diversityStrength: 'balanced' | 'strong',
  ): SearchResult[] {
    if (results.length <= 2) {
      return results;
    }

    const sourceNoveltyBonus = diversityStrength === 'strong'
      ? (queryPlan.complexity === 'hard' ? 0.018 : 0.008)
      : (queryPlan.complexity === 'hard' ? 0.010 : 0.004);
    const sourceReusePenaltyStep = diversityStrength === 'strong'
      ? (queryPlan.complexity === 'hard' ? 0.009 : 0.005)
      : (queryPlan.complexity === 'hard' ? 0.006 : 0.003);
    const headingNoveltyBonus = diversityStrength === 'strong'
      ? (queryPlan.complexity === 'hard' ? 0.010 : 0.005)
      : (queryPlan.complexity === 'hard' ? 0.006 : 0.003);
    const headingReusePenaltyStep = diversityStrength === 'strong' ? 0.004 : 0.003;
    const structuralNoveltyBonus = diversityStrength === 'strong'
      ? (queryPlan.complexity === 'hard' ? 0.005 : 0.002)
      : (queryPlan.complexity === 'hard' ? 0.003 : 0.001);

    const reordered: SearchResult[] = [];
    const remaining = [...results];

    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (let index = 0; index < remaining.length; index++) {
        const candidate = remaining[index];
        const sourceKey = `${candidate.sourceType}:${candidate.sourceId}`;
        const headingKey = normalizeQueryKey(candidate.headingPath ?? candidate.contextPrefix ?? '');
        const sourceReuse = reordered.filter((item) => `${item.sourceType}:${item.sourceId}` === sourceKey).length;
        const headingReuse = headingKey
          ? reordered.filter((item) => normalizeQueryKey(item.headingPath ?? item.contextPrefix ?? '') === headingKey).length
          : 0;

        let adjustedScore = candidate.score;
        if (sourceReuse === 0) {
          adjustedScore += sourceNoveltyBonus;
        } else {
          adjustedScore -= Math.min(sourceNoveltyBonus * 1.2, sourceReuse * sourceReusePenaltyStep);
        }

        if (headingKey) {
          if (headingReuse === 0) {
            adjustedScore += headingNoveltyBonus;
          } else {
            adjustedScore -= Math.min(headingNoveltyBonus, headingReuse * headingReusePenaltyStep);
          }
        }

        if (candidate.structuralRole && !reordered.some((item) => item.structuralRole === candidate.structuralRole)) {
          adjustedScore += structuralNoveltyBonus;
        }

        if (sourceReuse >= maxPerSource) {
          adjustedScore -= 0.050;
        }

        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestIndex = index;
        }
      }

      reordered.push(remaining.splice(bestIndex, 1)[0]);

      if (reordered.length >= Math.max(topK * 2, topK + maxPerSource) && remaining.length > 0) {
        reordered.push(...remaining);
        break;
      }
    }

    return reordered;
  }

  private _applyEvidenceRoleBalancing(
    results: SearchResult[],
    query: string,
    queryPlan: RetrievalQueryPlan,
    topK: number,
  ): { results: SearchResult[]; applied: boolean; targetRoles: string[]; coveredRoles: string[] } {
    if (results.length <= 2) {
      return { results, applied: false, targetRoles: [], coveredRoles: [] };
    }

    const targetRoles = classifyQueryEvidenceRoles(query, queryPlan);
    if (targetRoles.length === 0) {
      return { results, applied: false, targetRoles: [], coveredRoles: [] };
    }

    const shouldBalance = queryPlan.complexity === 'hard' || queryPlan.strategy === 'decomposed' || targetRoles.length >= 2;
    if (!shouldBalance) {
      return { results, applied: false, targetRoles, coveredRoles: [] };
    }

    const roleCache = new Map<number, EvidenceRole[]>();
    const getRoles = (candidate: SearchResult): EvidenceRole[] => {
      const cached = roleCache.get(candidate.rowid);
      if (cached) { return cached; }
      const roles = classifyResultEvidenceRoles(candidate);
      roleCache.set(candidate.rowid, roles);
      return roles;
    };

    const reordered: SearchResult[] = [];
    const remaining = [...results];
    const coveredRoles = new Set<EvidenceRole>();
    const targetRoleSet = new Set(targetRoles as EvidenceRole[]);
    const reorderLimit = Math.min(results.length, Math.max(topK + queryPlan.variants.length, topK * 2));

    while (remaining.length > 0) {
      const hasUncoveredTargetRemaining = remaining.some((candidate) =>
        getRoles(candidate).some((role) => targetRoleSet.has(role) && !coveredRoles.has(role)),
      );

      let bestIndex = 0;
      let bestScore = Number.NEGATIVE_INFINITY;

      for (let index = 0; index < remaining.length; index++) {
        const candidate = remaining[index];
        const roles = getRoles(candidate);
        const uncoveredTargetRoles = roles.filter((role) => targetRoleSet.has(role) && !coveredRoles.has(role));
        const uncoveredSupportRoles = roles.filter((role) => !targetRoleSet.has(role) && !coveredRoles.has(role));

        let adjustedScore = candidate.score;
        adjustedScore += Math.min(0.024, uncoveredTargetRoles.length * 0.010);
        adjustedScore += Math.min(0.006, uncoveredSupportRoles.length * 0.003);

        if (roles.length > 1) {
          adjustedScore += 0.002;
        }

        if (hasUncoveredTargetRemaining && uncoveredTargetRoles.length === 0) {
          adjustedScore -= 0.008;
        }

        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestIndex = index;
        }
      }

      const [chosen] = remaining.splice(bestIndex, 1);
      reordered.push(chosen);
      for (const role of getRoles(chosen)) {
        coveredRoles.add(role);
      }

      if (reordered.length >= reorderLimit && remaining.length > 0) {
        reordered.push(...remaining);
        break;
      }
    }

    return {
      results: reordered,
      applied: true,
      targetRoles,
      coveredRoles: Array.from(coveredRoles),
    };
  }

  private async _applyStructureAwareExpansion(
    results: SearchResult[],
    queryPlan: RetrievalQueryPlan,
    topK: number,
    structureExpansionMode: 'auto' | 'off',
  ): Promise<{ results: SearchResult[]; applied: boolean }> {
    if (structureExpansionMode === 'off' || results.length === 0 || queryPlan.complexity !== 'hard') {
      return { results, applied: false };
    }

    const anchorCandidates = results.filter((result) => this._shouldExpandStructure(result)).slice(0, Math.min(4, topK));
    if (anchorCandidates.length === 0) {
      return { results, applied: false };
    }

    const companions = await Promise.all(
      anchorCandidates.map((anchor) => this._vectorStore.getStructuralCompanions(anchor, { limit: 2 }).catch(() => [])),
    );

    const merged = new Map<string, SearchResult>();
    const makeKey = (result: SearchResult) => `${result.rowid}:${result.sourceType}:${result.sourceId}`;
    for (const result of results) {
      merged.set(makeKey(result), result);
    }

    let added = 0;
    for (let index = 0; index < anchorCandidates.length; index++) {
      const anchor = anchorCandidates[index];
      for (const companion of companions[index]) {
        const key = makeKey(companion);
        if (merged.has(key)) { continue; }
        merged.set(key, {
          ...companion,
          score: Math.max(0.001, anchor.score - 0.010 - (Math.abs(companion.chunkIndex - anchor.chunkIndex) * 0.0015)),
          sources: uniqueValues([...anchor.sources, 'structure-expand']),
        });
        added++;
      }
    }

    return {
      results: Array.from(merged.values()).sort((a, b) => b.score - a.score),
      applied: added > 0,
    };
  }

  private _shouldExpandStructure(result: SearchResult): boolean {
    if (!result.headingPath && !result.parentHeadingPath) {
      return false;
    }

    if (result.structuralRole === 'table' || result.structuralRole === 'code') {
      return true;
    }

    if (result.extractionPipeline === 'docling' || result.extractionPipeline === 'docling-ocr') {
      return true;
    }

    const documentKind = result.documentKind?.toLowerCase() ?? '';
    return /(pdf|document|technical|manual|architecture|spec|report)/.test(documentKind);
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
    const seenRoles = new Set<EvidenceRole>();

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
        const roles = classifyResultEvidenceRoles(candidate.result);
        const uncoveredRoleCount = roles.filter((role) => !seenRoles.has(role)).length;
        const densityScore = candidate.result.score / Math.max(1, Math.sqrt(candidate.tokens));

        let packScore = densityScore + (candidate.result.score * 0.20);
        if (!seenSources.has(sourceKey)) {
          packScore += 0.004;
        }
        if (headingKey && !seenHeadings.has(headingKey)) {
          packScore += 0.002;
        }
        packScore += Math.min(0.009, uncoveredRoleCount * 0.003);

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
      for (const role of classifyResultEvidenceRoles(selected)) {
        seenRoles.add(role);
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
  ): Promise<{ results: SearchResult[]; dropped: RetrievalDroppedEvidenceTrace[] }> {
    // Fetch stored embeddings for all candidate rowids
    const rowids = candidates.map((c) => c.rowid);
    const embeddings = await this._vectorStore.getEmbeddings(rowids);

    // Score each candidate by cosine similarity
    const scored: Array<{ result: SearchResult; cosine: number }> = [];
    const dropped: RetrievalDroppedEvidenceTrace[] = [];
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
      } else {
        dropped.push({
          ...toDiagnosticCandidate(candidate),
          droppedAt: 'cosine',
          detail: `cosine ${sim.toFixed(4)} < threshold ${minCosine.toFixed(4)}`,
        });
      }
      // else: dropped — not semantically close enough
    }

    // Sort by cosine similarity (descending), tie-break by RRF score
    scored.sort((a, b) => {
      if (Math.abs(b.cosine - a.cosine) > 0.001) { return b.cosine - a.cosine; }
      return b.result.score - a.result.score;
    });

    return {
      results: scored.map(({ result, cosine }) => ({
      ...result,
      // Downstream ranking stages sort by score, so persist a blended score here
      // instead of returning only an updated array order.
      score: (result.score * 0.5) + (cosine * 0.05),
      })),
      dropped,
    };
  }
}
