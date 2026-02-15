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

// ─── Database Bridge Type ────────────────────────────────────────────────────

interface DatabaseBridge {
  run(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; changes?: number; lastInsertRowid?: number }>;
  get(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; rows?: Record<string, unknown>[] }>;
}

// ─── Row → IPage mapping ────────────────────────────────────────────────────

function rowToPage(row: Record<string, unknown>): IPage {
  return {
    id: row.id as string,
    parentId: (row.parent_id as string) ?? null,
    title: row.title as string,
    icon: (row.icon as string) ?? null,
    content: row.content as string,
    sortOrder: row.sort_order as number,
    isArchived: !!(row.is_archived as number),
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

  // ── Auto-save debounce state ──

  /** Per-page debounce timers for content auto-save. */
  private readonly _pendingSaves = new Map<string, { timer: ReturnType<typeof setTimeout>; content: string }>();

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

    const result = await this._db.run(
      `INSERT INTO pages (id, parent_id, title, sort_order) VALUES (?, ?, ?, ?)`,
      [id, parent, pageTitle, sortOrder],
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
    return result.row ? rowToPage(result.row) : null;
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
    updates: Partial<Pick<IPage, 'title' | 'icon' | 'content'>>,
  ): Promise<IPage> {
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
      sets.push('content = ?');
      params.push(updates.content);
    }

    if (sets.length === 0) {
      const page = await this.getPage(pageId);
      if (!page) throw new Error(`[CanvasDataService] Page "${pageId}" not found`);
      return page;
    }

    sets.push("updated_at = datetime('now')");
    params.push(pageId);

    const result = await this._db.run(
      `UPDATE pages SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    if (result.error) throw new Error(result.error.message);

    const page = await this.getPage(pageId);
    if (!page) throw new Error(`[CanvasDataService] Page "${pageId}" not found after update`);

    this._onDidChangePage.fire({ kind: PageChangeKind.Updated, pageId, page });
    return page;
  }

  /**
   * Delete a page. Cascading delete removes all descendants (FK ON DELETE CASCADE).
   */
  async deletePage(pageId: string): Promise<void> {
    const result = await this._db.run('DELETE FROM pages WHERE id = ?', [pageId]);
    if (result.error) throw new Error(result.error.message);

    // Cancel any pending auto-save for this page
    this._cancelPendingSave(pageId);

    this._onDidChangePage.fire({ kind: PageChangeKind.Deleted, pageId });
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
  async reorderPages(parentId: string | null, orderedIds: string[]): Promise<void> {
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
    // Cancel existing timer for this page
    this._cancelPendingSave(pageId);

    const timer = setTimeout(async () => {
      this._pendingSaves.delete(pageId);
      try {
        await this.updatePage(pageId, { content });
        this._onDidSavePage.fire(pageId);
      } catch (err) {
        console.error(`[CanvasDataService] Auto-save failed for page "${pageId}":`, err);
      }
    }, this._autoSaveMs);

    this._pendingSaves.set(pageId, { timer, content });
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
      try {
        await this.updatePage(pageId, { content });
        this._onDidSavePage.fire(pageId);
      } catch (err) {
        console.error(`[CanvasDataService] Flush failed for page "${pageId}":`, err);
      }
    }
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

  // ── Internal ──

  private _cancelPendingSave(pageId: string): void {
    const pending = this._pendingSaves.get(pageId);
    if (pending) {
      clearTimeout(pending.timer);
      this._pendingSaves.delete(pageId);
    }
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
    // Cancel all pending timers
    for (const { timer } of this._pendingSaves.values()) {
      clearTimeout(timer);
    }
    this._pendingSaves.clear();
    super.dispose();
  }
}
