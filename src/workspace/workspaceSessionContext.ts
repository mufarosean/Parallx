// workspaceSessionContext.ts — workspace session identity model
//
// A WorkspaceSessionContext carries everything a service needs to know about
// the current workspace session: stable workspace ID, per-open session ID,
// root paths, abort primitives, and a diagnostic log prefix.
//
// Created by SessionManager on every open / switch. Session A's context
// is invalidated when Session B begins.

import type { URI } from '../platform/uri.js';

// ─── Interface ───────────────────────────────────────────────────────────────

/**
 * Immutable snapshot of the current workspace session.
 *
 * Passed to services at activation time. Async operations capture the
 * `sessionId` at start and validate it before committing results —
 * if the session changed mid-flight, the result is stale and must be
 * discarded.
 *
 * VS Code achieves this implicitly via per-window process isolation.
 * Parallx uses a single window with full-page reload, so this context
 * provides the same guarantees explicitly.
 */
export interface IWorkspaceSessionContext {
  /** Stable identifier from workspace config (persisted across sessions). */
  readonly workspaceId: string;

  /** Fresh UUID created on every open / switch. Never reused. */
  readonly sessionId: string;

  /** Workspace root folders (snapshot at session start). */
  readonly roots: readonly URI[];

  /** Primary root URI (convenience — `roots[0]`). `undefined` for empty workspaces. */
  readonly primaryRoot: URI | undefined;

  /** AbortController — signalled when this session ends. */
  readonly abortController: AbortController;

  /** Convenience: `abortController.signal`. */
  readonly cancellationSignal: AbortSignal;

  /** Whether this session is still the active one. */
  isActive(): boolean;

  /** Diagnostic log prefix: `[ws:<workspaceId> sid:<sessionId>]`. */
  readonly logPrefix: string;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Concrete implementation of `IWorkspaceSessionContext`.
 *
 * Created exclusively by `SessionManager.beginSession()`.
 * Once `invalidate()` is called (by the SessionManager on session end),
 * `isActive()` returns `false` and the abort controller is signalled.
 */
export class WorkspaceSessionContext implements IWorkspaceSessionContext {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly roots: readonly URI[];
  readonly primaryRoot: URI | undefined;
  readonly abortController: AbortController;
  readonly cancellationSignal: AbortSignal;
  readonly logPrefix: string;

  private _active = true;

  constructor(workspaceId: string, sessionId: string, roots: readonly URI[]) {
    this.workspaceId = workspaceId;
    this.sessionId = sessionId;
    this.roots = roots;
    this.primaryRoot = roots[0];
    this.abortController = new AbortController();
    this.cancellationSignal = this.abortController.signal;

    // Short IDs for readability in logs (first 8 chars)
    const wsShort = workspaceId.length > 8 ? workspaceId.slice(0, 8) : workspaceId;
    const sidShort = sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
    this.logPrefix = `[ws:${wsShort} sid:${sidShort}]`;
  }

  isActive(): boolean {
    return this._active;
  }

  /**
   * Called by SessionManager when this session ends.
   * Marks the context as inactive and signals the abort controller.
   */
  invalidate(): void {
    if (!this._active) return;
    this._active = false;
    this.abortController.abort();
  }
}
