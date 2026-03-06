// staleGuard.ts — stale session guard utility
//
// Lightweight utility for async operations to detect whether the
// workspace session changed while they were in-flight.
//
// Usage:
//   const guard = captureSession(sessionManager);
//   const result = await expensiveAsyncWork();
//   if (!guard.isValid()) {
//     console.log('Session changed — discarding stale result');
//     return;
//   }
//   commitResult(result);

import type { ISessionManager } from '../services/serviceTypes.js';

// ─── Guard ───────────────────────────────────────────────────────────────────

export interface SessionGuard {
  /** The session ID that was current when the guard was created. */
  readonly sessionId: string;

  /** Returns `true` if the captured session is still the active one. */
  isValid(): boolean;
}

/**
 * Capture the current session identity.
 *
 * The returned guard's `isValid()` method returns `false` if:
 *   - `endSession()` was called (workspace switch / page unload)
 *   - `beginSession()` was called with a different workspace
 *   - There was no active session when the guard was created
 *
 * Cost: one string comparison per `isValid()` call. Zero allocations
 * after the initial guard creation.
 */
export function captureSession(mgr: ISessionManager): SessionGuard {
  const captured = mgr.activeContext?.sessionId ?? '';
  return {
    sessionId: captured,
    isValid: () => {
      if (!captured) return false;                       // no session at capture time
      return mgr.activeContext?.sessionId === captured;   // same session still active
    },
  };
}
