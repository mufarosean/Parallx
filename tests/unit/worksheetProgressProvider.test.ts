// worksheetProgressProvider.test.ts — Worksheets' problems as progress any tool can show.
//
// The provider must say exactly what Worksheets' own dashboard says: the same
// problems (a Rising Fellow or CAS problem with a paper; no essay, no custom
// problem, none without a paper), the same counts per paper. So every count
// is compared with computeInsights().byPaper, the dashboard's source.

import { describe, it, expect, vi } from 'vitest';
import { computeInsights, progressByPaper } from '../../src/built-in/worksheet/progressInsights.js';
import { worksheetProgressGroups, worksheetProgressIds, worksheetProgressProvider } from '../../src/built-in/worksheet/progressProvider.js';
import { registerProgressProvider, listProgressProviders, progressCounts } from '../../src/services/progressProviders.js';

const item = (id: number, paper: string, attemptState: string, extra: Partial<{ source: string; kind: string }> = {}) => ({
  id, title: `P${id}`, paper, source: extra.source ?? 'rf', kind: extra.kind ?? 'quant', quadrant: 0,
  attemptState, attemptCount: attemptState && attemptState !== 'open' ? 1 : 0, seconds: 0, lastAttemptAt: 0,
});

const bank = [
  item(1, 'clark', 'easy'), item(2, 'clark', 'nailed'), item(3, 'clark', 'medium'), item(4, 'clark', 'hard'), item(5, 'clark', 'missed'),
  item(6, 'clark', ''), item(7, 'clark', 'open'),
  item(8, 'mack1994', 'easy', { source: 'cas' }), item(9, 'mack1994', ''),
  item(10, 'hurlimann', 'hard'),
  item(11, 'friedland', ''),
  // What the dashboard's "Progress by paper" leaves out.
  item(20, 'clark', 'easy', { kind: 'essay' }), item(21, 'clark', 'hard', { source: 'custom' }), item(22, '', 'easy'), item(23, 'pe1', 'easy', { source: 'exam' }),
];

describe('worksheetProgressGroups', () => {
  const groups = worksheetProgressGroups(bank);
  const dashboard = computeInsights(bank, []).byPaper;

  it('has one group per paper of the dashboard, with the dashboard\'s counts', () => {
    expect(groups.map((g) => g.group).sort()).toEqual(dashboard.map((p) => p.paper).sort());
    for (const p of dashboard) {
      const g = groups.find((x) => x.group === p.paper)!;
      expect({ total: g.total, good: g.good, middling: g.middling, poor: g.poor }, p.paper).toEqual({ total: p.total, good: p.easy, middling: p.medium, poor: p.hard });
      expect(progressCounts(g)[3], `${p.paper} not rated`).toBe(p.total - p.rated);
    }
  });

  it('counts the paper as seeded: legacy words are ratings, open is not rated', () => {
    expect(groups.find((g) => g.group === 'clark')).toEqual({ group: 'clark', label: 'Clark', total: 7, good: 2, middling: 1, poor: 2 });
    expect(groups.find((g) => g.group === 'friedland')).toEqual({ group: 'friedland', label: 'Friedland', total: 1, good: 0, middling: 0, poor: 0 });
  });

  it('labels a group as the dashboard names the paper', () => {
    expect(groups.find((g) => g.group === 'mack1994')!.label).toBe('Mack (1994)');
    expect(groups.find((g) => g.group === 'hurlimann')!.label).toBe('Hürlimann');
  });

  it('is the same list progressByPaper gives the dashboard', () => {
    expect(progressByPaper(bank)).toEqual(dashboard);
    expect(groups.reduce((t, g) => t + g.total, 0)).toBe(computeInsights(bank, []).totalProblems);
  });
});

describe('worksheetProgressIds', () => {
  it('names the problems of a paper in a state, and only the workbook\'s', () => {
    expect(worksheetProgressIds(bank, 'clark', 'good')).toEqual([1, 2]);
    expect(worksheetProgressIds(bank, 'clark', 'middling')).toEqual([3]);
    expect(worksheetProgressIds(bank, 'clark', 'poor')).toEqual([4, 5]);
    expect(worksheetProgressIds(bank, 'clark', 'rest')).toEqual([6, 7]);
    expect(worksheetProgressIds(bank, 'nobody', 'good')).toEqual([]);
  });
});

describe('worksheetProgressProvider', () => {
  const deps = () => {
    const listeners = new Set<() => void>();
    return {
      listeners,
      listItems: vi.fn(async () => bank),
      onDidChange: (listener: () => void) => { listeners.add(listener); return { dispose: () => { listeners.delete(listener); } }; },
      openQuiz: vi.fn(),
    };
  };

  it('is a provider of Problems in Worksheets\' own words', async () => {
    const p = worksheetProgressProvider(deps());
    expect(p.id).toBe('worksheets.problems');
    expect(p.displayName).toBe('Problems');
    expect(p.toolId).toBe('parallx.worksheet');
    expect(p.words).toEqual({ good: 'Easy', middling: 'Medium', poor: 'Hard', rest: 'Not rated' });
    expect(await p.groups()).toEqual(worksheetProgressGroups(bank));
  });

  it('passes on Worksheets\' data change, and stops when disposed', () => {
    const d = deps();
    const p = worksheetProgressProvider(d);
    const heard = vi.fn();
    const sub = p.onDidChange(heard);
    for (const l of d.listeners) l();
    expect(heard).toHaveBeenCalledOnce();
    sub.dispose();
    expect(d.listeners.size).toBe(0);
  });

  it('opens the quiz builder on a paper\'s problems in a state, and says false when there are none', async () => {
    const d = deps();
    const p = worksheetProgressProvider(d);
    expect(await p.open!('clark', 'poor')).toBe(true);
    expect(d.openQuiz).toHaveBeenCalledWith([4, 5], 'Clark Hard');
    expect(await p.open!('friedland', 'good')).toBe(false);
    expect(await p.open!('clark', 'sideways' as never)).toBe(false);
    expect(d.openQuiz).toHaveBeenCalledOnce();
  });

  it('registers in the core registry and leaves it when disposed', () => {
    const reg = registerProgressProvider(worksheetProgressProvider(deps()));
    expect(listProgressProviders().some((x) => x.id === 'worksheets.problems')).toBe(true);
    reg.dispose();
    expect(listProgressProviders().some((x) => x.id === 'worksheets.problems')).toBe(false);
  });
});
