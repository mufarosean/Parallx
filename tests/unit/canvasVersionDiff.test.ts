// What a saved version changed: blocks matched by id (or content), so a block
// that stays, moves or is edited reads as itself.
import { describe, it, expect } from 'vitest';
import { diffBlocks, summarize, summaryChip, summarySentence, wordCount } from '../../src/built-in/canvas/canvasVersionDiff';

const p = (id: string | null, text: string) => ({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
const doc = (...content: object[]) => ({ type: 'doc', content });

describe('diffBlocks', () => {
  it('marks kept, edited, added and removed blocks, with removed ones where they stood', () => {
    const before = doc(p('a', 'Chain ladder'), p('b', 'Mack'), p('c', 'Cape Cod'));
    const after = doc(p('a', 'Chain ladder'), p('b', 'Mack 1994'), p('d', 'Clark LDF'));
    expect(diffBlocks(before, after).map((r) => [r.node.attrs?.id, r.change])).toEqual([
      ['a', 'same'], ['b', 'changed'], ['d', 'added'], ['c', 'removed'],
    ]);
  });

  it('matches blocks without an id by their content', () => {
    const before = doc(p(null, 'One'), p(null, 'Two'));
    const after = doc(p(null, 'One'), p(null, 'Three'));
    expect(diffBlocks(before, after).map((r) => r.change)).toEqual(['same', 'added', 'removed']);
  });

  it('reads the first version as all added', () => {
    expect(diffBlocks(undefined, doc(p('a', 'x'))).map((r) => r.change)).toEqual(['added']);
  });
});

describe('summaries', () => {
  const before = doc(p('a', 'one two'), p('b', 'three'));
  const after = doc(p('a', 'one two four five'), p('c', 'six'));
  it('counts blocks and words', () => {
    expect(wordCount(after)).toBe(5);
    expect(summarize(before, after)).toEqual({ added: 1, changed: 1, removed: 1, wordDelta: 2 });
  });
  it('says it in a chip and in a sentence', () => {
    const s = summarize(before, after);
    expect(summaryChip(s)).toBe('+1 block · 1 edited · 1 removed');
    expect(summarySentence(s)).toBe('Added 1 block, edited 1 and removed 1. 2 words more.');
    expect(summaryChip(summarize(before, before))).toBe('No change to the text');
  });
});
