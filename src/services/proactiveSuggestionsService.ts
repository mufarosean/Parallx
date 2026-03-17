// proactiveSuggestionsService.ts — Proactive Suggestions (M10 Phase 7 — Task 7.4)
//
// Analyzes the knowledge base to detect patterns and suggest actions:
//   - Topic clusters: pages covering similar topics that could be consolidated
//   - Orphan detection: pages with no related pages (isolated content)
//   - Coverage gaps: topics mentioned frequently but without a dedicated page
//
// Runs periodically after initial indexing completes.
// Pattern detection uses vector similarity clustering — no LLM calls.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type {
  IEmbeddingService,
  IVectorStoreService,
  IDatabaseService,
  IIndexingPipelineService,
} from './serviceTypes.js';
import type { IUnifiedAIConfigService } from '../aiSettings/unifiedConfigTypes.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum pages to analyze before generating suggestions. */
const MIN_PAGES_FOR_ANALYSIS = 5;

/** Similarity threshold for pages to be considered related (cosine similarity 0–1). */
const CLUSTER_THRESHOLD = 0.65;

/** Maximum suggestions to store. */
const MAX_SUGGESTIONS = 10;

/** Analysis cooldown in ms (don't re-analyze more than once per 5 minutes). */
const ANALYSIS_COOLDOWN_MS = 5 * 60 * 1000;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A proactive suggestion type. */
export type SuggestionType = 'consolidate' | 'orphan' | 'coverage_gap';

/** A proactive suggestion from the system. */
export interface ProactiveSuggestion {
  /** Unique suggestion ID. */
  id: string;
  /** Type of suggestion. */
  type: SuggestionType;
  /** Human-readable title. */
  title: string;
  /** Descriptive message explaining the suggestion. */
  message: string;
  /** Related page IDs (for consolidation suggestions). */
  relatedPageIds: string[];
  /** Confidence score (0-1). */
  confidence: number;
  /** When this suggestion was generated. */
  createdAt: string;
  /** Whether the user has dismissed this suggestion. */
  dismissed: boolean;
}

// ─── ProactiveSuggestionsService ─────────────────────────────────────────────

export class ProactiveSuggestionsService extends Disposable {
  private readonly _onDidUpdateSuggestions = this._register(new Emitter<ProactiveSuggestion[]>());
  /** Fires when the suggestions list updates. */
  readonly onDidUpdateSuggestions: Event<ProactiveSuggestion[]> = this._onDidUpdateSuggestions.event;

  private _suggestions: ProactiveSuggestion[] = [];
  private _lastAnalysisTime = 0;
  private _analysisTimer: ReturnType<typeof setTimeout> | null = null;

  // M15: Configurable thresholds (defaults match original hardcoded values)
  private _suggestionsEnabled = true;
  private _clusterThreshold = CLUSTER_THRESHOLD;
  private _maxSuggestions = MAX_SUGGESTIONS;

  constructor(
    private readonly _embeddingService: IEmbeddingService,
    private readonly _vectorStoreService: IVectorStoreService,
    private readonly _db: IDatabaseService,
    private readonly _indexingPipeline: IIndexingPipelineService,
    unifiedConfigService?: Pick<IUnifiedAIConfigService, 'getEffectiveConfig' | 'onDidChangeConfig'>,
  ) {
    super();

    // M40 Phase 6: Read authoritative unified config and subscribe to changes.
    if (unifiedConfigService) {
      this._applyUnifiedConfig(unifiedConfigService);
      this._register(unifiedConfigService.onDidChangeConfig(() => {
        this._applyUnifiedConfig(unifiedConfigService);
      }));
    }

    // Run analysis after initial indexing completes
    this._register(this._indexingPipeline.onDidCompleteInitialIndex(() => {
      this._scheduleAnalysis();
    }));

    // Re-analyze when index updates
    this._register(this._vectorStoreService.onDidUpdateIndex(() => {
      this._scheduleAnalysis();
    }));
  }

  /** M40 Phase 6: Apply authoritative unified config to configurable thresholds. */
  private _applyUnifiedConfig(unifiedConfigService: Pick<IUnifiedAIConfigService, 'getEffectiveConfig'>): void {
    const suggestions = unifiedConfigService.getEffectiveConfig().suggestions;
    this._suggestionsEnabled = suggestions.suggestionsEnabled;
    this._clusterThreshold = suggestions.suggestionConfidenceThreshold > 0
      ? suggestions.suggestionConfidenceThreshold
      : CLUSTER_THRESHOLD;
    this._maxSuggestions = suggestions.maxPendingSuggestions > 0
      ? suggestions.maxPendingSuggestions
      : MAX_SUGGESTIONS;
  }

  /** Get current suggestions (excluding dismissed). */
  get suggestions(): ProactiveSuggestion[] {
    return this._suggestions.filter(s => !s.dismissed);
  }

  /** Get all suggestions including dismissed. */
  get allSuggestions(): ProactiveSuggestion[] {
    return [...this._suggestions];
  }

  /** Dismiss a suggestion. */
  dismiss(suggestionId: string): void {
    const suggestion = this._suggestions.find(s => s.id === suggestionId);
    if (suggestion) {
      suggestion.dismissed = true;
      this._onDidUpdateSuggestions.fire(this.suggestions);
    }
  }

  /** Force an immediate analysis. */
  async analyze(): Promise<ProactiveSuggestion[]> {
    return this._runAnalysis();
  }

  // ── Analysis Engine ──

  private _scheduleAnalysis(): void {
    // M15: Skip analysis entirely when suggestions are disabled
    if (!this._suggestionsEnabled) { return; }

    if (this._analysisTimer) {
      clearTimeout(this._analysisTimer);
    }
    const elapsed = Date.now() - this._lastAnalysisTime;
    const delay = Math.max(0, ANALYSIS_COOLDOWN_MS - elapsed);
    this._analysisTimer = setTimeout(() => {
      this._runAnalysis().catch(err => {
        console.error('[ProactiveSuggestions] Analysis failed:', err);
      });
    }, delay);
  }

  private async _runAnalysis(): Promise<ProactiveSuggestion[]> {
    this._lastAnalysisTime = Date.now();

    if (!this._indexingPipeline.isInitialIndexComplete || !this._db.isOpen) {
      return [];
    }

    // Get all indexed pages
    const pages = await this._getPages();
    if (pages.length < MIN_PAGES_FOR_ANALYSIS) return [];

    const newSuggestions: ProactiveSuggestion[] = [];

    // 1. Find topic clusters (pages that cover very similar content)
    const clusters = await this._findTopicClusters(pages);
    for (const cluster of clusters) {
      if (cluster.pageIds.length >= 2) {
        newSuggestions.push({
          id: 'sug_' + crypto.randomUUID().slice(0, 8),
          type: 'consolidate',
          title: `Related pages: ${cluster.label}`,
          message: `You have ${cluster.pageIds.length} pages covering "${cluster.label}". ` +
            `Consider consolidating into a single comprehensive document.`,
          relatedPageIds: cluster.pageIds,
          confidence: cluster.confidence,
          createdAt: new Date().toISOString(),
          dismissed: false,
        });
      }
    }

    // 2. Find orphan pages (pages with no similar content anywhere)
    const orphans = await this._findOrphans(pages);
    for (const orphan of orphans) {
      newSuggestions.push({
        id: 'sug_' + crypto.randomUUID().slice(0, 8),
        type: 'orphan',
        title: `Isolated page: ${orphan.title}`,
        message: `"${orphan.title}" has no related pages. Consider linking it to related content or adding tags.`,
        relatedPageIds: [orphan.pageId],
        confidence: 0.5,
        createdAt: new Date().toISOString(),
        dismissed: false,
      });
    }

    // Merge with existing (preserve dismissed state)
    this._mergeSuggestions(newSuggestions);
    this._onDidUpdateSuggestions.fire(this.suggestions);

    return this.suggestions;
  }

  /** Find clusters of pages with high similarity. */
  private async _findTopicClusters(
    pages: { id: string; title: string; text: string }[],
  ): Promise<Array<{ pageIds: string[]; label: string; confidence: number }>> {
    const clusters: Array<{ pageIds: string[]; label: string; confidence: number }> = [];
    const assigned = new Set<string>();

    for (const page of pages) {
      if (assigned.has(page.id)) continue;

      // Embed page content and find similar
      const embedding = await this._embeddingService.embedQuery(page.text.slice(0, 1500));
      const similar = await this._vectorStoreService.vectorSearch(embedding, 10, 'page_block');

      // Group similar pages (excluding self)
      const clusterPageIds = new Set<string>([page.id]);
      let totalScore = 0;
      for (const result of similar) {
        if (result.sourceId === page.id || assigned.has(result.sourceId)) continue;
        if (result.score >= this._clusterThreshold) {
          clusterPageIds.add(result.sourceId);
          totalScore += result.score;
        }
      }

      if (clusterPageIds.size >= 3) {
        // Only suggest consolidation for 3+ strongly related pages
        for (const id of clusterPageIds) assigned.add(id);
        const titles = await this._getPageTitles([...clusterPageIds]);
        clusters.push({
          pageIds: [...clusterPageIds],
          label: titles[0] || page.title,
          confidence: Math.min(totalScore / (clusterPageIds.size - 1), 1),
        });
      }
    }

    return clusters.slice(0, 3); // limit clusters
  }

  /** Find pages with no similar content. */
  private async _findOrphans(
    pages: { id: string; title: string; text: string }[],
  ): Promise<Array<{ pageId: string; title: string }>> {
    const orphans: Array<{ pageId: string; title: string }> = [];

    for (const page of pages) {
      const embedding = await this._embeddingService.embedQuery(page.text.slice(0, 1500));
      const similar = await this._vectorStoreService.vectorSearch(embedding, 5, 'page_block');

      // Count non-self results with decent score
      const related = similar.filter(r => r.sourceId !== page.id && r.score >= this._clusterThreshold);
      if (related.length === 0) {
        orphans.push({ pageId: page.id, title: page.title });
      }
    }

    return orphans.slice(0, 3); // limit orphans
  }

  /** Merge new suggestions with existing, preserving dismissed state. */
  private _mergeSuggestions(newSuggestions: ProactiveSuggestion[]): void {
    // Build a set of existing dismissed types+pages for preservation
    const dismissedKeys = new Set<string>();
    for (const s of this._suggestions) {
      if (s.dismissed) {
        dismissedKeys.add(`${s.type}:${s.relatedPageIds.sort().join(',')}`);
      }
    }

    // Apply dismissed state to new suggestions
    for (const s of newSuggestions) {
      const key = `${s.type}:${s.relatedPageIds.sort().join(',')}`;
      if (dismissedKeys.has(key)) {
        s.dismissed = true;
      }
    }

    this._suggestions = newSuggestions.slice(0, this._maxSuggestions);
  }

  // ── Helpers ──

  private async _getPages(): Promise<Array<{ id: string; title: string; text: string }>> {
    if (!this._db.isOpen) return [];
    try {
      const rows = await this._db.all<{ id: string; title: string; content: string }>(
        'SELECT id, title, content FROM pages WHERE is_archived = 0 LIMIT 50',
      );
      return rows.map(r => ({
        id: r.id,
        title: r.title,
        text: this._extractText(r.content),
      })).filter(p => p.text.length > 50); // skip near-empty pages
    } catch {
      return [];
    }
  }

  private async _getPageTitles(pageIds: string[]): Promise<string[]> {
    if (!this._db.isOpen || pageIds.length === 0) return [];
    try {
      const placeholders = pageIds.map(() => '?').join(',');
      const rows = await this._db.all<{ id: string; title: string }>(
        `SELECT id, title FROM pages WHERE id IN (${placeholders})`,
        pageIds,
      );
      const map = new Map(rows.map(r => [r.id, r.title]));
      return pageIds.map(id => map.get(id) ?? 'Untitled');
    } catch {
      return pageIds.map(() => 'Untitled');
    }
  }

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
    if (node.text) text += node.text;
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        const childText = this._walkNodes(child);
        if (childText) text += (text && !text.endsWith('\n') ? '\n' : '') + childText;
      }
    }
    return text;
  }

  override dispose(): void {
    if (this._analysisTimer) {
      clearTimeout(this._analysisTimer);
      this._analysisTimer = null;
    }
    super.dispose();
  }
}
