// devMode.ts — shared dev-mode detection (platform utility, zero deps)
//
// Single source of truth for detecting dev vs. production mode.
// All canvas consumers import this instead of duplicating the IIFE.

/**
 * `true` when running in development or test mode; `false` in production.
 *
 * Resolution order:
 *   1. `window.parallxElectron.testMode` (Playwright / E2E tests)
 *   2. `process.env.NODE_ENV !== 'production'` (Node / Electron main)
 *   3. Defaults to `true` (safe for dev — invariant checks always run)
 */
export const isDevMode: boolean = (() => {
  if (typeof window !== 'undefined' && (window as any).parallxElectron?.testMode) {
    return true;
  }
  const proc = (globalThis as any).process;
  if (proc?.env?.NODE_ENV) {
    return proc.env.NODE_ENV !== 'production';
  }
  return true;
})();
