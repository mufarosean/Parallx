/**
 * Fitness report writer (M84 / SR-4).
 *
 * Implements the JSON schema v1 defined in
 * `docs/research/M84_FITNESS_HARNESS_AUDIT.md` §7.
 *
 * Per-module fitness tests write a single JSON file under
 * `process.env.PARALLX_FITNESS_OUT` (a tmp directory) when present. The
 * composer at `scripts/run-fitness.mjs` reads those per-module files and
 * merges them into the final report under `data/fitness-reports/`.
 *
 * If `PARALLX_FITNESS_OUT` is absent (e.g. when a fitness module is run
 * directly via `npx playwright test --config=playwright.fitness.config.ts`
 * without the composer), the writer falls back to logging the JSON to
 * `console.log` with a `[fitness-report]` prefix so it can still be
 * scraped.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { round1, percentile, type DurationMs } from './timer';

export const SCHEMA_VERSION = 1;

export interface FitnessSampleStats {
  p50: number;
  p95: number;
  samples: number;
}

export interface FitnessMetricEntry {
  /** Statistics computed from a sample array. */
  stats: FitnessSampleStats;
  /** Upper bound for `stats.p95` that the metric must not exceed. */
  tolerance: number;
}

export interface FitnessModuleReport {
  name: string;
  status: 'ok' | 'fail' | 'skipped';
  metrics: Record<string, FitnessMetricEntry>;
  notes?: string[];
}

export interface FitnessReport {
  schemaVersion: number;
  milestone: 'M84';
  ranAt: string;
  provenance: {
    gitHead: string | null;
    nodeVersion: string;
    electronVersion: string | null;
    hostOs: string;
  };
  modules: FitnessModuleReport[];
  overallStatus: 'ok' | 'fail';
}

/** Compute stats and tolerance from raw samples + optional explicit tolerance. */
export function statsFromSamples(
  raw: readonly DurationMs[],
  options?: { explicitTolerance?: number; toleranceFactor?: number },
): FitnessMetricEntry {
  const p50 = round1(percentile(raw, 0.5));
  const p95 = round1(percentile(raw, 0.95));
  const factor = options?.toleranceFactor ?? 1.25;
  const tolerance =
    options?.explicitTolerance != null ? options.explicitTolerance : round1(p95 * factor);
  return {
    stats: { p50, p95, samples: raw.length },
    tolerance,
  };
}

/** Decide module status by comparing each metric's p95 against its tolerance. */
export function deriveModuleStatus(metrics: Record<string, FitnessMetricEntry>): 'ok' | 'fail' {
  for (const entry of Object.values(metrics)) {
    if (entry.stats.p95 > entry.tolerance) return 'fail';
  }
  return 'ok';
}

function captureProvenance(): FitnessReport['provenance'] {
  let gitHead: string | null = null;
  try {
    const head = fs.readFileSync(
      path.resolve(process.cwd(), '.git', 'HEAD'),
      'utf8',
    ).trim();
    if (head.startsWith('ref: ')) {
      const refPath = path.resolve(process.cwd(), '.git', head.slice(5));
      gitHead = fs.readFileSync(refPath, 'utf8').trim().slice(0, 8);
    } else {
      gitHead = head.slice(0, 8);
    }
  } catch { /* not a git checkout */ }
  return {
    gitHead,
    nodeVersion: process.version,
    electronVersion: process.versions.electron ?? null,
    hostOs: `${os.platform()} ${os.release()}`,
  };
}

/**
 * Write a single module's report.
 *
 * Used by per-module fitness tests. The composer (`scripts/run-fitness.mjs`)
 * picks up these per-module files and merges them.
 */
export function writeModuleReport(report: FitnessModuleReport): void {
  const outDir = process.env.PARALLX_FITNESS_OUT;
  const payload = JSON.stringify(report, null, 2);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${report.name}.json`);
    fs.writeFileSync(file, payload, 'utf8');
    return;
  }
  // Fallback: emit prefixed JSON for log scraping.
  // eslint-disable-next-line no-console
  console.log(`[fitness-report] ${payload}`);
}

/** Build the top-level report from per-module reports (used by composer). */
export function composeReport(modules: FitnessModuleReport[]): FitnessReport {
  const overallStatus: 'ok' | 'fail' = modules.some((m) => m.status === 'fail') ? 'fail' : 'ok';
  return {
    schemaVersion: SCHEMA_VERSION,
    milestone: 'M84',
    ranAt: new Date().toISOString(),
    provenance: captureProvenance(),
    modules,
    overallStatus,
  };
}
