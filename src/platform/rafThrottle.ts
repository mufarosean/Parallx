// rafThrottle.ts — coalesce high-frequency callbacks to one run per frame
//
// mousemove / scroll / resize / dragover fire far more often than the display
// refreshes, and their handlers usually do forced-layout work (posAtCoords,
// getBoundingClientRect, getComputedStyle). Running that per event is the
// single most common source of workbench jank. `rafThrottle` collapses a burst
// of calls into ONE invocation on the next animation frame, using the LATEST
// arguments — so the handler runs at most once per painted frame.
//
// This is the ONE shared throttle primitive for the whole app: the built-in
// workbench imports it directly; external extensions get the exact same
// function via `api.ui.rafThrottle`, so hot-path throttling is consistent
// everywhere and no surface reinvents (or forgets) it.

export interface RafThrottledFn<A extends unknown[]> {
  (...args: A): void;
  /** Cancel any pending frame. Call from your dispose/teardown. */
  dispose(): void;
  /** Run the pending invocation now (if any) and cancel the scheduled frame. */
  flush(): void;
}

// Fall back to a ~60fps timer when rAF is unavailable (non-DOM test/SSR).
const _raf: (cb: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16) as unknown as number;
const _caf: (handle: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? (h) => cancelAnimationFrame(h)
    : (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>);

/**
 * Wrap `fn` so repeated calls within a frame coalesce into a single call on the
 * next animation frame, invoked with the arguments from the MOST RECENT call.
 *
 * @example
 *   private readonly _onMove = rafThrottle((e: MouseEvent) => this._reposition(e));
 *   el.addEventListener('mousemove', this._onMove);
 *   // in dispose(): this._onMove.dispose();
 */
export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void): RafThrottledFn<A> {
  let handle: number | null = null;
  let latest: A | null = null;

  const run = (): void => {
    handle = null;
    const args = latest;
    latest = null;
    if (args) fn(...args);
  };

  const wrapped = ((...args: A): void => {
    latest = args;
    if (handle === null) {
      handle = _raf(run);
    }
  }) as RafThrottledFn<A>;

  wrapped.dispose = (): void => {
    if (handle !== null) { _caf(handle); handle = null; }
    latest = null;
  };

  wrapped.flush = (): void => {
    if (handle !== null) { _caf(handle); handle = null; run(); }
  };

  return wrapped;
}
