import { describe, expect, it } from 'vitest';

import { SkillProbe } from '../../src/openclaw/mind/skillProbe';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe('SkillProbe — held-out unaided-skill measurement', () => {
  it('does not probe a skill until it recurs enough', () => {
    const p = new SkillProbe({ minObservations: 3, cooldownMs: 0 });
    p.observe('a.ts', 0);
    p.observe('a.ts', HOUR);
    expect(p.maybeIssue(2 * HOUR)).toBeUndefined(); // only 2 observations
    p.observe('a.ts', 2 * HOUR);
    expect(p.maybeIssue(3 * HOUR)).toBe('a.ts'); // now eligible
  });

  it('issues a probe, marks the skill held-out, and resolves on completion with latency', () => {
    const p = new SkillProbe({ minObservations: 2, cooldownMs: 0 });
    p.observe('build.ts', 0);
    p.observe('build.ts', HOUR);
    const skill = p.maybeIssue(2 * HOUR);
    expect(skill).toBe('build.ts');
    expect(p.heldOutSkill).toBe('build.ts');

    const { resolved } = p.observe('build.ts', 2 * HOUR + 30 * MIN); // human did it unaided
    expect(resolved?.latencyMs).toBe(30 * MIN);
    expect(p.heldOutSkill).toBeUndefined(); // probe closed
    expect(p.reading().completed).toBe(1);
    expect(p.reading().completionRate).toBe(1);
  });

  it('only one probe is open at a time', () => {
    const p = new SkillProbe({ minObservations: 1, cooldownMs: 0 });
    p.observe('a', 0);
    p.observe('b', 0);
    expect(p.maybeIssue(HOUR)).toBeDefined();
    expect(p.maybeIssue(2 * HOUR)).toBeUndefined(); // one already open
  });

  it('respects the probe cooldown', () => {
    const p = new SkillProbe({ minObservations: 1, cooldownMs: 24 * HOUR });
    p.observe('a', 0);
    const first = p.maybeIssue(HOUR);
    expect(first).toBe('a');
    p.observe('a', 2 * HOUR); // resolve it
    expect(p.maybeIssue(3 * HOUR)).toBeUndefined(); // cooldown still active
    expect(p.maybeIssue(26 * HOUR)).toBe('a'); // cooldown elapsed
  });

  it('an unresolved probe expires after the window', () => {
    const p = new SkillProbe({ minObservations: 1, cooldownMs: 0, resolveWindowMs: 2 * HOUR });
    p.observe('a', 0);
    p.maybeIssue(HOUR);
    // human never returns to 'a' within window; touches something else far later
    p.observe('b', 10 * HOUR);
    expect(p.heldOutSkill).toBeUndefined(); // expired
    expect(p.reading().completed).toBe(0);
  });

  it('detects improving fluency (unaided latency falling over probes)', () => {
    const p = new SkillProbe({ minObservations: 1, cooldownMs: 0, resolveWindowMs: 100 * HOUR });
    const latencies = [60, 50, 20, 15]; // minutes — getting faster
    let t = 0;
    for (const lat of latencies) {
      p.observe('a', t);
      p.maybeIssue(t + 1);
      p.observe('a', t + 1 + lat * MIN); // unaided completion after `lat` minutes
      t += 200 * HOUR; // space probes out
    }
    expect(p.reading().completed).toBe(4);
    expect(p.reading().trend).toBe('improving');
  });

  it('round-trips through serialize/restore', () => {
    const p = new SkillProbe({ minObservations: 1, cooldownMs: 0 });
    p.observe('a', 0);
    p.maybeIssue(HOUR);
    p.observe('a', 2 * HOUR);
    const state = JSON.parse(JSON.stringify(p.toState()));
    const p2 = new SkillProbe({ minObservations: 1 });
    p2.restore(state);
    expect(p2.reading().completed).toBe(1);
    expect(p2.reading().issued).toBe(1);
  });
});
