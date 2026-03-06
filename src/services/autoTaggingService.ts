// autoTaggingService.ts — Auto-Tagging Service (M10 Phase 7 — Task 7.2)
//
// When a page is saved, this service:
//   1. Embeds the page content
//   2. Searches the vector store for similar pages
//   3. Looks up existing tags from similar pages
//   4. Suggests the most relevant tags using frequency/similarity analysis
//
// Tags are stored in a `page_tags` table managed by this service.
// No LLM call needed — pure embedding-based tag propagation.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type {
  IEmbeddingService,
  IVectorStoreService,
  IDatabaseService,
  IIndexingPipelineService,
} from './serviceTypes.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of similar pages to consider for tag inference. */
const MAX_SIMILAR_PAGES = 5;

/** Maximum tags to suggest per page. */
const MAX_SUGGESTED_TAGS = 5;

/** Minimum frequency for a tag across similar pages to be suggested. */
const MIN_TAG_FREQUENCY = 1;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A tag applied to a page. */
export interface PageTag {
  /** Unique tag ID. */
  id: string;
  /** Tag name (display text). */
  name: string;
  /** Tag color (CSS color string). */
  color: string;
}

/** A tag suggestion with confidence. */
export interface TagSuggestion {
  /** Tag to suggest. */
  tag: PageTag;
  /** Confidence score (0-1). */
  confidence: number;
  /** How many similar pages have this tag. */
  frequency: number;
}

/** Event data for tag changes. */
export interface TagChangeEvent {
  pageId: string;
  tags: PageTag[];
}

// ─── Tag Colors ──────────────────────────────────────────────────────────────

const TAG_COLORS = [
  '#e03e3e', '#d9730d', '#dfab01', '#0f7b6c', '#0b6e99',
  '#6940a5', '#ad1a72', '#64473a', '#e07c5a', '#9065b0',
];

// ─── AutoTaggingService ──────────────────────────────────────────────────────

export class AutoTaggingService extends Disposable {
  private readonly _onDidChangeTags = this._register(new Emitter<TagChangeEvent>());
  readonly onDidChangeTags: Event<TagChangeEvent> = this._onDidChangeTags.event;

  private readonly _onDidSuggestTags = this._register(new Emitter<{ pageId: string; suggestions: TagSuggestion[] }>());
  /** Fires when new tag suggestions are available for a page. */
  readonly onDidSuggestTags: Event<{ pageId: string; suggestions: TagSuggestion[] }> = this._onDidSuggestTags.event;

  private _initialized = false;

  constructor(
    private readonly _embeddingService: IEmbeddingService,
    private readonly _vectorStoreService: IVectorStoreService,
    private readonly _db: IDatabaseService,
    private readonly _indexingPipeline: IIndexingPipelineService,
  ) {
    super();
  }

  // ── Initialization ──

  /** Create the page_tags schema if it doesn't exist. */
  async initialize(): Promise<void> {
    if (this._initialized || !this._db.isOpen) return;

    await this._db.run(`
      CREATE TABLE IF NOT EXISTS page_tags (
        page_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        tag_name TEXT NOT NULL,
        tag_color TEXT NOT NULL DEFAULT '#0b6e99',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (page_id, tag_id)
      )
    `);

    await this._db.run(`
      CREATE INDEX IF NOT EXISTS idx_page_tags_page ON page_tags(page_id)
    `);

    await this._db.run(`
      CREATE INDEX IF NOT EXISTS idx_page_tags_name ON page_tags(tag_name)
    `);

    this._initialized = true;
  }

  // ── Tag CRUD ──

  /** Get all tags for a page. */
  async getPageTags(pageId: string): Promise<PageTag[]> {
    await this.initialize();
    const rows = await this._db.all<{ tag_id: string; tag_name: string; tag_color: string }>(
      'SELECT tag_id, tag_name, tag_color FROM page_tags WHERE page_id = ? ORDER BY created_at',
      [pageId],
    );
    return rows.map(r => ({ id: r.tag_id, name: r.tag_name, color: r.tag_color }));
  }

  /** Add a tag to a page. Creates the tag if it doesn't exist in the taxonomy. */
  async addTag(pageId: string, tagName: string, color?: string): Promise<PageTag> {
    await this.initialize();
    const tagId = this._generateTagId();
    const tagColor = color ?? this._pickColor(tagName);

    // Check if tag with this name already exists on this page
    const existing = await this._db.get<{ tag_id: string }>(
      'SELECT tag_id FROM page_tags WHERE page_id = ? AND tag_name = ?',
      [pageId, tagName],
    );
    if (existing) {
      return { id: existing.tag_id, name: tagName, color: tagColor };
    }

    await this._db.run(
      'INSERT OR IGNORE INTO page_tags (page_id, tag_id, tag_name, tag_color) VALUES (?, ?, ?, ?)',
      [pageId, tagId, tagName, tagColor],
    );

    const tag: PageTag = { id: tagId, name: tagName, color: tagColor };
    const tags = await this.getPageTags(pageId);
    this._onDidChangeTags.fire({ pageId, tags });
    return tag;
  }

  /** Remove a tag from a page. */
  async removeTag(pageId: string, tagId: string): Promise<void> {
    await this.initialize();
    await this._db.run(
      'DELETE FROM page_tags WHERE page_id = ? AND tag_id = ?',
      [pageId, tagId],
    );
    const tags = await this.getPageTags(pageId);
    this._onDidChangeTags.fire({ pageId, tags });
  }

  /** Get all unique tags across all pages (the taxonomy). */
  async getAllTags(): Promise<PageTag[]> {
    await this.initialize();
    const rows = await this._db.all<{ tag_id: string; tag_name: string; tag_color: string }>(
      'SELECT DISTINCT tag_name, MIN(tag_id) as tag_id, MIN(tag_color) as tag_color FROM page_tags GROUP BY tag_name ORDER BY tag_name',
    );
    return rows.map(r => ({ id: r.tag_id, name: r.tag_name, color: r.tag_color }));
  }

  // ── Tag Suggestion (embedding-based) ──

  /**
   * Suggest tags for a page based on similar pages' tags.
   *
   * Strategy:
   *   1. Embed the page content
   *   2. Find similar pages via vector search
   *   3. Collect tags from similar pages
   *   4. Rank by frequency and similarity score
   *   5. Return top suggestions
   */
  async suggestTags(pageId: string): Promise<TagSuggestion[]> {
    if (!this._indexingPipeline.isInitialIndexComplete) return [];
    await this.initialize();

    // 1. Get page content
    const pageText = await this._getPageText(pageId);
    if (!pageText) return [];

    // 2. Embed for similarity search
    const embedding = await this._embeddingService.embedQuery(pageText.slice(0, 2000));

    // 3. Find similar pages
    const candidates = await this._vectorStoreService.vectorSearch(
      embedding,
      MAX_SIMILAR_PAGES * 3,
      'page_block',
    );

    // 4. Get unique page IDs (excluding the target page)
    const seen = new Set<string>();
    const similarPageIds: string[] = [];
    for (const c of candidates) {
      if (c.sourceId === pageId || seen.has(c.sourceId)) continue;
      seen.add(c.sourceId);
      similarPageIds.push(c.sourceId);
      if (similarPageIds.length >= MAX_SIMILAR_PAGES) break;
    }

    if (similarPageIds.length === 0) return [];

    // 5. Get current page's tags (to exclude already-applied)
    const currentTags = new Set((await this.getPageTags(pageId)).map(t => t.name));

    // 6. Collect tags from similar pages with frequency counts
    const tagFrequency = new Map<string, { tag: PageTag; count: number; totalScore: number }>();
    for (let i = 0; i < similarPageIds.length; i++) {
      const tags = await this.getPageTags(similarPageIds[i]);
      const similarity = 1 / (i + 1); // decay by rank
      for (const tag of tags) {
        if (currentTags.has(tag.name)) continue; // skip already-applied
        const existing = tagFrequency.get(tag.name);
        if (existing) {
          existing.count++;
          existing.totalScore += similarity;
        } else {
          tagFrequency.set(tag.name, { tag, count: 1, totalScore: similarity });
        }
      }
    }

    // 7. Filter and rank suggestions
    const suggestions: TagSuggestion[] = [...tagFrequency.values()]
      .filter(t => t.count >= MIN_TAG_FREQUENCY)
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, MAX_SUGGESTED_TAGS)
      .map(t => ({
        tag: t.tag,
        confidence: Math.min(t.totalScore, 1),
        frequency: t.count,
      }));

    if (suggestions.length > 0) {
      this._onDidSuggestTags.fire({ pageId, suggestions });
    }

    return suggestions;
  }

  /**
   * Auto-tag a page after save: suggest + apply high-confidence tags.
   * Only applies tags with confidence above threshold.
   */
  async autoTagOnSave(pageId: string): Promise<TagSuggestion[]> {
    const suggestions = await this.suggestTags(pageId);
    // Auto-apply tags with confidence > 0.5
    for (const suggestion of suggestions) {
      if (suggestion.confidence > 0.5) {
        await this.addTag(pageId, suggestion.tag.name, suggestion.tag.color);
      }
    }
    return suggestions;
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
      const text = this._extractText(row.content);
      return row.title + '\n' + text;
    } catch {
      return undefined;
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
        if (childText) {
          text += (text && !text.endsWith('\n') ? '\n' : '') + childText;
        }
      }
    }
    return text;
  }

  private _generateTagId(): string {
    return 'tag_' + crypto.randomUUID().slice(0, 8);
  }

  private _pickColor(name: string): string {
    // Deterministic color based on tag name hash
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash) + name.charCodeAt(i);
      hash |= 0;
    }
    return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
  }
}
