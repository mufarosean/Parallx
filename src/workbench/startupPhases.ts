// startupPhases.ts — M86-W2 declarative startup-phase helper
//
// Bakes the M85-F3 invariant ("any new Phase 1 storage read must join the
// parallel-warm Promise.all") into a structural primitive. Authors declare
// warmups separately from the phase body; the helper handles the
// `await Promise.all(warmups)` step. Timing is reported so future
// startup-latency audits don't need ad-hoc instrumentation.
//
// This file ships standalone. workbench.ts is NOT migrated in this slice;
// migration is its own future slice. Tests exercise the helper directly.

import { getLogger, type ILogger } from '../platform/log.js';

export interface IStartupPhase<T> {
  /** Human-readable phase name; used in timing logs. */
  readonly name: string;
  /**
   * Side-effecting warmups that should overlap. Each returns a Promise.
   * Callers in the phase body may rely on these having completed.
   */
  readonly warmups?: ReadonlyArray<() => Promise<unknown>>;
  /**
   * Phase body. Runs after all warmups have settled.
   */
  body(): Promise<T>;
}

export interface IPhaseTiming {
  readonly name: string;
  readonly warmupMs: number;
  readonly bodyMs: number;
  readonly totalMs: number;
}

/**
 * Run a single phase. Warmups execute concurrently via Promise.all; the
 * body awaits all warmups before starting. A warmup that rejects causes
 * the whole phase to reject — callers wanting failure-tolerance should
 * wrap individual warmups in `.catch(...)`.
 *
 * Returns the phase body's result and emits a `perf` log record with timing.
 */
export async function runPhase<T>(
  phase: IStartupPhase<T>,
  logger: ILogger = getLogger(),
): Promise<{ value: T; timing: IPhaseTiming }> {
  const t0 = now();
  const warmups = phase.warmups ?? [];
  if (warmups.length > 0) {
    await Promise.all(warmups.map((w) => w()));
  }
  const t1 = now();
  const value = await phase.body();
  const t2 = now();
  const timing: IPhaseTiming = {
    name: phase.name,
    warmupMs: t1 - t0,
    bodyMs: t2 - t1,
    totalMs: t2 - t0,
  };
  logger.info('perf', `startup phase: ${phase.name}`, timing);
  return { value, timing };
}

/**
 * Sequence a list of phases. Each phase runs to completion (warmups +
 * body) before the next begins. Returns the array of phase timings so
 * callers can surface them in a diagnostics panel.
 */
export async function runPhasesSequential(
  phases: ReadonlyArray<IStartupPhase<unknown>>,
  logger: ILogger = getLogger(),
): Promise<IPhaseTiming[]> {
  const out: IPhaseTiming[] = [];
  for (const phase of phases) {
    const { timing } = await runPhase(phase, logger);
    out.push(timing);
  }
  return out;
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
