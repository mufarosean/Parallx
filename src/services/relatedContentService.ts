// relatedContentService.ts — Related Content Service (M10 Phase 7 — Task 7.1)
//
// Finds pages/files semantically similar to a given page by:
//   1. Getting the page's existing embeddings from the vector store
//   2. Computing an average embedding (centroid) of the page's chunks
//   3. Running vectorSearch to find similar content across the index
//   4. Deduplicating and grouping by source (page or file)
//
// Used by the "Related Content" sidebar panel.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type {
  IEmbeddingService,
  IVectorStoreService,
  IDatabaseService,
  IIndexingPipelineService,
} from './serviceTypes.js';
import type { SearchResult } from './vectorStoreService.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum related items to return. */
const DEFAULT_MAX_RESULTS = 8;

/** Minimum similarity score to include in results. */
const MIN_SCORE = 0.001;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A related content item (page or file). */
export interface RelatedItem {
  /** Source type: 'page' or 'file'. */
  sourceType: 'page' | 'file';
  /** Source identifier (page UUID or file path). */
  sourceId: string;
  /** Display label (page title or file name). */
  label: string;
  /** Relevance score (0-1 range, higher = more similar). */
  score: number;
  /** Number of matching chunks for this source. */
  matchingChunks: number;
}

/** Options for findRelated queries. */
export interface FindRelatedOptions {
  /** Max results to return (default: 8). */
  maxResults?: number;
  /** Filter by source type ('page' or 'file'). Omit for all. */
  sourceTypeFilter?: 'page' | 'file';
}

// ─── RelatedContentService ───────────────────────────────────────────────────

export class RelatedContentService extends Disposable {
  private readonly _onDidChangeRelated = this._register(new Emitter<string>());
  /** Fires when related content might have changed (e.g. after re-indexing). */
  readonly onDidChangeRelated: Event<string> = this._onDidChangeRelated.event;

  constructor(
    private readonly _embeddingService: IEmbeddingService,
    private readonly _vectorStoreService: IVectorStoreService,
    private readonly _db: IDatabaseService,
    private readonly _indexingPipeline: IIndexingPipelineService,
  ) {
    super();

    // Re-fire when index updates — related items may have changed
    this._register(this._vectorStoreService.onDidUpdateIndex(() => {
      this._onDidChangeRelated.fire('*');
    }));
  }

  /**
   * Find pages/files related to the given page.
   *
   * Strategy:
   *   1. Get the page's text content
   *   2. Embed it as a query (search_query prefix for similarity matching)
   *   3. Run vector search across the whole index
   *   4. Filter out chunks from the same page
   *   5. Group by source, rank by aggregate score
   */
  async findRelated(
    pageId: string,
    options?: FindRelatedOptions,
  ): Promise<RelatedItem[]> {
    const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;

    // Only search if initial indexing is complete
    if (!this._indexingPipeline.isInitialIndexComplete) {
      return [];
    }

    // 1. Get page text content for embedding
    const pageText = await this._getPageText(pageId);
    if (!pageText) return [];

    // 2. Embed the page content as a query
    // Truncate to avoid overly long embeddings — first ~2000 chars is enough for similarity
    const truncated = pageText.slice(0, 2000);
    const queryEmbedding = await this._embeddingService.embedQuery(truncated);

    // 3. Vector search — fetch more candidates than needed for grouping
    const sourceFilter = options?.sourceTypeFilter === 'page' ? 'page_block'
      : options?.sourceTypeFilter === 'file' ? 'file_chunk'
      : undefined;
    const candidates = await this._vectorStoreService.vectorSearch(
      queryEmbedding,
      maxResults * 3, // fetch extra to account for same-page filtering + grouping
      sourceFilter,
    );

    // 4. Filter out chunks from the queried page itself
    const filtered = candidates.filter(c => !(c.sourceType === 'page_block' && c.sourceId === pageId));

    // 5. Group by source, calculate aggregate score
    const grouped = new Map<string, { item: SearchResult; count: number; totalScore: number }>();
    for (const chunk of filtered) {
      const key = `${chunk.sourceType}:${chunk.sourceId}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.count++;
        existing.totalScore += chunk.score;
      } else {
        grouped.set(key, { item: chunk, count: 1, totalScore: chunk.score });
      }
    }

    // 6. Sort by aggregate score and resolve labels
    const sorted = [...grouped.values()]
      .filter(g => g.totalScore >= MIN_SCORE)
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, maxResults);

    const results: RelatedItem[] = [];
    for (const group of sorted) {
      const { item, count, totalScore } = group;
      const sourceType = item.sourceType === 'page_block' ? 'page' as const : 'file' as const;
      const label = sourceType === 'page'
        ? await this._getPageTitle(item.sourceId) ?? 'Untitled'
        : this._getFileName(item.sourceId);

      results.push({
        sourceType,
        sourceId: item.sourceId,
        label,
        score: totalScore,
        matchingChunks: count,
      });
    }

    return results;
  }

  // ── Helpers ──

  private async _getPageText(pageId: string): Promise<string | undefined> {
    if (!this._db.isOpen) return undefined;
    try {
      const row = await this._db.get<{ content: string; title: string }>(
        'SELECT content, title FROM pages WHERE id = ? AND is_archived = 0',
        [pageId],
      );
      if (!row) return undefined;
      // Extract text from TipTap JSON content
      const text = this._extractText(row.content);
      return row.title + '\n' + text;
    } catch {
      return undefined;
    }
  }

  private async _getPageTitle(pageId: string): Promise<string | undefined> {
    if (!this._db.isOpen) return undefined;
    try {
      const row = await this._db.get<{ title: string }>(
        'SELECT title FROM pages WHERE id = ?',
        [pageId],
      );
      return row?.title;
    } catch {
      return undefined;
    }
  }

  private _getFileName(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || filePath;
  }

  /** Extract text from TipTap JSON string. */
  private _extractText(jsonStr: string): string {
    try {
      const doc = JSON.parse(jsonStr);
      return this._walkNodes(doc);
    } catch {
      return '';
    }
  }

  private _walkNodes(node: any): string {
    if (!node) return '';
    let text = '';

    if (node.text) {
      text += node.text;
    }

    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        const childText = this._walkNodes(child);
        if (childText) {
          text += (text && !text.endsWith('\n') ? '\n' : '') + childText;
        }
      }
    }

    return text;
  }
}
