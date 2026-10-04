// settleDomTimers.ts — vitest setup file (vitest.config.ts `setupFiles`).
//
// ProseMirror's DOM observer, when it stops with records pending, flushes them
// on a 20 ms window.setTimeout. A jsdom test file that ends inside that window
// tears the environment down first; the timer then fires with no `document`
// and vitest reports "document is not defined" as an unhandled error, failing
// the whole run. It happened only on a loaded machine, in whichever editor
// test file finished at the wrong moment. Letting such timers run before the
// environment goes keeps the run clean. Files without a DOM are untouched.

import { afterAll } from 'vitest';

// Captured before any test file runs, so a file that left fake timers on
// cannot stall this wait.
const realSetTimeout = globalThis.setTimeout;

afterAll(async () => {
  if (typeof document === 'undefined') return;
  await new Promise<void>((resolve) => { realSetTimeout(resolve, 60); });
});
