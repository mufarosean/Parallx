// openclawCronAnchor.test.ts — anchor-grid semantics for `every` schedules
//
// The user-reported bug: extension `upsertJob` calls on every app start
// were resetting `nextRunAt` to `now + interval`. A user who closed the
// app within the interval never saw the cron fire. Fix mirrors openclaw's
// `schedule.anchorMs` — the next fire is computed from a per-job anchor,
// not from "now," so restart-upserts are idempotent.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  CronService,
  type ICronJob,
  type ICronJobCreateParams,
  type ICronPersistedSnapshot,
} from '../../src/openclaw/openclawCronService';
import { CronBridge } from '../../src/api/bridges/cronBridge';

function createParams(overrides?: Partial<ICronJobCreateParams>): ICronJobCreateParams {
  return {
    name: 'budget.sync.scheduled',
    schedule: { every: '30m' },
    payload: { agentTurn: 'sync' },
    ...overrides,
  };
}

describe('CronService — anchor-grid for `every` schedules', () => {
  let executor: any;
  let contextFetcher: any;

  beforeEach(() => {
    vi.useFakeTimers();
    executor = vi.fn().mockResolvedValue(undefined);
    contextFetcher = vi.fn().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('addJob', () => {
    it('sets anchorMs = creation time', () => {
      const t0 = 1_700_000_000_000;
      vi.setSystemTime(new Date(t0));

      const svc = new CronService(executor, contextFetcher, null);
      const job = svc.addJob(createParams());

      expect(job.anchorMs).toBe(t0);
      expect(job.nextRunAt).toBe(t0 + 30 * 60_000);
      svc.dispose();
    });
  });

  describe('updateJob — same schedule (the upsert-on-restart case)', () => {
    it('preserves anchorMs and nextRunAt when the schedule object is structurally identical', () => {
      const t0 = 1_700_000_000_000;
      vi.setSystemTime(new Date(t0));

      const svc = new CronService(executor, contextFetcher, null);
      const job = svc.addJob(createParams());
      const originalAnchor = job.anchorMs;
      const originalNext = job.nextRunAt;

      // Simulate "10 minutes later, app restarts and upserts the same job"
      vi.setSystemTime(new Date(t0 + 10 * 60_000));
      const updated = svc.updateJob(job.id, { schedule: { every: '30m' } });

      expect(updated.anchorMs).toBe(originalAnchor);
      expect(updated.nextRunAt).toBe(originalNext);
      svc.dispose();
    });

    it('preserves anchorMs even after multiple restarts in the same interval window', () => {
      const t0 = 1_700_000_000_000;
      vi.setSystemTime(new Date(t0));

      const svc = new CronService(executor, contextFetcher, null);
      const job = svc.addJob(createParams());
      const originalNext = job.nextRunAt!;

      // Five restarts, each 5 minutes apart (all within the 30-min window).
      for (let i = 1; i <= 5; i++) {
        vi.setSystemTime(new Date(t0 + i * 5 * 60_000));
        svc.updateJob(job.id, { schedule: { every: '30m' } });
      }
      const after = svc.getJob(job.id)!;
      expect(after.nextRunAt).toBe(originalNext); // still the original fire time
      svc.dispose();
    });
  });

  describe('updateJob — schedule changed (the user really changed the cadence)', () => {
    it('resets anchorMs and recomputes nextRunAt on the new cadence', () => {
      const t0 = 1_700_000_000_000;
      vi.setSystemTime(new Date(t0));

      const svc = new CronService(executor, contextFetcher, null);
      const job = svc.addJob(createParams({ schedule: { every: '30m' } }));

      const t1 = t0 + 10 * 60_000;
      vi.setSystemTime(new Date(t1));
      const updated = svc.updateJob(job.id, { schedule: { every: '15m' } });

      expect(updated.anchorMs).toBe(t1);
      expect(updated.nextRunAt).toBe(t1 + 15 * 60_000);
      svc.dispose();
    });
  });

  describe('updateJob — no schedule field passed', () => {
    it('preserves anchorMs and nextRunAt', () => {
      vi.setSystemTime(new Date(1_700_000_000_000));
      const svc = new CronService(executor, contextFetcher, null);
      const job = svc.addJob(createParams());
      const originalAnchor = job.anchorMs;
      const originalNext = job.nextRunAt;

      const updated = svc.updateJob(job.id, { enabled: false });

      expect(updated.anchorMs).toBe(originalAnchor);
      expect(updated.nextRunAt).toBe(originalNext);
      svc.dispose();
    });
  });

  describe('loadFromPersistence — legacy job without anchorMs', () => {
    it('backfills anchorMs from createdAt', async () => {
      const createdAt = 1_700_000_000_000;
      const legacyJob = {
        id: 'cron-1',
        name: 'legacy',
        schedule: { every: '30m' },
        payload: { agentTurn: 'x' },
        wakeMode: 'now' as const,
        contextMessages: 0,
        enabled: true,
        createdAt,
        lastRunAt: null,
        nextRunAt: createdAt + 30 * 60_000,
        runCount: 0,
      } as ICronJob; // intentionally missing anchorMs

      const svc = new CronService(executor, contextFetcher, null);
      const persisted: ICronPersistedSnapshot = { jobs: [legacyJob] };
      svc.setPersistence({
        load: async () => persisted,
        save: async () => {},
      });
      await svc.loadFromPersistence();

      const restored = svc.getJob('cron-1')!;
      expect(restored.anchorMs).toBe(createdAt);
      svc.dispose();
    });

    it('preserves anchorMs when present on the persisted job', async () => {
      const anchorMs = 1_700_000_000_000;
      const persistedJob: ICronJob = {
        id: 'cron-1',
        name: 'with-anchor',
        schedule: { every: '30m' },
        payload: { agentTurn: 'x' },
        wakeMode: 'now',
        contextMessages: 0,
        enabled: true,
        createdAt: anchorMs - 1000,
        lastRunAt: null,
        nextRunAt: anchorMs + 30 * 60_000,
        runCount: 0,
        anchorMs,
      };

      const svc = new CronService(executor, contextFetcher, null);
      svc.setPersistence({
        load: async () => ({ jobs: [persistedJob] }),
        save: async () => {},
      });
      await svc.loadFromPersistence();

      expect(svc.getJob('cron-1')!.anchorMs).toBe(anchorMs);
      svc.dispose();
    });
  });

  describe('post-run nextRunAt — anchor-grid', () => {
    it('successful run schedules the NEXT tick on the original anchor grid', async () => {
      const t0 = 1_700_000_000_000;
      vi.setSystemTime(new Date(t0));

      const svc = new CronService(executor, contextFetcher, null);
      const job = svc.addJob(createParams({ schedule: { every: '30m' } }));

      // Fire it 35 minutes later (so the original nextRunAt slot has passed).
      vi.setSystemTime(new Date(t0 + 35 * 60_000));
      await svc.runJob(job.id);

      const after = svc.getJob(job.id)!;
      // Anchor was t0; intervals are 30m. At t0 + 35m the next slot is
      // t0 + 60m (the 2nd tick from anchor, since 35 > 30).
      expect(after.nextRunAt).toBe(t0 + 60 * 60_000);
      expect(after.anchorMs).toBe(t0); // unchanged by firing
      svc.dispose();
    });
  });
});

describe('CronBridge.upsertJob — restart idempotency (defence-in-depth)', () => {
  let executor: any;
  let contextFetcher: any;

  beforeEach(() => {
    vi.useFakeTimers();
    executor = vi.fn().mockResolvedValue(undefined);
    contextFetcher = vi.fn().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not pass `schedule` to updateJob when the schedule is structurally identical', () => {
    const t0 = 1_700_000_000_000;
    vi.setSystemTime(new Date(t0));

    const svc = new CronService(executor, contextFetcher, null);
    const updateSpy = vi.spyOn(svc, 'updateJob');

    const bridge = new CronBridge('test-tool', svc);
    bridge.upsertJob({
      id: 'budget.sync.scheduled',
      schedule: { every: '30m' },
      payload: { agentTurn: 'sync' },
    });
    // First upsert is an insert — no updateJob call.
    expect(updateSpy).not.toHaveBeenCalled();

    // App restart 10 minutes later — same schedule re-upserted.
    vi.setSystemTime(new Date(t0 + 10 * 60_000));
    bridge.upsertJob({
      id: 'budget.sync.scheduled',
      schedule: { every: '30m' },
      payload: { agentTurn: 'sync' },
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const updateArgs = updateSpy.mock.calls[0][1];
    expect(updateArgs.schedule).toBeUndefined();
    svc.dispose();
  });

  it('passes `schedule` when the cadence actually differs', () => {
    vi.setSystemTime(new Date(1_700_000_000_000));
    const svc = new CronService(executor, contextFetcher, null);
    const updateSpy = vi.spyOn(svc, 'updateJob');

    const bridge = new CronBridge('test-tool', svc);
    bridge.upsertJob({
      id: 'foo',
      schedule: { every: '30m' },
      payload: { agentTurn: 'x' },
    });
    bridge.upsertJob({
      id: 'foo',
      schedule: { every: '15m' },
      payload: { agentTurn: 'x' },
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][1].schedule).toEqual({ every: '15m' });
    svc.dispose();
  });
});
