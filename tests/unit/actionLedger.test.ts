import { describe, expect, it } from 'vitest';

import {
  appendAction,
  verifyChain,
  fnv1a,
  ActionLedger,
  GENESIS_HASH,
  type IAgentActionRecord,
  type IAgentActionInput,
} from '../../src/openclaw/mind/actionLedger';
import type { IStorage } from '../../src/platform/storage';

class FakeStorage implements IStorage {
  readonly map = new Map<string, string>();
  async get(k: string) { return this.map.get(k); }
  async set(k: string, v: string) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
  async has(k: string) { return this.map.has(k); }
  async keys(p?: string) { return [...this.map.keys()].filter(k => !p || k.startsWith(p)); }
}

const act = (over: Partial<IAgentActionInput> = {}): IAgentActionInput => ({
  kind: 'review', summary: 's', origin: 'heartbeat:wake', ...over,
});

function buildChain(n: number): readonly IAgentActionRecord[] {
  let chain: readonly IAgentActionRecord[] = [];
  for (let i = 0; i < n; i++) chain = appendAction(chain, act({ summary: `a${i}` }), i * 1000);
  return chain;
}

describe('hash chain', () => {
  it('seeds the first record from genesis and increments seq', () => {
    const chain = buildChain(3);
    expect(chain[0].prevHash).toBe(GENESIS_HASH);
    expect(chain.map(r => r.seq)).toEqual([0, 1, 2]);
    expect(chain[1].prevHash).toBe(chain[0].hash);
    expect(chain[2].prevHash).toBe(chain[1].hash);
  });

  it('verifies a clean chain', () => {
    expect(verifyChain(buildChain(5))).toEqual({ ok: true });
  });

  it('detects tampering of a record body (hash no longer matches payload)', () => {
    const chain = buildChain(4).slice() as IAgentActionRecord[];
    // forge the summary of record 2 without recomputing hashes
    chain[2] = { ...chain[2], summary: 'I totally acted (I did not)' };
    const res = verifyChain(chain);
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe(2);
  });

  it('detects deletion of an interior record (broken link)', () => {
    const chain = buildChain(5);
    const withHole = [chain[0], chain[1], chain[3], chain[4]]; // dropped record 2
    const res = verifyChain(withHole);
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe(2);
  });

  it('fnv1a is deterministic and 8 hex chars', () => {
    expect(fnv1a('abc')).toBe(fnv1a('abc'));
    expect(fnv1a('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
  });
});

describe('ActionLedger (durable)', () => {
  it('appends across calls and stays verifiable after reload', async () => {
    const storage = new FakeStorage();
    const ledger = new ActionLedger(storage);
    await ledger.append(act({ kind: 'review', summary: 'ran review' }), 1000);
    await ledger.append(act({ kind: 'act', summary: 'staged file', reversible: true }), 2000);
    const loaded = await ledger.load();
    expect(loaded).toHaveLength(2);
    expect(loaded[1].kind).toBe('act');
    expect(loaded[1].reversible).toBe(true);
    expect(await ledger.verify()).toEqual({ ok: true });
  });

  it('caps the retained window (oldest dropped) and the window stays internally verifiable', async () => {
    const storage = new FakeStorage();
    const ledger = new ActionLedger(storage, 3);
    for (let i = 0; i < 6; i++) await ledger.append(act({ summary: `a${i}` }), i * 1000);
    const loaded = await ledger.load();
    expect(loaded).toHaveLength(3);
    expect(loaded.map(r => r.summary)).toEqual(['a3', 'a4', 'a5']); // oldest dropped
    expect(verifyChain(loaded)).toEqual({ ok: true });
  });

  it('verify catches an attacker editing the persisted store', async () => {
    const storage = new FakeStorage();
    const ledger = new ActionLedger(storage);
    await ledger.append(act({ summary: 'real' }), 1000);
    await ledger.append(act({ summary: 'real2' }), 2000);
    // tamper with the raw persisted JSON
    const raw = JSON.parse(storage.map.get('autonomy.ledger.v1')!) as IAgentActionRecord[];
    raw[0] = { ...raw[0], summary: 'forged' };
    storage.map.set('autonomy.ledger.v1', JSON.stringify(raw));
    const res = await ledger.verify();
    expect(res.ok).toBe(false);
  });
});
