// viewTypes.ts — central type definitions for the views subsystem
//
// All view-related interfaces, types, and enums live here.
// Implementation files import types from this module and re-export
// for backward compatibility.

import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';

// ─── View State ──────────────────────────────────────────────────────────────

/**
 * Serialisable state blob returned by a view's `saveState()`.
 */
export type ViewState = Record<string, unknown>;

// ─── IView ───────────────────────────────────────────────────────────────────

/**
 * Contract for content-based UI elements hosted inside parts.
 *
 * Views are layout-agnostic — they receive dimensions but don't control
 * their placement. They manage their own internal state and DOM.
 *
 * Lifecycle: createElement → setVisible(true) → layout → focus → … → dispose
 */
export interface IView extends IDisposable {
  /** Unique identifier. */
  readonly id: string;

  /** Human-readable name shown in tabs. */
  readonly name: string;

  /** Optional icon identifier (CSS class or codicon). */
  readonly icon?: string;

  /** The root DOM element (available after createElement). */
  readonly element: HTMLElement | undefined;

  // ── Size Constraints ──

  readonly minimumWidth: number;
  readonly maximumWidth: number;
  readonly minimumHeight: number;
  readonly maximumHeight: number;

  // ── Lifecycle ──

  /** Create the view's DOM structure inside the given container. */
  createElement(container: HTMLElement): void;

  /** Show or hide the view without disposing it. */
  setVisible(visible: boolean): void;

  /** Respond to dimension changes. */
  layout(width: number, height: number): void;

  /** Receive keyboard focus. */
  focus(): void;

  // ── State ──

  /** Persist view-specific state. */
  saveState(): ViewState;

  /** Restore view-specific state. */
  restoreState(state: ViewState): void;

  // ── Events ──

  /** Fires when size constraints change. */
  readonly onDidChangeConstraints: Event<void>;

  /** Fires when visibility changes. */
  readonly onDidChangeVisibility: Event<boolean>;
}

// ─── View Descriptor ─────────────────────────────────────────────────────────

import type { SizeConstraints } from '../layout/layoutTypes.js';

/**
 * Declarative metadata describing a view before it is instantiated.
 *
 * Descriptors are registered with the ViewManager and used to:
 * - populate menus and palettes
 * - defer view creation until actually needed (lazy instantiation)
 * - persist view registration info as JSON
 */
export interface IViewDescriptor {
  /** Unique view ID. */
  readonly id: string;

  /** Human-readable name shown in tabs and menus. */
  readonly name: string;

  /** Icon identifier (CSS class or codicon name). */
  readonly icon?: string;

  /** ID of the part / view container this view belongs to by default. */
  readonly containerId: string;

  /**
   * When clause — a string expression evaluated against the context key
   * service. The view is only shown when this evaluates to true.
   * If undefined the view is always available.
   */
  readonly when?: string;

  /** Default size constraints for the view. */
  readonly constraints: SizeConstraints;

  /**
   * Whether the view should grab focus when first activated.
   */
  readonly focusOnActivate: boolean;

  /**
   * Optional keyboard shortcut to toggle / focus this view.
   * Format: modifier keys + key, e.g. "Ctrl+Shift+E".
   */
  readonly keybinding?: string;

  /**
   * Priority for ordering within a container (lower = earlier).
   */
  readonly order: number;

  /**
   * Factory function that creates the view instance.
   * Called lazily the first time the view is needed.
   */
  readonly factory: () => IView | Promise<IView>;
}

// ─── View Container State ────────────────────────────────────────────────────

export interface ViewContainerState {
  readonly activeViewId: string | undefined;
  readonly tabOrder: readonly string[];
  readonly collapsedSections?: readonly string[];
}

// ─── View Manager ────────────────────────────────────────────────────────────

export enum ViewLifecyclePhase {
  Registered = 'registered',
  Created = 'created',
  Visible = 'visible',
  Hidden = 'hidden',
  Focused = 'focused',
  Disposed = 'disposed',
}

export interface ViewLifecycleEvent {
  readonly viewId: string;
  readonly phase: ViewLifecyclePhase;
}
