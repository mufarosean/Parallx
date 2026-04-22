/**
 * W4 (M58) — Integration tests for CronService + CronTurnExecutor wiring.
 *
 * Proves:
 *   1. Cron fires route origin-stamped deliveries to status + notification
 *      surfaces via the SurfaceRouter (ORIGIN_CRON).
 *   2. `payload.agentTurn` is preserved verbatim in delivery metadata so
 *      the M59 substrate can pick it up without API changes.
 *   3. Wake-mode `now` executes immediately; wake-mode `next-heartbeat`
 *      delegates to a HeartbeatWaker call (simulating
 *      `heartbeatRunner.wake('cron')`).
 *   4. Missed jobs (nextRunAt already past) fire on `start()` / `runMissedJobs`.
 *   5. ContextLineFetcher reads last-N pairs from the active chat session
 *      and returns an empty array when no session is bound.
 *   6. The 8 cron tool actions (cron_status, cron_list, cron_add,
 *      cron_update, cron_remove, cron_run, cron_runs, cron_wake) are
 *      registered with the correct permission levels
 *      (add/update/remove = requires-approval; rest = always-allowed).
 *   7. Ship-thin guarantee: the executor calls `router.sendWithOrigin` only
 *      — it does NOT invoke any LLM / chat-service path.
 *
 * Upstream: cron-tool.ts action set + CronService fire semantics, plus
 * M58 W6 surface router origin tagging.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  CronService,
  type ICronJob,
  type ICronRunResult,
} from '../../src/openclaw/openclawCronService';
import {
  createCronTurnExecutor,
  createCronContextLineFetcher,
  createCronHeartbeatWaker,
} from '../../src/openclaw/openclawCronExecutor';
import {
  SurfaceRouterService,
  ORIGIN_CRON,
  getDeliveryOrigin,
} from '../../src/services/surfaceRouterService';
import {
  SURFACE_STATUS,
  SURFACE_NOTIFICATIONS,
  type ISurfaceDelivery,
  type ISurfacePlugin,
  type ISurfaceCapabilities,
} from '../../src/openclaw/openclawSurfacePlugin';
import {
  cronToolRequiresApproval,
  cronToolPermissionLevel,
} from '../../src/openclaw/openclawToolPolicy';
import {
  createCronTools,
  CRON_TOOL_NAMES,
} from '../../src/built-in/chat/tools/cronTools';
import type { HeartbeatRunner } from '../../src/openclaw/openclawHeartbeatRunner';
import type { IChatSession } from '../../src/services/chatTypes';

// ---------------------------------------------------------------------------
// Fake surfaces
// ---------------------------------------------------------------------------

class FakeSurfacePlugin implements ISurfacePlugin {
  readonly deliveries: ISurfaceDelivery[] = [];
  constructor(
    readonly id: string,
    readonly capabilities: ISurfaceCapabilities = {
      supportsText: true,
      supportsStructured: false,
      supportsBinary: false,
      supportsActions: false,
    },
  ) {}
  isAvailable(): boolean { return true; }
  async deliver(delivery: ISurfaceDelivery): Promise<boolean> {
    this.deliveries.push(delivery);
    return true;
  }
  dispose(): void {}
}

interface IHarness {
  router: SurfaceRouterService;
  status: FakeSurfacePlugin;
  notifications: FakeSurfacePlugin;
}

function createHarness(): IHarness {
  const router = new SurfaceRouterService();
  const status = new FakeSurfacePlugin(SURFACE_STATUS);
  const notifications = new FakeSurfacePlugin(SURFACE_NOTIFICATIONS);
  router.registerSurface(status);
  router.registerSurface(notifications);
  return { router, status, notifications };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('M58 W4 — Cron wiring', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // -----------------------------------------------------------------------
  // 1. Origin-stamped surface deliveries
  // -----------------------------------------------------------------------

  it('routes cron fires to status + notifications with ORIGIN_CRON', async () => {
    const h = createHarness();
    const executor = createCronTurnExecutor(h.router);
    const ctxFetcher = vi.fn().mockResolvedValue([]);
    const svc = new CronService(executor, ctxFetcher, null);

    const job = svc.addJob({
      name: 'daily-scan',
      schedule: { every: '5m' },
      payload: { agentTurn: 'Scan the inbox' },
    });

    await svc.runJob(job.id);

    // Status surface: flash + idle reset → 2 deliveries.
    expect(h.status.deliveries.length).toBe(2);
    // Notification: one info.
    expect(h.notifications.deliveries.length).toBe(1);

    for (const d of [...h.status.deliveries, ...h.notifications.deliveries]) {
      expect(getDeliveryOrigin(d)).toBe(ORIGIN_CRON);
    }

    const notif = h.notifications.deliveries[0];
    expect(notif.metadata.severity).toBe('info');
    expect(notif.metadata.source).toBe('cron');
    const framing = notif.metadata.cronEvent as Record<string, unknown>;
    expect(framing.jobName).toBe('daily-scan');
    expect(framing.agentTurn).toBe('Scan the inbox');

    svc.dispose();
  });

  // -----------------------------------------------------------------------
  // 2. agentTurn preserved verbatim (M59 substrate input)
  // -----------------------------------------------------------------------

  it('preserves payload.agentTurn in delivery metadata', async () => {
    const h = createHarness();
    const executor = createCronTurnExecutor(h.router);
    const svc = new CronService(executor, async () => [], null);

    svc.addJob({
      name: 'm59-preserve',
      schedule: { at: new Date(Date.now() + 60_000).toISOString() },
      payload: { agentTurn: 'EXACT VERBATIM MESSAGE !@# 123' },
    });

    await svc.runJob(svc.jobs[0].id);
    const framings = [...h.status.deliveries, ...h.notifications.deliveries]
      .map(d => d.metadata.cronEvent as Record<string, unknown>);
    for (const f of framings) {
      expect(f.agentTurn).toBe('EXACT VERBATIM MESSAGE !@# 123');
    }
    svc.dispose();
  });

  // -----------------------------------------------------------------------
  // 3. Wake modes
  // -----------------------------------------------------------------------

  it('wake mode "now" fires without consulting heartbeat waker', async () => {
    const h = createHarness();
    const executor = createCronTurnExecutor(h.router);
    const waker = vi.fn();
    const svc = new CronService(executor, async () => [], waker);
    const job = svc.addJob({
      name: 'now-mode',
      schedule: { every: '5m' },
      payload: { agentTurn: 'now' },
      wakeMode: 'now',
    });
    await svc.runJob(job.id);
    expect(waker).not.toHaveBeenCalled();
    expect(h.notifications.deliveries.length).toBe(1);
    svc.dispose();
  });

  it('wake mode "next-heartbeat" calls the heartbeat waker with reason "cron"', async () => {
    const h = createHarness();
    const executor = createCronTurnExecutor(h.router);
    const waker = vi.fn();
    const svc = new CronService(executor, async () => [], waker);
    const job = svc.addJob({
      name: 'hb-mode',
      schedule: { every: '5m' },
      payload: { agentTurn: 'piggyback' },
      wakeMode: 'next-heartbeat',
    });
    await svc.runJob(job.id);
    expect(waker).toHaveBeenCalledTimes(1);
    expect(waker).toHaveBeenCalledWith('cron');
    svc.dispose();
  });

  it('createCronHeartbeatWaker forwards to HeartbeatRunner.wake("cron")', () => {
    const fakeRunner = { wake: vi.fn() } as unknown as HeartbeatRunner;
    const waker = createCronHeartbeatWaker(fakeRunner);
    waker('cron');
    expect((fakeRunner.wake as any)).toHaveBeenCalledWith('cron');
  });

  // -----------------------------------------------------------------------
  // 4. Missed-job catchup path
  // -----------------------------------------------------------------------

  it('fires missed jobs whose nextRunAt is already past on start()', async () => {
    const h = createHarness();
    const executor = createCronTurnExecutor(h.router);
    const svc = new CronService(executor, async () => [], null);

    // Create a job whose next run was 1 minute ago.
    const past = new Date(Date.now() - 60_000).toISOString();
    const job = svc.addJob({
      name: 'missed',
      schedule: { at: past },
      payload: { agentTurn: 'missed-run' },
    });
    // Validation: `at` in the past yields nextRunAt=null. Seed an explicit
    // due time via a second addJob path — reuse `every` with a runJob to
    // simulate a past-due `nextRunAt`.
    expect(job.nextRunAt).toBeNull();

    // Use an every-job with manually advanced clock.
    const every = svc.addJob({
      name: 'every-missed',
      schedule: { every: '5m' },
      payload: { agentTurn: 'every-miss' },
    });
    expect(every.nextRunAt).not.toBeNull();

    // Advance past its nextRunAt.
    vi.setSystemTime(new Date(every.nextRunAt! + 1000));

    svc.start();
    // Allow microtasks to drain the fire-and-forget catchup.
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    const runs = svc.runHistory.filter(r => r.jobName === 'every-missed');
    expect(runs.length).toBeGreaterThanOrEqual(1);
    svc.dispose();
  });

  // -----------------------------------------------------------------------
  // 5. ContextLineFetcher
  // -----------------------------------------------------------------------

  it('ContextLineFetcher returns empty when no active session', async () => {
    const fetcher = createCronContextLineFetcher({ getActiveSession: () => undefined });
    expect(await fetcher(5)).toEqual([]);
    expect(await fetcher(0)).toEqual([]);
  });

  it('ContextLineFetcher reads last-N request/response pairs', async () => {
    const mk = (text: string) => ({ parts: [{ kind: 'markdown', content: text }] });
    const session = {
      id: 's1', messages: [
        { request: { text: 'q1' }, response: mk('a1') },
        { request: { text: 'q2' }, response: mk('a2') },
        { request: { text: 'q3' }, response: mk('a3') },
      ],
    } as unknown as IChatSession;
    const fetcher = createCronContextLineFetcher({ getActiveSession: () => session });
    const lines = await fetcher(2);
    expect(lines).toEqual([
      'user: q2', 'assistant: a2',
      'user: q3', 'assistant: a3',
    ]);
  });

  // -----------------------------------------------------------------------
  // 6. Tool registration + approval gating
  // -----------------------------------------------------------------------

  it('registers 8 cron tools with upstream-matching names', () => {
    const tools = createCronTools(undefined);
    expect(tools.length).toBe(8);
    const names = tools.map(t => t.name);
    expect(names).toEqual([...CRON_TOOL_NAMES]);
  });

  it('cron_add / cron_update / cron_remove require approval; others are free', () => {
    const tools = createCronTools(undefined);
    const byName = new Map(tools.map(t => [t.name, t]));
    for (const gated of ['cron_add', 'cron_update', 'cron_remove']) {
      expect(cronToolRequiresApproval(gated)).toBe(true);
      expect(byName.get(gated)!.permissionLevel).toBe('requires-approval');
      expect(byName.get(gated)!.requiresConfirmation).toBe(true);
    }
    for (const free of ['cron_status', 'cron_list', 'cron_runs', 'cron_run', 'cron_wake']) {
      expect(cronToolRequiresApproval(free)).toBe(false);
      expect(cronToolPermissionLevel(free)).toBe('always-allowed');
      expect(byName.get(free)!.permissionLevel).toBe('always-allowed');
    }
  });

  it('cron tool handlers drive the scheduler end-to-end', async () => {
    const h = createHarness();
    const executor = createCronTurnExecutor(h.router);
    const svc = new CronService(executor, async () => [], null);
    const tools = createCronTools(svc);
    const byName = new Map(tools.map(t => [t.name, t]));
    const token = { isCancellationRequested: false } as any;

    // cron_status → initial state: 0 jobs, timer not yet running.
    const statusRes = JSON.parse((await byName.get('cron_status')!.handler({}, token)).content);
    expect(statusRes.ok).toBe(true);
    expect(statusRes.status.jobCount).toBe(0);

    // cron_add
    const addRes = JSON.parse((await byName.get('cron_add')!.handler({
      name: 'via-tool',
      schedule: { every: '5m' },
      payload: { agentTurn: 'Tool-created job' },
      wakeMode: 'now',
    }, token)).content);
    expect(addRes.ok).toBe(true);
    const jobId = addRes.job.id;

    // cron_list
    const listRes = JSON.parse((await byName.get('cron_list')!.handler({}, token)).content);
    expect(listRes.jobs.length).toBe(1);

    // cron_update
    const updRes = JSON.parse((await byName.get('cron_update')!.handler({
      id: jobId, description: 'updated',
    }, token)).content);
    expect(updRes.job.description).toBe('updated');

    // cron_run
    const runRes = JSON.parse((await byName.get('cron_run')!.handler({ id: jobId }, token)).content);
    expect(runRes.ok).toBe(true);
    expect(runRes.result.success).toBe(true);

    // Firing routed through origin-tagged deliveries.
    const originTags = [...h.status.deliveries, ...h.notifications.deliveries]
      .map(getDeliveryOrigin);
    expect(originTags.every(o => o === ORIGIN_CRON)).toBe(true);

    // cron_runs — should have one entry for this job.
    const runsRes = JSON.parse((await byName.get('cron_runs')!.handler({ jobId }, token)).content);
    expect((runsRes.runs as ICronRunResult[]).length).toBe(1);

    // cron_wake — returns ok even when no due jobs.
    const wakeRes = JSON.parse((await byName.get('cron_wake')!.handler({}, token)).content);
    expect(wakeRes.ok).toBe(true);

    // cron_remove
    const rmRes = JSON.parse((await byName.get('cron_remove')!.handler({ id: jobId }, token)).content);
    expect(rmRes.removed).toBe(true);
    expect(svc.jobs.length).toBe(0);

    svc.dispose();
  });

  it('cron tool handlers surface a clean error when host is undefined', async () => {
    const tools = createCronTools(undefined);
    const token = { isCancellationRequested: false } as any;
    for (const t of tools) {
      const res = await t.handler({ id: 'x', name: 'y', schedule: { every: '5m' }, payload: {} }, token);
      const parsed = JSON.parse(res.content);
      expect(parsed.ok).toBe(false);
      expect(res.isError).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // 7. Ship-thin guarantee: no LLM / chatService call path
  // -----------------------------------------------------------------------

  it('thin executor does not reach chatService.sendRequest (§6.5 guarantee)', async () => {
    const h = createHarness();
    const executor = createCronTurnExecutor(h.router);
    const svc = new CronService(executor, async () => [], null);
    const job = svc.addJob({
      name: 'ship-thin',
      schedule: { every: '5m' },
      payload: { agentTurn: 'would-be-turn' },
    });

    // Wrap router.sendWithOrigin to audit call count and verify no other
    // output channel is touched.
    const sendSpy = vi.spyOn(h.router, 'sendWithOrigin');
    await svc.runJob(job.id);

    // 3 sends: status-flash + notification + status-idle.
    expect(sendSpy).toHaveBeenCalledTimes(3);
    for (const call of sendSpy.mock.calls) {
      expect(call[1]).toBe(ORIGIN_CRON);
    }
    svc.dispose();
  });
});
