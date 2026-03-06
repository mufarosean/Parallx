// sessionLogger.ts — session-scoped diagnostic logger
//
// Thin wrapper that prepends the active session's logPrefix
// ([ws:abc123 sid:def456]) to every console output. Falls back to
// [ws:? sid:?] when no context is available.
//
// Usage:
//   const log = new SessionLogger(sessionContext);
//   log.info('Indexing started');        // → [ws:abc sid:def] Indexing started
//   log.warn('Stale result discarded');  // → [ws:abc sid:def] Stale result discarded
//
// Rules (M14):
//   - Never throws. If context is unavailable, falls back gracefully.
//   - Non-blocking. Logging must not delay the operation it instruments.

import type { IWorkspaceSessionContext } from './workspaceSessionContext.js';

// ─── Fallback prefix ────────────────────────────────────────────────────────

const UNKNOWN_PREFIX = '[ws:? sid:?]';

// ─── SessionLogger ──────────────────────────────────────────────────────────

/**
 * Diagnostic logger scoped to a workspace session.
 *
 * Each method delegates to the corresponding `console` method with the
 * session's `logPrefix` prepended.  If no context is available (or the
 * context was invalidated), a generic fallback prefix is used instead.
 */
export class SessionLogger {
  private _context: IWorkspaceSessionContext | undefined;

  constructor(context?: IWorkspaceSessionContext) {
    this._context = context;
  }

  /** Update the session context (e.g. after a workspace switch). */
  setContext(context: IWorkspaceSessionContext | undefined): void {
    this._context = context;
  }

  /** The current log prefix. */
  get prefix(): string {
    return this._context?.logPrefix ?? UNKNOWN_PREFIX;
  }

  /** Log at info level. */
  info(message: string, ...args: unknown[]): void {
    try {
      console.log(`${this.prefix} ${message}`, ...args);
    } catch {
      // Never throw from logging
    }
  }

  /** Log at warn level. */
  warn(message: string, ...args: unknown[]): void {
    try {
      console.warn(`${this.prefix} ${message}`, ...args);
    } catch {
      // Never throw from logging
    }
  }

  /** Log at error level. */
  error(message: string, ...args: unknown[]): void {
    try {
      console.error(`${this.prefix} ${message}`, ...args);
    } catch {
      // Never throw from logging
    }
  }

  /** Log at debug level. */
  debug(message: string, ...args: unknown[]): void {
    try {
      console.debug(`${this.prefix} ${message}`, ...args);
    } catch {
      // Never throw from logging
    }
  }
}
