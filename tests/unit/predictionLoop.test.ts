import { describe, expect, it, beforeEach } from 'vitest';

import { PredictionLoop } from '../../src/openclaw/mind/predictionLoop';
import { SequencePredictor } from '../../src/openclaw/mind/sequencePredictor';
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

let clock = 1000; let ids = 0;
function build() {
  const storage = new FakeStorage();
  const mind = new MindService(new MindStore(storage), new ActionLedger(storage), {
    now: () => clock, genId: () => `id${++ids}`,
  });
  const predictor = new SequencePredictor({ halfLifeCount: 1000, noveltyMass: 0.15 });
  const loop = new PredictionLoop(mind, predictor, { minHistory: 3, surpriseThreshold: 0.5 });
  return { mind, predictor, loop };
}

beforeEach(() => { clock = 1000; ids = 0; });

describe('PredictionLoop — real prediction graded by reality', () => {
  it('does not predict until it has enough history', async () => {
    const { mind, loop } = build();
    await loop.observe('a.ts'); // size 1
    await loop.observe('b.ts'); // size 2
    // still below minHistory(3) → no prediction yet → no unresolved predictions
    expect(mind.current().some(e => e.kind === 'prediction')).toBe(false);
  });

  it('issues a prediction once it has history, and grades it on the next observation', async () => {
    const { mind, loop } = build();
    for (const x of ['a.ts', 'a.ts', 'a.ts']) await loop.observe(x); // builds history, last issues a prediction
    // a prediction is now pending
    expect(mind.current().some(e => e.kind === 'prediction' && !e.resolved)).toBe(true);

    const res = await loop.observe('a.ts'); // matches the forecast (a.ts) → low brier
    expect(res.brier).toBeLessThan(0.5);
    expect(res.surprised).toBe(false);
    // the prediction is now resolved
    expect(mind.current().some(e => e.kind === 'prediction' && e.resolved)).toBe(true);
  });

  it('flags surprise and remembers it when reality contradicts the forecast', async () => {
    const { mind, loop } = build();
    for (const x of ['a.ts', 'a.ts', 'a.ts']) await loop.observe(x); // forecast strongly favors a.ts
    const res = await loop.observe('totally-new.ts'); // unforecast → high brier
    expect(res.surprised).toBe(true);
    expect(res.brier).toBeGreaterThanOrEqual(0.5);
    // the surprise is remembered as continuity the next review will see
    const threads = mind.current().filter(e => e.kind === 'thread');
    expect(threads.some(t => t.content.includes('Surprised') && t.content.includes('totally-new.ts'))).toBe(true);
  });

  it('moves the fidelity meter as predictions resolve', async () => {
    const { mind, loop } = build();
    for (const x of ['a.ts', 'a.ts', 'a.ts']) await loop.observe(x);
    expect(Number.isNaN(mind.fidelity())).toBe(true); // nothing resolved yet
    await loop.observe('a.ts'); // resolves one
    expect(Number.isNaN(mind.fidelity())).toBe(false);
  });

  it('is a no-op on an empty observation', async () => {
    const { loop } = build();
    const res = await loop.observe('');
    expect(res).toEqual({ surprised: false });
  });
});
