// partTypes.ts — part-related types and enums

import { Event } from '../platform/events.js';
import { IDisposable } from '../platform/lifecycle.js';
import { SizeConstraints, Dimensions, Orientation } from '../layout/layoutTypes.js';

// ─── Part Identifiers ────────────────────────────────────────────────────────

/**
 * Standard part identifiers matching common IDE layout regions.
 */
export enum PartId {
  Titlebar = 'workbench.parts.titlebar',
  Sidebar = 'workbench.parts.sidebar',
  Panel = 'workbench.parts.panel',
  Editor = 'workbench.parts.editor',
  AuxiliaryBar = 'workbench.parts.auxiliarybar',
  StatusBar = 'workbench.parts.statusbar',
}

// ─── Part Position ───────────────────────────────────────────────────────────

/**
 * Where a part sits in the workbench layout.
 */
export enum PartPosition {
  Top = 'top',
  Bottom = 'bottom',
  Left = 'left',
  Right = 'right',
  Center = 'center',
}

// ─── Part State ──────────────────────────────────────────────────────────────

/**
 * Serializable state for a part, used by layout persistence.
 */
export interface PartState {
  readonly id: string;
  readonly visible: boolean;
  readonly width: number;
  readonly height: number;
  readonly position: PartPosition;
  /** Arbitrary part-specific state. */
  readonly data?: Record<string, unknown>;
}

// ─── IPart Interface ─────────────────────────────────────────────────────────

/**
 * Interface for structural parts — containers that occupy fixed regions
 * in the workbench and host view containers.
 *
 * Parts implement IGridView so the grid system can manage their sizing.
 * They add lifecycle methods (create → mount → layout → dispose) and
 * visibility management on top of the grid contract.
 */
export interface IPart extends IDisposable {
  /** Unique identifier for this part. */
  readonly id: string;

  /** The root DOM element for this part. */
  readonly element: HTMLElement;

  /** Container element where child content (views) is mounted. */
  readonly contentElement: HTMLElement;

  /** Current visibility. */
  readonly visible: boolean;

  /** Position in the workbench layout. */
  readonly position: PartPosition;

  // ── Size Constraints ──

  readonly minimumWidth: number;
  readonly maximumWidth: number;
  readonly minimumHeight: number;
  readonly maximumHeight: number;

  // ── Lifecycle ──

  /** Create the part's DOM structure (called once). */
  create(parent: HTMLElement): void;

  /** Mount the part into a parent element (may be called multiple times). */
  mount(parent: HTMLElement): void;

  /** Layout the part for the given dimensions. */
  layout(width: number, height: number, orientation: Orientation): void;

  /** Show or hide the part. */
  setVisible(visible: boolean): void;

  // ── State ──

  /** Save part state for persistence. */
  saveState(): PartState;

  /** Restore part state from persistence. */
  restoreState(state: PartState): void;

  /** Serialize for grid persistence. */
  toJSON(): object;

  // ── Events ──

  /** Fires when the part's visibility changes. */
  readonly onDidChangeVisibility: Event<boolean>;

  /** Fires when the part's size changes. */
  readonly onDidChangeSize: Event<Dimensions>;

  /** Fires when size constraints change. */
  readonly onDidChangeConstraints: Event<void>;
}

// ─── Part Descriptor ─────────────────────────────────────────────────────────

/**
 * Metadata describing a part, used by the PartRegistry for registration
 * and factory instantiation.
 */
export interface PartDescriptor {
  /** Unique part ID. */
  readonly id: string;

  /** Human-readable name. */
  readonly name: string;

  /** Default position in the layout. */
  readonly position: PartPosition;

  /** Whether the part is visible by default. */
  readonly defaultVisible: boolean;

  /** Default size constraints. */
  readonly constraints: SizeConstraints;

  /** Factory function that creates the part instance. */
  readonly factory: () => IPart;
}
