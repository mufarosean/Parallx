/**
 * Shared timing helpers for M84 fitness modules.
 *
 * Wraps `performance.now()` so module code reads cleanly and the
 * Playwright workers and Node composer share one source of truth.
 *
 * All durations are millisecond `number`s. Percentile helpers expect
 * already-collected sample arrays — they do not allocate measurement
 * state themselves.
 */

export type DurationMs = number;

/** Wall-clock `performance.now()`. Exported for readability at call sites. */
export function nowMs(): DurationMs {
  return performance.now();
}

/** Compute the inclusive p-quantile from an unsorted sample array. */
export function percentile(samples: readonly DurationMs[], p: number): DurationMs {
  if (samples.length === 0) return 0;
  if (p < 0 || p > 1) throw new Error(`percentile: p out of range: ${p}`);
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

/** Round to one decimal place for JSON report friendliness. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
