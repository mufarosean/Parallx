// retrievalService.ts — IRetrievalService implementation
//
// Query-time retrieval: embeds a user query, runs hybrid search (vector + keyword
// via VectorStoreService, which keeps only chunks above the relevance floor),
// and returns ranked context chunks ready for injection into the LLM prompt.
//
// Aligned with upstream OpenClaw search-manager.ts: embed → hybrid search →
// relevance floor → return top N. Two config knobs: ragTopK, ragMinRelevance.

import { Disposable } from '../platform/lifecycle.js';
import type {
  IEmbeddingService,
  IVectorStoreService,
  IRetrievalService,
} from './serviceTypes.js';
import type { SearchResult, SearchOptions, HybridSearchTrace } from './vectorStoreService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_TOP_K = 20;

/** Rough token estimator: chars / 4 (same as defaultParticipant). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
  /** Least cosine similarity to the query (default: AI Settings, retrieval.minRelevance). */
  minRelevance?: number;
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
  /** Relevance: the chunk's cosine similarity to the query, 0 to 1. */
  score: number;
  /** For a PDF chunk, the page(s) its text is on, e.g. "page 13 of 30" (set by the caller). */
  page?: string;
  /** Which retrieval methods contributed ('vector', 'keyword'). */
  sources: string[];
  /** Estimated token count for this chunk. */
  tokenCount: number;
}

export interface RetrievalTrace {
  query: string;
  topK: number;
  minRelevance: number;
  /** The best similarity any candidate had, kept or not: what to tune the floor by. */
  bestSimilarity?: number;
  rawCandidateCount: number;
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
      ragMinRelevance: number;
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

  /**
   * Bind a config provider (UnifiedAIConfigService) for runtime defaults. The
   * relevance floor goes to the vector store too, so every search (memory
   * recall included) uses the one setting.
   */
  setConfigProvider(provider: IRetrievalConfigProvider): void {
    this._configProvider = provider;
    (this._vectorStore as { setMinRelevance?(get: () => number): void }).setMinRelevance?.(() => provider.getEffectiveConfig().retrieval.ragMinRelevance);
  }

  // ── Public API ──

  /**
   * Retrieve relevant context chunks for a user query.
   *
   * Aligned with upstream OpenClaw search-manager.ts:
   *   1. Embed query
   *   2. Hybrid search (vector + keyword via VectorStoreService)
   *      (the relevance floor applies here, in the vector store)
   *   3. Internal artifact hygiene (.parallx files — desktop adaptation)
   *   4. Return top N
   */
  async retrieve(query: string, options?: RetrievalOptions): Promise<RetrievedContext[]> {
    if (!query.trim()) { return []; }

    const cfg = this._configProvider?.getEffectiveConfig();
    const cfgRetrieval = cfg?.retrieval;
    const topK = options?.topK ?? cfgRetrieval?.ragTopK ?? DEFAULT_TOP_K;
    const minRelevance = options?.minRelevance ?? cfgRetrieval?.ragMinRelevance;

    // 1. Embed query
    const queryEmbedding = await this._embeddingService.embedQuery(query);

    // 2. Hybrid search — single call, matches upstream search-manager.ts
    const searchOptions: SearchOptions = {
      topK,
      sourceFilter: options?.sourceFilter,
      sourceIds: options?.sourceIds,
      pathPrefixes: options?.pathPrefixes,
      minRelevance,
      includeKeyword: options?.includeKeyword ?? true,
    };
    const rawResults = await this._vectorStore.search(queryEmbedding, query, searchOptions);
    const vectorStoreTrace = (this._vectorStore as IVectorStoreTraceAccessor).getLastSearchTrace?.();

    // 3. Internal artifact hygiene (.parallx files)
    const hygieneResult = this._applyInternalArtifactHygiene(rawResults, query, options);

    // 4. Map to RetrievedContext, trim to topK
    const finalResults = hygieneResult.results.slice(0, topK).map(r => ({
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      contextPrefix: r.contextPrefix,
      text: r.chunkText,
      score: r.similarity ?? 0,
      sources: [...r.sources],
      tokenCount: estimateTokens(r.chunkText),
    }));

    // Build trace
    this._lastTrace = {
      query,
      topK,
      minRelevance: vectorStoreTrace?.minRelevance ?? minRelevance ?? 0,
      bestSimilarity: vectorStoreTrace?.bestSimilarity,
      rawCandidateCount: rawResults.length,
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
      // HARNESS.md §3.2 — surface the relevance score so the model can judge
      // a strong hit from a near-miss instead of trusting every chunk equally.
      // The harness surfaces evidence; the model judges (the same contract as
      // raw search results in frontier harnesses).
      sections.push(`[${idx}] Source: ${source} (relevance ${chunk.score.toFixed(2)})`);
      if (chunk.sourceType === 'file_chunk' && chunk.sourceId) {
        sections.push(`Path: ${chunk.sourceId}`);
      }
      if (chunk.page) {
        sections.push(`PDF page: ${chunk.page}`);
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