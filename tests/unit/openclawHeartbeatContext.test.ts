import { describe, expect, it } from 'vitest';

import {
  buildHeartbeatSnapshot,
  formatAppContext,
  hasNoteworthySignals,
  risingFailures,
} from '../../src/openclaw/openclawHeartbeatContext';

const diag = (name: string, status: 'pass' | 'warn' | 'fail', detail = '') => ({
  name, status, detail, timestamp: 0,
});
const ev = (type: string) => ({ type, payload: {}, timestamp: 0 });

describe('buildHeartbeatSnapshot', () => {
  it('keeps only warn/fail diagnostics, fail first', () => {
    const s = buildHeartbeatSnapshot(
      [diag('A', 'pass'), diag('B', 'warn', 'w'), diag('C', 'fail', 'f')],
      [],
    );
    expect(s.diagnosticsAvailable).toBe(true);
    expect(s.diagnosticsTotal).toBe(3);
    expect(s.diagnosticsAttention.map(d => d.name)).toEqual(['C', 'B']); // fail before warn
  });

  it('groups pending events by type', () => {
    const s = buildHeartbeatSnapshot([], [ev('file-change'), ev('file-change'), ev('index-complete')]);
    expect(s.eventCount).toBe(3);
    expect(s.events).toEqual([
      { type: 'file-change', count: 2 },
      { type: 'index-complete', count: 1 },
    ]);
  });

  it('marks diagnostics unavailable when undefined', () => {
    const s = buildHeartbeatSnapshot(undefined, []);
    expect(s.diagnosticsAvailable).toBe(false);
    expect(s.diagnosticsAttention).toEqual([]);
  });
});

describe('hasNoteworthySignals', () => {
  it('is false for an all-clear, idle snapshot', () => {
    expect(hasNoteworthySignals(buildHeartbeatSnapshot([diag('A', 'pass')], []))).toBe(false);
  });
  it('is true when a diagnostic needs attention', () => {
    expect(hasNoteworthySignals(buildHeartbeatSnapshot([diag('A', 'fail')], []))).toBe(true);
  });
  it('is true when there are pending events', () => {
    expect(hasNoteworthySignals(buildHeartbeatSnapshot([], [ev('file-change')]))).toBe(true);
  });
});

describe('risingFailures', () => {
  it('returns only checks that newly fail (rising edge)', () => {
    const prev = new Set(['A']);
    const results = [diag('A', 'fail'), diag('B', 'fail'), diag('C', 'pass')];
    expect(risingFailures(prev, results)).toEqual(['B']); // A was already failing
  });
  it('is empty when nothing new fails', () => {
    expect(risingFailures(new Set(['A']), [diag('A', 'fail'), diag('C', 'pass')])).toEqual([]);
  });
  it('is empty when there are no failures', () => {
    expect(risingFailures(new Set(), [diag('A', 'pass'), diag('B', 'warn')])).toEqual([]);
  });
});

describe('formatAppContext', () => {
  it('reports the all-clear posture so the model can confidently NOOP', () => {
    const out = formatAppContext(buildHeartbeatSnapshot([diag('A', 'pass'), diag('B', 'pass')], []));
    expect(out).toContain('all 2 checks passing');
    expect(out).toContain('none since the last review');
  });

  it('surfaces failing diagnostics with detail', () => {
    const out = formatAppContext(buildHeartbeatSnapshot(
      [diag('Ollama Connection', 'fail', 'Cannot reach Ollama')],
      [ev('file-change')],
    ));
    expect(out).toContain('[FAIL] Ollama Connection: Cannot reach Ollama');
    expect(out).toContain('1 file-change');
  });

  it('notes when diagnostics are unavailable', () => {
    expect(formatAppContext(buildHeartbeatSnapshot(undefined, []))).toContain('Diagnostics: unavailable');
  });
});
