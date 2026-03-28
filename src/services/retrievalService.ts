// retrievalService.ts — IRetrievalService implementation
//
// Query-time retrieval: embeds a user query, runs hybrid search (vector + keyword
// via VectorStoreService), applies score threshold filtering, and returns ranked
// context chunks ready for injection into the LLM prompt.
//
// Aligned with upstream OpenClaw search-manager.ts: embed → hybrid search →
// filter by minScore → return top N. Two config knobs: maxResults, minScore.

import { Disposable } from '../platform/lifecycle.js';
import type {
  IEmbeddingService,
  IVectorStoreService,
  IRetrievalService,
} from './serviceTypes.js';
import type { SearchResult, SearchOptions, HybridSearchTrace } from './vectorStoreService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_TOP_K = 20;
const DEFAULT_MIN_SCORE = 0.01;

/** Rough token estimator: chars / 4 (same as defaultParticipant). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Dot product of two equal-length vectors.
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

// ─── Internal artifact detection (desktop platform adaptation) ───────────────

function isInternalArtifactPath(sourceId: string): boolean {
  return /^\.parallx\//i.test(sourceId);
}

function queryExplicitlyTargetsInternalArtifacts(query: string): boolean {
  return [
    /\.parallx\//,
    /\bparallx\b/,
    /\bai-config(?:\.json)?\b/,
    /\bpermissions\.json\b/,
    /\bmemory\.md\b/,
    /\bmemory\s+file\b/,
    /\btranscript\b/,
    /\bsession\s+history\b/,
    /\bsession\s+log\b/,
  ].some((pattern) => pattern.test(query.toLowerCase()));
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Options for a retrieval query. */
export interface RetrievalOptions {
  /** Max chunks to return (default: 20). */
  topK?: number;
  /** Filter by source type ('page_block', 'file_chunk'). */
  sourceFilter?: string;
  /** Restrict retrieval to an explicit set of source IDs. */
  sourceIds?: string[];
  /** Restrict retrieval to sources whose source_id starts with one of these prefixes. */
  pathPrefixes?: string[];
  /** Minimum relevance score (default: 0.01). */
  minScore?: number;
  /** Whether to include FTS5 keyword search (default: true). */
  includeKeyword?: boolean;
  /** Whether internal workspace artifacts such as `.parallx/*` may participate in retrieval. */
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

export interface RetrievalTrace {
  query: string;
  topK: number;
  minScore: number;
  rawCandidateCount: number;
  afterScoreFilterCount: number;
  finalCount: number;
  finalChunks: Array<{
    sourceType: string;
    sourceId: string;
    score: number;
    tokenCount: number;
  }>;
  vectorStoreTrace?: HybridSearchTrace;
}

// ─── RetrievalService ────────────────────────────────────────────────────────

/** Config provider shape — retrieval settings from AI Settings. */
interface IRetrievalConfigProvider {
  getEffectiveConfig(): {
    retrieval: {
      ragTopK: number;
      ragScoreThreshold: number;
    };
  };
}

interface IVectorStoreTraceAccessor {
  getLastSearchTrace?(): HybridSearchTrace | undefined;
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

  /** Bind a config provider (UnifiedAIConfigService) for runtime defaults. */
  setConfigProvider(provider: IRetrievalConfigProvider): void {
    this._configProvider = provider;
  }

  // ── Public API ──

  /**
   * Retrieve relevant context chunks for a user query.
   *
   * Aligned with upstream OpenClaw search-manager.ts:
   *   1. Embed query
   *   2. Hybrid search (vector + keyword via VectorStoreService)
   *   3. Internal artifact hygiene (.parallx files — desktop adaptation)
   *   4. Score threshold filter
   *   5. Return top N
   */
  async retrieve(query: string, options?: RetrievalOptions): Promise<RetrievedContext[]> {
    if (!query.trim()) { return []; }

    const cfg = this._configProvider?.getEffectiveConfig();
    const cfgRetrieval = cfg?.retrieval;
    const topK = options?.topK ?? cfgRetrieval?.ragTopK ?? DEFAULT_TOP_K;
    const minScore = options?.minScore ?? cfgRetrieval?.ragScoreThreshold ?? DEFAULT_MIN_SCORE;

    // 1. Embed query
    const queryEmbedding = await this._embeddingService.embedQuery(query);

    // 2. Hybrid search — single call, matches upstream search-manager.ts
    const searchOptions: SearchOptions = {
      topK,
      sourceFilter: options?.sourceFilter,
      sourceIds: options?.sourceIds,
      pathPrefixes: options?.pathPrefixes,
      minScore: 0, // apply our own threshold after
      includeKeyword: options?.includeKeyword ?? true,
    };
    const rawResults = await this._vectorStore.search(queryEmbedding, query, searchOptions);
    const vectorStoreTrace = (this._vectorStore as IVectorStoreTraceAccessor).getLastSearchTrace?.();

    // 3. Internal artifact hygiene (.parallx files)
    const hygieneResult = this._applyInternalArtifactHygiene(rawResults, query, options);

    // 4. Score threshold filter
    const filtered = hygieneResult.results.filter(r => r.score >= minScore);

    // 5. Map to RetrievedContext, trim to topK
    const finalResults = filtered.slice(0, topK).map(r => ({
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      contextPrefix: r.contextPrefix,
      text: r.chunkText,
      score: r.score,
      sources: [...r.sources],
      tokenCount: estimateTokens(r.chunkText),
    }));

    // Build trace
    this._lastTrace = {
      query,
      topK,
      minScore,
      rawCandidateCount: rawResults.length,
      afterScoreFilterCount: filtered.length,
      finalCount: finalResults.length,
      finalChunks: finalResults.map(c => ({
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        score: c.score,
        tokenCount: c.tokenCount,
      })),
      vectorStoreTrace,
    };

    return finalResults;
  }

  getLastTrace(): RetrievalTrace | undefined {
    return this._lastTrace ? structuredClone(this._lastTrace) : undefined;
  }

  /**
   * Format retrieved context for injection into a chat message.
   */
  formatContext(chunks: RetrievedContext[]): string {
    if (chunks.length === 0) { return ''; }

    const sections: string[] = ['[Retrieved Context]'];
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
      if (chunk.sourceType === 'file_chunk' && chunk.sourceId) {
        sections.push(`Path: ${chunk.sourceId}`);
      }
      sections.push(chunk.text);
    }

    sections.push('---');
    return sections.join('\n');
  }

  // ── Internal ──

  private _applyInternalArtifactHygiene(
    results: SearchResult[],
    query: string,
    options?: RetrievalOptions,
  ): { results: SearchResult[] } {
    const allowInternalArtifacts = options?.internalArtifactPolicy === 'include'
      || queryExplicitlyTargetsInternalArtifacts(query);

    if (allowInternalArtifacts) {
      return { results };
    }

    const filtered: SearchResult[] = [];
    for (const result of results) {
      if (result.sourceType === 'file_chunk' && isInternalArtifactPath(result.sourceId)) {
        continue;
      }
      filtered.push(result);
    }

    return { results: filtered };
  }
}