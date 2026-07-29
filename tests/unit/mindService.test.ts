import { describe, expect, it, beforeEach } from 'vitest';

import { MindService } from '../../src/openclaw/mind/mindService';
import { MindStore } from '../../src/openclaw/mind/mindStore';
import { ActionLedger } from '../../src/openclaw/mind/actionLedger';
import type { IStorage } from '../../src/platform/storage';

class FakeStorage implements IStorage {
  readonly map = new Map<string, string>();
  async get(k: string) { return this.map.get(k); }
  async set(k: string, v: string) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
  async has(k: string) { return this.map.has(k); }
  async keys(p?: string) { return [...this.map.keys()].filter(k => !p || k.startsWith(p)); }
}

let clock = 1_000;
let ids = 0;
function build(storage = new FakeStorage()) {
  const svc = new MindService(new MindStore(storage), new ActionLedger(storage), {
    now: () => clock,
    genId: () => `id${++ids}`,
  });
  return { svc, storage };
}

beforeEach(() => { clock = 1_000; ids = 0; });

describe('MindService — the loop seam', () => {
  it('remember persists, ledgers, and surfaces in the seed', async () => {
    const { svc, storage } = build();
    await svc.init();
    const ok = await svc.remember('belief', 'User ships on Fridays', 0.9, ['tick-1']);
    expect(ok).toBe(true);
    expect(svc.seedBlock()).toContain('User ships on Fridays');
    // persisted + ledgered
    expect(storage.map.get('autonomy.mind.v1')).toContain('Fridays');
    expect(await svc.auditOk()).toEqual({ ok: true });
  });

  it('enforces governance — a write with no provenance is rejected', async () => {
    const { svc } = build();
    await svc.init();
    expect(await svc.remember('belief', 'unsourced claim', 0.9, [])).toBe(false);
    expect(svc.current()).toHaveLength(0);
  });

  it('continuityBlock renders beliefs for interactive turns, without the heartbeat habit/cron text', async () => {
    const { svc } = build();
    await svc.init();
    await svc.remember('belief', 'User studies Exam 7 in the mornings', 0.9, ['review-1']);
    await svc.observeAction('opened planner', clock);
    const block = svc.continuityBlock();
    expect(block).toContain('User studies Exam 7 in the mornings');
    expect(block).not.toContain('cron_create'); // heartbeat-lane offer text stays out of chat
  });

  it('continuityBlock is EMPTY (not a placeholder) when nothing survives the seed floor', async () => {
    const { svc } = build();
    await svc.init();
    expect(svc.continuityBlock()).toBe('');
    // seedBlock keeps its placeholder for the heartbeat lane.
    expect(svc.seedBlock()).toContain('empty');
  });

  it('continuity: a fresh service loads the MIND a prior one persisted', async () => {
    const storage = new FakeStorage();
    const first = build(storage);
    await first.svc.init();
    await first.svc.remember('thread', 'Tracking: migrate planner to v2', 0.7, ['tick-1']);

    const second = build(storage); // simulate a new tick / restart
    await second.svc.init();
    expect(second.svc.seedBlock()).toContain('migrate planner to v2');
  });

  it('predict → resolve grades against observed reality and moves the fidelity meter', async () => {
    const { svc } = build();
    await svc.init();
    const pred = await svc.predict('next file opened', [{ label: 'main.ts', prob: 0.7 }], 60_000, ['tick-1']);
    expect(pred).toBeDefined();
    expect(svc.seedBlock()).toContain('awaiting outcome');
    expect(Number.isNaN(svc.fidelity())).toBe(true); // nothing resolved yet

    const brier = await svc.resolve(pred!.id, 'main.ts');
    expect(brier).toBeCloseTo(0.09, 5); // (0.7-1)^2
    expect(svc.fidelity()).toBeCloseTo(0.09, 5);
  });

  it('resolve is a no-op for an unknown or already-resolved prediction', async () => {
    const { svc } = build();
    await svc.init();
    expect(await svc.resolve('nope', 'x')).toBeUndefined();
    const pred = await svc.predict('next cmd', [{ label: 'save', prob: 0.5 }], 1000, ['t']);
    await svc.resolve(pred!.id, 'save');
    expect(await svc.resolve(pred!.id, 'save')).toBeUndefined(); // already resolved
  });

  it('record writes to the audit ledger and keeps it verifiable', async () => {
    const { svc } = build();
    await svc.init();
    await svc.record('review', 'interval review ran', 'heartbeat:interval');
    await svc.record('noop', 'nothing warranted action', 'heartbeat:interval');
    expect(await svc.auditOk()).toEqual({ ok: true });
  });

  it('the conscience meter counts human vs agent actions, surfaces in snapshot, and persists', async () => {
    const storage = new FakeStorage();
    const mk = () => new MindService(new MindStore(storage), new ActionLedger(storage), { now: () => clock, genId: () => `id${++ids}`, capabilityStorage: storage });
    const svc = mk();
    await svc.init();
    await svc.recordHuman(0);
    await svc.recordHuman(0);
    await svc.record('act', 'did substantive work', 'heartbeat:wake'); // agent action
    await svc.record('noop', 'nothing', 'heartbeat:interval'); // NOT counted as agent work

    expect(svc.capability().humanActions).toBe(2);
    expect(svc.capability().agentActions).toBe(1); // only the 'act'
    expect((await svc.snapshot()).capability.humanActions).toBe(2);

    // persisted across a fresh service (restart)
    const svc2 = mk();
    await svc2.init();
    expect(svc2.capability().humanActions).toBe(2);
    expect(svc2.capability().agentActions).toBe(1);
  });

  it('habit detection: observeAction learns a daily habit and surfaces an automation offer in the seed + snapshot', async () => {
    const storage = new FakeStorage();
    const DAY = 24 * 60 * 60 * 1000;
    const HM = (d: number, h: number, m = 0) => d * DAY + (h * 60 + m) * 60000;
    const t = HM(3, 12);
    const svc = new MindService(new MindStore(storage), new ActionLedger(storage), { now: () => t, genId: () => `id${++ids}`, capabilityStorage: storage });
    await svc.init();
    // the user refreshes AI News ~8am four mornings in a row
    await svc.observeAction('dashboard:refresh AI News', HM(0, 8, 2));
    await svc.observeAction('dashboard:refresh AI News', HM(1, 8, 10));
    await svc.observeAction('dashboard:refresh AI News', HM(2, 7, 55));
    await svc.observeAction('dashboard:refresh AI News', HM(3, 8, 5));

    expect(svc.habits(t).some(h => h.action === 'dashboard:refresh AI News' && h.isDailyHabit)).toBe(true);
    // the agent SEES it in its review seed, told it may offer to automate via cron
    const seed = svc.seedBlock();
    expect(seed).toContain('refresh AI News');
    expect(seed).toContain('cron_create');
    // and it surfaces in the snapshot
    expect((await svc.snapshot()).habits.length).toBeGreaterThan(0);

    // takePendingHabitProposals is deterministic + propose-once
    const first = await svc.takePendingHabitProposals(t);
    expect(first.some(h => h.action === 'dashboard:refresh AI News')).toBe(true);
    const second = await svc.takePendingHabitProposals(t);
    expect(second).toHaveLength(0); // never proposes the same habit twice

    // persists across restart (incl. the "already proposed" mark)
    const svc2 = new MindService(new MindStore(storage), new ActionLedger(storage), { now: () => t, genId: () => `x${++ids}`, capabilityStorage: storage });
    await svc2.init();
    expect(svc2.habits(t).length).toBeGreaterThan(0);
    expect(await svc2.takePendingHabitProposals(t)).toHaveLength(0); // still proposed
  });

  it('daily reflection: reflectionDue gates it; reflect() prunes stale beliefs, marks, ledgers, persists', async () => {
    const storage = new FakeStorage();
    const mk = () => new MindService(new MindStore(storage), new ActionLedger(storage), { now: () => clock, genId: () => `id${++ids}`, capabilityStorage: storage });
    const svc = mk();
    await svc.init();
    expect(svc.reflectionDue(0)).toBe(true); // a fresh mind reflects once early
    await svc.remember('belief', 'a stale belief', 0.5, ['r']); // updatedMs = clock (1000)

    const YEAR = 365 * 24 * 60 * 60 * 1000;
    const { pruned } = await svc.reflect(YEAR); // far future → the belief has fully decayed
    expect(pruned).toBeGreaterThanOrEqual(1);
    expect(svc.reflectionDue(YEAR)).toBe(false); // marked reflected
    expect((await svc.snapshot()).recentActions.some(a => a.origin === 'heartbeat:reflection')).toBe(true);

    const svc2 = mk(); // restart
    await svc2.init();
    expect(svc2.reflectionDue(YEAR)).toBe(false); // persisted
  });

  it('the human can forget a belief (a correction), ledgered as a user action', async () => {
    const { svc } = build();
    await svc.init();
    await svc.remember('belief', 'User hates dark mode', 0.7, ['a guess']);
    const id = (await svc.snapshot()).beliefs[0].id;
    expect(typeof id).toBe('string');

    expect(await svc.forget(id)).toBe(true);
    const snap = await svc.snapshot();
    expect(snap.beliefs).toHaveLength(0);
    expect(snap.recentActions.some(a => a.origin === 'user' && a.summary.includes('forgot'))).toBe(true);
    expect(await svc.forget('nope')).toBe(false); // missing id → no-op
  });

  it('nag governor: feedback drives the dismiss-ratio + interruption budget, surfaced + persisted', async () => {
    const storage = new FakeStorage();
    const mk = () => new MindService(new MindStore(storage), new ActionLedger(storage), { now: () => clock, genId: () => `id${++ids}`, capabilityStorage: storage });
    const svc = mk();
    await svc.init();
    for (let i = 0; i < 6; i++) await svc.recordFeedback('dismiss');
    const snap = await svc.snapshot();
    expect(snap.nag.dismissRatio).toBe(1);
    expect(snap.nag.throttled).toBe(true);

    // persisted across restart
    const svc2 = mk();
    await svc2.init();
    expect((await svc2.snapshot()).nag.dismissRatio).toBe(1);
  });

  it('recordHuman with a skill feeds the held-out fluency probe, surfaces in snapshot, and persists', async () => {
    const storage = new FakeStorage();
    const mk = () => new MindService(new MindStore(storage), new ActionLedger(storage), { now: () => clock, genId: () => `id${++ids}`, capabilityStorage: storage });
    const svc = mk();
    await svc.init();
    await svc.recordHuman(0, 'a.ts');
    await svc.recordHuman(1000, 'a.ts');
    await svc.recordHuman(2000, 'a.ts'); // recurring → probe-eligible; a probe is issued

    const snap = await svc.snapshot();
    expect(snap.fluency).toBeDefined();
    expect(snap.fluency.issued).toBeGreaterThanOrEqual(1);

    // persists across restart
    const svc2 = mk();
    await svc2.init();
    expect(svc2.fluency().issued).toBe(snap.fluency.issued);
  });

  it('snapshot exposes the whole MIND for the panel (beliefs, predictions, fidelity, audit, ledger)', async () => {
    const { svc } = build();
    await svc.init();
    await svc.remember('belief', 'User ships on Fridays', 0.9, ['t1']);
    const pred = await svc.predict('next file', [{ label: 'a.ts', prob: 0.7 }], 1000, ['t1']);
    await svc.resolve(pred!.id, 'a.ts');

    const snap = await svc.snapshot();
    expect(snap.available).toBe(true);
    expect(snap.beliefs[0].content).toContain('Fridays');
    expect(snap.beliefs[0].confidence).toBeGreaterThan(0);
    expect(snap.predictions[0].resolved?.actual).toBe('a.ts');
    expect(snap.fidelity).toBeCloseTo(0.09, 5); // (0.7-1)^2
    expect(snap.audit.ok).toBe(true);
    expect(snap.recentActions.length).toBeGreaterThan(0);
    expect(snap.recentActions[0].kind).toBe('prediction-resolved'); // most recent first
  });
});
