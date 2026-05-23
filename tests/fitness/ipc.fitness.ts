/**
 * M84 Slice B — IPC count / duration baseline.
 *
 * Launches the app, installs the main-process IPC counter, waits for
 * workbench-ready, then idles for a settle window so deferred IPC drains.
 * Aggregates per-channel call count and p50/p95/p99 duration plus
 * overall totals.
 *
 * Methodology mirrors Slice A:
 *   - 5 cold launches.
 *   - First sample discarded as warmup.
 *   - p50/p95/p99 per channel; totalCalls and totalDurationMs across all.
 *   - Tolerance band p95 × 1.25 on every metric.
 *
 * Note on coverage: the counter attaches AFTER `electron.launch()`
 * returns (post-`app.whenReady`). Handlers invoked DURING that window
 * are missed. This is acceptable because Slice A already measures the
 * launch path itself; Slice B targets the workflow IPC that any SR-5+
 * change is most likely to amplify.
 *
 * Anti-list compliance: no `electron/*` source modified. The counter
 * monkey-patches `ipcMain._invokeHandlers` at test time via Playwright's
 * `electronApp.evaluate()`. See `_shared/ipcCounter.ts` for rationale.
 */

import { test } from '@playwright/test';
import {
  closeFitnessApp,
  createFitnessWorkspace,
  cleanupFitnessWorkspace,
  launchForFitness,
} from './_shared/launcher';
import { nowMs } from './_shared/timer';
import {
  aggregateIpcLog,
  drainIpcLog,
  installIpcCounter,
  type IpcAggregate,
} from './_shared/ipcCounter';
import {
  deriveModuleStatus,
  statsFromSamples,
  writeModuleReport,
  type FitnessModuleReport,
} from './_shared/reportWriter';

const SAMPLE_COUNT = 5;
const WORKBENCH_READY_SELECTOR = '[data-part-id="workbench.parts.titlebar"]';
const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 3000;

test.describe.configure({ mode: 'serial' });

test('M84 Slice B — IPC count/duration baseline (5 cold launches)', async () => {
  test.setTimeout(SAMPLE_COUNT * (READY_TIMEOUT_MS + SETTLE_MS + 10_000) + 30_000);

  const totalCallsSamples: number[] = [];
  const totalDurationSamples: number[] = [];
  const channelCountSamples: number[] = [];
  // Snapshot the perChannel aggregate from the LAST measured run so the
  // report includes a representative per-channel breakdown. The aggregate
  // numbers (totalCalls, totalDurationMs) are aggregated across runs.
  let lastPerChannel: IpcAggregate['perChannel'] = {};
  const notes: string[] = [];

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const workspaceDir = await createFitnessWorkspace();
    const app = await launchForFitness();
    try {
      // Attach as early as possible. We accept that boot-time IPC is missed.
      await installIpcCounter(app);

      const window = await app.firstWindow();
      await window.waitForSelector(WORKBENCH_READY_SELECTOR, { timeout: READY_TIMEOUT_MS });

      // Capture the full IPC log from attach through ready + settle.
      // This measures the cold-start workflow IPC (the bulk of post-boot
      // calls the app makes to bring the workbench up).
      const tSettleStart = nowMs();
      while (nowMs() - tSettleStart < SETTLE_MS) {
        await new Promise((r) => setTimeout(r, 100));
      }

      const log = await drainIpcLog(app);
      const agg = aggregateIpcLog(log);

      totalCallsSamples.push(agg.totalCalls);
      totalDurationSamples.push(agg.totalDurationMs);
      channelCountSamples.push(Object.keys(agg.perChannel).length);
      lastPerChannel = agg.perChannel;

      if (i === 0 && agg.totalCalls === 0) {
        notes.push(
          'run 0: zero IPC observed in settle window. If this persists across runs the ' +
          '_invokeHandlers private API may have moved.',
        );
      }
    } finally {
      await closeFitnessApp(app);
      await cleanupFitnessWorkspace(workspaceDir);
    }
  }

  // Discard warmup.
  const dropWarmup = <T>(arr: T[]): T[] => (arr.length > 1 ? arr.slice(1) : arr);
  const calls = dropWarmup(totalCallsSamples);
  const duration = dropWarmup(totalDurationSamples);
  const channels = dropWarmup(channelCountSamples);

  const metrics: FitnessModuleReport['metrics'] = {
    totalCallsPerRun: statsFromSamples(calls),
    totalDurationMsPerRun: statsFromSamples(duration),
    distinctChannelsPerRun: statsFromSamples(channels),
  };

  const status = deriveModuleStatus(metrics);

  notes.push(
    `${SAMPLE_COUNT} cold launches; first sample discarded as warmup.`,
    `Settle window: ${SETTLE_MS}ms idle after workbench-ready selector.`,
    'Counter installed AFTER electron.launch() returns; boot IPC excluded by design (Slice A covers launch path).',
    'Tolerance = p95 × 1.25 per docs/research/M84_FITNESS_HARNESS_AUDIT.md §7.',
    `Per-channel breakdown (from last run): ${Object.keys(lastPerChannel).length} channels`,
  );

  // Top 10 channels by total time spent — emitted as a note for visibility.
  const top = Object.entries(lastPerChannel)
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .slice(0, 10);
  for (const [channel, s] of top) {
    notes.push(`  ${channel}: count=${s.count} p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms total=${s.totalMs}ms`);
  }

  const report: FitnessModuleReport = {
    name: 'ipc',
    status,
    metrics,
    notes,
  };

  writeModuleReport(report);
});
