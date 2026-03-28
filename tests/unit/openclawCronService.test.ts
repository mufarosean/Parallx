import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  CronService,
  MAX_CONTEXT_MESSAGES,
  MAX_CRON_JOBS,
  CRON_CHECK_INTERVAL_MS,
  MIN_EVERY_INTERVAL_MS,
  parseDuration,
  type ICronJobCreateParams,
  type ICronSchedule,
  type CronTurnExecutor,
  type ContextLineFetcher,
  type HeartbeatWaker,
} from '../../src/openclaw/openclawCronService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createParams(overrides?: Partial<ICronJobCreateParams>): ICronJobCreateParams {
  return {
    name: 'test-job',
    schedule: { every: '5m' },
    payload: { agentTurn: 'Check workspace health' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CronService', () => {
  let executor: ReturnType<typeof vi.fn>;
  let contextFetcher: ReturnType<typeof vi.fn>;
  let heartbeatWaker: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    executor = vi.fn().mockResolvedValue(undefined);
    contextFetcher = vi.fn().mockResolvedValue(['line1', 'line2']);
    heartbeatWaker = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Job CRUD
  // -----------------------------------------------------------------------

  describe('addJob', () => {
    it('creates a job with defaults', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      const job = svc.addJob(createParams());

      expect(job.id).toMatch(/^cron-/);
      expect(job.name).toBe('test-job');
      expect(job.wakeMode).toBe('now');
      expect(job.contextMessages).toBe(0);
      expect(job.enabled).toBe(true);
      expect(job.runCount).toBe(0);
      expect(job.lastRunAt).toBeNull();
      expect(job.nextRunAt).toBeGreaterThan(Date.now() - 1);

      svc.dispose();
    });

    it('respects explicit wakeMode and contextMessages', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      const job = svc.addJob(createParams({
        wakeMode: 'next-heartbeat',
        contextMessages: 5,
      }));

      expect(job.wakeMode).toBe('next-heartbeat');
      expect(job.contextMessages).toBe(5);

      svc.dispose();
    });

    it('clamps contextMessages to MAX_CONTEXT_MESSAGES', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      const job = svc.addJob(createParams({ contextMessages: 999 }));

      expect(job.contextMessages).toBe(MAX_CONTEXT_MESSAGES);

      svc.dispose();
    });

    it('rejects when job limit is reached', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);

      for (let i = 0; i < MAX_CRON_JOBS; i++) {
        svc.addJob(createParams({ name: `job-${i}` }));
      }

      expect(() => svc.addJob(createParams({ name: 'overflow' }))).toThrow(/limit/i);

      svc.dispose();
    });

    it('rejects invalid schedule (no fields)', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);

      expect(() => svc.addJob(createParams({
        schedule: {} as ICronSchedule,
      }))).toThrow(/exactly one/i);

      svc.dispose();
    });

    it('rejects invalid schedule (multiple fields)', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);

      expect(() => svc.addJob(createParams({
        schedule: { at: new Date().toISOString(), every: '5m' },
      }))).toThrow(/exactly one/i);

      svc.dispose();
    });

    it('rejects too-small "every" interval', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);

      expect(() => svc.addJob(createParams({
        schedule: { every: '1s' },
      }))).toThrow(/at least/i);

      svc.dispose();
    });

    it('throws after dispose', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      svc.dispose();

      expect(() => svc.addJob(createParams())).toThrow(/disposed/i);
    });
  });

  describe('updateJob', () => {
    it('updates job fields', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      const job = svc.addJob(createParams());

      const updated = svc.updateJob(job.id, {
        name: 'renamed',
        contextMessages: 3,
        enabled: false,
      });

      expect(updated.name).toBe('renamed');
      expect(updated.contextMessages).toBe(3);
      expect(updated.enabled).toBe(false);
      // Unchanged fields preserved
      expect(updated.schedule).toEqual(job.schedule);

      svc.dispose();
    });

    it('throws for unknown job', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);

      expect(() => svc.updateJob('nonexistent', { name: 'x' })).toThrow(/not found/i);

      svc.dispose();
    });

    it('recomputes nextRunAt when schedule changes', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      const job = svc.addJob(createParams({ schedule: { every: '5m' } }));
      const originalNext = job.nextRunAt;

      const updated = svc.updateJob(job.id, { schedule: { every: '10m' } });
      expect(updated.nextRunAt).not.toBe(originalNext);

      svc.dispose();
    });
  });

  describe('removeJob', () => {
    it('removes existing job', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      const job = svc.addJob(createParams());

      expect(svc.removeJob(job.id)).toBe(true);
      expect(svc.jobCount).toBe(0);

      svc.dispose();
    });

    it('returns false for unknown job', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);

      expect(svc.removeJob('nonexistent')).toBe(false);

      svc.dispose();
    });
  });

  describe('getJob', () => {
    it('returns snapshot of existing job', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      const job = svc.addJob(createParams());
      const fetched = svc.getJob(job.id);

      expect(fetched).toEqual(job);
      expect(fetched).not.toBe(job); // different reference

      svc.dispose();
    });

    it('returns undefined for unknown job', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);

      expect(svc.getJob('nonexistent')).toBeUndefined();

      svc.dispose();
    });
  });

  describe('list', () => {
    it('lists all jobs', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      svc.addJob(createParams({ name: 'a' }));
      svc.addJob(createParams({ name: 'b' }));

      expect(svc.jobs).toHaveLength(2);
      expect(svc.jobs.map(j => j.name)).toEqual(['a', 'b']);

      svc.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------

  describe('start/stop', () => {
    it('starts the timer', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      svc.start();

      expect(svc.isRunning).toBe(true);

      svc.dispose();
    });

    it('stop clears the timer', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      svc.start();
      svc.stop();

      expect(svc.isRunning).toBe(false);

      svc.dispose();
    });

    it('start is idempotent', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      svc.start();
      svc.start(); // second call should be harmless

      expect(svc.isRunning).toBe(true);

      svc.dispose();
    });
  });

  describe('timer-based execution', () => {
    it('fires due jobs when timer ticks', async () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);

      // Add a job due in 5 minutes
      svc.addJob(createParams({ schedule: { every: '5m' } }));

      svc.start();

      // Advance past the job's nextRunAt
      vi.advanceTimersByTime(5 * 60 * 1000 + CRON_CHECK_INTERVAL_MS);

      // Allow async execution
      await vi.advanceTimersByTimeAsync(0);

      expect(executor).toHaveBeenCalled();

      svc.dispose();
    });

    it('skips disabled jobs', async () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);

      const job = svc.addJob(createParams({ enabled: false }));

      svc.start();
      vi.advanceTimersByTime(5 * 60 * 1000 + CRON_CHECK_INTERVAL_MS);
      await vi.advanceTimersByTimeAsync(0);

      expect(executor).not.toHaveBeenCalled();

      svc.dispose();
    });
  });

  describe('runJob (manual)', () => {
    it('runs a specific job immediately', async () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      const job = svc.addJob(createParams());

      const result = await svc.runJob(job.id);

      expect(result.success).toBe(true);
      expect(result.jobId).toBe(job.id);
      expect(executor).toHaveBeenCalledTimes(1);

      svc.dispose();
    });

    it('records run in history', async () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      const job = svc.addJob(createParams());

      await svc.runJob(job.id);

      expect(svc.runHistory).toHaveLength(1);
      expect(svc.runHistory[0].jobId).toBe(job.id);
      expect(svc.runHistory[0].success).toBe(true);

      svc.dispose();
    });

    it('updates job state after run', async () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      const job = svc.addJob(createParams());

      await svc.runJob(job.id);

      const updated = svc.getJob(job.id)!;
      expect(updated.runCount).toBe(1);
      expect(updated.lastRunAt).toBeGreaterThan(0);

      svc.dispose();
    });

    it('throws for unknown job', async () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);

      await expect(svc.runJob('nonexistent')).rejects.toThrow(/not found/i);

      svc.dispose();
    });

    it('handles executor failure gracefully', async () => {
      executor.mockRejectedValueOnce(new Error('boom'));

      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      const job = svc.addJob(createParams());

      const result = await svc.runJob(job.id);

      expect(result.success).toBe(false);
      expect(result.error).toBe('boom');

      svc.dispose();
    });
  });

  describe('context injection', () => {
    it('fetches context lines when contextMessages > 0', async () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      svc.addJob(createParams({ contextMessages: 3 }));

      const job = svc.jobs[0];
      await svc.runJob(job.id);

      expect(contextFetcher).toHaveBeenCalledWith(3);
      expect(executor).toHaveBeenCalledWith(
        expect.objectContaining({ contextMessages: 3 }),
        ['line1', 'line2'],
      );

      svc.dispose();
    });

    it('skips context fetch when contextMessages is 0', async () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      svc.addJob(createParams({ contextMessages: 0 }));

      const job = svc.jobs[0];
      await svc.runJob(job.id);

      expect(contextFetcher).not.toHaveBeenCalled();
      expect(executor).toHaveBeenCalledWith(
        expect.objectContaining({ contextMessages: 0 }),
        [],
      );

      svc.dispose();
    });
  });

  describe('wake mode integration', () => {
    it('"next-heartbeat" calls heartbeat waker', async () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      svc.addJob(createParams({ wakeMode: 'next-heartbeat' }));

      const job = svc.jobs[0];
      await svc.runJob(job.id);

      expect(heartbeatWaker).toHaveBeenCalledWith('cron');

      svc.dispose();
    });

    it('"now" does not call heartbeat waker', async () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      svc.addJob(createParams({ wakeMode: 'now' }));

      const job = svc.jobs[0];
      await svc.runJob(job.id);

      expect(heartbeatWaker).not.toHaveBeenCalled();

      svc.dispose();
    });

    it('works without heartbeat waker (null)', async () => {
      const svc = new CronService(executor, contextFetcher, null);
      svc.addJob(createParams({ wakeMode: 'next-heartbeat' }));

      const job = svc.jobs[0];
      const result = await svc.runJob(job.id);

      expect(result.success).toBe(true);

      svc.dispose();
    });
  });

  describe('wake', () => {
    it('triggers check for due jobs', async () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);

      // Add a job that is already due
      const job = svc.addJob(createParams({ schedule: { every: '1m' } }));

      // Advance time past the job's nextRunAt
      vi.advanceTimersByTime(60_001);

      await svc.wake();

      expect(executor).toHaveBeenCalled();

      svc.dispose();
    });
  });

  describe('dispose', () => {
    it('clears all state', () => {
      const svc = new CronService(executor, contextFetcher, heartbeatWaker);
      svc.addJob(createParams());
      svc.start();
      svc.dispose();

      expect(svc.jobCount).toBe(0);
      expect(svc.isRunning).toBe(false);
      expect(svc.runHistory).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Schedule validation
// ---------------------------------------------------------------------------

describe('schedule validation', () => {
  let executor: ReturnType<typeof vi.fn>;
  let contextFetcher: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executor = vi.fn().mockResolvedValue(undefined);
    contextFetcher = vi.fn().mockResolvedValue([]);
  });

  it('accepts "at" with valid ISO datetime', () => {
    const svc = new CronService(executor, contextFetcher, null);
    const future = new Date(Date.now() + 3600_000).toISOString();
    const job = svc.addJob({ name: 'x', schedule: { at: future }, payload: {} });
    expect(job.nextRunAt).toBeGreaterThan(Date.now());
    svc.dispose();
  });

  it('rejects "at" with invalid datetime', () => {
    const svc = new CronService(executor, contextFetcher, null);
    expect(() => svc.addJob({
      name: 'x', schedule: { at: 'not-a-date' }, payload: {},
    })).toThrow(/invalid.*at/i);
    svc.dispose();
  });

  it('accepts "cron" with 5 fields', () => {
    const svc = new CronService(executor, contextFetcher, null);
    const job = svc.addJob({ name: 'x', schedule: { cron: '*/5 * * * *' }, payload: {} });
    expect(job.nextRunAt).toBeGreaterThan(0);
    svc.dispose();
  });

  it('rejects "cron" with wrong field count', () => {
    const svc = new CronService(executor, contextFetcher, null);
    expect(() => svc.addJob({
      name: 'x', schedule: { cron: '*/5 * *' }, payload: {},
    })).toThrow(/5 fields/i);
    svc.dispose();
  });
});

// ---------------------------------------------------------------------------
// parseDuration
// ---------------------------------------------------------------------------

describe('parseDuration', () => {
  it('parses milliseconds', () => {
    expect(parseDuration('500ms')).toBe(500);
  });

  it('parses seconds', () => {
    expect(parseDuration('30s')).toBe(30_000);
  });

  it('parses minutes', () => {
    expect(parseDuration('5m')).toBe(300_000);
  });

  it('parses hours', () => {
    expect(parseDuration('1h')).toBe(3_600_000);
  });

  it('parses days', () => {
    expect(parseDuration('1d')).toBe(86_400_000);
  });

  it('parses fractional values', () => {
    expect(parseDuration('1.5h')).toBe(5_400_000);
  });

  it('is case-insensitive', () => {
    expect(parseDuration('5M')).toBe(300_000);
  });

  it('rejects invalid input', () => {
    expect(() => parseDuration('abc')).toThrow(/invalid duration/i);
  });

  it('rejects empty input', () => {
    expect(() => parseDuration('')).toThrow(/invalid duration/i);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('cron constants', () => {
  it('MAX_CONTEXT_MESSAGES is 10', () => {
    expect(MAX_CONTEXT_MESSAGES).toBe(10);
  });

  it('MAX_CRON_JOBS is reasonable', () => {
    expect(MAX_CRON_JOBS).toBeGreaterThanOrEqual(10);
    expect(MAX_CRON_JOBS).toBeLessThanOrEqual(100);
  });

  it('CRON_CHECK_INTERVAL_MS is 1 minute', () => {
    expect(CRON_CHECK_INTERVAL_MS).toBe(60_000);
  });

  it('MIN_EVERY_INTERVAL_MS is 1 minute', () => {
    expect(MIN_EVERY_INTERVAL_MS).toBe(60_000);
  });
});
