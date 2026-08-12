// Worksheets: practice-session selection logic (pure).

import { describe, it, expect } from 'vitest';
import { buildPracticeSet, tagCounts, itemTags } from '../../src/built-in/worksheet/practiceSession.js';

const item = (id: number, tags: string, attemptState = '', attemptCount = 0) =>
  ({ id, tags, attemptState, attemptCount });

const bank = [
  item(1, 'brosius', 'nailed', 2),
  item(2, 'brosius,reserves', 'missed', 1),
  item(3, 'mack1994', '', 0),
  item(4, 'mack1994', 'partial', 3),
  item(5, '', 'open', 0),
  item(6, 'meyers', '', 0),
];

describe('buildPracticeSet', () => {
  it('no filters: bank order, capped by count', () => {
    expect(buildPracticeSet(bank, { tags: [], state: 'all', count: 3, shuffle: false }))
      .toEqual([1, 2, 3]);
  });

  it('tags are ANY-match', () => {
    expect(buildPracticeSet(bank, { tags: ['brosius', 'meyers'], state: 'all', count: 10, shuffle: false }))
      .toEqual([1, 2, 6]);
  });

  it('unseen = never attempted and not mid-attempt', () => {
    expect(buildPracticeSet(bank, { tags: [], state: 'unseen', count: 10, shuffle: false }))
      .toEqual([3, 6]);
  });

  it('struggling = missed, partial, or open', () => {
    expect(buildPracticeSet(bank, { tags: [], state: 'struggling', count: 10, shuffle: false }))
      .toEqual([2, 4, 5]);
  });

  it('shuffle uses the injected rng deterministically and keeps the set', () => {
    // rng()=0 makes Fisher-Yates fully deterministic: every step swaps with
    // index 0, producing a known rotation.
    const a = buildPracticeSet(bank, { tags: [], state: 'all', count: 6, shuffle: true }, () => 0);
    expect(a).toEqual([2, 3, 4, 5, 6, 1]);
  });

  it('count is clamped to at least 1', () => {
    expect(buildPracticeSet(bank, { tags: [], state: 'all', count: 0, shuffle: false })).toHaveLength(6);
    expect(buildPracticeSet(bank, { tags: [], state: 'all', count: -5, shuffle: false })).toHaveLength(6);
  });
});

describe('tagCounts / itemTags', () => {
  it('counts items per tag across the bank', () => {
    const counts = tagCounts(bank);
    expect(counts.get('brosius')).toBe(2);
    expect(counts.get('mack1994')).toBe(2);
    expect(counts.get('reserves')).toBe(1);
    expect(counts.has('')).toBe(false);
  });

  it('itemTags trims and drops empties', () => {
    expect(itemTags(' a , b ,, ')).toEqual(['a', 'b']);
  });
});
