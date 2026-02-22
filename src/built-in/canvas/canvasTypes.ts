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

  /** Fires after an auto-save flush completes for a specific page. */
  readonly onDidSavePage: Event<string>;

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

  // ── Tree / hierarchy ──

  movePage(pageId: string, newParentId: string | null, afterSiblingId?: string): Promise<void>;
  reorderPages(parentId: string | null, orderedIds: string[]): Promise<void>;
  getAncestors(pageId: string): Promise<IPage[]>;

  // ── Auto-save ──

  scheduleContentSave(pageId: string, content: string): void;
  flushPendingSaves(): Promise<void>;
  hasPendingSave(pageId: string): boolean;
  readonly pendingSaveCount: number;

  // ── Favorites / Archive ──

  toggleFavorite(pageId: string): Promise<IPage>;
  getFavoritedPages(): Promise<IPage[]>;
  archivePage(pageId: string): Promise<void>;
  restorePage(pageId: string): Promise<IPage>;
  permanentlyDeletePage(pageId: string): Promise<void>;
  getArchivedPages(): Promise<IPage[]>;

  // ── Duplication ──

  duplicatePage(pageId: string): Promise<IPage>;
}
