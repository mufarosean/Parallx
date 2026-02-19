// canvasDataService.ts — renderer-side page CRUD + auto-save for Canvas
//
// Wraps window.parallxElectron.database.* IPC calls into a typed,
// event-driven API. Provides page CRUD, tree assembly, move/reorder,
// debounced content auto-save, and change notifications.
//
// No direct IPC calls from UI components — everything goes through
// this service.

import { Disposable } from '../../platform/lifecycle.js';
import { Emitter, Event } from '../../platform/events.js';
import {
  type IPage,
  type IPageTreeNode,
  type PageChangeEvent,
  PageChangeKind,
} from './canvasTypes.js';
import {
  CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
  decodeCanvasContent,
  encodeCanvasContentFromDoc,
  normalizeCanvasContentForStorage,
} from './contentSchema.js';

export const enum SaveStateKind {
  Pending = 'Pending',
  Flushing = 'Flushing',
  Saved = 'Saved',
  Failed = 'Failed',
  Retrying = 'Retrying',
}

export interface SaveStateEvent {
  readonly pageId: string;
  readonly kind: SaveStateKind;
  readonly source: 'debounce' | 'flush' | 'repair';
  readonly error?: string;
}

interface CrossPageMoveParams {
  readonly sourcePageId: string;
  readonly targetPageId: string;
  readonly sourceDoc: any;
  readonly appendedNodes: any[];
  readonly expectedSourceRevision?: number;
  readonly expectedTargetRevision?: number;
}

// ─── Database Bridge Type ────────────────────────────────────────────────────

interface DatabaseBridge {
  run(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; changes?: number; lastInsertRowid?: number }>;
  get(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; rows?: Record<string, unknown>[] }>;
}

// ─── Row → IPage mapping ────────────────────────────────────────────────────

/** @internal Exported for testing — converts a raw database row to an IPage. */
export function rowToPage(row: Record<string, unknown>): IPage {
  return {
    id: row.id as string,
    parentId: (row.parent_id as string) ?? null,
    title: row.title as string,
    icon: (row.icon as string) ?? null,
    content: row.content as string,
    contentSchemaVersion: (row.content_schema_version as number) ?? CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
    revision: (row.revision as number) ?? 1,
    sortOrder: row.sort_order as number,
    isArchived: !!(row.is_archived as number),
    coverUrl: (row.cover_url as string) ?? null,
    coverYOffset: (row.cover_y_offset as number) ?? 0.5,
    fontFamily: (row.font_family as 'default' | 'serif' | 'mono') ?? 'default',
    fullWidth: !!(row.full_width as number),
    smallText: !!(row.small_text as number),
    isLocked: !!(row.is_locked as number),
    isFavorited: !!(row.is_favorited as number),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── CanvasDataService ───────────────────────────────────────────────────────

/**
 * Renderer-side data service for Canvas pages.
 *
 * All database access goes through IPC to the main process. This service
 * provides typed methods, change events, and debounced auto-save.
 */
export class CanvasDataService extends Disposable {

  // ── Events ──

  private readonly _onDidChangePage = this._register(new Emitter<PageChangeEvent>());
  readonly onDidChangePage: Event<PageChangeEvent> = this._onDidChangePage.event;

  /** Fires after an auto-save flush completes for a specific page. */
  private readonly _onDidSavePage = this._register(new Emitter<string>());
  readonly onDidSavePage: Event<string> = this._onDidSavePage.event;

  /** Fires when save lifecycle state changes (pending/flushing/saved/failed). */
  private readonly _onDidChangeSaveState = this._register(new Emitter<SaveStateEvent>());
  readonly onDidChangeSaveState: Event<SaveStateEvent> = this._onDidChangeSaveState.event;

  // ── Auto-save debounce state ──

  /** Per-page debounce timers for content auto-save. */
  private readonly _pendingSaves = new Map<string, { timer: ReturnType<typeof setTimeout>; content: string; expectedRevision?: number }>();

  /** Per-page retry state for failed auto-saves (exponential backoff). */
  private readonly _retryQueue = new Map<string, { timer: ReturnType<typeof setTimeout>; content: string; retries: number; expectedRevision?: number }>();

  /** Max retry attempts before giving up. */
  private static readonly MAX_RETRIES = 3;
  /** Base delay for retry backoff in ms (doubles each retry: 1s, 2s, 4s). */
  private static readonly RETRY_BASE_MS = 1000;

  /** Last known committed revision per page. */
  private readonly _knownRevisions = new Map<string, number>();

  /** Debounce interval in ms. */
  private readonly _autoSaveMs: number;

  constructor(autoSaveMs = 500) {
    super();
    this._autoSaveMs = autoSaveMs;
  }

  // ── Bridge accessor ──

  private get _db(): DatabaseBridge {
    const electron = (window as any).parallxElectron;
    if (!electron?.database) {
      throw new Error('[CanvasDataService] window.parallxElectron.database not available');
    }
    return electron.database;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Page CRUD
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new page.
   *
   * @param parentId — parent page ID, or undefined/null for root level
   * @param title — page title (defaults to 'Untitled')
   * @returns the created page
   */
  async createPage(parentId?: string | null, title?: string): Promise<IPage> {
    const id = crypto.randomUUID();
    const parent = parentId ?? null;
    const pageTitle = title || 'Untitled';

    // Calculate sort order: max sibling sort_order + 1
    const maxResult = await this._db.get(
      parent === null
        ? 'SELECT MAX(sort_order) as max_sort FROM pages WHERE parent_id IS NULL'
        : 'SELECT MAX(sort_order) as max_sort FROM pages WHERE parent_id = ?',
      parent === null ? [] : [parent],
    );
    if (maxResult.error) throw new Error(maxResult.error.message);
    const sortOrder = ((maxResult.row?.max_sort as number) ?? 0) + 1;

    const initialContent = encodeCanvasContentFromDoc({ type: 'doc', content: [{ type: 'paragraph' }] });

    const result = await this._db.run(
      `INSERT INTO pages (id, parent_id, title, content, content_schema_version, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, parent, pageTitle, initialContent.storedContent, initialContent.schemaVersion, sortOrder],
    );
    if (result.error) throw new Error(result.error.message);

    const page = await this.getPage(id);
    if (!page) throw new Error(`[CanvasDataService] Created page "${id}" not found after insert`);

    this._onDidChangePage.fire({ kind: PageChangeKind.Created, pageId: id, page });
    this._knownRevisions.set(id, page.revision);
    return page;
  }

  /**
   * Fetch a single page by ID. Returns null if not found.
   */
  async getPage(pageId: string): Promise<IPage | null> {
    const result = await this._db.get('SELECT * FROM pages WHERE id = ?', [pageId]);
    if (result.error) throw new Error(result.error.message);
    const page = result.row ? rowToPage(result.row) : null;
    if (page) {
      this._knownRevisions.set(page.id, page.revision);
    }
    return page;
  }

  /**
   * Get all root-level pages (parent_id IS NULL), ordered by sort_order.
   */
  async getRootPages(): Promise<IPage[]> {
    const result = await this._db.all(
      'SELECT * FROM pages WHERE parent_id IS NULL AND is_archived = 0 ORDER BY sort_order',
    );
    if (result.error) throw new Error(result.error.message);
    return (result.rows ?? []).map(rowToPage);
  }

  /**
   * Get child pages of a parent, ordered by sort_order.
   */
  async getChildren(parentId: string): Promise<IPage[]> {
    const result = await this._db.all(
      'SELECT * FROM pages WHERE parent_id = ? AND is_archived = 0 ORDER BY sort_order',
      [parentId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.rows ?? []).map(rowToPage);
  }

  /**
   * Get the full page tree assembled from flat rows.
   * Returns root-level nodes with children recursively populated.
   */
  async getPageTree(): Promise<IPageTreeNode[]> {
    const result = await this._db.all(
      'SELECT * FROM pages WHERE is_archived = 0 ORDER BY sort_order',
    );
    if (result.error) throw new Error(result.error.message);

    const pages = (result.rows ?? []).map(rowToPage);
    return this._assembleTree(pages);
  }

  /**
   * Update a page's mutable fields (title, icon, content).
   * Sets updated_at to the current timestamp.
   */
  async updatePage(
    pageId: string,
    updates: Partial<Pick<IPage, 'title' | 'icon' | 'content' | 'coverUrl' | 'coverYOffset' | 'fontFamily' | 'fullWidth' | 'smallText' | 'isLocked' | 'isFavorited' | 'contentSchemaVersion'>> & { expectedRevision?: number },
  ): Promise<IPage> {
    const expectedRevision = updates.expectedRevision;
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.title !== undefined) {
      sets.push('title = ?');
      params.push(updates.title);
    }
    if (updates.icon !== undefined) {
      sets.push('icon = ?');
      params.push(updates.icon);
    }
    if (updates.content !== undefined) {
      const normalized = normalizeCanvasContentForStorage(updates.content);
      sets.push('content = ?');
      params.push(normalized.storedContent);
      sets.push('content_schema_version = ?');
      params.push(normalized.schemaVersion);
    }
    if (updates.contentSchemaVersion !== undefined && updates.content === undefined) {
      sets.push('content_schema_version = ?');
      params.push(updates.contentSchemaVersion);
    }
    if (updates.coverUrl !== undefined) {
      sets.push('cover_url = ?');
      params.push(updates.coverUrl);
    }
    if (updates.coverYOffset !== undefined) {
      sets.push('cover_y_offset = ?');
      params.push(updates.coverYOffset);
    }
    if (updates.fontFamily !== undefined) {
      sets.push('font_family = ?');
      params.push(updates.fontFamily);
    }
    if (updates.fullWidth !== undefined) {
      sets.push('full_width = ?');
      params.push(updates.fullWidth ? 1 : 0);
    }
    if (updates.smallText !== undefined) {
      sets.push('small_text = ?');
      params.push(updates.smallText ? 1 : 0);
    }
    if (updates.isLocked !== undefined) {
      sets.push('is_locked = ?');
      params.push(updates.isLocked ? 1 : 0);
    }
    if (updates.isFavorited !== undefined) {
      sets.push('is_favorited = ?');
      params.push(updates.isFavorited ? 1 : 0);
    }

    if (sets.length === 0) {
      const page = await this.getPage(pageId);
      if (!page) throw new Error(`[CanvasDataService] Page "${pageId}" not found`);
      return page;
    }

    sets.push("updated_at = datetime('now')");
    sets.push('revision = revision + 1');
    params.push(pageId);

    const whereClause = expectedRevision === undefined
      ? 'id = ?'
      : 'id = ? AND revision = ?';
    if (expectedRevision !== undefined) {
      params.push(expectedRevision);
    }

    const result = await this._db.run(
      `UPDATE pages SET ${sets.join(', ')} WHERE ${whereClause}`,
      params,
    );
    if (result.error) throw new Error(result.error.message);
    if ((result.changes ?? 0) === 0 && expectedRevision !== undefined) {
      throw new Error(`[CanvasDataService] Revision conflict for page "${pageId}"`);
    }

    const page = await this.getPage(pageId);
    if (!page) throw new Error(`[CanvasDataService] Page "${pageId}" not found after update`);

    this._knownRevisions.set(pageId, page.revision);
    this._onDidChangePage.fire({ kind: PageChangeKind.Updated, pageId, page });
    return page;
  }

  /**
   * Append block JSON nodes to the end of a page document.
   * Used for copy-style drops where source content is unchanged.
   */
  async appendBlocksToPage(targetPageId: string, appendedNodes: any[]): Promise<IPage> {
    if (!Array.isArray(appendedNodes) || appendedNodes.length === 0) {
      const existing = await this.getPage(targetPageId);
      if (!existing) throw new Error(`[CanvasDataService] Page "${targetPageId}" not found`);
      return existing;
    }

    this._cancelPendingSave(targetPageId);

    const target = await this.getPage(targetPageId);
    if (!target) throw new Error(`[CanvasDataService] Page "${targetPageId}" not found`);

    const decodedTarget = decodeCanvasContent(target.content);
    const targetContent = Array.isArray(decodedTarget.doc?.content) ? decodedTarget.doc.content : [];
    const mergedDoc = {
      type: 'doc',
      content: [...targetContent, ...appendedNodes],
    };

    return this.updatePage(targetPageId, {
      content: encodeCanvasContentFromDoc(mergedDoc).storedContent,
      contentSchemaVersion: CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
      expectedRevision: this._knownRevisions.get(targetPageId),
    });
  }

  /**
   * Atomically move blocks across pages by persisting source and target updates
   * in a single database transaction.
   */
  async moveBlocksBetweenPagesAtomic(params: CrossPageMoveParams): Promise<{ sourcePage: IPage; targetPage: IPage }> {
    const {
      sourcePageId,
      targetPageId,
      sourceDoc,
      appendedNodes,
      expectedSourceRevision,
      expectedTargetRevision,
    } = params;

    if (!sourcePageId || !targetPageId) {
      throw new Error('[CanvasDataService] Source and target page IDs are required');
    }
    if (sourcePageId === targetPageId) {
      throw new Error('[CanvasDataService] Cross-page move requires different source and target pages');
    }
    if (!Array.isArray(appendedNodes) || appendedNodes.length === 0) {
      throw new Error('[CanvasDataService] Cannot move empty block set');
    }

    const resolvedExpectedSource = expectedSourceRevision ?? this._knownRevisions.get(sourcePageId);
    const resolvedExpectedTarget = expectedTargetRevision ?? this._knownRevisions.get(targetPageId);

    this._cancelPendingSave(sourcePageId);
    this._cancelPendingSave(targetPageId);

    await this._db.run('BEGIN IMMEDIATE TRANSACTION');

    try {
      const sourceRowResult = await this._db.get('SELECT * FROM pages WHERE id = ?', [sourcePageId]);
      if (sourceRowResult.error) throw new Error(sourceRowResult.error.message);
      if (!sourceRowResult.row) throw new Error(`[CanvasDataService] Source page "${sourcePageId}" not found`);

      const targetRowResult = await this._db.get('SELECT * FROM pages WHERE id = ?', [targetPageId]);
      if (targetRowResult.error) throw new Error(targetRowResult.error.message);
      if (!targetRowResult.row) throw new Error(`[CanvasDataService] Target page "${targetPageId}" not found`);

      const sourcePageBefore = rowToPage(sourceRowResult.row);
      const targetPageBefore = rowToPage(targetRowResult.row);

      if (resolvedExpectedSource !== undefined && sourcePageBefore.revision !== resolvedExpectedSource) {
        throw new Error(`[CanvasDataService] Revision conflict for source page "${sourcePageId}"`);
      }
      if (resolvedExpectedTarget !== undefined && targetPageBefore.revision !== resolvedExpectedTarget) {
        throw new Error(`[CanvasDataService] Revision conflict for target page "${targetPageId}"`);
      }

      const sourceEncoded = encodeCanvasContentFromDoc(sourceDoc);
      const decodedTarget = decodeCanvasContent(targetPageBefore.content);
      const targetContent = Array.isArray(decodedTarget.doc?.content) ? decodedTarget.doc.content : [];
      const mergedTargetDoc = {
        type: 'doc',
        content: [...targetContent, ...appendedNodes],
      };
      const targetEncoded = encodeCanvasContentFromDoc(mergedTargetDoc);

      const updateSourceResult = await this._db.run(
        `UPDATE pages
         SET content = ?, content_schema_version = ?, revision = revision + 1, updated_at = datetime('now')
         WHERE id = ? AND revision = ?`,
        [sourceEncoded.storedContent, sourceEncoded.schemaVersion, sourcePageId, sourcePageBefore.revision],
      );
      if (updateSourceResult.error) throw new Error(updateSourceResult.error.message);
      if ((updateSourceResult.changes ?? 0) === 0) {
        throw new Error(`[CanvasDataService] Revision conflict while updating source page "${sourcePageId}"`);
      }

      const updateTargetResult = await this._db.run(
        `UPDATE pages
         SET content = ?, content_schema_version = ?, revision = revision + 1, updated_at = datetime('now')
         WHERE id = ? AND revision = ?`,
        [targetEncoded.storedContent, targetEncoded.schemaVersion, targetPageId, targetPageBefore.revision],
      );
      if (updateTargetResult.error) throw new Error(updateTargetResult.error.message);
      if ((updateTargetResult.changes ?? 0) === 0) {
        throw new Error(`[CanvasDataService] Revision conflict while updating target page "${targetPageId}"`);
      }

      const sourceAfterResult = await this._db.get('SELECT * FROM pages WHERE id = ?', [sourcePageId]);
      if (sourceAfterResult.error) throw new Error(sourceAfterResult.error.message);
      if (!sourceAfterResult.row) throw new Error(`[CanvasDataService] Source page "${sourcePageId}" missing after move`);

      const targetAfterResult = await this._db.get('SELECT * FROM pages WHERE id = ?', [targetPageId]);
      if (targetAfterResult.error) throw new Error(targetAfterResult.error.message);
      if (!targetAfterResult.row) throw new Error(`[CanvasDataService] Target page "${targetPageId}" missing after move`);

      const sourcePage = rowToPage(sourceAfterResult.row);
      const targetPage = rowToPage(targetAfterResult.row);

      const commitResult = await this._db.run('COMMIT');
      if (commitResult.error) throw new Error(commitResult.error.message);

      this._knownRevisions.set(sourcePageId, sourcePage.revision);
      this._knownRevisions.set(targetPageId, targetPage.revision);

      this._onDidChangePage.fire({ kind: PageChangeKind.Updated, pageId: sourcePageId, page: sourcePage });
      this._onDidChangePage.fire({ kind: PageChangeKind.Updated, pageId: targetPageId, page: targetPage });

      return { sourcePage, targetPage };
    } catch (err) {
      try {
        await this._db.run('ROLLBACK');
      } catch {
        // Ignore rollback failures; original error is more actionable.
      }
      throw err;
    }
  }

  /**
   * Delete a page. Cascading delete removes all descendants (FK ON DELETE CASCADE).
   */
  async deletePage(pageId: string): Promise<void> {
    const result = await this._db.run('DELETE FROM pages WHERE id = ?', [pageId]);
    if (result.error) throw new Error(result.error.message);

    // Cancel any pending auto-save for this page
    this._cancelPendingSave(pageId);
    this._cancelRetry(pageId);

    this._onDidChangePage.fire({ kind: PageChangeKind.Deleted, pageId });
    this._knownRevisions.delete(pageId);
  }

  /**
   * Move a page to a new parent and/or position.
   *
   * @param pageId — page to move
   * @param newParentId — new parent (null = root level)
   * @param afterSiblingId — insert after this sibling (undefined = end)
   */
  async movePage(
    pageId: string,
    newParentId: string | null,
    afterSiblingId?: string,
  ): Promise<void> {
    // Get the target sibling list to calculate sort_order
    const siblings = newParentId === null
      ? await this.getRootPages()
      : await this.getChildren(newParentId);

    let newSortOrder: number;

    if (!afterSiblingId) {
      // Append at end
      const maxSort = siblings.length > 0
        ? Math.max(...siblings.map(s => s.sortOrder))
        : 0;
      newSortOrder = maxSort + 1;
    } else {
      // Insert after the specified sibling
      const afterIdx = siblings.findIndex(s => s.id === afterSiblingId);
      if (afterIdx === -1) {
        // Sibling not found — append at end
        newSortOrder = (siblings.length > 0 ? Math.max(...siblings.map(s => s.sortOrder)) : 0) + 1;
      } else if (afterIdx === siblings.length - 1) {
        // After the last item
        newSortOrder = siblings[afterIdx].sortOrder + 1;
      } else {
        // Between afterSibling and the next sibling
        newSortOrder = (siblings[afterIdx].sortOrder + siblings[afterIdx + 1].sortOrder) / 2;
      }
    }

    const result = await this._db.run(
      `UPDATE pages SET parent_id = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?`,
      [newParentId, newSortOrder, pageId],
    );
    if (result.error) throw new Error(result.error.message);

    const page = await this.getPage(pageId);
    this._onDidChangePage.fire({ kind: PageChangeKind.Moved, pageId, page: page ?? undefined });
  }

  /**
   * Reorder pages within a parent by assigning sequential sort_order values.
   *
   * @param parentId — parent page ID (null for root level)
   * @param orderedIds — page IDs in desired order
   */
  async reorderPages(_parentId: string | null, orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      const result = await this._db.run(
        `UPDATE pages SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`,
        [i + 1, orderedIds[i]],
      );
      if (result.error) throw new Error(result.error.message);
    }

    this._onDidChangePage.fire({
      kind: PageChangeKind.Reordered,
      pageId: orderedIds[0] ?? '',
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Auto-Save Debounce (Task 2.3)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Schedule a debounced content save for a page.
   * Multiple rapid calls for the same page coalesce into a single write.
   * Different pages have independent debounce timers.
   *
   * @param pageId — page to save
   * @param content — stringified Tiptap JSON content
   */
  scheduleContentSave(pageId: string, content: string): void {
    const normalized = normalizeCanvasContentForStorage(content);
    const expectedRevision = this._knownRevisions.get(pageId);

    // Cancel existing timer for this page
    this._cancelPendingSave(pageId);
    // New content supersedes any pending retry (newer content wins)
    this._cancelRetry(pageId);

    const timer = setTimeout(async () => {
      this._pendingSaves.delete(pageId);
      this._onDidChangeSaveState.fire({ pageId, kind: SaveStateKind.Flushing, source: 'debounce' });
      try {
        const page = await this.updatePage(pageId, {
          content: normalized.storedContent,
          contentSchemaVersion: normalized.schemaVersion,
          expectedRevision,
        });
        this._knownRevisions.set(pageId, page.revision);
        this._onDidSavePage.fire(pageId);
        this._onDidChangeSaveState.fire({ pageId, kind: SaveStateKind.Saved, source: 'debounce' });
      } catch (err) {
        console.error(`[CanvasDataService] Auto-save failed for page "${pageId}":`, err);
        if (err instanceof Error && err.message.includes('Revision conflict')) {
          // Revision conflicts need fresh revision — don't retry with stale data
          try {
            const latest = await this.getPage(pageId);
            if (latest) this._knownRevisions.set(pageId, latest.revision);
          } catch {
            // ignore refresh failure
          }
          this._onDidChangeSaveState.fire({
            pageId,
            kind: SaveStateKind.Failed,
            source: 'debounce',
            error: err instanceof Error ? err.message : String(err),
          });
        } else {
          // Non-revision-conflict failure — schedule retry with backoff
          this._scheduleRetry(pageId, normalized.storedContent, normalized.schemaVersion, 0);
        }
      }
    }, this._autoSaveMs);

    this._pendingSaves.set(pageId, { timer, content: normalized.storedContent, expectedRevision });
    this._onDidChangeSaveState.fire({ pageId, kind: SaveStateKind.Pending, source: 'debounce' });
  }

  /**
   * Force-save all pending auto-saves immediately.
   * Used before shutdown, workspace change, or tool deactivation.
   */
  async flushPendingSaves(): Promise<void> {
    const pending = [...this._pendingSaves.entries()];
    this._pendingSaves.clear();

    for (const [pageId, { timer, content, expectedRevision }] of pending) {
      clearTimeout(timer);
      this._onDidChangeSaveState.fire({ pageId, kind: SaveStateKind.Flushing, source: 'flush' });
      try {
        const normalized = normalizeCanvasContentForStorage(content);
        const page = await this.updatePage(pageId, {
          content: normalized.storedContent,
          contentSchemaVersion: normalized.schemaVersion,
          expectedRevision,
        });
        this._knownRevisions.set(pageId, page.revision);
        this._onDidSavePage.fire(pageId);
        this._onDidChangeSaveState.fire({ pageId, kind: SaveStateKind.Saved, source: 'flush' });
      } catch (err) {
        console.error(`[CanvasDataService] Flush failed for page "${pageId}":`, err);
        this._onDidChangeSaveState.fire({
          pageId,
          kind: SaveStateKind.Failed,
          source: 'flush',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Decode page content for editor usage and auto-heal malformed/legacy storage.
   * Returns a valid TipTap document object in all cases.
   */
  async decodePageContentForEditor(page: IPage): Promise<{ doc: any; recovered: boolean }> {
    const decoded = decodeCanvasContent(page.content);

    if (decoded.needsRepair) {
      console.warn(
        `[CanvasDataService] Content repair for page "${page.id}" (${decoded.reason ?? 'normalization'})`,
      );
      try {
        await this.updatePage(page.id, {
          content: decoded.repairedStoredContent,
          contentSchemaVersion: decoded.schemaVersion,
        });
        this._onDidChangeSaveState.fire({ pageId: page.id, kind: SaveStateKind.Saved, source: 'repair' });
      } catch (err) {
        console.error(`[CanvasDataService] Content repair write failed for page "${page.id}":`, err);
        this._onDidChangeSaveState.fire({
          pageId: page.id,
          kind: SaveStateKind.Failed,
          source: 'repair',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { doc: decoded.doc, recovered: decoded.needsRepair };
  }

  /**
   * Number of pages with pending (unsaved) content changes.
   */
  get pendingSaveCount(): number {
    return this._pendingSaves.size;
  }

  /**
   * Whether a specific page has a pending auto-save.
   */
  hasPendingSave(pageId: string): boolean {
    return this._pendingSaves.has(pageId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Favorites (Capability 10)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Toggle the favorite state of a page.
   */
  async toggleFavorite(pageId: string): Promise<IPage> {
    const page = await this.getPage(pageId);
    if (!page) throw new Error(`[CanvasDataService] Page "${pageId}" not found`);
    return this.updatePage(pageId, { isFavorited: !page.isFavorited });
  }

  /**
   * Get all favorited (non-archived) pages, ordered by title.
   */
  async getFavoritedPages(): Promise<IPage[]> {
    const result = await this._db.all(
      'SELECT * FROM pages WHERE is_favorited = 1 AND is_archived = 0 ORDER BY title',
    );
    if (result.error) throw new Error(result.error.message);
    return (result.rows ?? []).map(rowToPage);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Archive / Trash (Capability 10)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Soft-delete a page by setting is_archived = 1.
   */
  async archivePage(pageId: string): Promise<void> {
    const result = await this._db.run(
      `UPDATE pages SET is_archived = 1, updated_at = datetime('now') WHERE id = ?`,
      [pageId],
    );
    if (result.error) throw new Error(result.error.message);
    this._cancelPendingSave(pageId);
    this._cancelRetry(pageId);
    this._onDidChangePage.fire({ kind: PageChangeKind.Deleted, pageId });
  }

  /**
   * Restore an archived page.
   */
  async restorePage(pageId: string): Promise<IPage> {
    const result = await this._db.run(
      `UPDATE pages SET is_archived = 0, updated_at = datetime('now') WHERE id = ?`,
      [pageId],
    );
    if (result.error) throw new Error(result.error.message);
    const page = await this.getPage(pageId);
    if (!page) throw new Error(`[CanvasDataService] Page "${pageId}" not found after restore`);
    this._onDidChangePage.fire({ kind: PageChangeKind.Created, pageId, page });
    return page;
  }

  /**
   * Permanently delete a page (true delete, not soft).
   */
  async permanentlyDeletePage(pageId: string): Promise<void> {
    const result = await this._db.run('DELETE FROM pages WHERE id = ?', [pageId]);
    if (result.error) throw new Error(result.error.message);
    this._cancelPendingSave(pageId);
    this._cancelRetry(pageId);
    this._onDidChangePage.fire({ kind: PageChangeKind.Deleted, pageId });
  }

  /**
   * Get all archived pages, ordered by most recently deleted.
   */
  async getArchivedPages(): Promise<IPage[]> {
    const result = await this._db.all(
      'SELECT * FROM pages WHERE is_archived = 1 ORDER BY updated_at DESC',
    );
    if (result.error) throw new Error(result.error.message);
    return (result.rows ?? []).map(rowToPage);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Breadcrumb Ancestors (Capability 10)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Walk up the parent chain to build a breadcrumb list.
   * Returns ancestors from root → immediate parent (excludes the page itself).
   */
  async getAncestors(pageId: string): Promise<IPage[]> {
    const ancestors: IPage[] = [];
    let currentId: string | null = pageId;

    // Visited set prevents infinite loops from circular parentId chains
    const visited = new Set<string>();
    const MAX_DEPTH = 30;
    let depth = 0;

    while (currentId && depth < MAX_DEPTH) {
      if (visited.has(currentId)) break; // cycle detected
      visited.add(currentId);

      const page = await this.getPage(currentId);
      if (!page) break;
      if (currentId !== pageId) {
        ancestors.unshift(page); // prepend so order is root→parent
      }
      currentId = page.parentId;
      depth++;
    }

    return ancestors;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Page Duplication (Capability 10 — Task 10.4)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Deep-copy a page and all its descendants.
   * Returns the new root page. Child pages are recursively duplicated
   * with new IDs while maintaining parent-child relationships.
   */
  async duplicatePage(pageId: string): Promise<IPage> {
    const source = await this.getPage(pageId);
    if (!source) throw new Error(`[CanvasDataService] Page "${pageId}" not found for duplication`);

    // Calculate sort order: place after original among its siblings
    const siblings = source.parentId === null
      ? await this.getRootPages()
      : await this.getChildren(source.parentId);
    const maxSort = siblings.length > 0
      ? Math.max(...siblings.map(s => s.sortOrder))
      : 0;

    const rootCopy = await this._duplicateRecursive(source, source.parentId, maxSort + 1, true);
    return rootCopy;
  }

  private async _duplicateRecursive(
    source: IPage,
    newParentId: string | null,
    sortOrder: number,
    isRoot: boolean,
  ): Promise<IPage> {
    const newId = crypto.randomUUID();
    const title = isRoot ? `Copy of ${source.title}` : source.title;

    // Insert duplicated page (copy content, icon, cover, font, width, text — NOT favorite, locked)
    const result = await this._db.run(
      `INSERT INTO pages (id, parent_id, title, icon, content, content_schema_version, sort_order, cover_url, cover_y_offset, font_family, full_width, small_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        newParentId,
        title,
        source.icon,
        source.content,
        source.contentSchemaVersion,
        sortOrder,
        source.coverUrl,
        source.coverYOffset,
        source.fontFamily,
        source.fullWidth ? 1 : 0,
        source.smallText ? 1 : 0,
      ],
    );
    if (result.error) throw new Error(result.error.message);

    const newPage = await this.getPage(newId);
    if (!newPage) throw new Error(`[CanvasDataService] Duplicated page "${newId}" not found after insert`);

    this._onDidChangePage.fire({ kind: PageChangeKind.Created, pageId: newId, page: newPage });

    // Recursively duplicate children
    const children = await this.getChildren(source.id);
    for (let i = 0; i < children.length; i++) {
      await this._duplicateRecursive(children[i], newId, i + 1, false);
    }

    return newPage;
  }

  // ── Internal ──

  private _cancelPendingSave(pageId: string): void {
    const pending = this._pendingSaves.get(pageId);
    if (pending) {
      clearTimeout(pending.timer);
      this._pendingSaves.delete(pageId);
    }
  }

  /**
   * Cancel a pending retry for a page.
   */
  private _cancelRetry(pageId: string): void {
    const retry = this._retryQueue.get(pageId);
    if (retry) {
      clearTimeout(retry.timer);
      this._retryQueue.delete(pageId);
    }
  }

  /**
   * Schedule a retry for a failed auto-save with exponential backoff.
   * Delays: 1s, 2s, 4s. After MAX_RETRIES failures, fires SaveStateKind.Failed.
   */
  private _scheduleRetry(
    pageId: string,
    storedContent: string,
    schemaVersion: number,
    attempt: number,
  ): void {
    if (attempt >= CanvasDataService.MAX_RETRIES) {
      console.error(`[CanvasDataService] Auto-save retry exhausted for page "${pageId}" after ${attempt} attempts`);
      this._retryQueue.delete(pageId);
      this._onDidChangeSaveState.fire({
        pageId,
        kind: SaveStateKind.Failed,
        source: 'debounce',
        error: `Auto-save failed after ${attempt} retry attempts`,
      });
      return;
    }

    const delayMs = CanvasDataService.RETRY_BASE_MS * Math.pow(2, attempt);
    this._onDidChangeSaveState.fire({ pageId, kind: SaveStateKind.Retrying, source: 'debounce' });

    const timer = setTimeout(async () => {
      this._retryQueue.delete(pageId);
      this._onDidChangeSaveState.fire({ pageId, kind: SaveStateKind.Flushing, source: 'debounce' });
      try {
        // Re-fetch latest revision for the retry attempt
        const freshRevision = this._knownRevisions.get(pageId);
        const page = await this.updatePage(pageId, {
          content: storedContent,
          contentSchemaVersion: schemaVersion,
          expectedRevision: freshRevision,
        });
        this._knownRevisions.set(pageId, page.revision);
        this._onDidSavePage.fire(pageId);
        this._onDidChangeSaveState.fire({ pageId, kind: SaveStateKind.Saved, source: 'debounce' });
      } catch (retryErr) {
        console.error(`[CanvasDataService] Retry ${attempt + 1}/${CanvasDataService.MAX_RETRIES} failed for page "${pageId}":`, retryErr);
        if (retryErr instanceof Error && retryErr.message.includes('Revision conflict')) {
          // Revision conflict during retry — refresh revision and try again
          try {
            const latest = await this.getPage(pageId);
            if (latest) this._knownRevisions.set(pageId, latest.revision);
          } catch {
            // ignore
          }
        }
        this._scheduleRetry(pageId, storedContent, schemaVersion, attempt + 1);
      }
    }, delayMs);

    this._retryQueue.set(pageId, { timer, content: storedContent, retries: attempt, expectedRevision: this._knownRevisions.get(pageId) });
  }

  /**
   * Assemble a flat list of pages into a tree structure.
   */
  private _assembleTree(pages: IPage[]): IPageTreeNode[] {
    const nodeMap = new Map<string, IPageTreeNode>();
    const roots: IPageTreeNode[] = [];

    // Create mutable nodes
    for (const page of pages) {
      nodeMap.set(page.id, { ...page, children: [] });
    }

    // Link children to parents
    for (const page of pages) {
      const node = nodeMap.get(page.id)!;
      if (page.parentId === null) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(page.parentId);
        if (parent) {
          (parent.children as IPageTreeNode[]).push(node);
        } else {
          // Orphan — treat as root
          roots.push(node);
        }
      }
    }

    return roots;
  }

  override dispose(): void {
    // Cancel all pending debounce timers
    for (const { timer } of this._pendingSaves.values()) {
      clearTimeout(timer);
    }
    this._pendingSaves.clear();

    // Cancel all pending retry timers
    for (const { timer } of this._retryQueue.values()) {
      clearTimeout(timer);
    }
    this._retryQueue.clear();

    super.dispose();
  }
}
