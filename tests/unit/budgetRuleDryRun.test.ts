// Merchants and Rules: what a rule would change before it is saved. A
// category you set by hand is never moved by a rule.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

const { ruleDryRun } = __testables;
const rows = [
  { merchant: 'BLUE BOTTLE COFFEE', category_id: 'dining', categorization_source: 'ai' },
  { merchant: 'BLUE BOTTLE COFFEE', category_id: 'dining', categorization_source: 'ai' },
  { merchant: 'Blue Bottle Coffee', category_id: 'groceries', categorization_source: 'manual' },
  { merchant: 'BLUE BOTTLE COFFEE', category_id: 'coffee', categorization_source: 'rule' },
  { merchant: 'PEETS COFFEE', category_id: 'dining', categorization_source: 'ai' },
];

describe('budget rule dry run', () => {
  it('counts matches, changes and the rows you set by hand', () => {
    const r = ruleDryRun({ pattern: 'blue bottle', match_type: 'contains' }, rows, 'coffee');
    expect(r.matched).toBe(4);
    expect(r.changing).toBe(2);
    expect(r.keptManual).toBe(1);
    expect(r.changes).toEqual([{ merchant: 'BLUE BOTTLE COFFEE', fromId: 'dining', n: 2 }]);
  });

  it('an exact rule matches only the exact text, any case', () => {
    const r = ruleDryRun({ pattern: 'peets coffee', match_type: 'exact' }, rows, 'coffee');
    expect(r.matched).toBe(1);
    expect(r.changing).toBe(1);
  });

  it('matches nothing when nothing fits', () => {
    expect(ruleDryRun({ pattern: 'UBER', match_type: 'contains' }, rows, 'transport')).toEqual({ matched: 0, changing: 0, keptManual: 0, changes: [] });
  });
});
