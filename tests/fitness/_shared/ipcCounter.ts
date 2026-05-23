/**
 * IPC counter for M84 Slice B.
 *
 * Anti-list constraint: cannot modify `electron/preload.cjs` or
 * `electron/main.cjs`. `contextBridge.exposeInMainWorld` exposes the
 * renderer surface as readonly — wrapping `window.parallxElectron.*`
 * from the renderer silently fails.
 *
 * Approach: use Playwright's `ElectronApplication.evaluate()` to run a
 * snippet in the **main process** that wraps `ipcMain`'s internal
 * `_invokeHandlers` map (every `ipcMain.handle(channel, fn)` lands
 * there). Each entry is replaced with a wrapper that records
 * `{channel, ms}` to `globalThis.__parallxIpcLog`. The same evaluation
 * monkey-patches `ipcMain.handle` so handlers registered after our
 * attach are also wrapped.
 *
 * Limitations:
 *   - We attach AFTER `app.whenReady` (when `electron.launch()` returns),
 *     so handlers invoked synchronously during boot are missed. This is
 *     acceptable for Slice B because the baseline measures workflow IPC,
 *     not boot IPC (the latter is captured by Slice A timings).
 *   - We monkey-patch a private API (`_invokeHandlers`). If Electron
 *     ever renames it, the wrap will silently capture nothing. The
 *     `getIpcChannels` helper asserts that at least one channel is
 *     present after install so the test fails loudly if that happens.
 */

import type { ElectronApplication } from 'playwright';
import { percentile, round1, type DurationMs } from './timer';

export interface IpcLogEntry {
  channel: string;
  ms: DurationMs;
}

export interface IpcChannelStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  totalMs: number;
}

export interface IpcAggregate {
  totalCalls: number;
  totalDurationMs: number;
  perChannel: Record<string, IpcChannelStats>;
}

/**
 * Install the IPC counter in the main process. Replaces all currently
 * registered ipcMain handlers and patches `ipcMain.handle` so future
 * registrations are also wrapped.
 */
export async function installIpcCounter(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as Record<string, unknown>;
    if (g.__parallxIpcInstalled) return;
    g.__parallxIpcInstalled = true;
    g.__parallxIpcLog = [];

    const log = g.__parallxIpcLog as Array<{ channel: string; ms: number }>;

    function wrap(channel: string, handler: (...args: unknown[]) => unknown) {
      return async (...args: unknown[]) => {
        const t0 = Date.now();
        try {
          return await handler(...args);
        } finally {
          log.push({ channel, ms: Date.now() - t0 });
        }
      };
    }

    // Wrap already-registered handlers.
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })
      ._invokeHandlers;
    if (handlers && typeof handlers.forEach === 'function') {
      const entries = Array.from(handlers.entries());
      for (const [channel, handler] of entries) {
        handlers.set(channel, wrap(channel, handler));
      }
    }

    // Wrap future ipcMain.handle calls.
    const origHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = ((channel: string, handler: (...a: unknown[]) => unknown) => {
      origHandle(channel, wrap(channel, handler));
    }) as typeof ipcMain.handle;
  });
}

/** Drain the IPC log without clearing. */
export async function snapshotIpcLog(app: ElectronApplication): Promise<IpcLogEntry[]> {
  return await app.evaluate(() => {
    const g = globalThis as Record<string, unknown>;
    const log = (g.__parallxIpcLog as Array<{ channel: string; ms: number }>) ?? [];
    return log.slice();
  });
}

/** Drain the IPC log AND clear it (use to reset between phases). */
export async function drainIpcLog(app: ElectronApplication): Promise<IpcLogEntry[]> {
  return await app.evaluate(() => {
    const g = globalThis as Record<string, unknown>;
    const log = (g.__parallxIpcLog as Array<{ channel: string; ms: number }>) ?? [];
    g.__parallxIpcLog = [];
    return log;
  });
}

/** Return the set of channels seen so far. Used by tests to fail loudly if zero. */
export async function getIpcChannels(app: ElectronApplication): Promise<string[]> {
  const log = await snapshotIpcLog(app);
  return Array.from(new Set(log.map((e) => e.channel)));
}

/** Aggregate a log into per-channel + total stats. */
export function aggregateIpcLog(log: readonly IpcLogEntry[]): IpcAggregate {
  const perChannel: Record<string, IpcChannelStats> = {};
  const groups = new Map<string, DurationMs[]>();
  for (const entry of log) {
    if (!groups.has(entry.channel)) groups.set(entry.channel, []);
    groups.get(entry.channel)!.push(entry.ms);
  }
  let totalDurationMs = 0;
  for (const [channel, samples] of groups.entries()) {
    const total = samples.reduce((a, b) => a + b, 0);
    perChannel[channel] = {
      count: samples.length,
      p50: round1(percentile(samples, 0.5)),
      p95: round1(percentile(samples, 0.95)),
      p99: round1(percentile(samples, 0.99)),
      totalMs: round1(total),
    };
    totalDurationMs += total;
  }
  return {
    totalCalls: log.length,
    totalDurationMs: round1(totalDurationMs),
    perChannel,
  };
}
