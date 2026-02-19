// contextTypes.ts — central type definitions for the context subsystem
//
// All context-related interfaces and types live here.
// Implementation files import types from this module and re-export
// for backward compatibility.

import type { IDisposable } from '../platform/lifecycle.js';

// ─── Context Key Types ───────────────────────────────────────────────────────

/** Allowed context key value types. */
export type ContextKeyValue = string | number | boolean | string[] | Record<string, unknown> | undefined;

/** Event payload when context keys change. */
export interface ContextKeyChangeEvent {
  /** The keys that changed. */
  readonly affectedKeys: ReadonlySet<string>;
}

/**
 * A typed handle to a single context key. Allows setting and resetting
 * values with proper change tracking.
 */
export interface IContextKey<T extends ContextKeyValue = ContextKeyValue> {
  readonly key: string;
  get(): T;
  set(value: T): void;
  reset(): void;
}

// ─── When Clause Types ───────────────────────────────────────────────────────

/**
 * Function that resolves a context key to its current value.
 * Returns undefined if the key is not set.
 */
export type ContextKeyLookup = (key: string) => unknown;

// ─── Workbench Context Types ─────────────────────────────────────────────────

/**
 * Minimal shape of a part we track for context. Avoids importing the Workbench class.
 */
export interface TrackablePart {
  readonly id: string;
  readonly visible: boolean;
  readonly onDidChangeVisibility: (listener: (visible: boolean) => void) => IDisposable;
}

/**
 * Minimal shape of a view manager we track for context.
 */
export interface TrackableViewManager {
  readonly activeViewId: string | undefined;
  readonly onDidChangeActiveView: (listener: (viewId: string | undefined) => void) => IDisposable;
}
