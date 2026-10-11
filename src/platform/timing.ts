// timing.ts — debounce and sleep, once.
//
// Eighty-odd places had written "clearTimeout(t); t = setTimeout(...)" by
// hand, and two had their own `delay`. These are the shared ones; `api.ui`
// hands `debounce` to extensions as well. (`rafThrottle` is the per-frame
// cousin for mouse and scroll handlers.)

export interface DebouncedFn<A extends unknown[]> {
  (...args: A): void;
  /** Drop the pending call, if any. Call from your dispose/teardown. */
  cancel(): void;
  /** Run the pending call now (if any) instead of waiting out the delay. */
  flush(): void;
  /** Whether a call is waiting. */
  readonly pending: boolean;
}

/**
 * Wrap `fn` so a burst of calls runs it once, `ms` after the last call,
 * with the arguments of that last call.
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): DebouncedFn<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;
  const run = (): void => {
    timer = undefined;
    const args = lastArgs;
    lastArgs = undefined;
    if (args) fn(...args);
  };
  const debounced = ((...args: A): void => {
    lastArgs = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as DebouncedFn<A>;
  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    lastArgs = undefined;
  };
  debounced.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    run();
  };
  Object.defineProperty(debounced, 'pending', { get: () => timer !== undefined });
  return debounced;
}

/** Resolve after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
