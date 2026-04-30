// autonomyCronGate.test.ts — M60 Phase γ §3.7 (idempotency, missed-job
// coalesce, shutdown) + §3.8 (flag gate) + §3.10 (event emit) for CronService.

import { describe, expect, it, vi } from 'vitest';
import {
  CronService,
  type ICronFireAutonomyInfo,
  type ICronJob,
  type ICronPersistedSnapshot,
} from '../../src/openclaw/openclawCronService';

function makeService(opts: {
  isFlagEnabled?: () => boolean;
  onAutonomyEvent?: (info: ICronFireAutonomyInfo) => void;
  executor?: ReturnType<typeof vi.fn>;
} = {}) {
  const executor = opts.executor ?? vi.fn().mockResolvedValue(undefined);
  const fetcher = vi.fn().mockResolvedValue([]);
  const svc = new CronService(executor, fetcher, null);
  if (opts.isFlagEnabled || opts.onAutonomyEvent) {
    svc.setObservers({
      isFlagEnabled: opts.isFlagEnabled,
      onAutonomyEvent: opts.onAutonomyEvent,
    });
  }
  return { svc, executor, fetcher };
}

describe('CronService — M60 §3.8 flag gate', () => {
  it('refuses to execute jobs when autonomy.cron.enabled is off', async () => {
    const events: ICronFireAutonomyInfo[] = [];
    const { svc, executor } = makeService({
      isFlagEnabled: () => false,
      onAutonomyEvent: (info) => events.push(info),
    });
    const job = svc.addJob({
      name: 'test',
      schedule: { every: '1m' },
      payload: { agentTurn: 'hi' },
    });
    const result = await svc.runJob(job.id);
    expect(executor).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('gated');
    expect(events.some((e) => e.outcome === 'gated')).toBe(true);
    svc.dispose();
  });

  it('emits a completed event when flag is on and execution succeeds', async () => {
    const events: ICronFireAutonomyInfo[] = [];
    const { svc, executor } = makeService({
      isFlagEnabled: () => true,
      onAutonomyEvent: (info) => events.push(info),
    });
    const job = svc.addJob({
      name: 'test',
      schedule: { every: '1m' },
      payload: { agentTurn: 'hi' },
    });
    const result = await svc.runJob(job.id);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    const completed = events.find((e) => e.outcome === 'completed');
    expect(completed).toBeDefined();
    expect(completed!.idempotencyKey).toContain(job.id);
    svc.dispose();
  });
});

describe('CronService — M60 §3.7 idempotency keys (auto-firings only)', () => {
  it('manual runJob bypasses idempotency dedup (test-friendly behavior)', async () => {
    const events: ICronFireAutonomyInfo[] = [];
    const { svc, executor } = makeService({
      isFlagEnabled: () => true,
      onAutonomyEvent: (info) => events.push(info),
    });
    const job = svc.addJob({
      name: 'test',
      schedule: { every: '1m' },
      payload: { agentTurn: 'hi' },
    });
    await svc.runJob(job.id);
    await svc.runJob(job.id);
    // Two manual runs → two real executions; no duplicate-idempotency-key event.
    expect(executor).toHaveBeenCalledTimes(2);
    expect(
      events.filter((e) => e.note === 'duplicate-idempotency-key').length,
    ).toBe(0);
    svc.dispose();
  });

  it('automatic timer-driven firings dedup the same (jobId, scheduledAt) key', async () => {
    const events: ICronFireAutonomyInfo[] = [];
    const { svc, executor } = makeService({
      isFlagEnabled: () => true,
      onAutonomyEvent: (info) => events.push(info),
    });
    const job = svc.addJob({
      name: 'test',
      schedule: { every: '1m' },
      payload: { agentTurn: 'hi' },
    });
    // Pin nextRunAt so two _checkDueJobs passes hit the same scheduledAt.
    const fixedJob: ICronJob = { ...svc.getJob(job.id)!, nextRunAt: 1234567890 };
    // @ts-expect-error — reach into private map for the test only.
    svc['_jobs'].set(fixedJob.id, fixedJob);
    // First auto-fire: executes.
    // @ts-expect-error — private method access for test only.
    await svc['_executeJob'](fixedJob, { trackIdempotency: true });
    // Reset nextRunAt so scheduledAt matches; second auto-fire: deduped.
    // @ts-expect-error — same.
    svc['_jobs'].set(fixedJob.id, fixedJob);
    // @ts-expect-error — private method access for test only.
    await svc['_executeJob'](fixedJob, { trackIdempotency: true });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(
      events.filter((e) => e.note === 'duplicate-idempotency-key').length,
    ).toBe(1);
    svc.dispose();
  });
});

describe('CronService — M60 §3.7 missed-job coalescing', () => {
  it('collapses multiple missed firings of the same job into a single catch-up', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const events: ICronFireAutonomyInfo[] = [];
    const { svc } = makeService({
      isFlagEnabled: () => true,
      onAutonomyEvent: (info) => events.push(info),
      executor,
    });

    // Hydrate from persistence: a job whose nextRunAt was 1h ago.
    svc.setPersistence({
      load: async (): Promise<ICronPersistedSnapshot> => ({
        jobs: [
          {
            id: 'cron-1',
            name: 'overdue',
            schedule: { every: '5m' },
            payload: { agentTurn: 'hi' },
            wakeMode: 'now',
            contextMessages: 0,
            enabled: true,
            createdAt: Date.now() - 3_600_000,
            lastRunAt: null,
            nextRunAt: Date.now() - 3_600_000, // 1h ago
            runCount: 0,
            updatedAt: Date.now() - 3_600_000,
          },
        ],
      }),
      save: async () => { /* ignore */ },
    });
    await svc.loadFromPersistence();
    svc.start();
    // Allow microtasks for the fire-and-forget catchup chain.
    for (let i = 0; i < 4; i++) await Promise.resolve();

    expect(executor).toHaveBeenCalledTimes(1); // single coalesced firing
    svc.stop();
    svc.dispose();
  });
});

describe('CronService — M60 Phase γ persistence', () => {
  it('round-trips the job set through load/save', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    let stored: ICronPersistedSnapshot | null = null;
    const { svc } = makeService({ isFlagEnabled: () => true, executor });
    svc.setPersistence({
      load: async () => stored,
      save: async (snapshot) => {
        stored = { jobs: snapshot.jobs.map((j) => ({ ...j })) };
      },
    });

    const job = svc.addJob({
      name: 'persist-me',
      schedule: { every: '5m' },
      payload: { agentTurn: 'hi' },
    });
    // save is fire-and-forget; flush microtasks.
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(stored).not.toBeNull();
    expect(stored!.jobs[0].id).toBe(job.id);
    expect(stored!.jobs[0].name).toBe('persist-me');

    // Build a new service, load from same store, expect same job set.
    const svc2 = new CronService(executor, vi.fn().mockResolvedValue([]), null);
    svc2.setPersistence({
      load: async () => stored,
      save: async () => { /* ignore */ },
    });
    await svc2.loadFromPersistence();
    expect(svc2.jobs.length).toBe(1);
    expect(svc2.jobs[0].name).toBe('persist-me');

    svc.dispose();
    svc2.dispose();
  });
});

describe('CronService — M60 §3.7 shutdown suspension', () => {
  it('refuses new firings after suspendForShutdown', async () => {
    const events: ICronFireAutonomyInfo[] = [];
    const { svc, executor } = makeService({
      isFlagEnabled: () => true,
      onAutonomyEvent: (info) => events.push(info),
    });
    const job = svc.addJob({
      name: 'test',
      schedule: { every: '1m' },
      payload: { agentTurn: 'hi' },
    });
    svc.suspendForShutdown();
    const result = await svc.runJob(job.id);
    expect(executor).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(events.some((e) => e.note === 'shutdown')).toBe(true);
    svc.dispose();
  });
});
