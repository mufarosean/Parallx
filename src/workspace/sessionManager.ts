// sessionManager.ts — workspace session lifecycle manager
//
// Owns the lifecycle of WorkspaceSessionContext instances.
// On every workspace open / switch, beginSession() creates a fresh context
// (with a new UUID) and invalidates the previous one.
//
// Services read `sessionManager.activeContext` for the current session.
// Async operations use captureSession() (from staleGuard.ts) to detect
// stale results.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import type { URI } from '../platform/uri.js';
import type { ISessionManager } from '../services/serviceTypes.js';
import { WorkspaceSessionContext } from './workspaceSessionContext.js';
import type { IWorkspaceSessionContext } from './workspaceSessionContext.js';

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Concrete session manager.
 *
 * Registered as an eager singleton in `workbenchServices.ts`.
 * Wired into the workbench lifecycle:
 *   - Phase 4 (`_restoreWorkspace`): `beginSession()`
 *   - `switchWorkspace()`: `endSession()` before reload
 */
export class SessionManager extends Disposable implements ISessionManager {
  private _activeContext: WorkspaceSessionContext | undefined;

  private readonly _onDidChangeSession = this._register(new Emitter<IWorkspaceSessionContext | undefined>());
  readonly onDidChangeSession: Event<IWorkspaceSessionContext | undefined> = this._onDidChangeSession.event;

  get activeContext(): IWorkspaceSessionContext | undefined {
    return this._activeContext;
  }

  beginSession(workspaceId: string, roots: readonly URI[]): IWorkspaceSessionContext {
    // Invalidate the previous session (if any)
    if (this._activeContext) {
      this._activeContext.invalidate();
    }

    const sessionId = crypto.randomUUID();
    const context = new WorkspaceSessionContext(workspaceId, sessionId, roots);
    this._activeContext = context;

    console.log('%s Session started', context.logPrefix);
    this._onDidChangeSession.fire(context);
    return context;
  }

  endSession(): void {
    if (!this._activeContext) return;

    const prefix = this._activeContext.logPrefix;
    this._activeContext.invalidate();
    this._activeContext = undefined;

    console.log('%s Session ended', prefix);
    this._onDidChangeSession.fire(undefined);
  }

  override dispose(): void {
    // End any active session before disposal
    this.endSession();
    super.dispose();
  }
}
