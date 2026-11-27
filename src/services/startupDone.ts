// startupDone.ts — the moment the window has finished starting.
//
// The tabs of the last session are put back after the tools start, so a tool
// that opens something of its own at startup has to wait for them, or its
// tab is put behind theirs. `afterStartup` runs the function once the tabs
// are back (at once, when they already are).

let done = false;
const waiting: (() => void)[] = [];

export function afterStartup(fn: () => void): void {
  if (done) fn(); else waiting.push(fn);
}

/** Called by the workbench, once, when the last session's tabs are back. */
export function markStartupDone(): void {
  done = true;
  for (const fn of waiting.splice(0)) { try { fn(); } catch (err) { console.error('[startup]', err); } }
}
