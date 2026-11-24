// Worksheets' work provider: the ledger's time and the problems rated, by day and paper.
import { describe, it, expect } from 'vitest';
import { worksheetWorkEntries } from '../../src/built-in/worksheet/workProvider.js';

/** A rating's moment is turned into its day by the function given, so no test depends on the zone or the date. */
const dayOf = (ms: number) => (ms < 2000 ? '2026-03-10' : '2026-03-11');

describe('worksheetWorkEntries', () => {
  it('gives one entry per day and paper: the ledger\'s minutes, and the problems rated that day', () => {
    const out = worksheetWorkEntries(
      [{ day: '2026-03-10', paper: 'clark', seconds: 900 }, { day: '2026-03-10', paper: 'clark', seconds: 600 }, { day: '2026-03-10', paper: 'hurlimann', seconds: 1800 }, { day: '2026-03-11', paper: 'clark', seconds: 90 }],
      [{ itemId: 1, paper: 'clark', at: 1000 }, { itemId: 2, paper: 'clark', at: 1500 }, { itemId: 9, paper: 'hurlimann', at: 1200 }],
      dayOf,
    );
    expect(out).toEqual([
      { day: '2026-03-10', groups: [{ group: 'clark', label: 'Clark' }], minutes: 25, items: 2 },
      { day: '2026-03-10', groups: [{ group: 'hurlimann', label: 'Hürlimann' }], minutes: 30, items: 1 },
      { day: '2026-03-11', groups: [{ group: 'clark', label: 'Clark' }], minutes: 1.5, items: 0 },
    ]);
  });
  it('counts a problem rated twice in a day once, and on each day it was rated', () => {
    const out = worksheetWorkEntries([], [{ itemId: 1, paper: 'mack', at: 1000 }, { itemId: 1, paper: 'mack', at: 1900 }, { itemId: 1, paper: 'mack', at: 2500 }], dayOf);
    expect(out.map((e) => [e.day, e.items])).toEqual([['2026-03-10', 1], ['2026-03-11', 1]]);
  });
  it('never says how many were right: Worksheets rates Easy, Medium and Hard', () => {
    const out = worksheetWorkEntries([{ day: '2026-03-10', paper: 'mack', seconds: 60 }], [{ itemId: 1, paper: 'mack', at: 1000 }], dayOf);
    expect(out[0]).not.toHaveProperty('right');
  });
  it('reports time on the quiz\'s own screens with no group, and leaves out a day with nothing', () => {
    const out = worksheetWorkEntries([{ day: '2026-03-10', paper: '', seconds: 120 }, { day: '2026-03-12', paper: 'mack', seconds: 0 }], [{ itemId: 3, paper: 'mack', at: 0 }], dayOf);
    expect(out).toEqual([{ day: '2026-03-10', groups: [], minutes: 2, items: 0 }]);
  });
});
