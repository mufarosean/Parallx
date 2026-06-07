import { describe, expect, it } from 'vitest';

import { CapabilityMeter } from '../../src/openclaw/mind/capabilityMeter';

const DAY = 24 * 60 * 60 * 1000;

describe('CapabilityMeter — the conscience (assistance-fade)', () => {
  it('reports null share with no activity', () => {
    expect(new CapabilityMeter().read().assistanceShare).toBeNull();
  });

  it('computes the agent share of activity over the window', () => {
    const m = new CapabilityMeter();
    for (let i = 0; i < 3; i++) m.recordHuman(i * DAY);
    m.recordAgent(0);
    const r = m.read();
    expect(r.humanActions).toBe(3);
    expect(r.agentActions).toBe(1);
    expect(r.assistanceShare).toBeCloseTo(0.25, 5);
  });

  it('a stable, human-led share is NOT a deskilling risk', () => {
    const m = new CapabilityMeter({ riskShare: 0.6 });
    // every day: lots of human work, a little agent help — flat
    for (let d = 0; d < 8; d++) {
      for (let i = 0; i < 8; i++) m.recordHuman(d * DAY);
      m.recordAgent(d * DAY);
    }
    const r = m.read();
    expect(r.trend).toBe('stable');
    expect(r.deskillingRisk).toBe(false);
  });

  it('flags deskilling when the agent share rises over time past the threshold', () => {
    const m = new CapabilityMeter({ riskShare: 0.6, riseMargin: 0.1 });
    // early days: human-led
    for (let d = 0; d < 4; d++) {
      for (let i = 0; i < 9; i++) m.recordHuman(d * DAY);
      m.recordAgent(d * DAY);
    }
    // later days: agent does almost everything (human offloaded)
    for (let d = 4; d < 8; d++) {
      m.recordHuman(d * DAY);
      for (let i = 0; i < 9; i++) m.recordAgent(d * DAY);
    }
    const r = m.read();
    expect(r.trend).toBe('rising');
    expect(r.deskillingRisk).toBe(true);
  });

  it('a rising share that stays LOW is not yet a risk (threshold guards it)', () => {
    const m = new CapabilityMeter({ riskShare: 0.6 });
    for (let d = 0; d < 4; d++) for (let i = 0; i < 20; i++) m.recordHuman(d * DAY); // all human
    for (let d = 4; d < 8; d++) { for (let i = 0; i < 18; i++) m.recordHuman(d * DAY); for (let i = 0; i < 2; i++) m.recordAgent(d * DAY); }
    const r = m.read();
    expect(r.assistanceShare).toBeLessThan(0.6);
    expect(r.deskillingRisk).toBe(false); // share never crosses the risk line
  });

  it('a falling agent share is healthy (the human is taking back over)', () => {
    const m = new CapabilityMeter();
    for (let d = 0; d < 4; d++) { m.recordHuman(d * DAY); for (let i = 0; i < 9; i++) m.recordAgent(d * DAY); } // agent-led early
    for (let d = 4; d < 8; d++) { for (let i = 0; i < 9; i++) m.recordHuman(d * DAY); m.recordAgent(d * DAY); } // human-led later
    expect(m.read().trend).toBe('falling');
    expect(m.read().deskillingRisk).toBe(false);
  });

  it('retains only the windowBuckets most recent days', () => {
    const m = new CapabilityMeter({ windowBuckets: 3 });
    for (let d = 0; d < 6; d++) m.recordHuman(d * DAY);
    expect(m.read().humanActions).toBe(3); // only the last 3 days retained
  });
});
