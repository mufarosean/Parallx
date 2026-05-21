// canvasTypes.ts — data model types for the Canvas note-taking tool
//
// Defines the page model, tree node shape, change event types, and the
// ICanvasDataService interface consumed by all canvas components.
// All database rows map to IPage. Tree assembly produces IPageTreeNode.

import type { Event } from '../../platform/events.js';

// ─── Page Model ──────────────────────────────────────────────────────────────

/**
 * A single Canvas page as stored in the database.
 */
export interface IPage {
  /** Unique page identifier (UUID). */
  readonly id: string;
  /** Parent page ID, or null for root-level pages. */
  readonly parentId: string | null;
  /** Page title. */
  readonly title: string;
  /** Emoji icon, or null for default icon. */
  readonly icon: string | null;
  /** Page content as stringified Tiptap JSON. */
  readonly content: string;
  /** Stored content schema version for migration/recovery logic. */
  readonly contentSchemaVersion: number;
  /** Monotonic page revision used for optimistic concurrency control. */
  readonly revision: number;
  /** Sort position among siblings (REAL for O(1) insertion). */
  readonly sortOrder: number;
  /** Whether the page is archived (soft-deleted). */
  readonly isArchived: boolean;
  /** Cover image — base64 data URL or CSS gradient string, or null. */
  readonly coverUrl: string | null;
  /** Cover vertical crop offset (0.0 = top, 1.0 = bottom). */
  readonly coverYOffset: number;
  /** Font family preference: 'default' | 'serif' | 'mono'. */
  readonly fontFamily: 'default' | 'serif' | 'mono';
  /** Whether the page is displayed in full-width mode. */
  readonly fullWidth: boolean;
  /** Whether small text mode is enabled. */
  readonly smallText: boolean;
  /** Whether the page is locked (read-only). */
  readonly isLocked: boolean;
  /** Whether the page is pinned to the Favorites section. */
  readonly isFavorited: boolean;
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
  /** ISO-8601 last-modified timestamp. */
  readonly updatedAt: string;
}

// ─── Tree Node ───────────────────────────────────────────────────────────────

/**
 * A page with its children assembled into a tree structure.
 */
export interface IPageTreeNode extends IPage {
  /** Child pages, ordered by sortOrder. */
  readonly children: IPageTreeNode[];
}

// ─── Change Events ───────────────────────────────────────────────────────────

/**
 * Kinds of page mutations that fire change events.
 */
export const enum PageChangeKind {
  Created = 'Created',
  Updated = 'Updated',
  Deleted = 'Deleted',
  Moved = 'Moved',
  Reordered = 'Reordered',
}

/**
 * Event payload fired when a page is created, updated, deleted, moved, or reordered.
 */
export interface PageChangeEvent {
  /** What kind of change occurred. */
  readonly kind: PageChangeKind;
  /** The page that was affected. */
  readonly pageId: string;
  /** The page data after the change (undefined for Deleted). */
  readonly page?: IPage;
  /** The mutable fields that changed for Updated events when known. */
  readonly changedFields?: readonly PageMutationField[];
}

// ─── Page Update Data ────────────────────────────────────────────────────────

/**
 * Mutable fields accepted by `ICanvasDataService.updatePage()`.
 * Extracted so consumers can reference the type without importing the
 * concrete `CanvasDataService` class.
 */
export type PageUpdateData = Partial<Pick<IPage,
  'title' | 'icon' | 'content' | 'coverUrl' | 'coverYOffset' |
  'fontFamily' | 'fullWidth' | 'smallText' | 'isLocked' | 'isFavorited' |
  'contentSchemaVersion'
>> & { expectedRevision?: number };

export type PageUpdateField = Exclude<keyof PageUpdateData, 'expectedRevision'>;

/**
 * Fields that can change on a page during its lifetime.  Wider than
 * `PageUpdateField` because lifecycle transitions like archive/restore
 * mutate columns that aren't accepted by `updatePage()`.
 */
export type PageMutationField = PageUpdateField | 'isArchived';

const SIDEBAR_RELEVANT_PAGE_FIELDS: ReadonlySet<PageMutationField> = new Set<PageMutationField>([
  'title',
  'icon',
  'isFavorited',
  'isArchived',
]);

export function doesPageChangeAffectSidebar(event: PageChangeEvent): boolean {
  if (event.kind !== PageChangeKind.Updated) {
    return true;
  }

  if (!event.changedFields || event.changedFields.length === 0) {
    return true;
  }

  return event.changedFields.some((field) => SIDEBAR_RELEVANT_PAGE_FIELDS.has(field));
}

// ─── Page Save Event ────────────────────────────────────────────────────────
//
// Payload for `onDidSavePage`. M78 Phase 8 — carries the saved page so
// listeners don't have to issue a redundant `getPage` IPC just to know
// what was saved.

export interface PageSaveEvent {
  readonly pageId: string;
  readonly page: IPage;
}

// ─── Save State Events ──────────────────────────────────────────────────────
//
// Lifecycle states fired by the auto-save pipeline. M77 Phase 11.1 — moved
// here from canvasDataService.ts so the page chrome can subscribe through
// the interface instead of importing the concrete class.

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

// ─── Cross-Page Move Params ─────────────────────────────────────────────────

/**
 * Parameters for an atomic cross-page block move.
 */
export interface CrossPageMoveParams {
  readonly sourcePageId: string;
  readonly targetPageId: string;
  readonly sourceDoc: any;
  readonly appendedNodes: any[];
  readonly expectedSourceRevision?: number;
  readonly expectedTargetRevision?: number;
}

// ─── ICanvasDataService ─────────────────────────────────────────────────────

/**
 * Public interface for the Canvas page data service.
 *
 * All canvas components depend on this interface — only the composition
 * root (`main.ts`) imports the concrete `CanvasDataService` class.
 * This mirrors VS Code's service interface pattern (e.g. `IEditorService`).
 */
export interface ICanvasDataService {

  // ── Events ──

  /** Fires when a page is created, updated, deleted, moved, or reordered. */
  readonly onDidChangePage: Event<PageChangeEvent>;

  /** Fires after an auto-save flush completes for a specific page.
   *  M78 Phase 8 — the event payload now carries the saved IPage so
   *  listeners that need it (indexing scheduler, etc.) don't have to
   *  re-fetch via getPage, saving one IPC round-trip per save.
   *  Legacy listeners can still ignore the second argument; the event
   *  emitter passes only the first positional value to handlers. */
  readonly onDidSavePage: Event<PageSaveEvent>;

  /** Fires every time the save pipeline transitions state for a page
   *  (Pending → Flushing → Saved, or Retrying / Failed). M77 Phase 11.1 —
   *  added so the page chrome can render a save indicator. */
  readonly onDidChangeSaveState: Event<SaveStateEvent>;

  /** Fires when an external consumer (e.g. sidebar) changed a page's content and open editors should reload. */
  readonly onRequestContentReload: Event<string>;

  /** Signal that a page's stored content was changed externally and open editors should reload. */
  fireContentReload(pageId: string): void;

  /**
   * Notify the service that a page was mutated via raw SQL by an external
   * writer (e.g. AI chat tools) that bypassed `createPage` / `updatePage`.
   * Re-reads the page (when applicable) and fires `onDidChangePage` so the
   * sidebar and other listeners refresh promptly.
   */
  notifyExternalPageMutation(pageId: string, kind: 'created' | 'updated' | 'deleted'): Promise<void>;

  // ── Page CRUD ──

  createPage(parentId?: string | null, title?: string): Promise<IPage>;
  getPage(pageId: string): Promise<IPage | null>;
  getRootPages(): Promise<IPage[]>;
  getChildren(parentId: string): Promise<IPage[]>;
  getPageTree(): Promise<IPageTreeNode[]>;
  updatePage(pageId: string, updates: PageUpdateData): Promise<IPage>;
  deletePage(pageId: string): Promise<void>;

  // ── Content operations ──

  appendBlocksToPage(targetPageId: string, appendedNodes: any[]): Promise<IPage>;
  moveBlocksBetweenPagesAtomic(params: CrossPageMoveParams): Promise<{ sourcePage: IPage; targetPage: IPage }>;
  decodePageContentForEditor(page: IPage): Promise<{ doc: any; recovered: boolean }>;

  /**
   * Encode a raw TipTap doc JSON via the content schema and immediately
   * persist it for the given page, cancelling any pending debounced save.
   *
   * This is the single entry point for "encode‑and‑save" — consumers
   * never import contentSchema directly.
   */
  flushContentSave(pageId: string, docJson: any): Promise<void>;

  // ── Embedded pageBlock graph (visual layer keyed off parentId) ──

  /**
   * Idempotently append a pageBlock card for `childPageId` to `parentPageId`'s
   * stored content. No-op if a card for that child already exists anywhere
   * in the parent's document tree.
   */
  ensurePageBlockOnParent(parentPageId: string, childPageId: string): Promise<void>;

  /**
   * Recursively remove every pageBlock referencing `childPageId` from
   * `parentPageId`'s stored content. Walks columns, callouts, details, etc.
   */
  removePageBlockFromParent(parentPageId: string, childPageId: string): Promise<void>;

  /**
   * M77 Phase 1 — atomic page-hierarchy operations. Bundle the page row
   * update and the affected parents' content updates in one transaction
   * so partial failures can't leave embedded pageBlock cards out of
   * sync with the DB hierarchy.
   */
  movePageWithBlocks(opts: {
    pageId: string;
    newParentId: string | null;
    afterSiblingId?: string;
  }): Promise<void>;

  createChildPageWithBlock(opts: {
    parentId: string | null;
    title?: string;
  }): Promise<IPage>;

  /**
   * Repair drift between DB parent_id and embedded pageBlock nodes.
   * Removes pageBlock entries whose referenced child no longer has this
   * page as parent. Returns the count of orphans removed. Does NOT fire
   * `onRequestContentReload` — callers that need that should fire it
   * themselves via `fireContentReload`.
   */
  reconcileParentBlockState(parentPageId: string): Promise<number>;

  // ── Tree / hierarchy ──

  movePage(pageId: string, newParentId: string | null, afterSiblingId?: string): Promise<void>;
  reorderPages(parentId: string | null, orderedIds: string[]): Promise<void>;
  getAncestors(pageId: string): Promise<IPage[]>;

  // ── Auto-save ──

  scheduleContentSave(pageId: string, content: string): void;
  flushPendingSaves(): Promise<void>;
  hasPendingSave(pageId: string): boolean;
  /**
   * Cancel any pending debounced auto-save for a page. Used by callers
   * that are about to mutate that page's content through a non-debounced
   * path (atomic helpers, externally-orchestrated transactions) so a
   * stale debounced save can't clobber the fresh write.
   */
  cancelPendingSave(pageId: string): void;
  readonly pendingSaveCount: number;

  // ── Favorites / Archive ──

  toggleFavorite(pageId: string): Promise<IPage>;
  getFavoritedPages(): Promise<IPage[]>;
  /**
   * Most-recently-updated non-archived pages, ordered newest first.
   * Bounded by `limit` (defaults to 5). M77 Phase 11.3 — surfaces a
   * "Recents" section in the sidebar.
   */
  getRecentPages(limit?: number): Promise<IPage[]>;
  archivePage(pageId: string): Promise<void>;
  restorePage(pageId: string): Promise<IPage>;
  permanentlyDeletePage(pageId: string): Promise<void>;
  getArchivedPages(): Promise<IPage[]>;

  // ── Duplication ──

  duplicatePage(pageId: string): Promise<IPage>;
}
