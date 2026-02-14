// layoutTypes.ts — layout-related types and enums

/**
 * Direction of a grid split.
 */
export enum Orientation {
  Horizontal = 'horizontal', // children laid out left-to-right
  Vertical = 'vertical',     // children laid out top-to-bottom
}

/**
 * Sizing mode for a grid node or view.
 */
export enum SizingMode {
  /** Fixed pixel size */
  Pixel = 'pixel',
  /** Proportional (fraction of parent) */
  Proportional = 'proportional',
}

/**
 * Size constraints for a grid participant.
 */
export interface SizeConstraints {
  readonly minimumWidth: number;
  readonly maximumWidth: number;
  readonly minimumHeight: number;
  readonly maximumHeight: number;
}

/**
 * Default size constraints (no meaningful restriction).
 */
export const DEFAULT_SIZE_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 0,
  maximumWidth: Number.POSITIVE_INFINITY,
  minimumHeight: 0,
  maximumHeight: Number.POSITIVE_INFINITY,
};

/**
 * Dimensions for layout operations.
 */
export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Position within a grid.
 */
export interface Position {
  readonly x: number;
  readonly y: number;
}

/**
 * Bounding box (position + dimensions).
 */
export interface Box extends Dimensions, Position {}

/**
 * Which edge of a grid node a sash (resize handle) is on.
 */
enum SashEdge {
  Top = 'top',
  Right = 'right',
  Bottom = 'bottom',
  Left = 'left',
}

/**
 * Events emitted by the grid system.
 */
enum GridEventType {
  /** A node was added to the grid */
  NodeAdded = 'nodeAdded',
  /** A node was removed from the grid */
  NodeRemoved = 'nodeRemoved',
  /** A node was resized */
  NodeResized = 'nodeResized',
  /** The grid structure changed (split, merge) */
  StructureChanged = 'structureChanged',
  /** The grid was fully serialized/deserialized */
  StateRestored = 'stateRestored',
}

/**
 * Location within the grid tree, represented as a path of child indices.
 * e.g. [0, 1] means "first child's second child".
 */
export type GridLocation = number[];
