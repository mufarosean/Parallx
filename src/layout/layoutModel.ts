// layoutModel.ts — serializable layout schema

import { Orientation, SizingMode } from './layoutTypes.js';

// ─── Schema Version ──────────────────────────────────────────────────────────

/**
 * Current schema version, incremented on breaking changes.
 * Used by persistence layer for migration decisions.
 */
export const LAYOUT_SCHEMA_VERSION = 1;

// ─── Serializable Node Types (discriminated union) ───────────────────────────

/**
 * Discriminant for the two kinds of grid nodes.
 */
export enum SerializedNodeType {
  Branch = 'branch',
  Leaf = 'leaf',
}

/**
 * A branch node splits space among children either horizontally or vertically.
 */
export interface SerializedBranchNode {
  readonly type: SerializedNodeType.Branch;
  readonly orientation: Orientation;
  /** Size of this node within its parent (pixels or proportional fraction). */
  readonly size: number;
  readonly sizingMode: SizingMode;
  readonly children: SerializedGridNode[];
  /**
   * A NAMED REGION: a branch with an identity ("the editor area") that is
   * addressable — insert into it, flex it on resize, stamp its edges — and
   * that survives having one or zero children, exempt from the
   * canonical-collapse rules. A region is a tree capability, not a typed
   * slot: nothing about its CONTENT is implied by its name.
   */
  readonly regionId?: string;
  readonly keepAlive?: boolean;
}

/**
 * A leaf node hosts a single view (identified by viewId).
 */
export interface SerializedLeafNode {
  readonly type: SerializedNodeType.Leaf;
  /** Identifier of the view placed in this cell. */
  readonly viewId: string;
  /** Size of this node within its parent (pixels or proportional fraction). */
  readonly size: number;
  readonly sizingMode: SizingMode;
  /** Minimum width constraint saved at serialization time. */
  readonly minimumWidth?: number;
  /** Maximum width constraint saved at serialization time. */
  readonly maximumWidth?: number;
  /** Minimum height constraint saved at serialization time. */
  readonly minimumHeight?: number;
  /** Maximum height constraint saved at serialization time. */
  readonly maximumHeight?: number;
}

/**
 * A grid node is either a branch (container) or a leaf (view host).
 */
export type SerializedGridNode = SerializedBranchNode | SerializedLeafNode;

// ─── Serializable Grid ──────────────────────────────────────────────────────

/**
 * Complete serialized grid state — the root of the tree.
 */
export interface SerializedGrid {
  readonly root: SerializedBranchNode;
  readonly orientation: Orientation;
  readonly width: number;
  readonly height: number;
}

// ─── Part Placement ─────────────────────────────────────────────────────────

/**
 * Serialized state of a single structural part.
 */
interface SerializedPartState {
  readonly partId: string;
  readonly visible: boolean;
  /** Grid location path, if participating in grid. */
  readonly gridLocation?: number[];
  /** Current pixel size. */
  readonly size?: { width: number; height: number };
}

// ─── View Assignment ────────────────────────────────────────────────────────

/**
 * Records which views are assigned to which part/container.
 */
interface SerializedViewAssignment {
  readonly viewId: string;
  readonly containerId: string;
  /** Order within the container. */
  readonly order: number;
  /** Whether this view is the active (visible) one in its container. */
  readonly active: boolean;
}

// ─── Hidden Areas ───────────────────────────────────────────────────────────

/** Where a hidden view sat, so it can go back there: beside a sibling, or at an edge. */
export type SerializedPlacementRecall =
  | { readonly kind: 'beside'; readonly siblingId: string; readonly orientation: Orientation; readonly before: boolean }
  | { readonly kind: 'edge'; readonly orientation: Orientation; readonly before: boolean };

/**
 * One occupant an area toggle hid. Parts remember their own sizes; a
 * floating seat (a widget box, a detached container) carries the size and
 * place it left, because nothing else does.
 */
export interface SerializedHiddenOccupant {
  readonly id: string;
  readonly width?: number;
  readonly height?: number;
  readonly recall?: SerializedPlacementRecall;
}

/** What a body area held when its toggle hid it, in hide order. */
export interface SerializedHiddenArea {
  readonly area: 'left' | 'right' | 'bottom';
  readonly occupants: readonly SerializedHiddenOccupant[];
}

// ─── Full Layout State ──────────────────────────────────────────────────────

/**
 * The complete layout state — everything needed to reconstruct
 * the workbench layout from scratch.
 */
export interface SerializedLayoutState {
  /** Schema version for migration support. */
  readonly version: number;
  /** The grid tree structure. */
  readonly grid: SerializedGrid;
  /** Visibility and sizing of structural parts. */
  readonly parts: SerializedPartState[];
  /** Which views are in which containers. */
  readonly views: SerializedViewAssignment[];
  /** ID of the currently active part. */
  readonly activePart?: string;
  /** ID of the currently focused view. */
  readonly focusedView?: string;
  /** Nested grid for editor groups (independent from main grid). */
  readonly editorGrid?: SerializedGrid;
  /**
   * What each body area held when its toggle hid it. A seat hidden with
   * its area is out of the grid, so the tree alone forgets it; this is
   * what brings it back after a restart. Absent in old saves.
   */
  readonly hiddenAreas?: readonly SerializedHiddenArea[];
}

// ─── Default Layout ─────────────────────────────────────────────────────────

/**
 * Returns the default layout state used when no saved state exists.
 */
export function createDefaultLayoutState(width: number, height: number): SerializedLayoutState {
  return {
    version: LAYOUT_SCHEMA_VERSION,
    grid: {
      orientation: Orientation.Vertical,
      width,
      height,
      root: {
        type: SerializedNodeType.Branch,
        orientation: Orientation.Vertical,
        size: height,
        sizingMode: SizingMode.Pixel,
        children: [
          // Titlebar
          {
            type: SerializedNodeType.Leaf,
            viewId: 'workbench.parts.titlebar',
            size: 30,
            sizingMode: SizingMode.Pixel,
            minimumHeight: 30,
            maximumHeight: 30,
          },
          // Main area (sidebar + editor + auxiliary bar)
          {
            type: SerializedNodeType.Branch,
            orientation: Orientation.Horizontal,
            size: 0, // fills remaining space
            sizingMode: SizingMode.Proportional,
            children: [
              {
                type: SerializedNodeType.Leaf,
                viewId: 'workbench.parts.sidebar',
                size: 250,
                sizingMode: SizingMode.Pixel,
                minimumWidth: 170,
                maximumWidth: 800,
              },
              {
                type: SerializedNodeType.Leaf,
                viewId: 'workbench.parts.editor',
                size: 0, // fills remaining space
                sizingMode: SizingMode.Proportional,
                minimumWidth: 200,
              },
              {
                type: SerializedNodeType.Leaf,
                viewId: 'workbench.parts.auxiliarybar',
                size: 250,
                sizingMode: SizingMode.Pixel,
                minimumWidth: 170,
                maximumWidth: 800,
              },
            ],
          },
          // Panel
          {
            type: SerializedNodeType.Leaf,
            viewId: 'workbench.parts.panel',
            size: 200,
            sizingMode: SizingMode.Pixel,
            minimumHeight: 100,
            maximumHeight: 600,
          },
          // Status bar
          {
            type: SerializedNodeType.Leaf,
            viewId: 'workbench.parts.statusbar',
            size: 22,
            sizingMode: SizingMode.Pixel,
            minimumHeight: 22,
            maximumHeight: 22,
          },
        ],
      },
    },
    parts: [
      { partId: 'workbench.parts.titlebar', visible: true },
      { partId: 'workbench.parts.sidebar', visible: true },
      { partId: 'workbench.parts.editor', visible: true },
      { partId: 'workbench.parts.auxiliarybar', visible: false },
      { partId: 'workbench.parts.panel', visible: true },
      { partId: 'workbench.parts.statusbar', visible: true },
    ],
    views: [],
    activePart: 'workbench.parts.editor',
  };
}
