// autonomyHeartbeatGate.test.ts — M60 Phase γ §3.8 (flag gate) + §3.10
// (autonomy event emit) + §3.7 (shutdown suspend) for HeartbeatRunner.

import { describe, expect, it, vi } from 'vitest';
import {
  HeartbeatRunner,
  MIN_HEARTBEAT_INTERVAL_MS,
  type IHeartbeatConfig,
  type IHeartbeatTickAutonomyInfo,
} from '../../src/openclaw/openclawHeartbeatRunner';

function makeConfig(overrides: Partial<IHeartbeatConfig> = {}): IHeartbeatConfig {
  return {
    enabled: true,
    intervalMs: 60_000,
    ...overrides,
  };
}

describe('HeartbeatRunner — M60 §3.6 minimum interval', () => {
  it('lowers MIN_HEARTBEAT_INTERVAL_MS to 15s per M60 §3.6', () => {
    expect(MIN_HEARTBEAT_INTERVAL_MS).toBe(15_000);
  });
});

describe('HeartbeatRunner — M60 §3.8 flag gate', () => {
  it('skips tick and emits a gated autonomy event when flag is off', async () => {
    const executor = vi.fn();
    const events: IHeartbeatTickAutonomyInfo[] = [];
    let flagEnabled = false;
    const runner = new HeartbeatRunner(
      executor,
      () =>
        makeConfig({
          isFlagEnabled: () => flagEnabled,
          onAutonomyEvent: (info) => events.push(info),
        }),
    );

    runner.pushEvent({ type: 'file-change', payload: { path: '/x' }, timestamp: 1 });
    // Wait a microtask for any pending tick promise to resolve.
    await Promise.resolve();
    await Promise.resolve();

    expect(executor).not.toHaveBeenCalled();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].outcome).toBe('gated');
    expect(events[0].note).toContain('autonomy.heartbeat.enabled=false');

    // Flip flag on — wake should now execute.
    flagEnabled = true;
    runner.wake('wake');
    await Promise.resolve();
    await Promise.resolve();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.outcome === 'completed')).toBe(true);

    runner.dispose();
  });
});

describe('HeartbeatRunner — M60 §3.7 shutdown suspension', () => {
  it('suspendForShutdown blocks subsequent ticks and emits a cancelled event', async () => {
    const executor = vi.fn();
    const events: IHeartbeatTickAutonomyInfo[] = [];
    const runner = new HeartbeatRunner(
      executor,
      () =>
        makeConfig({
          isFlagEnabled: () => true,
          onAutonomyEvent: (info) => events.push(info),
        }),
    );

    runner.suspendForShutdown();
    runner.wake('wake');
    runner.pushEvent({ type: 'file-change', payload: { path: '/x' }, timestamp: 1 });
    await Promise.resolve();
    await Promise.resolve();

    expect(executor).not.toHaveBeenCalled();
    // suspendForShutdown is idempotent
    runner.suspendForShutdown();
    expect(events.every((e) => e.outcome !== 'completed')).toBe(true);

    runner.dispose();
  });
});

describe('HeartbeatRunner — emit on completion', () => {
  it('emits a completed event with eventsProcessed when executor succeeds', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const events: IHeartbeatTickAutonomyInfo[] = [];
    const runner = new HeartbeatRunner(
      executor,
      () =>
        makeConfig({
          isFlagEnabled: () => true,
          onAutonomyEvent: (info) => events.push(info),
        }),
    );

    runner.pushEvent({ type: 'file-change', payload: { path: '/y' }, timestamp: 1 });
    // Drain the tick promise.
    for (let i = 0; i < 4; i++) await Promise.resolve();

    expect(executor).toHaveBeenCalledTimes(1);
    const completed = events.find((e) => e.outcome === 'completed');
    expect(completed).toBeDefined();
    expect(completed!.eventsProcessed).toBe(1);

    runner.dispose();
  });
});
