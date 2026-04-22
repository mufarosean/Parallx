/**
 * W2 (M58) — Integration test for HeartbeatRunner + HeartbeatTurnExecutor
 * wiring.
 *
 * Proves:
 *   1. Interval ticks route a status-surface delivery stamped with
 *      ORIGIN_HEARTBEAT when enabled and events are pending.
 *   2. pushEvent → immediate system-event tick → surface delivery with
 *      origin tag round-trips through getDeliveriesByOrigin().
 *   3. Heartbeat disabled in config → no timer, no deliveries.
 *   4. Reasons allowlist filters: if the tick reason is not in
 *      `config.heartbeat.reasons`, the executor stays silent (no surface
 *      delivery).
 *   5. `runner.wake('wake')` fires a delivery even when no events are
 *      queued (wake bypasses the "no-events" gate).
 *   6. Feedback-loop guard: the executor's own deliveries carry
 *      ORIGIN_HEARTBEAT, so downstream consumers can distinguish them
 *      from user- or agent-authored writes via `getDeliveriesByOrigin`.
 *
 * Upstream: heartbeat-runner.ts tick lifecycle + surface delivery origin
 * tagging (M58 W6).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  HeartbeatRunner,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  type IHeartbeatConfig,
} from '../../src/openclaw/openclawHeartbeatRunner';
import { createHeartbeatTurnExecutor } from '../../src/openclaw/openclawHeartbeatExecutor';
import {
  SurfaceRouterService,
  ORIGIN_HEARTBEAT,
  getDeliveryOrigin,
} from '../../src/services/surfaceRouterService';
import {
  SURFACE_STATUS,
  type ISurfaceDelivery,
  type ISurfacePlugin,
  type ISurfaceCapabilities,
} from '../../src/openclaw/openclawSurfacePlugin';
import type { HeartbeatReasonKey } from '../../src/aiSettings/unifiedConfigTypes';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ALL_REASONS: readonly HeartbeatReasonKey[] = [
  'interval', 'system-event', 'cron', 'wake', 'hook',
];

class FakeStatusPlugin implements ISurfacePlugin {
  readonly id = SURFACE_STATUS;
  readonly capabilities: ISurfaceCapabilities = {
    supportsText: true,
    supportsStructured: false,
    supportsBinary: false,
    supportsActions: false,
  };
  readonly deliveries: ISurfaceDelivery[] = [];

  isAvailable(): boolean { return true; }
  async deliver(delivery: ISurfaceDelivery): Promise<boolean> {
    this.deliveries.push(delivery);
    return true;
  }
  dispose(): void {}
}

interface IHarness {
  router: SurfaceRouterService;
  status: FakeStatusPlugin;
  runner: HeartbeatRunner;
  config: { enabled: boolean; intervalMs: number; reasons: HeartbeatReasonKey[] };
}

function createHarness(overrides?: {
  enabled?: boolean;
  intervalMs?: number;
  reasons?: HeartbeatReasonKey[];
}): IHarness {
  const router = new SurfaceRouterService();
  const status = new FakeStatusPlugin();
  router.registerSurface(status);

  const config = {
    enabled: overrides?.enabled ?? true,
    intervalMs: overrides?.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    reasons: overrides?.reasons ?? [...ALL_REASONS],
  };

  const executor = createHeartbeatTurnExecutor(router, () => ({ reasons: config.reasons }));
  const readConfig = (): IHeartbeatConfig => ({
    enabled: config.enabled,
    intervalMs: config.intervalMs,
  });
  const runner = new HeartbeatRunner(executor, readConfig);

  return { router, status, runner, config };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HeartbeatRunner wiring (M58 W2)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('interval tick routes to status surface when events pending and enabled', async () => {
    const h = createHarness();
    h.runner.start();

    // push an event so the "skipped-no-events" gate passes on interval
    h.runner.pushEvent({ type: 'file-change', payload: { path: '/a.ts' }, timestamp: Date.now() });
    // drain the immediate system-event tick
    await vi.runOnlyPendingTimersAsync();

    // clear deliveries from the immediate system-event tick
    const beforeInterval = h.status.deliveries.length;
    expect(beforeInterval).toBeGreaterThan(0); // immediate system-event tick already fired

    // push another event so the next interval tick has work to do
    h.runner.pushEvent({ type: 'file-change', payload: { path: '/b.ts' }, timestamp: Date.now() });
    // ^ this also triggers an immediate tick because _pendingEvents.length === 1
    await vi.runOnlyPendingTimersAsync();

    // All deliveries should carry ORIGIN_HEARTBEAT
    for (const d of h.status.deliveries) {
      expect(getDeliveryOrigin(d)).toBe(ORIGIN_HEARTBEAT);
    }

    h.runner.dispose();
  });

  it('pushEvent triggers an immediate system-event tick with origin tag', async () => {
    const h = createHarness();
    h.runner.start();

    h.runner.pushEvent({ type: 'file-change', payload: { path: '/x' }, timestamp: 1 });
    await vi.runOnlyPendingTimersAsync();

    const historical = h.router.getDeliveriesByOrigin(ORIGIN_HEARTBEAT);
    expect(historical.length).toBeGreaterThan(0);
    expect(historical.every((d) => d.surfaceId === SURFACE_STATUS)).toBe(true);

    h.runner.dispose();
  });

  it('disabled config: start() is inert, pushEvent does not deliver', async () => {
    const h = createHarness({ enabled: false });
    h.runner.start();

    h.runner.pushEvent({ type: 'file-change', payload: { path: '/x' }, timestamp: 1 });
    await vi.runOnlyPendingTimersAsync();

    expect(h.status.deliveries).toHaveLength(0);
    expect(h.router.getDeliveriesByOrigin(ORIGIN_HEARTBEAT)).toHaveLength(0);

    h.runner.dispose();
  });

  it('reasons allowlist: reason not in list → executor stays silent', async () => {
    // Only allow 'cron' — heartbeat's own interval/system-event/wake are blocked.
    const h = createHarness({ reasons: ['cron'] });
    h.runner.start();

    h.runner.pushEvent({ type: 'file-change', payload: {}, timestamp: 1 });
    await vi.runOnlyPendingTimersAsync();
    h.runner.wake('wake');
    await vi.runOnlyPendingTimersAsync();

    expect(h.status.deliveries).toHaveLength(0);

    // Flip allowlist live → next tick should deliver.
    h.config.reasons = [...ALL_REASONS];
    h.runner.wake('wake');
    await vi.runOnlyPendingTimersAsync();
    expect(h.status.deliveries.length).toBeGreaterThan(0);

    h.runner.dispose();
  });

  it('wake bypasses the no-events gate', async () => {
    const h = createHarness();
    h.runner.start();

    // No events queued — an interval tick would skip, but wake should fire.
    h.runner.wake('wake');
    await vi.runOnlyPendingTimersAsync();

    const historical = h.router.getDeliveriesByOrigin(ORIGIN_HEARTBEAT);
    expect(historical.length).toBeGreaterThan(0);

    h.runner.dispose();
  });

  it('feedback-loop guard: every delivery carries ORIGIN_HEARTBEAT', async () => {
    const h = createHarness();
    h.runner.start();

    h.runner.pushEvent({ type: 'index-complete', payload: {}, timestamp: 1 });
    await vi.runOnlyPendingTimersAsync();
    h.runner.wake('wake');
    await vi.runOnlyPendingTimersAsync();

    const all = h.router.deliveryHistory;
    expect(all.length).toBeGreaterThan(0);
    for (const d of all) {
      expect(getDeliveryOrigin(d)).toBe(ORIGIN_HEARTBEAT);
    }

    h.runner.dispose();
  });

  it('surface deliveries are not consumed as new events (guard by contract)', async () => {
    // The heartbeat runner's event sources are file watcher / indexer /
    // workspace folders — NONE of them read from SurfaceRouter history.
    // Emitting to the status surface cannot re-enter pushEvent. We assert
    // the public contract: pushEvent is the only event entry point.
    const h = createHarness();
    h.runner.start();

    // Fire many heartbeat deliveries, verify pendingEventCount stays 0.
    h.runner.wake('wake');
    await vi.runOnlyPendingTimersAsync();
    h.runner.wake('wake');
    await vi.runOnlyPendingTimersAsync();

    expect(h.runner.pendingEventCount).toBe(0);
    h.runner.dispose();
  });
});
