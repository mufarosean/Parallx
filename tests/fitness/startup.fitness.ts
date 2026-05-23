/**
 * M84 Slice A — Startup fitness baseline.
 *
 * Measures three durations across N cold launches of the Electron app:
 *
 *   launchToFirstWindowMs   — `electron.launch()` returns to first window object.
 *   launchToWorkbenchReadyMs — first window's titlebar selector becomes visible.
 *   launchToFirstEditorMs    — first editor pane mounts (or `SAMPLE_LIMIT` ms ceiling).
 *
 * Methodology mirrors `docs/research/M84_FITNESS_HARNESS_AUDIT.md` §6.1:
 *   - 5 cold launches.
 *   - First sample discarded as warmup.
 *   - p50/p95 computed from the remaining 4.
 *   - Tolerance = p95 × 1.25 (default audit policy).
 *
 * Output: a single JSON file at `${PARALLX_FITNESS_OUT}/startup.json` when
 * the env var is set (composer mode); otherwise logged via
 * `[fitness-report] {…}` for scraping.
 *
 * Anti-list compliance: no `electron/*` source modified; the renderer is
 * only observed through the existing titlebar selector contract.
 */

import { test } from '@playwright/test';
import {
  closeFitnessApp,
  createFitnessWorkspace,
  cleanupFitnessWorkspace,
  launchForFitness,
} from './_shared/launcher';
import { nowMs, type DurationMs } from './_shared/timer';
import {
  deriveModuleStatus,
  statsFromSamples,
  writeModuleReport,
  type FitnessModuleReport,
} from './_shared/reportWriter';

const SAMPLE_COUNT = 5;
const WORKBENCH_READY_SELECTOR = '[data-part-id="workbench.parts.titlebar"]';
const FIRST_EDITOR_SELECTOR = '[data-part-id="workbench.parts.editor"]';
const READY_TIMEOUT_MS = 30_000;
const FIRST_EDITOR_TIMEOUT_MS = 30_000;

test.describe.configure({ mode: 'serial' });

test('M84 Slice A — startup baseline (5 cold launches)', async () => {
  test.setTimeout(SAMPLE_COUNT * (READY_TIMEOUT_MS + FIRST_EDITOR_TIMEOUT_MS) + 30_000);

  const launchToFirstWindow: DurationMs[] = [];
  const launchToWorkbenchReady: DurationMs[] = [];
  const launchToFirstEditor: DurationMs[] = [];
  const firstEditorNotes: string[] = [];

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const workspaceDir = await createFitnessWorkspace();
    const t0 = nowMs();
    const app = await launchForFitness();
    try {
      const window = await app.firstWindow();
      const tFirstWindow = nowMs();
      launchToFirstWindow.push(tFirstWindow - t0);

      await window.waitForSelector(WORKBENCH_READY_SELECTOR, { timeout: READY_TIMEOUT_MS });
      const tReady = nowMs();
      launchToWorkbenchReady.push(tReady - t0);

      try {
        await window.waitForSelector(FIRST_EDITOR_SELECTOR, { timeout: FIRST_EDITOR_TIMEOUT_MS });
        launchToFirstEditor.push(nowMs() - t0);
      } catch {
        // Empty workspace may render no editor pane. Treat as "ready alone."
        firstEditorNotes.push(`run ${i}: no editor pane within ${FIRST_EDITOR_TIMEOUT_MS}ms`);
      }
    } finally {
      await closeFitnessApp(app);
      await cleanupFitnessWorkspace(workspaceDir);
    }
  }

  // Discard warmup (first sample) per audit §11 first-run risk mitigation.
  const dropWarmup = <T>(arr: T[]): T[] => (arr.length > 1 ? arr.slice(1) : arr);
  const fw = dropWarmup(launchToFirstWindow);
  const wb = dropWarmup(launchToWorkbenchReady);
  const ed = dropWarmup(launchToFirstEditor);

  const metrics: FitnessModuleReport['metrics'] = {
    launchToFirstWindowMs: statsFromSamples(fw),
    launchToWorkbenchReadyMs: statsFromSamples(wb),
  };
  if (ed.length > 0) {
    metrics.launchToFirstEditorMs = statsFromSamples(ed);
  }

  const status = deriveModuleStatus(metrics);

  const notes: string[] = [
    `${SAMPLE_COUNT} cold launches; first sample discarded as warmup.`,
    `Selectors: workbench-ready="${WORKBENCH_READY_SELECTOR}", first-editor="${FIRST_EDITOR_SELECTOR}".`,
    'Tolerance = p95 × 1.25 per docs/research/M84_FITNESS_HARNESS_AUDIT.md §7.',
  ];
  if (firstEditorNotes.length > 0) notes.push(...firstEditorNotes);

  const report: FitnessModuleReport = {
    name: 'startup',
    status,
    metrics,
    notes,
  };

  writeModuleReport(report);
});
