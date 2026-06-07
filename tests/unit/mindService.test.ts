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
