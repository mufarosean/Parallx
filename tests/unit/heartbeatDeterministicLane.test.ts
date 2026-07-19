// heartbeatDeterministicLane.test.ts — M87 S1: the fact→trigger→delivery
// orchestration. Injected fakes only; the lane has NO model access by
// construction (that's the acceptance invariant: deterministic findings
// never touch the LLM).

import { describe, expect, it, vi } from 'vitest';
import { runHeartbeatDeterministicLane, type IHeartbeatLaneDeps } from '../../src/openclaw/heartbeatDeterministicLane';
import type { IHeartbeatFacts, IHeartbeatLedger } from '../../src/openclaw/heartbeatTriggers';

const DAY = 86_400_000;
const NOW = new Date(2026, 6, 19, 12, 0, 0).getTime();

function overdueFacts(): IHeartbeatFacts {
  return {
    plans: [{ sessionId: 's1', goal: 'Ship', activeStep: 'tests', updatedAt: NOW - 6 * DAY }],
    tasks: [{ id: 'leak', title: 'Leak', status: 'planned', dueAt: NOW - 2 * DAY, createdAt: NOW - 9 * DAY }],
  };
}

function makeDeps(over?: Partial<IHeartbeatLaneDeps>): {
  deps: IHeartbeatLaneDeps;
  saved: { ledger: IHeartbeatLedger | null };
  deliverTask: ReturnType<typeof vi.fn>;
  deliverNotification: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
} {
  const saved: { ledger: IHeartbeatLedger | null } = { ledger: null };
  const deliverTask = vi.fn(async () => true);
  const deliverNotification = vi.fn(async () => true);
  const log = vi.fn();
  const deps: IHeartbeatLaneDeps = {
    collectFacts: async () => overdueFacts(),
    loadLedger: async () => ({}),
    saveLedger: async (l) => { saved.ledger = l; },
    deliverTask,
    deliverNotification,
    log,
    now: () => NOW,
    ...over,
  };
  return { deps, saved, deliverTask, deliverNotification, log };
}

describe('runHeartbeatDeterministicLane', () => {
  it('routes task-shaped findings to deliverTask and stamps the ledger', async () => {
    const { deps, saved, deliverTask, log } = makeDeps();
    const result = await runHeartbeatDeterministicLane(deps);

    // stalled-plan + overdue-task, both task-shaped
    expect(deliverTask).toHaveBeenCalledTimes(2);
    expect(result.delivered).toBe(2);
    expect(result.failed).toBe(0);
    expect(saved.ledger).not.toBeNull();
    expect(saved.ledger!['stalled-plan:s1']).toBe(NOW);
    expect(saved.ledger!['overdue-task:leak']).toBe(NOW);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('cooldown round-trip: a delivered key is suppressed on the next beat', async () => {
    const first = makeDeps();
    await runHeartbeatDeterministicLane(first.deps);
    const persisted = first.saved.ledger!;

    const second = makeDeps({ loadLedger: async () => persisted });
    const result = await runHeartbeatDeterministicLane(second.deps);
    expect(second.deliverTask).not.toHaveBeenCalled();
    expect(result.delivered).toBe(0);
    expect(result.suppressed).toBe(2);
  });

  it('a FAILED delivery is not stamped — it retries next beat', async () => {
    const failing = makeDeps({ deliverTask: vi.fn(async () => { throw new Error('offline'); }) });
    const r1 = await runHeartbeatDeterministicLane(failing.deps);
    expect(r1.failed).toBe(2);
    expect(failing.saved.ledger!['overdue-task:leak']).toBeUndefined();

    const retry = makeDeps({ loadLedger: async () => failing.saved.ledger! });
    const r2 = await runHeartbeatDeterministicLane(retry.deps);
    expect(r2.delivered).toBe(2);
  });

  it('a duplicate-open-task result (false) stamps the ledger without counting a delivery', async () => {
    const dup = makeDeps({ deliverTask: vi.fn(async () => false) });
    const r = await runHeartbeatDeterministicLane(dup.deps);
    expect(r.delivered).toBe(0);
    expect(r.failed).toBe(0);
    expect(dup.saved.ledger!['overdue-task:leak']).toBe(NOW); // no re-nag
  });

  it('fail-soft: broken fact collection yields a clean zero result', async () => {
    const broken = makeDeps({ collectFacts: async () => { throw new Error('planner gone'); } });
    const r = await runHeartbeatDeterministicLane(broken.deps);
    expect(r).toEqual({ delivered: 0, suppressed: 0, failed: 0 });
    expect(broken.deliverTask).not.toHaveBeenCalled();
  });

  it('fail-soft: broken ledger storage still delivers', async () => {
    const broken = makeDeps({
      loadLedger: async () => { throw new Error('no storage'); },
      saveLedger: async () => { throw new Error('no storage'); },
    });
    const r = await runHeartbeatDeterministicLane(broken.deps);
    expect(r.delivered).toBe(2);
  });

  it('quiet facts ⇒ zero deliveries, and the audit log stays silent', async () => {
    const quiet = makeDeps({ collectFacts: async () => ({ plans: [], tasks: [] }) });
    const r = await runHeartbeatDeterministicLane(quiet.deps);
    expect(r).toEqual({ delivered: 0, suppressed: 0, failed: 0 });
    expect(quiet.log).not.toHaveBeenCalled();
  });

  it('uses configured thresholds', async () => {
    const strict = makeDeps({
      getConfig: () => ({ stallDays: 30, reviewQueueSize: 5, overdueDays: 30 }),
    });
    const r = await runHeartbeatDeterministicLane(strict.deps);
    expect(r.delivered).toBe(0);
  });
});
