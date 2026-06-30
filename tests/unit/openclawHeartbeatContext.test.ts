import { describe, expect, it } from 'vitest';

import {
  buildHeartbeatSnapshot,
  formatAppContext,
  formatEventLine,
  hasNoteworthySignals,
  buildWorkspaceContext,
  buildTasksContext,
} from '../../src/openclaw/openclawHeartbeatContext';

const ev = (type: string) => ({ type, payload: {}, timestamp: 0 });

describe('buildHeartbeatSnapshot', () => {
  it('groups pending events by type', () => {
    const s = buildHeartbeatSnapshot([ev('file-change'), ev('file-change'), ev('index-complete')]);
    expect(s.eventCount).toBe(3);
    expect(s.events).toEqual([
      { type: 'file-change', count: 2 },
      { type: 'index-complete', count: 1 },
    ]);
  });

  it('is empty for no events', () => {
    const s = buildHeartbeatSnapshot([]);
    expect(s.eventCount).toBe(0);
    expect(s.events).toEqual([]);
  });
});

describe('hasNoteworthySignals', () => {
  it('is false for an idle (no-event) snapshot', () => {
    expect(hasNoteworthySignals(buildHeartbeatSnapshot([]))).toBe(false);
  });
  it('is true when there are pending events', () => {
    expect(hasNoteworthySignals(buildHeartbeatSnapshot([ev('file-change')]))).toBe(true);
  });
});

describe('formatEventLine', () => {
  const mk = (type: string, payload: Record<string, unknown>) => ({ type, payload, timestamp: 0 });

  it('renders an extension signal in human form with source + detail + severity', () => {
    const line = formatEventLine(mk('extension-signal', { source: 'budget', title: 'Over cap', detail: '$5 left', severity: 'urgent' }));
    expect(line).toBe('signal from budget [urgent]: Over cap — $5 left');
  });

  it('omits severity tag for info signals', () => {
    expect(formatEventLine(mk('extension-signal', { source: 's', title: 't', severity: 'info' }))).toBe('signal from s: t');
  });

  it('renders a file-change with its path', () => {
    expect(formatEventLine(mk('file-change', { path: '/a/b.ts' }))).toBe('file changed: /a/b.ts');
  });

  it('renders a prediction-surprise with the diverging path and pressure', () => {
    const line = formatEventLine(mk('prediction-surprise', { path: '/x/new.ts', pressure: 1.8 }));
    expect(line).toContain('prediction surprise');
    expect(line).toContain('/x/new.ts');
    expect(line).toContain('1.8');
  });

  it('renders a habit-confirmed as a focused decision the model judges (with cron rail)', () => {
    const line = formatEventLine(mk('habit-confirmed', { action: 'dashboard:refresh AI News', typicalTime: '08:00', cron: '0 8 * * *' }));
    expect(line).toContain('habit just confirmed');
    expect(line).toContain('refresh AI News');
    expect(line).toContain('08:00');
    expect(line).toContain('cron_create');
    expect(line).toContain('0 8 * * *');
    expect(line).toContain('NOOP'); // it can decline — judgment is the model's
  });

  it('falls back to type + JSON for unknown kinds', () => {
    expect(formatEventLine(mk('mystery', { x: 1 }))).toBe('mystery · {"x":1}');
  });
});

describe('formatAppContext', () => {
  it('leads with recent activity and never mentions diagnostics', () => {
    const out = formatAppContext(buildHeartbeatSnapshot([ev('file-change')]));
    expect(out).toContain('Recent activity');
    expect(out).toContain('1 file-change');
    expect(out).not.toContain('Background health');
    expect(out).not.toMatch(/diagnostic/i);
  });

  it('reports nothing-new for an idle snapshot', () => {
    const out = formatAppContext(buildHeartbeatSnapshot([]));
    expect(out).toContain('Recent activity: nothing new');
    expect(out).not.toMatch(/diagnostic/i);
  });
});

describe('buildWorkspaceContext — the agent sees the user\'s actual work', () => {
  it('renders the pages, most recently worked-on first', () => {
    const out = buildWorkspaceContext([
      { title: 'Q3 Budget', updatedAt: '2026-06-07T09:00:00Z' },
      { title: 'Q3 Planning', updatedAt: '2026-06-07T10:00:00Z' },
    ]);
    expect(out).toContain('Q3 Planning');
    expect(out).toContain('Q3 Budget');
    expect(out.indexOf('Q3 Planning')).toBeLessThan(out.indexOf('Q3 Budget')); // newer first
    expect(out).toContain('2 canvas page');
  });

  it('is empty when there are no pages', () => {
    expect(buildWorkspaceContext([])).toBe('');
  });
});

describe('buildTasksContext — the agent sees the user\'s commitments', () => {
  it('lists open tasks and flags how many are due within a day', () => {
    const now = 1_000_000_000_000;
    const out = buildTasksContext([
      { title: 'File the Q3 report', dueAt: now + 60 * 60 * 1000 }, // due soon
      { title: 'Refactor the planner', dueAt: now + 10 * 24 * 60 * 60 * 1000 },
    ], now);
    expect(out).toContain('File the Q3 report');
    expect(out).toContain('2 open task');
    expect(out).toContain('1 due within a day');
  });

  it('is empty when there are no open tasks', () => {
    expect(buildTasksContext([])).toBe('');
  });
});
