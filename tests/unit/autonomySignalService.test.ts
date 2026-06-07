import { describe, expect, it } from 'vitest';

import { AutonomySignalService, type IAutonomySignal } from '../../src/services/autonomySignalService';

describe('AutonomySignalService', () => {
  it('accepts a valid signal, returns true, and fires onDidSignal with the normalized form', () => {
    const svc = new AutonomySignalService();
    const seen: IAutonomySignal[] = [];
    svc.onDidSignal(s => seen.push(s));

    const accepted = svc.signal({ source: 'budget', kind: 'over', title: '  Over cap  ', severity: 'urgent' });

    expect(accepted).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ source: 'budget', kind: 'over', title: 'Over cap', detail: undefined, severity: 'urgent' });
  });

  it('drops a malformed signal: returns false and does not fire', () => {
    const svc = new AutonomySignalService();
    let fired = 0;
    svc.onDidSignal(() => fired++);

    expect(svc.signal({})).toBe(false);
    expect(svc.signal(null)).toBe(false);
    expect(svc.signal({ title: '   ' })).toBe(false);
    expect(fired).toBe(0);
  });
});
