import { describe, it, expect } from 'vitest';
import { normalizeTag } from '../../src/built-in/worksheet/tagData';
import { rosterItems } from '../../src/built-in/worksheet/roster';

describe('problem tags', () => {
  it('writes every tag one way', () => {
    expect(normalizeTag('Final Roster')).toBe('final-roster');
    expect(normalizeTag('  hard,  ones ')).toBe('hard-ones');
    expect(normalizeTag('--Tail  Factor--')).toBe('tail-factor');
    expect(normalizeTag('   ')).toBe('');
  });

  it('a tag put on from the note box is a roster tag like any other', () => {
    // listItems joins the import's tags and the student's with a comma.
    const items = [{ id: 1, paper: 'clark', tags: ['clark,rf,quant', 'weak-spots'].join(','), starred: true }];
    expect(rosterItems(items, 'weak-spots').map((i) => i.id)).toEqual([1]);
  });
});
