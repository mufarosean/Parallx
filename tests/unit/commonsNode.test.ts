import { describe, expect, it } from 'vitest';

import { LoopbackBus, LoopbackTransport } from '../../src/openclaw/commons/peerTransport';
import { CommonsNode, ReputationLedger } from '../../src/openclaw/commons/commonsNode';

function idgen(prefix: string) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe('ReputationLedger', () => {
  it('starts at 0 and bumps; round-trips state', () => {
    const r = new ReputationLedger();
    expect(r.scoreOf('x')).toBe(0);
    r.bump('x'); r.bump('x', 2);
    expect(r.scoreOf('x')).toBe(3);
    const r2 = new ReputationLedger();
    r2.restore(JSON.parse(JSON.stringify(r.toState())));
    expect(r2.scoreOf('x')).toBe(3);
  });
});

describe('CommonsNode — sovereign federation over loopback', () => {
  it('two nodes exchange a governed pattern P2P, with quarantine → approve → trust → auto-accept', () => {
    const bus = new LoopbackBus();
    const a = new CommonsNode('peer-A', new LoopbackTransport(bus), { now: () => 1, genId: idgen('A') });
    const b = new CommonsNode('peer-B', new LoopbackTransport(bus), { now: () => 1, genId: idgen('B'), trustThreshold: 1 });

    // A contributes a generic pattern → it passes the firewall and reaches B,
    // which QUARANTINES it (A is an untrusted stranger).
    const c1 = a.contribute('After editing a source file, its test is often edited next.');
    expect('artifact' in c1).toBe(true);
    expect(b.quarantined()).toHaveLength(1);
    expect(b.accepted()).toHaveLength(0);

    // B's human approves it → accepted, and A earns trust at B.
    const qid = b.quarantined()[0].id;
    expect(b.approve(qid)).toBe(true);
    expect(b.accepted()).toHaveLength(1);
    expect(b.reputationOf('peer-A')).toBe(1);

    // A contributes again → now AUTO-accepted (A is trusted by B).
    a.contribute('Linters run faster with a warm cache.');
    expect(b.accepted()).toHaveLength(2);
    expect(b.quarantined()).toHaveLength(0);
  });

  it('SOVEREIGNTY: personal content never crosses the wire (firewall blocks at the source)', () => {
    const bus = new LoopbackBus();
    const a = new CommonsNode('peer-A', new LoopbackTransport(bus), { now: () => 1, genId: idgen('A') });
    const b = new CommonsNode('peer-B', new LoopbackTransport(bus), { now: () => 1, genId: idgen('B') });

    const c = a.contribute('The user lives at C:\\Users\\bob and edits taxes.pdf on 2026-06-07');
    expect('rejected' in c).toBe(true);
    // B never received anything — nothing personal left A's machine.
    expect(b.quarantined()).toHaveLength(0);
    expect(b.accepted()).toHaveLength(0);
  });

  it('a node ignores its own broadcasts and dedupes repeats', () => {
    const bus = new LoopbackBus();
    const a = new CommonsNode('peer-A', new LoopbackTransport(bus), { now: () => 1, genId: () => 'fixed-id' });
    const b = new CommonsNode('peer-B', new LoopbackTransport(bus), { now: () => 1, genId: idgen('B') });
    a.contribute('Generic insight one.');
    a.contribute('Generic insight one.'); // same fixed id → dedup at B
    expect(a.accepted()).toHaveLength(0); // never accepts its own
    expect(b.quarantined()).toHaveLength(1); // deduped
  });

  it('rejecting a quarantined artifact earns the origin no trust', () => {
    const bus = new LoopbackBus();
    const a = new CommonsNode('peer-A', new LoopbackTransport(bus), { now: () => 1, genId: idgen('A') });
    const b = new CommonsNode('peer-B', new LoopbackTransport(bus), { now: () => 1, genId: idgen('B') });
    a.contribute('Generic insight.');
    const qid = b.quarantined()[0].id;
    expect(b.reject(qid)).toBe(true);
    expect(b.accepted()).toHaveLength(0);
    expect(b.reputationOf('peer-A')).toBe(0); // no trust earned
  });
});
