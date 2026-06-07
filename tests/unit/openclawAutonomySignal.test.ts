import { describe, expect, it } from 'vitest';

import {
  normalizeAutonomySignal,
  signalToSystemEvent,
  AUTONOMY_SIGNAL_EVENT_TYPE,
} from '../../src/openclaw/openclawAutonomySignal';

describe('normalizeAutonomySignal', () => {
  it('accepts a well-formed signal and defaults severity to info', () => {
    const s = normalizeAutonomySignal({ source: 'budget', kind: 'over', title: 'Over budget' });
    expect(s).toEqual({ source: 'budget', kind: 'over', title: 'Over budget', detail: undefined, severity: 'info' });
  });

  it('keeps a valid severity', () => {
    expect(normalizeAutonomySignal({ title: 'x', severity: 'urgent' })?.severity).toBe('urgent');
    expect(normalizeAutonomySignal({ title: 'x', severity: 'warn' })?.severity).toBe('warn');
    expect(normalizeAutonomySignal({ title: 'x', severity: 'bogus' })?.severity).toBe('info');
  });

  it('drops payloads with no usable title (never crashes/spams the heartbeat)', () => {
    expect(normalizeAutonomySignal(null)).toBeNull();
    expect(normalizeAutonomySignal(undefined)).toBeNull();
    expect(normalizeAutonomySignal('nope')).toBeNull();
    expect(normalizeAutonomySignal({})).toBeNull();
    expect(normalizeAutonomySignal({ title: '   ' })).toBeNull();
    expect(normalizeAutonomySignal({ title: 42 })).toBeNull();
  });

  it('fills sensible defaults for missing source/kind', () => {
    const s = normalizeAutonomySignal({ title: 'Something happened' });
    expect(s?.source).toBe('extension');
    expect(s?.kind).toBe('signal');
  });

  it('truncates overlong title/detail', () => {
    const s = normalizeAutonomySignal({ title: 'a'.repeat(500), detail: 'b'.repeat(5000) });
    expect(s?.title.length).toBe(200);
    expect(s?.detail?.length).toBe(1000);
  });
});

describe('signalToSystemEvent', () => {
  it('maps a signal onto the heartbeat extension-signal event', () => {
    const ev = signalToSystemEvent({ source: 'web-research', kind: 'feed', title: 'New results', detail: 'd', severity: 'warn' });
    expect(ev.type).toBe(AUTONOMY_SIGNAL_EVENT_TYPE);
    expect(ev.payload).toMatchObject({ source: 'web-research', kind: 'feed', title: 'New results', detail: 'd', severity: 'warn' });
    expect(typeof ev.timestamp).toBe('number');
  });

  it('omits detail when absent', () => {
    const ev = signalToSystemEvent({ source: 's', kind: 'k', title: 't', severity: 'info' });
    expect('detail' in (ev.payload as object)).toBe(false);
  });
});
