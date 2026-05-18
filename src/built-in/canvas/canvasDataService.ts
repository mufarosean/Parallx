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
  type ICanvasDataService,
  type PageChangeEvent,
  type PageUpdateField,
  type PageMutationField,
  type PageUpdateData,
  type CrossPageMoveParams,
  type SaveStateEvent,
  PageChangeKind,
  SaveStateKind,
} from './canvasTypes.js';
import {
  CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
  decodeCanvasContent,
  encodeCanvasContentFromDoc,
  normalizeCanvasContentForStorage,
} from './contentSchema.js';

// SaveStateKind / SaveStateEvent moved to canvasTypes.ts (M77 Phase 11.1)
// so consumers can subscribe via ICanvasDataService without coupling to
// this concrete class. Re-exported for backwards compatibility with
// existing imports (main.ts, tests).
export { SaveStateKind } from './canvasTypes.js';
export type { SaveStateEvent } from './canvasTypes.js';

// ─── Database Bridge Type ────────────────────────────────────────────────────

interface DatabaseBridge {
  run(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; changes?: number; lastInsertRowid?: number }>;
  get(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; rows?: Record<string, unknown>[] }>;
  runTransaction(operations: { type: 'run' | 'get' | 'all'; sql: string; params?: unknown[] }[]): Promise<{ error: { code: string; message: string } | null; results?: unknown[] }>;
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
export class CanvasDataService extends Disposable implements ICanvasDataService {

  // ── Events ──

  private readonly _onDidChangePage = this._register(new Emitter<PageChangeEvent>());
  readonly onDidChangePage: Event<PageChangeEvent> = this._onDidChangePage.event;

  /** Fires after an auto-save flush completes for a specific page. */
  private readonly _onDidSavePage = this._register(new Emitter<string>());
  readonly onDidSavePage: Event<string> = this._onDidSavePage.event;

  /** Fires when save lifecycle state changes (pending/flushing/saved/failed). */
  private readonly _onDidChangeSaveState = this._register(new Emitter<SaveStateEvent>());
  readonly onDidChangeSaveState: Event<SaveStateEvent> = this._onDidChangeSaveState.event;

  /** Fires when an external consumer changed a page's content and open editors should reload. */
  private readonly _onRequestContentReload = this._register(new Emitter<string>());
  readonly onRequestContentReload: Event<string> = this._onRequestContentReload.event;

  fireContentReload(pageId: string): void {
    this._onRequestContentReload.fire(pageId);
  }

  /**
   * Notify the service that an external writer (e.g. AI chat tools writing
   * directly via raw SQL) mutated a page. Re-reads the page and fires
   * `onDidChangePage` so the sidebar / index / other listeners refresh.
   * For `kind === 'updated'` also signals open editors to reload content.
   */
  async notifyExternalPageMutation(pageId: string, kind: 'created' | 'updated' | 'deleted'): Promise<void> {
    if (kind === 'deleted') {
      this._onDidChangePage.fire({ kind: PageChangeKind.Deleted, pageId });
      return;
    }
    let page: IPage | null = null;
    try {
      page = await this.getPage(pageId);
    } catch (err) {
      console.warn('[CanvasDataService] notifyExternalPageMutation: getPage failed for', pageId, err);
    }
    if (!page) return;
    this._onDidChangePage.fire({
      kind: kind === 'created' ? PageChangeKind.Created : PageChangeKind.Updated,
      pageId,
      page,
    });
    if (kind === 'updated') {
      this._onRequestContentReload.fire(pageId);
    }
  }

  // ── Auto-save debounce state ──

  /** Per-page debounce timers for content auto-save.
   * `schemaVersion` is captured alongside the content so the coalesce-by-equality
   * check (scheduleContentSave) doesn't drop a schedule that differs only in
   * schema version (M77 Phase 9.3). */
  private readonly _pendingSaves = new Map<string, { timer: ReturnType<typeof setTimeout>; content: string; schemaVersion: number; expectedRevision?: number }>();

  /** Per-page retry state for failed auto-saves (exponential backoff). */
  private readonly _retryQueue = new Map<string, { timer: ReturnType<typeof setTimeout>; content: string; retries: number; expectedRevision?: number }>();

  /** Max retry attempts before giving up. */
  private static readonly MAX_RETRIES = 3;
  /** Base delay for retry backoff in ms (doubles each retry: 1s, 2s, 4s). */
  private static readonly RETRY_BASE_MS = 1000;

  /** Last known committed revision per page. */
  private readonly _knownRevisions = new Map<string, number>();

  /** Last known committed stored content per page. */
  private readonly _knownStoredContent = new Map<string, string>();

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

  private _rememberPageState(page: IPage): IPage {
    this._knownRevisions.set(page.id, page.revision);
    this._knownStoredContent.set(page.id, page.content);
    return page;
  }

  private _getChangedFields(updates: PageUpdateData): PageUpdateField[] {
    const changedFields: PageUpdateField[] = [];

    if (updates.title !== undefined) changedFields.push('title');
    if (updates.icon !== undefined) changedFields.push('icon');
    if (updates.content !== undefined) changedFields.push('content', 'contentSchemaVersion');
    if (updates.contentSchemaVersion !== undefined && updates.content === undefined) changedFields.push('contentSchemaVersion');
    if (updates.coverUrl !== undefined) changedFields.push('coverUrl');
    if (updates.coverYOffset !== undefined) changedFields.push('coverYOffset');
    if (updates.fontFamily !== undefined) changedFields.push('fontFamily');
    if (updates.fullWidth !== undefined) changedFields.push('fullWidth');
    if (updates.smallText !== undefined) changedFields.push('smallText');
    if (updates.isLocked !== undefined) changedFields.push('isLocked');
    if (updates.isFavorited !== undefined) changedFields.push('isFavorited');

    return changedFields;
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
      this._rememberPageState(page);
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
   * @deprecated No-op. parentId is the single source of truth for hierarchy;
   * pageBlock content is a visual subsystem that follows parentId, not the
   * other way around. Retained for API compatibility.
   */
  async reconcileEmbeddedHierarchyForAllPages(): Promise<void> {
    // Intentionally empty — hierarchy is driven by parentId, not content.
  }

  /**
   * Update a page's mutable fields (title, icon, content).
   * Sets updated_at to the current timestamp.
   */
  async updatePage(
    pageId: string,
    updates: PageUpdateData,
  ): Promise<IPage> {
    const changedFields = this._getChangedFields(updates);
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

    this._rememberPageState(page);
    this._onDidChangePage.fire({ kind: PageChangeKind.Updated, pageId, page, changedFields });

    // ── Reconcile denormalized pageBlock attrs ─────────────────────────────
    // Title/icon are cached in every parent's stored content as pageBlock
    // attrs.  Propagate the change so on-disk content does not drift, even
    // when the parent editor is closed.
    if (changedFields.includes('title') || changedFields.includes('icon')) {
      void this._updateLinkedBlocksForPageId(pageId, {
        title: page.title,
        icon: page.icon,
      }).catch(err => {
        console.warn(`[CanvasDataService] Failed to reconcile pageBlock attrs for "${pageId}":`, err);
      });
    }

    return page;
  }

  /**
   * Encode a raw TipTap doc JSON via the content schema and immediately
   * persist it for the given page, cancelling any pending debounced save.
   *
   * This is the single entry point for "encode-and-save" — consumers
   * never import contentSchema directly.
   */
  async flushContentSave(pageId: string, docJson: any): Promise<void> {
    // Cancel any stale pending/retry saves — this content supersedes them.
    this._cancelPendingSave(pageId);
    this._cancelRetry(pageId);

    const encoded = encodeCanvasContentFromDoc(docJson);
    const expectedRevision = this._knownRevisions.get(pageId);

    this._onDidChangeSaveState.fire({ pageId, kind: SaveStateKind.Flushing, source: 'flush' });
    try {
      const page = await this.updatePage(pageId, {
        content: encoded.storedContent,
        contentSchemaVersion: encoded.schemaVersion,
        expectedRevision,
      });
      this._knownRevisions.set(pageId, page.revision);
      this._onDidSavePage.fire(pageId);
      this._onDidChangeSaveState.fire({ pageId, kind: SaveStateKind.Saved, source: 'flush' });
    } catch (err) {
      this._onDidChangeSaveState.fire({
        pageId,
        kind: SaveStateKind.Failed,
        source: 'flush',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
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
   * Idempotently ensure `parentPageId`'s stored content contains a pageBlock
   * card for `childPageId`.  Called by sidebar code paths that move pages
   * between parents \u2014 the parent's editor may be closed, so we mutate
   * persisted content directly.
   */
  async ensurePageBlockOnParent(parentPageId: string, childPageId: string): Promise<void> {
    // M77 Phase 6 — retry on revision conflict. Legacy API kept for
    // external callers; internal sidebar/editor flows use the atomic
    // movePageWithBlocks / createChildPageWithBlock helpers.
    await this._retryOnRevisionConflict(async () => {
      const [parent, child] = await Promise.all([
        this.getPage(parentPageId),
        this.getPage(childPageId),
      ]);
      if (!parent) throw new Error(`[CanvasDataService] Parent page "${parentPageId}" not found`);
      if (!child) throw new Error(`[CanvasDataService] Child page "${childPageId}" not found`);
      await this._ensureLinkedBlockOnParent(parent, child);
    }, 'ensurePageBlockOnParent');
  }

  /**
   * Recursively remove every pageBlock referencing `childPageId` from
   * `parentPageId`'s stored content.  Walks the full doc tree (columns,
   * callouts, details, etc.) so embedded cards never get stranded.
   */
  async removePageBlockFromParent(parentPageId: string, childPageId: string): Promise<void> {
    // M77 Phase 6 — retry on revision conflict. If the parent is being
    // auto-saved while we're computing the pruned content, our flush
    // hits a revision conflict; re-read and re-prune from the new
    // revision instead of failing the operation.
    await this._retryOnRevisionConflict(async () => {
      const parent = await this.getPage(parentPageId);
      if (!parent) return;

      const decoded = decodeCanvasContent(parent.content);
      const pruned = this._pruneLinkedBlocks(decoded.doc, childPageId);
      if (!pruned.changed) return;

      await this.flushContentSave(parentPageId, pruned.node);
      this._onRequestContentReload.fire(parentPageId);
    }, 'removePageBlockFromParent');
  }

  /**
   * Atomically move blocks across pages by persisting source and target updates
   * in a single database transaction via a single IPC round-trip.
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

    // ── Phase 1: Pre-read pages (parallel IPC) ──
    const [sourceRowResult, targetRowResult] = await Promise.all([
      this._db.get('SELECT * FROM pages WHERE id = ?', [sourcePageId]),
      this._db.get('SELECT * FROM pages WHERE id = ?', [targetPageId]),
    ]);

    if (sourceRowResult.error) throw new Error(sourceRowResult.error.message);
    if (!sourceRowResult.row) throw new Error(`[CanvasDataService] Source page "${sourcePageId}" not found`);
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

    // ── Phase 2: Compute content in renderer ──
    const sourceEncoded = encodeCanvasContentFromDoc(sourceDoc);
    const decodedTarget = decodeCanvasContent(targetPageBefore.content);
    const targetContent = Array.isArray(decodedTarget.doc?.content) ? decodedTarget.doc.content : [];
    const mergedTargetDoc = {
      type: 'doc',
      content: [...targetContent, ...appendedNodes],
    };
    const targetEncoded = encodeCanvasContentFromDoc(mergedTargetDoc);

    // ── Phase 3: Bundled transaction (single IPC round-trip) ──
    // Operations: UPDATE source, UPDATE target, SELECT source (after), SELECT target (after)
    const txnResult = await this._db.runTransaction([
      {
        type: 'run',
        sql: `UPDATE pages
              SET content = ?, content_schema_version = ?, revision = revision + 1, updated_at = datetime('now')
              WHERE id = ? AND revision = ?`,
        params: [sourceEncoded.storedContent, sourceEncoded.schemaVersion, sourcePageId, sourcePageBefore.revision],
      },
      {
        type: 'run',
        sql: `UPDATE pages
              SET content = ?, content_schema_version = ?, revision = revision + 1, updated_at = datetime('now')
              WHERE id = ? AND revision = ?`,
        params: [targetEncoded.storedContent, targetEncoded.schemaVersion, targetPageId, targetPageBefore.revision],
      },
      { type: 'get', sql: 'SELECT * FROM pages WHERE id = ?', params: [sourcePageId] },
      { type: 'get', sql: 'SELECT * FROM pages WHERE id = ?', params: [targetPageId] },
    ]);

    if (txnResult.error) {
      throw new Error(`[CanvasDataService] Transaction failed: ${txnResult.error.message}`);
    }

    const results = txnResult.results!;
    const updateSourceRes = results[0] as { changes: number };
    const updateTargetRes = results[1] as { changes: number };
    const sourceAfterRow = (results[2] as { row: Record<string, unknown> | null }).row;
    const targetAfterRow = (results[3] as { row: Record<string, unknown> | null }).row;

    if ((updateSourceRes.changes ?? 0) === 0) {
      throw new Error(`[CanvasDataService] Revision conflict while updating source page "${sourcePageId}"`);
    }
    if ((updateTargetRes.changes ?? 0) === 0) {
      throw new Error(`[CanvasDataService] Revision conflict while updating target page "${targetPageId}"`);
    }
    if (!sourceAfterRow) throw new Error(`[CanvasDataService] Source page "${sourcePageId}" missing after move`);
    if (!targetAfterRow) throw new Error(`[CanvasDataService] Target page "${targetPageId}" missing after move`);

    const sourcePage = rowToPage(sourceAfterRow);
    const targetPage = rowToPage(targetAfterRow);

    this._knownRevisions.set(sourcePageId, sourcePage.revision);
    this._knownRevisions.set(targetPageId, targetPage.revision);

    this._onDidChangePage.fire({
      kind: PageChangeKind.Updated,
      pageId: sourcePageId,
      page: sourcePage,
      changedFields: ['content', 'contentSchemaVersion'],
    });
    this._onDidChangePage.fire({
      kind: PageChangeKind.Updated,
      pageId: targetPageId,
      page: targetPage,
      changedFields: ['content', 'contentSchemaVersion'],
    });

    return { sourcePage, targetPage };
  }

  /**
   * Delete a page. Cascading delete removes all descendants (FK ON DELETE CASCADE).
   */
  async deletePage(pageId: string): Promise<void> {
    const deletedIds = await this._getPageSubtreeIds(pageId);

    // Cancel any pending/retry saves for the entire subtree BEFORE delete,
    // so debounced timers can't fire against rows that are about to vanish.
    for (const id of deletedIds.length > 0 ? deletedIds : [pageId]) {
      this._cancelPendingSave(id);
      this._cancelRetry(id);
    }

    const result = await this._db.run('DELETE FROM pages WHERE id = ?', [pageId]);
    if (result.error) throw new Error(result.error.message);

    for (const deletedId of deletedIds) {
      await this._removeLinkedBlocksForPageId(deletedId);
      this._knownRevisions.delete(deletedId);
      this._knownStoredContent.delete(deletedId);
      if (deletedId !== pageId) {
        this._onDidChangePage.fire({ kind: PageChangeKind.Deleted, pageId: deletedId });
      }
    }

    this._onDidChangePage.fire({ kind: PageChangeKind.Deleted, pageId });
    this._knownRevisions.delete(pageId);
    this._knownStoredContent.delete(pageId);
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
    // ── Cycle prevention ────────────────────────────────────────────────────
    // Reject moves where the target parent is the page itself or any of its
    // descendants.  Without this guard, a cycle would (a) hide both pages
    // from the assembled tree (neither reaches a null-parent root) and (b)
    // make subtree traversal vulnerable to non-termination.
    if (newParentId !== null) {
      if (newParentId === pageId) {
        throw new Error(`[CanvasDataService] Cannot move page "${pageId}" into itself`);
      }
      const subtreeIds = new Set(await this._getPageSubtreeIds(pageId));
      if (subtreeIds.has(newParentId)) {
        throw new Error(`[CanvasDataService] Cannot move page "${pageId}" into its own descendant "${newParentId}"`);
      }
    }

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
   * Atomic move that keeps the embedded pageBlock cards in sync with the
   * hierarchy in a single transaction (M77 Phase 1).
   *
   * The legacy combination of `movePage` + `removePageBlockFromParent` +
   * `ensurePageBlockOnParent` was three separate transactions with no
   * cross-cutting guarantee, so any partial failure left one parent's
   * content out of sync with the DB hierarchy — the "page blocks
   * disappear" bug. This method bundles the page row update and both
   * parent content updates into one `runTransaction` call so either every
   * write lands or none of them do.
   *
   * Behaviour:
   *   - Computes the new sort_order using the same logic as `movePage`.
   *   - Reads both affected parents (with revision checks) before the
   *     transaction so we know the content base state.
   *   - In the transaction: page row UPDATE, old parent content UPDATE
   *     (block removed), new parent content UPDATE (block appended).
   *   - Fires `Moved` for the page + `Updated` for both parents +
   *     `onRequestContentReload` for both parents so open editors refresh.
   *
   * Reorder-within-same-parent: the old/new parent are the same, so we
   * skip the content rewrites entirely (the page block doesn't need to
   * move within the parent for a sort_order change).
   */
  async movePageWithBlocks(opts: {
    pageId: string;
    newParentId: string | null;
    afterSiblingId?: string;
  }): Promise<void> {
    // M77 Phase 6 — retry on transient revision conflicts. A revision
    // conflict means another writer committed between our read and our
    // transaction; the right response is to re-read and try again.
    // Cap at 3 attempts so a genuinely-stuck contention doesn't loop
    // forever — pathological contention will surface as a thrown error
    // the sidebar's _surfaceError handler reports.
    return this._retryOnRevisionConflict(
      () => this._movePageWithBlocksOnce(opts),
      'movePageWithBlocks',
    );
  }

  private async _movePageWithBlocksOnce(opts: {
    pageId: string;
    newParentId: string | null;
    afterSiblingId?: string;
  }): Promise<void> {
    const { pageId, newParentId, afterSiblingId } = opts;

    // Cycle prevention (same as movePage).
    if (newParentId !== null) {
      if (newParentId === pageId) {
        throw new Error(`[CanvasDataService] Cannot move page "${pageId}" into itself`);
      }
      const subtreeIds = new Set(await this._getPageSubtreeIds(pageId));
      if (subtreeIds.has(newParentId)) {
        throw new Error(`[CanvasDataService] Cannot move page "${pageId}" into its own descendant "${newParentId}"`);
      }
    }

    // Snapshot the moved page so we know its old parent id BEFORE the
    // transaction. We can't trust the caller's `oldParentId` because the
    // sidebar tree may be stale.
    const pageBefore = await this.getPage(pageId);
    if (!pageBefore) throw new Error(`[CanvasDataService] Page "${pageId}" not found`);
    const oldParentId = pageBefore.parentId ?? null;

    // Compute new sort_order using sibling list (same logic as movePage).
    const siblings = newParentId === null
      ? await this.getRootPages()
      : await this.getChildren(newParentId);
    let newSortOrder: number;
    if (!afterSiblingId) {
      const maxSort = siblings.length > 0 ? Math.max(...siblings.map(s => s.sortOrder)) : 0;
      newSortOrder = maxSort + 1;
    } else {
      const afterIdx = siblings.findIndex(s => s.id === afterSiblingId);
      if (afterIdx === -1) {
        newSortOrder = (siblings.length > 0 ? Math.max(...siblings.map(s => s.sortOrder)) : 0) + 1;
      } else if (afterIdx === siblings.length - 1) {
        newSortOrder = siblings[afterIdx].sortOrder + 1;
      } else {
        newSortOrder = (siblings[afterIdx].sortOrder + siblings[afterIdx + 1].sortOrder) / 2;
      }
    }

    // Reorder-only (same parent): defer to the simpler movePage path and
    // skip content rewrites entirely.
    if (oldParentId === newParentId) {
      const result = await this._db.run(
        `UPDATE pages SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`,
        [newSortOrder, pageId],
      );
      if (result.error) throw new Error(result.error.message);
      const refreshed = await this.getPage(pageId);
      this._onDidChangePage.fire({ kind: PageChangeKind.Moved, pageId, page: refreshed ?? undefined });
      return;
    }

    // Cancel pending saves on both parents (and the moved page) so we
    // don't race with a debounced auto-save that would clobber our
    // content update.
    if (oldParentId) this._cancelPendingSave(oldParentId);
    if (newParentId) this._cancelPendingSave(newParentId);
    this._cancelPendingSave(pageId);

    // Read both parents in parallel with their current revisions. Either
    // can be null (root-level moves).
    const [oldParent, newParent] = await Promise.all([
      oldParentId ? this.getPage(oldParentId) : Promise.resolve(null),
      newParentId ? this.getPage(newParentId) : Promise.resolve(null),
    ]);

    // Compute content for old parent (block removed) and new parent
    // (block appended). Both branches gate on whether anything actually
    // changes so we don't issue redundant updates.
    let oldParentUpdate: { storedContent: string; schemaVersion: number; revision: number } | null = null;
    if (oldParent && oldParentId) {
      const decoded = decodeCanvasContent(oldParent.content);
      const pruned = this._pruneLinkedBlocks(decoded.doc, pageId);
      if (pruned.changed) {
        const encoded = encodeCanvasContentFromDoc(pruned.node);
        oldParentUpdate = {
          storedContent: encoded.storedContent,
          schemaVersion: encoded.schemaVersion,
          revision: oldParent.revision,
        };
      }
    }

    let newParentUpdate: { storedContent: string; schemaVersion: number; revision: number } | null = null;
    if (newParent && newParentId) {
      const decoded = decodeCanvasContent(newParent.content);
      if (!this._docContainsPageBlock(decoded.doc, pageId)) {
        const content = Array.isArray(decoded.doc?.content) ? decoded.doc.content : [];
        const nextDoc = {
          type: 'doc',
          content: [
            ...content,
            {
              type: 'pageBlock',
              attrs: { pageId, title: pageBefore.title, icon: pageBefore.icon },
            },
          ],
        };
        const encoded = encodeCanvasContentFromDoc(nextDoc);
        newParentUpdate = {
          storedContent: encoded.storedContent,
          schemaVersion: encoded.schemaVersion,
          revision: newParent.revision,
        };
      }
    }

    // Build the transaction: page row update, then any parent content
    // updates. Each parent update has a revision check so a concurrent
    // save during our read-compute window will surface as 0 changes
    // and abort the transaction.
    const ops: { type: 'run'; sql: string; params?: unknown[] }[] = [
      {
        type: 'run',
        sql: `UPDATE pages SET parent_id = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?`,
        params: [newParentId, newSortOrder, pageId],
      },
    ];
    if (oldParentUpdate && oldParentId) {
      ops.push({
        type: 'run',
        sql: `UPDATE pages
                SET content = ?, content_schema_version = ?, revision = revision + 1, updated_at = datetime('now')
              WHERE id = ? AND revision = ?`,
        params: [oldParentUpdate.storedContent, oldParentUpdate.schemaVersion, oldParentId, oldParentUpdate.revision],
      });
    }
    if (newParentUpdate && newParentId) {
      ops.push({
        type: 'run',
        sql: `UPDATE pages
                SET content = ?, content_schema_version = ?, revision = revision + 1, updated_at = datetime('now')
              WHERE id = ? AND revision = ?`,
        params: [newParentUpdate.storedContent, newParentUpdate.schemaVersion, newParentId, newParentUpdate.revision],
      });
    }

    const txn = await this._db.runTransaction(ops);
    if (txn.error) {
      throw new Error(`[CanvasDataService] movePageWithBlocks transaction failed: ${txn.error.message}`);
    }

    // Verify the parent updates landed (revision conflict shows as 0
    // changes). The page row update doesn't have a revision check so
    // it's checked separately.
    const results = txn.results ?? [];
    let resultIndex = 0;
    const pageUpdateRes = results[resultIndex++] as { changes: number };
    if ((pageUpdateRes?.changes ?? 0) === 0) {
      throw new Error(`[CanvasDataService] movePageWithBlocks: page "${pageId}" row update affected 0 rows`);
    }
    if (oldParentUpdate) {
      const r = results[resultIndex++] as { changes: number };
      if ((r?.changes ?? 0) === 0) {
        throw new Error(`[CanvasDataService] movePageWithBlocks: revision conflict on old parent "${oldParentId}"`);
      }
    }
    if (newParentUpdate) {
      const r = results[resultIndex++] as { changes: number };
      if ((r?.changes ?? 0) === 0) {
        throw new Error(`[CanvasDataService] movePageWithBlocks: revision conflict on new parent "${newParentId}"`);
      }
    }

    // Update known revisions and fire all events. Fire AFTER the
    // transaction succeeds so listeners never see a half-applied state.
    if (oldParentUpdate) this._knownRevisions.set(oldParentId!, oldParentUpdate.revision + 1);
    if (newParentUpdate) this._knownRevisions.set(newParentId!, newParentUpdate.revision + 1);

    const movedPage = await this.getPage(pageId);
    this._onDidChangePage.fire({
      kind: PageChangeKind.Moved,
      pageId,
      page: movedPage ?? undefined,
    });
    if (oldParentUpdate && oldParentId) {
      const refreshed = await this.getPage(oldParentId);
      if (refreshed) {
        this._onDidChangePage.fire({
          kind: PageChangeKind.Updated,
          pageId: oldParentId,
          page: refreshed,
          changedFields: ['content', 'contentSchemaVersion'],
        });
        this._onRequestContentReload.fire(oldParentId);
      }
    }
    if (newParentUpdate && newParentId) {
      const refreshed = await this.getPage(newParentId);
      if (refreshed) {
        this._onDidChangePage.fire({
          kind: PageChangeKind.Updated,
          pageId: newParentId,
          page: refreshed,
          changedFields: ['content', 'contentSchemaVersion'],
        });
        this._onRequestContentReload.fire(newParentId);
      }
    }
  }

  /**
   * Atomic page creation with optional parent page block (M77 Phase 1).
   *
   * Replaces the unsafe combination of `createPage` + `ensurePageBlockOnParent`
   * in the sidebar's create flow. The page INSERT and the parent's
   * content UPDATE go in a single transaction so a failure on either
   * side rolls back cleanly — no orphan pages, no parent saying it has
   * a child it doesn't.
   *
   * Behaviour matches `createPage` (UUID, sort_order = max + 1, initial
   * paragraph) plus appends a pageBlock attribute to the parent's
   * content if `parentId` is non-null.
   */
  async createChildPageWithBlock(opts: {
    parentId: string | null;
    title?: string;
  }): Promise<IPage> {
    // M77 Phase 6 — retry on revision conflict so a burst of auto-saves
    // on the parent can't make page creation fail spuriously. Mints a
    // fresh UUID inside each attempt so a partially-applied attempt
    // (which can't actually happen with runTransaction, but defensive)
    // never leaks an id.
    return this._retryOnRevisionConflict(
      () => this._createChildPageWithBlockOnce(opts),
      'createChildPageWithBlock',
    );
  }

  private async _createChildPageWithBlockOnce(opts: {
    parentId: string | null;
    title?: string;
  }): Promise<IPage> {
    const { parentId, title } = opts;
    const id = crypto.randomUUID();
    const pageTitle = title || 'Untitled';

    // Sort order — same as createPage.
    const maxResult = await this._db.get(
      parentId === null
        ? 'SELECT MAX(sort_order) as max_sort FROM pages WHERE parent_id IS NULL'
        : 'SELECT MAX(sort_order) as max_sort FROM pages WHERE parent_id = ?',
      parentId === null ? [] : [parentId],
    );
    if (maxResult.error) throw new Error(maxResult.error.message);
    const sortOrder = ((maxResult.row?.max_sort as number) ?? 0) + 1;

    const initialContent = encodeCanvasContentFromDoc({ type: 'doc', content: [{ type: 'paragraph' }] });

    // Read parent (if any) so we can compute the updated content with
    // the new page block appended. Cancel its pending save so a
    // debounced auto-save can't race with our update.
    let parentUpdate: { storedContent: string; schemaVersion: number; revision: number } | null = null;
    if (parentId !== null) {
      this._cancelPendingSave(parentId);
      const parent = await this.getPage(parentId);
      if (!parent) {
        throw new Error(`[CanvasDataService] Parent page "${parentId}" not found`);
      }
      const decoded = decodeCanvasContent(parent.content);
      if (!this._docContainsPageBlock(decoded.doc, id)) {
        const content = Array.isArray(decoded.doc?.content) ? decoded.doc.content : [];
        const nextDoc = {
          type: 'doc',
          content: [
            ...content,
            { type: 'pageBlock', attrs: { pageId: id, title: pageTitle, icon: null } },
          ],
        };
        const encoded = encodeCanvasContentFromDoc(nextDoc);
        parentUpdate = {
          storedContent: encoded.storedContent,
          schemaVersion: encoded.schemaVersion,
          revision: parent.revision,
        };
      }
    }

    const ops: { type: 'run'; sql: string; params?: unknown[] }[] = [
      {
        type: 'run',
        sql: `INSERT INTO pages (id, parent_id, title, content, content_schema_version, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
        params: [id, parentId, pageTitle, initialContent.storedContent, initialContent.schemaVersion, sortOrder],
      },
    ];
    if (parentUpdate && parentId !== null) {
      ops.push({
        type: 'run',
        sql: `UPDATE pages
                SET content = ?, content_schema_version = ?, revision = revision + 1, updated_at = datetime('now')
              WHERE id = ? AND revision = ?`,
        params: [parentUpdate.storedContent, parentUpdate.schemaVersion, parentId, parentUpdate.revision],
      });
    }

    const txn = await this._db.runTransaction(ops);
    if (txn.error) {
      throw new Error(`[CanvasDataService] createChildPageWithBlock transaction failed: ${txn.error.message}`);
    }
    const results = txn.results ?? [];
    if (parentUpdate) {
      const r = results[1] as { changes: number };
      if ((r?.changes ?? 0) === 0) {
        throw new Error(`[CanvasDataService] createChildPageWithBlock: revision conflict on parent "${parentId}"`);
      }
      this._knownRevisions.set(parentId!, parentUpdate.revision + 1);
    }

    const page = await this.getPage(id);
    if (!page) {
      throw new Error(`[CanvasDataService] Created page "${id}" not found after insert`);
    }

    this._onDidChangePage.fire({ kind: PageChangeKind.Created, pageId: id, page });
    if (parentUpdate && parentId !== null) {
      const refreshed = await this.getPage(parentId);
      if (refreshed) {
        this._onDidChangePage.fire({
          kind: PageChangeKind.Updated,
          pageId: parentId,
          page: refreshed,
          changedFields: ['content', 'contentSchemaVersion'],
        });
        this._onRequestContentReload.fire(parentId);
      }
    }
    return page;
  }

  /**
   * Repair drift between DB parent_id and embedded pageBlock nodes in a
   * parent's content (M77 Phase 1).
   *
   * Walks the page's content looking for pageBlock nodes; for each, checks
   * the referenced child page exists AND has this page as its parent. If
   * the reference is broken (child deleted, child moved away, etc.) the
   * pageBlock is removed. Returns the number of removed orphan blocks so
   * callers can log/surface repair activity.
   *
   * NOTE: We deliberately do NOT auto-add pageBlock for every direct child.
   * A page can legitimately have children without an embedded block (the
   * sidebar shows the children regardless). We only remove orphans —
   * blocks pointing at pages that aren't actually our children.
   */
  async reconcileParentBlockState(parentPageId: string): Promise<number> {
    const parent = await this.getPage(parentPageId);
    if (!parent) return 0;

    const decoded = decodeCanvasContent(parent.content);
    const orphanIds = await this._findOrphanPageBlocks(decoded.doc, parentPageId);
    if (orphanIds.length === 0) return 0;

    let nextDoc: any = decoded.doc;
    for (const orphanId of orphanIds) {
      const pruned = this._pruneLinkedBlocks(nextDoc, orphanId);
      if (pruned.changed) nextDoc = pruned.node;
    }

    await this.flushContentSave(parentPageId, nextDoc);
    // Deliberately NOT firing onRequestContentReload here — the caller
    // (typically _loadContent at editor load time) is about to read the
    // updated page itself. Firing reload would re-enter the load path.
    // Callers that want the reload event can fire it themselves via
    // fireContentReload(parentPageId).
    return orphanIds.length;
  }

  /**
   * Recursively collect pageIds of pageBlock nodes whose referenced page
   * either doesn't exist or no longer has `parentPageId` as its parent.
   */
  private async _findOrphanPageBlocks(node: any, parentPageId: string): Promise<string[]> {
    const referencedIds = new Set<string>();
    this._collectPageBlockIds(node, referencedIds);
    if (referencedIds.size === 0) return [];

    const orphans: string[] = [];
    for (const childId of referencedIds) {
      const child = await this.getPage(childId);
      if (!child || (child.parentId ?? null) !== parentPageId) {
        orphans.push(childId);
      }
    }
    return orphans;
  }

  private _collectPageBlockIds(node: any, into: Set<string>): void {
    if (!node || typeof node !== 'object') return;
    const t = typeof node.type === 'string' ? node.type : '';
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (t === 'pageBlock' && typeof attrs?.pageId === 'string') {
      into.add(attrs.pageId as string);
    }
    const content = Array.isArray(node.content) ? node.content : null;
    if (content) for (const c of content) this._collectPageBlockIds(c, into);
  }

  /**
   * Reorder pages within a parent by assigning sequential sort_order values.
   *
   * @param parentId — parent page ID (null for root level)
   * @param orderedIds — page IDs in desired order
   */
  async reorderPages(_parentId: string | null, orderedIds: string[]): Promise<void> {
    // Cancel pending content saves for all affected pages (belt-and-suspenders:
    // reorder only writes sort_order, not content, but cancelling avoids any
    // updated_at timestamp conflicts with a concurrent content save).
    for (const id of orderedIds) {
      this._cancelPendingSave(id);
    }

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
    const knownContent = this._knownStoredContent.get(pageId);
    const pendingSave = this._pendingSaves.get(pageId);
    const retrySave = this._retryQueue.get(pageId);

    // M77 Phase 9.3 — equality must compare BOTH stored content and schema
    // version. Content equal but schemaVersion changed = the schema-migrate
    // hot-path; coalescing it away would silently drop the version bump.
    if (
      pendingSave?.content === normalized.storedContent &&
      pendingSave.schemaVersion === normalized.schemaVersion
    ) {
      return;
    }

    if (retrySave?.content === normalized.storedContent) {
      return;
    }

    if (!pendingSave && !retrySave && knownContent === normalized.storedContent) {
      return;
    }

    // Cancel existing timer for this page
    this._cancelPendingSave(pageId);
    // New content supersedes any pending retry (newer content wins)
    this._cancelRetry(pageId);

    const timer = setTimeout(async () => {
      this._pendingSaves.delete(pageId);
      // M77 Phase 9.1 — capture `expectedRevision` at FIRE TIME, not at
      // schedule time. Between schedule and fire (up to `_autoSaveMs`),
      // another writer (title/icon reconciler, AI page tool, etc.) may
      // have bumped the revision; using the stale capture forces a
      // spurious revision-conflict error. Reading from `_knownRevisions`
      // here picks up the latest committed revision the service knows
      // about.
      const expectedRevision = this._knownRevisions.get(pageId);
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

    this._pendingSaves.set(pageId, {
      timer,
      content: normalized.storedContent,
      schemaVersion: normalized.schemaVersion,
      expectedRevision: this._knownRevisions.get(pageId),
    });
    this._onDidChangeSaveState.fire({ pageId, kind: SaveStateKind.Pending, source: 'debounce' });
  }

  /**
   * Force-save all pending auto-saves immediately.
   * Used before shutdown, workspace change, or tool deactivation.
   */
  async flushPendingSaves(): Promise<void> {
    const pending = [...this._pendingSaves.entries()];
    this._pendingSaves.clear();

    for (const [pageId, { timer, content }] of pending) {
      clearTimeout(timer);
      // M77 Phase 9.1 — refresh expectedRevision at flush time instead of
      // trusting the value captured at schedule time. The pending entry's
      // captured revision could be stale by the time flush runs.
      const expectedRevision = this._knownRevisions.get(pageId);
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
   * Get the most-recently-updated non-archived pages. M77 Phase 11.3 —
   * powers the sidebar Recents section. Defaults to 5 entries; sidebar
   * tunes the limit.
   */
  async getRecentPages(limit: number = 5): Promise<IPage[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const result = await this._db.all(
      'SELECT * FROM pages WHERE is_archived = 0 ORDER BY updated_at DESC LIMIT ?',
      [safeLimit],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.rows ?? []).map(rowToPage);
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
    const archivedIds = await this._archivePageSubtree(pageId);
    for (const archivedId of archivedIds) {
      await this._removeLinkedBlocksForPageId(archivedId);
    }
  }

  /**
   * Restore an archived page and its entire subtree.
   *
   * Symmetric to `archivePage` — flips `is_archived = 0` for every descendant
   * and re-attaches a `pageBlock` card to each restored child's parent doc
   * (idempotently — skipped if the parent is itself archived or already
   * contains a card for the child).
   */
  async restorePage(pageId: string): Promise<IPage> {
    const subtreeIds = await this._getPageSubtreeIds(pageId);
    if (subtreeIds.length === 0) {
      throw new Error(`[CanvasDataService] Page "${pageId}" not found for restore`);
    }

    const restoreResult = await this._db.run(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM pages WHERE id = ?
         UNION ALL
         SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id
       )
       UPDATE pages
       SET is_archived = 0,
           updated_at = datetime('now')
       WHERE id IN (SELECT id FROM subtree)`,
      [pageId],
    );
    if (restoreResult.error) throw new Error(restoreResult.error.message);

    // M77 Phase 9.2 — fetch the entire restored subtree + every parent we
    // might re-attach a pageBlock card to in TWO queries instead of N
    // sequential getPage() round-trips. For a subtree of K pages the old
    // path issued ~3K IPC calls (Updated emit, child fetch, parent
    // fetch); this issues 2 (subtree + parents).
    const subtreeRowsResult = await this._db.all(
      `SELECT * FROM pages WHERE id IN (${subtreeIds.map(() => '?').join(',')})`,
      subtreeIds,
    );
    if (subtreeRowsResult.error) throw new Error(subtreeRowsResult.error.message);
    const subtreePages = (subtreeRowsResult.rows ?? []).map(rowToPage);
    const subtreeById = new Map(subtreePages.map((p) => [p.id, p] as const));

    // Collect distinct parent ids that aren't already inside the subtree
    // (a parent inside the subtree was also restored; its archival state
    // is already known).
    const subtreeIdSet = new Set(subtreeIds);
    const externalParentIds = new Set<string>();
    for (const p of subtreePages) {
      if (p.parentId && !subtreeIdSet.has(p.parentId)) {
        externalParentIds.add(p.parentId);
      }
    }

    const parentById = new Map<string, IPage>();
    for (const p of subtreePages) parentById.set(p.id, p); // self can be a parent of children
    if (externalParentIds.size > 0) {
      const externalIds = [...externalParentIds];
      const parentRows = await this._db.all(
        `SELECT * FROM pages WHERE id IN (${externalIds.map(() => '?').join(',')})`,
        externalIds,
      );
      if (parentRows.error) throw new Error(parentRows.error.message);
      for (const row of parentRows.rows ?? []) {
        const parent = rowToPage(row);
        parentById.set(parent.id, parent);
      }
    }

    // Fire Updated events for the whole subtree so the sidebar refreshes.
    for (const id of subtreeIds) {
      const page = subtreeById.get(id);
      if (page) {
        this._onDidChangePage.fire({
          kind: PageChangeKind.Updated,
          pageId: id,
          page,
          changedFields: ['isArchived'] as PageMutationField[],
        });
      }
    }

    // M77 Phase 9.4 — Re-append pageBlock cards to non-archived parents.
    // Collect per-child failures instead of throwing on the first one so
    // a single bad child can't strand the rest of the cascade. The first
    // failure is rethrown at the end carrying all failed ids so the
    // caller can surface them.
    const restoreFailures: { childId: string; error: Error }[] = [];
    for (const id of subtreeIds) {
      const child = subtreeById.get(id);
      if (!child || !child.parentId) continue;
      const parent = parentById.get(child.parentId);
      if (!parent || parent.isArchived) continue;
      try {
        await this._ensureLinkedBlockOnParent(parent, child);
      } catch (err) {
        restoreFailures.push({
          childId: id,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    const root = subtreeById.get(pageId) ?? await this.getPage(pageId);
    if (!root) throw new Error(`[CanvasDataService] Page "${pageId}" not found after restore`);

    if (restoreFailures.length > 0) {
      const ids = restoreFailures.map((f) => f.childId).join(', ');
      const first = restoreFailures[0].error.message;
      throw new Error(
        `[CanvasDataService] restorePage("${pageId}") partial failure — ${restoreFailures.length} child(ren) failed to re-attach: ${ids}. First error: ${first}`,
      );
    }

    return root;
  }

  /**
   * Permanently delete a page (true delete, not soft).
   */
  async permanentlyDeletePage(pageId: string): Promise<void> {
    const deletedIds = await this._getPageSubtreeIds(pageId);

    for (const id of deletedIds.length > 0 ? deletedIds : [pageId]) {
      this._cancelPendingSave(id);
      this._cancelRetry(id);
    }

    const result = await this._db.run('DELETE FROM pages WHERE id = ?', [pageId]);
    if (result.error) throw new Error(result.error.message);

    for (const deletedId of deletedIds) {
      await this._removeLinkedBlocksForPageId(deletedId);
      this._knownRevisions.delete(deletedId);
      this._knownStoredContent.delete(deletedId);
      if (deletedId !== pageId) {
        this._onDidChangePage.fire({ kind: PageChangeKind.Deleted, pageId: deletedId });
      }
    }

    this._knownRevisions.delete(pageId);
    this._knownStoredContent.delete(pageId);
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

    const rootCopy = await this._duplicateRecursive(source, source.parentId, maxSort + 1, true, new Set(), 0);
    return rootCopy;
  }

  /** Hard cap to keep recursion bounded even if data is corrupt. */
  private static readonly MAX_TREE_DEPTH = 64;

  private async _duplicateRecursive(
    source: IPage,
    newParentId: string | null,
    sortOrder: number,
    isRoot: boolean,
    visited: Set<string>,
    depth: number,
  ): Promise<IPage> {
    if (depth > CanvasDataService.MAX_TREE_DEPTH) {
      throw new Error(`[CanvasDataService] Duplicate aborted — max depth ${CanvasDataService.MAX_TREE_DEPTH} exceeded`);
    }
    if (visited.has(source.id)) {
      throw new Error(`[CanvasDataService] Duplicate aborted — cycle detected at "${source.id}"`);
    }
    visited.add(source.id);
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
      await this._duplicateRecursive(children[i], newId, i + 1, false, visited, depth + 1);
    }

    return newPage;
  }

  // ── Internal ──

  /**
   * M77 Phase 6 — retry a transactional operation on revision conflict.
   *
   * Atomic helpers (movePageWithBlocks, createChildPageWithBlock) include
   * `revision = ?` guards in their UPDATE clauses so a write that races
   * with our read fails as 0 changes. The helper throws a revision-
   * conflict error which we catch here, re-read, and retry. Three
   * attempts cover the realistic contention window; beyond that, the
   * conflict is structural and should surface to the user.
   *
   * Errors that don't match the revision-conflict pattern propagate
   * immediately — no retrying e.g. cycle-prevention rejections.
   */
  private async _retryOnRevisionConflict<T>(
    operation: () => Promise<T>,
    label: string,
    maxAttempts: number = 3,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/revision conflict/i.test(msg)) {
          throw err;
        }
        lastErr = err;
        if (attempt < maxAttempts) {
          // Tiny back-off so a save burst can clear before we retry.
          await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
        }
      }
    }
    throw lastErr instanceof Error
      ? new Error(`[CanvasDataService] ${label} failed after ${maxAttempts} attempts: ${lastErr.message}`)
      : new Error(`[CanvasDataService] ${label} failed after ${maxAttempts} attempts`);
  }

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
          // Orphan — treat as root, but log so corruption is visible.
          console.warn(`[CanvasDataService] Orphan page "${page.id}" — parent "${page.parentId}" missing; promoting to root`);
          roots.push(node);
        }
      }
    }

    return roots;
  }

  /**
   * True if the doc tree contains a `pageBlock` referencing `targetPageId`
   * anywhere (top-level, in columns, callouts, details, etc.).
   */
  private _docContainsPageBlock(node: any, targetPageId: string): boolean {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'pageBlock' && node.attrs?.pageId === targetPageId) return true;
    const content = Array.isArray(node.content) ? node.content : [];
    for (const child of content) {
      if (this._docContainsPageBlock(child, targetPageId)) return true;
    }
    return false;
  }

  /**
   * Walk a doc tree and update every `pageBlock` whose `pageId` matches
   * `targetPageId` to carry the supplied title/icon attrs.
   * Returns a new tree if anything changed, otherwise the original.
   */
  private _retitleLinkedBlocks(
    node: any,
    targetPageId: string,
    next: { title: string; icon: string | null },
  ): { node: any; changed: boolean } {
    if (!node || typeof node !== 'object') return { node, changed: false };

    if (node.type === 'pageBlock' && node.attrs?.pageId === targetPageId) {
      const currentTitle = node.attrs.title ?? null;
      const currentIcon = node.attrs.icon ?? null;
      if (currentTitle === next.title && currentIcon === next.icon) {
        return { node, changed: false };
      }
      return {
        node: {
          ...node,
          attrs: {
            ...node.attrs,
            title: next.title,
            icon: next.icon,
          },
        },
        changed: true,
      };
    }

    const content = Array.isArray(node.content) ? node.content : null;
    if (!content) return { node, changed: false };

    let changed = false;
    const nextContent: any[] = [];
    for (const child of content) {
      const r = this._retitleLinkedBlocks(child, targetPageId, next);
      if (r.changed) changed = true;
      nextContent.push(r.node);
    }
    if (!changed) return { node, changed: false };
    return { node: { ...node, content: nextContent }, changed: true };
  }

  /**
   * Reconcile every stored page's content so that pageBlocks linking to
   * `targetPageId` carry the latest title/icon.  Walks all rows (incl.
   * archived) so closed parents don't drift.
   */
  private async _updateLinkedBlocksForPageId(
    targetPageId: string,
    next: { title: string; icon: string | null },
  ): Promise<void> {
    const result = await this._db.all('SELECT id, content FROM pages');
    if (result.error) throw new Error(result.error.message);

    for (const row of result.rows ?? []) {
      const pageId = row.id;
      const storedContent = row.content;
      if (typeof pageId !== 'string' || typeof storedContent !== 'string') continue;
      if (pageId === targetPageId) continue; // skip self

      const decoded = decodeCanvasContent(storedContent);
      const retitled = this._retitleLinkedBlocks(decoded.doc, targetPageId, next);
      if (!retitled.changed) continue;

      const encoded = encodeCanvasContentFromDoc(retitled.node);
      const updateResult = await this._db.run(
        `UPDATE pages
         SET content = ?,
             content_schema_version = ?,
             revision = revision + 1,
             updated_at = datetime('now')
         WHERE id = ?`,
        [encoded.storedContent, encoded.schemaVersion, pageId],
      );
      if (updateResult.error) throw new Error(updateResult.error.message);

      const updated = await this.getPage(pageId);
      if (updated) {
        this._knownRevisions.set(pageId, updated.revision);
        // Notify open editors of the parent so they reload the card text.
        this._onDidChangePage.fire({
          kind: PageChangeKind.Updated,
          pageId,
          page: updated,
          changedFields: ['content', 'contentSchemaVersion'],
        });
        this._onRequestContentReload.fire(pageId);
      }
    }
  }

  /**
   * Idempotently append a `pageBlock` card for `child` to `parent`'s stored
   * content if one is not already present anywhere in the tree.
   */
  private async _ensureLinkedBlockOnParent(parent: IPage, child: IPage): Promise<void> {
    const decoded = decodeCanvasContent(parent.content);
    if (this._docContainsPageBlock(decoded.doc, child.id)) return;

    const content = Array.isArray(decoded.doc?.content) ? decoded.doc.content : [];
    const nextDoc = {
      type: 'doc',
      content: [
        ...content,
        {
          type: 'pageBlock',
          attrs: {
            pageId: child.id,
            title: child.title,
            icon: child.icon,
          },
        },
      ],
    };

    await this.flushContentSave(parent.id, nextDoc);
    this._onRequestContentReload.fire(parent.id);
  }

  private _pruneLinkedBlocks(node: any, targetPageId: string): { node: any; changed: boolean } {
    if (!node || typeof node !== 'object') {
      return { node, changed: false };
    }

    const attrs = (node.attrs && typeof node.attrs === 'object') ? node.attrs as Record<string, unknown> : undefined;
    const nodeType = typeof node.type === 'string' ? node.type : '';
    const isTargetPageBlock = nodeType === 'pageBlock' && attrs?.pageId === targetPageId;
    const isTargetDatabaseInline = nodeType === 'databaseInline' && attrs?.databaseId === targetPageId;
    const isTargetDatabaseFullPage = nodeType === 'databaseFullPage' && attrs?.databaseId === targetPageId;

    if (isTargetPageBlock || isTargetDatabaseInline || isTargetDatabaseFullPage) {
      return { node: null, changed: true };
    }

    const content = Array.isArray((node as any).content) ? (node as any).content : null;
    if (!content) {
      return { node, changed: false };
    }

    const nextContent: any[] = [];
    let changed = false;
    for (const child of content) {
      const pruned = this._pruneLinkedBlocks(child, targetPageId);
      if (pruned.changed) changed = true;
      if (pruned.node != null) {
        nextContent.push(pruned.node);
      }
    }

    if (!changed) {
      return { node, changed: false };
    }

    return {
      node: {
        ...node,
        content: nextContent,
      },
      changed: true,
    };
  }

  private async _removeLinkedBlocksForPageId(targetPageId: string): Promise<void> {
    // Walk EVERY page (including archived) — leaving stale references in
    // archived parents would surface as broken cards on restore.
    const result = await this._db.all('SELECT id, content FROM pages');
    if (result.error) throw new Error(result.error.message);

    for (const row of result.rows ?? []) {
      const pageId = row.id;
      const storedContent = row.content;
      if (typeof pageId !== 'string' || typeof storedContent !== 'string') continue;

      const decoded = decodeCanvasContent(storedContent);
      const pruned = this._pruneLinkedBlocks(decoded.doc, targetPageId);
      if (!pruned.changed) continue;

      const encoded = encodeCanvasContentFromDoc(pruned.node);
      const updateResult = await this._db.run(
        `UPDATE pages
         SET content = ?,
             content_schema_version = ?,
             revision = revision + 1,
             updated_at = datetime('now')
         WHERE id = ?`,
        [encoded.storedContent, encoded.schemaVersion, pageId],
      );
      if (updateResult.error) throw new Error(updateResult.error.message);

      const updated = await this.getPage(pageId);
      if (updated) {
        this._knownRevisions.set(pageId, updated.revision);
        this._onDidChangePage.fire({
          kind: PageChangeKind.Updated,
          pageId,
          page: updated,
          changedFields: ['content', 'contentSchemaVersion'],
        });
      }
    }
  }

  private async _getPageSubtreeIds(rootPageId: string): Promise<string[]> {
    const idsResult = await this._db.all(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM pages WHERE id = ?
         UNION ALL
         SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id
       )
       SELECT id FROM subtree`,
      [rootPageId],
    );
    if (idsResult.error) throw new Error(idsResult.error.message);

    return (idsResult.rows ?? [])
      .map(row => row.id)
      .filter((id): id is string => typeof id === 'string');
  }

  private async _archivePageSubtree(rootPageId: string): Promise<string[]> {
    const ids = await this._getPageSubtreeIds(rootPageId);

    if (ids.length === 0) return [];

    const archiveResult = await this._db.run(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM pages WHERE id = ?
         UNION ALL
         SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id
       )
       UPDATE pages
       SET is_archived = 1,
           updated_at = datetime('now')
       WHERE id IN (SELECT id FROM subtree)`,
      [rootPageId],
    );
    if (archiveResult.error) throw new Error(archiveResult.error.message);

    for (const id of ids) {
      this._cancelPendingSave(id);
      this._cancelRetry(id);
      this._knownRevisions.delete(id);
      this._onDidChangePage.fire({ kind: PageChangeKind.Deleted, pageId: id });
    }

    return ids;
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
