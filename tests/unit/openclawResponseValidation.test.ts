import { describe, expect, it } from 'vitest';

import {
  validateCitations,
} from '../../src/openclaw/openclawResponseValidation';

// ---------------------------------------------------------------------------
// validateCitations
// ---------------------------------------------------------------------------

describe('validateCitations', () => {
  it('returns empty attributable sources when markdown is empty', () => {
    const result = validateCitations('', [{ uri: 'a.md', label: 'A', index: 1 }]);
    expect(result.markdown).toBe('');
    expect(result.attributableSources).toEqual([]);
  });

  it('returns empty attributable sources when ragSources is empty', () => {
    const result = validateCitations('See [1] for details.', []);
    expect(result.markdown).toBe('See [1] for details.');
    expect(result.attributableSources).toEqual([]);
  });

  it('returns empty attributable sources when no citation refs in text', () => {
    const result = validateCitations(
      'No citations here.',
      [{ uri: 'a.md', label: 'A', index: 1 }],
    );
    expect(result.markdown).toBe('No citations here.');
    expect(result.attributableSources).toEqual([]);
  });

  it('filters to only referenced sources when indices match', () => {
    const sources = [
      { uri: 'a.md', label: 'A', index: 1 },
      { uri: 'b.md', label: 'B', index: 2 },
      { uri: 'c.md', label: 'C', index: 3 },
    ];
    const result = validateCitations('Answer from [1] and [3].', sources);
    expect(result.attributableSources).toHaveLength(2);
    expect(result.attributableSources.map(s => s.index)).toEqual([1, 3]);
  });

  it('does not remap mismatched indices — returns markdown as-is', () => {
    const sources = [
      { uri: 'a.md', label: 'A', index: 1 },
      { uri: 'b.md', label: 'B', index: 2 },
    ];
    // Model output [5][6] — wrong indices, no remapping should occur
    const result = validateCitations('See [5] and [6] for details.', sources);
    expect(result.markdown).toBe('See [5] and [6] for details.');
    expect(result.attributableSources).toHaveLength(0); // neither 5 nor 6 are valid
  });

  it('returns no attributable sources when indices do not match valid set', () => {
    const sources = [
      { uri: 'a.md', label: 'A', index: 1 },
      { uri: 'b.md', label: 'B', index: 2 },
    ];
    const result = validateCitations('See [99].', sources);
    expect(result.attributableSources).toHaveLength(0);
  });

  it('deduplicates repeated references', () => {
    const sources = [
      { uri: 'a.md', label: 'A', index: 1 },
      { uri: 'b.md', label: 'B', index: 2 },
    ];
    const result = validateCitations('See [1], then [1] again, plus [2].', sources);
    expect(result.attributableSources).toHaveLength(2);
  });

  it('handles single source single ref', () => {
    const sources = [{ uri: 'a.md', label: 'A', index: 0 }];
    const result = validateCitations('Answer: [0].', sources);
    expect(result.attributableSources).toHaveLength(1);
    expect(result.attributableSources[0].uri).toBe('a.md');
  });

  it('never modifies model markdown', () => {
    const sources = [
      { uri: 'a.md', label: 'A', index: 1 },
      { uri: 'b.md', label: 'B', index: 2 },
    ];
    const original = 'See [5] and [6] for details.';
    const result = validateCitations(original, sources);
    expect(result.markdown).toBe(original);
  });

  it('extracts mix of valid and invalid refs — only valid ones returned', () => {
    const sources = [
      { uri: 'a.md', label: 'A', index: 1 },
      { uri: 'b.md', label: 'B', index: 2 },
    ];
    const result = validateCitations('See [1], [99], and [2].', sources);
    expect(result.attributableSources).toHaveLength(2);
    expect(result.attributableSources.map(s => s.index)).toEqual([1, 2]);
    expect(result.markdown).toBe('See [1], [99], and [2].');
  });
});
