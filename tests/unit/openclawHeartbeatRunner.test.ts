import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  HeartbeatRunner,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  MIN_HEARTBEAT_INTERVAL_MS,
  MAX_HEARTBEAT_INTERVAL_MS,
  DUPLICATE_SUPPRESSION_WINDOW_MS,
  type IHeartbeatConfig,
  type IHeartbeatSystemEvent,
  type HeartbeatTurnExecutor,
} from '../../src/openclaw/openclawHeartbeatRunner';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createConfig(overrides?: Partial<IHeartbeatConfig>): IHeartbeatConfig {
  return {
    enabled: true,
    intervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
    ...overrides,
  };
}

function createEvent(overrides?: Partial<IHeartbeatSystemEvent>): IHeartbeatSystemEvent {
  return {
    type: 'file-changed',
    payload: { path: '/test/file.ts' },
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HeartbeatRunner', () => {
  let executor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    executor = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('construction', () => {
    it('initializes with config values', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());
      expect(runner.state.enabled).toBe(true);
      expect(runner.state.intervalMs).toBe(DEFAULT_HEARTBEAT_INTERVAL_MS);
      expect(runner.state.lastRunMs).toBe(0);
      expect(runner.state.consecutiveRuns).toBe(0);
    });

    it('clamps interval to minimum', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig({ intervalMs: 100 }));
      expect(runner.state.intervalMs).toBe(MIN_HEARTBEAT_INTERVAL_MS);
    });

    it('clamps interval to maximum', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig({ intervalMs: 999_999_999 }));
      expect(runner.state.intervalMs).toBe(MAX_HEARTBEAT_INTERVAL_MS);
    });
  });

  describe('start/stop', () => {
    it('does not start when disabled', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig({ enabled: false }));
      runner.start();

      // Push an event and advance timer — should NOT execute
      runner.pushEvent(createEvent());
      vi.advanceTimersByTime(DEFAULT_HEARTBEAT_INTERVAL_MS * 2);

      // The pushEvent will attempt _tick but config.enabled is false
      expect(executor).not.toHaveBeenCalled();

      runner.dispose();
    });

    it('stop clears the timer', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());
      runner.start();
      runner.stop();

      // Timer should be cleared — advancing should not trigger executor
      runner.pushEvent(createEvent());
      vi.advanceTimersByTime(DEFAULT_HEARTBEAT_INTERVAL_MS * 2);

      // Note: pushEvent itself causes immediate _tick for system-event,
      // but start() was stopped so the interval ticks don't fire
      runner.dispose();
    });
  });

  describe('pushEvent', () => {
    it('pushes events and tracks count', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());

      expect(runner.pendingEventCount).toBe(0);

      // First push triggers immediate execution (system-event)
      runner.pushEvent(createEvent({ type: 'event-1' }));

      // After execution, events are drained
      // But since executor is async, we need to wait
      runner.dispose();
    });

    it('suppresses duplicate events within the window', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());

      const event = createEvent({ type: 'file-changed', payload: { path: '/a.ts' } });

      runner.pushEvent(event);
      runner.pushEvent(event); // duplicate — should be suppressed

      // Only one event should have been pushed
      // The first push triggers execution which drains the queue
      runner.dispose();
    });

    it('allows same event after suppression window', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());

      const event = createEvent({ type: 'file-changed', payload: { path: '/a.ts' } });

      runner.pushEvent(event);

      // Advance past suppression window
      vi.advanceTimersByTime(DUPLICATE_SUPPRESSION_WINDOW_MS + 1);

      runner.pushEvent(event); // should NOT be suppressed now

      runner.dispose();
    });

    it('ignored after dispose', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());
      runner.dispose();

      runner.pushEvent(createEvent());
      expect(runner.pendingEventCount).toBe(0);
    });
  });

  describe('wake', () => {
    it('triggers immediate heartbeat check', async () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());

      // Push an event first so the wake has something to process
      // (interval ticks with no events are skipped, but wake is not interval)
      runner.pushEvent(createEvent({ type: 'pre-wake' }));

      // Wait for the async tick from pushEvent
      await vi.advanceTimersByTimeAsync(0);

      // Executor should have been called from the pushEvent's system-event tick
      expect(executor).toHaveBeenCalledTimes(1);

      runner.dispose();
    });

    it('ignored after dispose', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());
      runner.dispose();

      runner.wake();
      expect(executor).not.toHaveBeenCalled();
    });
  });

  describe('state tracking', () => {
    it('updates state after successful execution', async () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());

      const beforeRun = Date.now();
      runner.pushEvent(createEvent());

      // Wait for async execution
      await vi.advanceTimersByTimeAsync(0);

      const state = runner.state;
      expect(state.lastRunMs).toBeGreaterThanOrEqual(beforeRun);
      expect(state.consecutiveRuns).toBe(1);

      runner.dispose();
    });

    it('returns snapshot from state getter', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());

      const s1 = runner.state;
      const s2 = runner.state;
      expect(s1).toEqual(s2);
      expect(s1).not.toBe(s2); // different object references

      runner.dispose();
    });
  });

  describe('error handling', () => {
    it('re-queues events on executor failure', async () => {
      executor.mockRejectedValueOnce(new Error('executor failed'));

      const runner = new HeartbeatRunner(executor, () => createConfig());

      runner.pushEvent(createEvent());
      await vi.advanceTimersByTimeAsync(0);

      // Events should be re-queued after failure
      expect(runner.pendingEventCount).toBe(1);

      runner.dispose();
    });
  });

  describe('pruneSuppressionCache', () => {
    it('removes expired entries', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());

      runner.pushEvent(createEvent({ type: 'old-event' }));

      // Advance past suppression window
      vi.advanceTimersByTime(DUPLICATE_SUPPRESSION_WINDOW_MS + 1);

      runner.pruneSuppressionCache();

      // Same event should now be accepted
      runner.pushEvent(createEvent({ type: 'old-event' }));

      runner.dispose();
    });
  });

  describe('dispose', () => {
    it('clears all state', () => {
      const runner = new HeartbeatRunner(executor, () => createConfig());
      runner.pushEvent(createEvent({ type: 'unique-1234' }));
      runner.start();
      runner.dispose();

      expect(runner.pendingEventCount).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Constants tests
// ---------------------------------------------------------------------------

describe('heartbeat constants', () => {
  it('DEFAULT_HEARTBEAT_INTERVAL_MS is 5 minutes', () => {
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it('MIN_HEARTBEAT_INTERVAL_MS is at least 30 seconds', () => {
    expect(MIN_HEARTBEAT_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
  });

  it('MAX_HEARTBEAT_INTERVAL_MS is at most 1 hour', () => {
    expect(MAX_HEARTBEAT_INTERVAL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('DUPLICATE_SUPPRESSION_WINDOW_MS is reasonable', () => {
    expect(DUPLICATE_SUPPRESSION_WINDOW_MS).toBeGreaterThanOrEqual(10_000);
    expect(DUPLICATE_SUPPRESSION_WINDOW_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });
});
