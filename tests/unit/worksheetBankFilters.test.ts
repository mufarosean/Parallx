// Worksheets: the Problem Bank's filters. Chips in one facet widen (any may
// match), chips across facets narrow (all must). Done is the opposite of
// Incomplete. The search box finds a paper by its name.
import { describe, it, expect } from 'vitest';
import { bankMatches, isDone, parseQuery, BANK_FACETS, BANK_FILTERS, BANK_COUNTED, type BankFilterItem } from '../../src/built-in/worksheet/bankFilters.js';

const item = (o: Partial<BankFilterItem> = {}): BankFilterItem => ({
  title: 'P1', sheetName: 'B1', questionMd: 'Compute the reserve.', paper: 'brosius', note: '', tags: '',
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
  it('several words match in any order and anywhere, each one somewhere', () => {
    const it1 = item({ questionMd: 'Use least squares to estimate the credibility weight.', note: 'tricky algebra' });
    expect(bankMatches(it1, F(), 'credibility brosius')).toBe(true);
    expect(bankMatches(it1, F(), 'brosius algebra squares')).toBe(true);
    expect(bankMatches(it1, F(), 'brosius mack')).toBe(false);
    expect(bankMatches(it1, F(), '  Credibility   ')).toBe(true);
  });
  it('a quoted phrase matches whole; a minus leaves problems out', () => {
    const it1 = item({ questionMd: 'Use least squares to estimate the credibility weight.' });
    expect(bankMatches(it1, F(), '"least squares"')).toBe(true);
    expect(bankMatches(it1, F(), '"squares least"')).toBe(false);
    expect(bankMatches(it1, F(), 'brosius -squares')).toBe(false);
    expect(bankMatches(it1, F(), 'brosius -mack')).toBe(true);
    expect(bankMatches(it1, F(), '-"least squares"')).toBe(false);
    expect(parseQuery(' a  "b c" -d -"e f" - "unclosed')).toEqual([
      { text: 'a', not: false }, { text: 'b c', not: false }, { text: 'd', not: true }, { text: 'e f', not: true }, { text: 'unclosed', not: false },
    ]);
  });
  it('searches the tags too, so an exam question is found by its reading', () => {
    expect(bankMatches(item({ paper: 'pe1', title: 'PE 1 · Q #2', tags: 'pe1,exam,quant,reading:clark' }), F(), 'clark')).toBe(true);
  });
  it('every chip belongs to one facet, and the counted ones exist', () => {
    const all = (Object.values(BANK_FACETS) as readonly (readonly string[])[]).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(BANK_FILTERS.map(([v]) => v).sort()).toEqual([...all].sort());
    for (const c of BANK_COUNTED) expect(all).toContain(c);
  });
});

describe('the Custom source chip', () => {
  it('shows only the custom bank', () => {
    const base = { title: 't', sheetName: 'SHA-07', questionMd: '', paper: 'shapland', note: '', tags: '', kind: 'quant', starred: false, attemptCount: 0, attemptState: '' };
    expect(bankMatches({ ...base, source: 'custom' }, new Set(['custom']), '')).toBe(true);
    expect(bankMatches({ ...base, source: 'rf' }, new Set(['custom']), '')).toBe(false);
  });
});
