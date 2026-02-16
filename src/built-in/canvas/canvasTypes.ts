// canvasTypes.ts — data model types for the Canvas note-taking tool
//
// Defines the page model, tree node shape, and change event types.
// All database rows map to IPage. Tree assembly produces IPageTreeNode.

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
