// Worksheets: the Problem Bank's filters. Chips in one facet widen (any may
// match), chips across facets narrow (all must). Done is the opposite of
// Incomplete. The search box finds a paper by its name.
import { describe, it, expect } from 'vitest';
import { bankMatches, isDone, BANK_FACETS, BANK_FILTERS, BANK_COUNTED, type BankFilterItem } from '../../src/built-in/worksheet/bankFilters.js';

const item = (o: Partial<BankFilterItem> = {}): BankFilterItem => ({
  title: 'P1', sheetName: 'B1', questionMd: 'Compute the reserve.', paper: 'brosius', note: '',
  source: 'rf', kind: 'quant', starred: false, attemptCount: 0, attemptState: '', ...o,
});
const F = (...f: string[]) => new Set(f);

describe('bank filters', () => {
  it('Done is a problem worked through to a rating and not open now; Incomplete is the rest', () => {
    const never = item();
    const open = item({ attemptCount: 1, attemptState: 'open' });
    const rated = item({ attemptCount: 2, attemptState: 'hard' });
    expect([never, open, rated].map(isDone)).toEqual([false, false, true]);
    expect(bankMatches(rated, F('done'), '')).toBe(true);
    expect(bankMatches(open, F('done'), '')).toBe(false);
    expect(bankMatches(never, F('incomplete'), '')).toBe(true);
    expect(bankMatches(rated, F('incomplete'), '')).toBe(false);
    // Both on: the status facet widens, so everything shows.
    expect([never, open, rated].every((it) => bankMatches(it, F('done', 'incomplete'), ''))).toBe(true);
  });
  it('narrows across facets: done AND hard AND Rising Fellow', () => {
    const it1 = item({ attemptCount: 1, attemptState: 'hard' });
    expect(bankMatches(it1, F('done', 'hard', 'rf'), '')).toBe(true);
    expect(bankMatches(item({ attemptCount: 1, attemptState: 'medium' }), F('done', 'hard'), '')).toBe(false);
    expect(bankMatches(item({ attemptCount: 1, attemptState: 'hard', source: 'cas' }), F('done', 'hard', 'rf'), '')).toBe(false);
    expect(bankMatches(item({ attemptCount: 1, attemptState: 'hard', source: 'exam' }), F('exam'), '')).toBe(true);
  });
  it('finds a paper by its name, whatever the title says', () => {
    expect(bankMatches(item({ title: 'Problem 7' }), F(), 'brosius')).toBe(true);
    expect(bankMatches(item({ title: 'Problem 7', paper: 'clark' }), F(), 'brosius')).toBe(false);
    expect(bankMatches(item({ note: 'Remember the Brosius credibility weight' }), F(), 'credibility')).toBe(true);
  });
  it('every chip belongs to one facet, and the counted ones exist', () => {
    const all = (Object.values(BANK_FACETS) as readonly (readonly string[])[]).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(BANK_FILTERS.map(([v]) => v).sort()).toEqual([...all].sort());
    for (const c of BANK_COUNTED) expect(all).toContain(c);
  });
});
