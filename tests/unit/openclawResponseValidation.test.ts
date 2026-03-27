import { describe, expect, it } from 'vitest';

import {
  validateCitations,
  assessEvidence,
  buildEvidenceConstraint,
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

  it('remaps mismatched indices when count matches ragSources', () => {
    const sources = [
      { uri: 'a.md', label: 'A', index: 1 },
      { uri: 'b.md', label: 'B', index: 2 },
    ];
    // Model output [5][6] — wrong indices, but count matches sources
    const result = validateCitations('See [5] and [6] for details.', sources);
    expect(result.markdown).toBe('See [1] and [2] for details.');
    expect(result.attributableSources).toHaveLength(2);
    expect(result.attributableSources.map(s => s.index)).toEqual([1, 2]);
  });

  it('does not remap when mismatch count differs from ragSources count', () => {
    const sources = [
      { uri: 'a.md', label: 'A', index: 1 },
      { uri: 'b.md', label: 'B', index: 2 },
    ];
    // Model output [5][6][7] — 3 refs but only 2 sources → no remap
    const result = validateCitations('See [5], [6], and [7].', sources);
    expect(result.markdown).toBe('See [5], [6], and [7].');
    expect(result.attributableSources).toEqual([]); // none match valid indices
  });

  it('remaps partial match when ref count equals source count', () => {
    const sources = [
      { uri: 'a.md', label: 'A', index: 1 },
      { uri: 'b.md', label: 'B', index: 2 },
    ];
    // [1] and [99] → 2 refs, 2 sources → remap triggered (1→1, 99→2)
    const result = validateCitations('Based on [1] and [99].', sources);
    expect(result.attributableSources).toHaveLength(2);
  });

  it('returns no attributable sources when mismatch count differs and no valid indices', () => {
    const sources = [
      { uri: 'a.md', label: 'A', index: 1 },
      { uri: 'b.md', label: 'B', index: 2 },
    ];
    // 1 ref, 2 sources → no remap, [99] not in validIndices
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
});

// ---------------------------------------------------------------------------
// assessEvidence
// ---------------------------------------------------------------------------

describe('assessEvidence', () => {
  it('returns insufficient when no context text', () => {
    const result = assessEvidence('What is X?', '', []);
    expect(result.status).toBe('insufficient');
    expect(result.reasons).toContain('no-grounded-sources');
  });

  it('returns insufficient when ragSources is empty', () => {
    const result = assessEvidence('What is X?', 'some context text', []);
    expect(result.status).toBe('insufficient');
    expect(result.reasons).toContain('no-grounded-sources');
  });

  it('returns insufficient when no query terms overlap context', () => {
    const result = assessEvidence(
      'Tell me about quantum entanglement',
      'The policy covers collision damage.',
      [{ uri: 'a.md', label: 'A' }],
    );
    expect(result.status).toBe('insufficient');
    expect(result.reasons).toContain('no-query-term-overlap');
  });

  it('returns sufficient for simple query with matching context', () => {
    const result = assessEvidence(
      'What is collision deductible?',
      '[1] Source: Policy.md\ncollision deductible is $500',
      [{ uri: 'policy.md', label: 'Policy', index: 1 }],
    );
    expect(result.status).toBe('sufficient');
  });

  it('returns weak for hard query with single source', () => {
    const result = assessEvidence(
      'I was rear-ended by an uninsured driver and need to compare my coverage options and then file a claim after documenting everything',
      '[1] Source: Guide.md\nuninsured driver filing deadlines report claim',
      [{ uri: 'guide.md', label: 'Guide', index: 1 }],
    );
    expect(result.status).toBe('weak');
    expect(result.reasons).toContain('hard-query-low-source-coverage');
  });

  it('detects hard queries by word count >= 12 and flags thin context', () => {
    // 13 words → isHard. Short context → thin-evidence-set. 0 sections → low-section-coverage.
    const result = assessEvidence(
      'one two three four five six seven eight nine ten eleven twelve thirteen',
      'one two three four five six seven eight context',
      [{ uri: 'a.md', label: 'A', index: 1 }, { uri: 'b.md', label: 'B', index: 2 }],
    );
    expect(result.status).toBe('weak');
    expect(result.reasons).toEqual(expect.arrayContaining(['thin-evidence-set']));
  });

  it('detects hard queries by complexity keywords (compare, workflow)', () => {
    const result = assessEvidence(
      'compare the two approaches',
      'approaches details context two compare',
      [{ uri: 'a.md', label: 'A', index: 1 }],
    );
    // Hard + single source → weak
    expect(result.status).toBe('weak');
    expect(result.reasons).toContain('hard-query-low-source-coverage');
  });

  it('detects hard queries by multiple question words', () => {
    const result = assessEvidence(
      'what happens when the service fails',
      'service fails recovery happens context',
      [{ uri: 'a.md', label: 'A', index: 1 }],
    );
    // "what" + "when" = 2 question words → hard, single source → weak
    expect(result.status).toBe('weak');
  });

  it('does not use domain-specific terms in stop words', () => {
    // Verify the stop word list doesn't filter domain terms
    const result = assessEvidence(
      'What about insurance policy coverage?',
      'insurance policy coverage details here',
      [{ uri: 'a.md', label: 'A', index: 1 }],
    );
    // "insurance", "policy", "coverage" should NOT be stop-worded
    expect(result.status).toBe('sufficient');
  });

  it('flags thin evidence for hard queries', () => {
    const result = assessEvidence(
      'compare the two approaches and then summarize the workflow steps',
      'approaches two', // Very short context
      [{ uri: 'a.md', label: 'A', index: 1 }],
    );
    expect(result.status).toBe('weak');
    expect(result.reasons).toEqual(expect.arrayContaining(['thin-evidence-set']));
  });
});

// ---------------------------------------------------------------------------
// buildEvidenceConstraint
// ---------------------------------------------------------------------------

describe('buildEvidenceConstraint', () => {
  it('returns insufficient constraint for insufficient evidence', () => {
    const result = buildEvidenceConstraint('test query', {
      status: 'insufficient',
      reasons: ['no-grounded-sources'],
    });
    expect(result).toContain('insufficient');
    expect(result).toContain('Response Constraint');
  });

  it('returns narrow constraint for weak evidence', () => {
    const result = buildEvidenceConstraint('test query', {
      status: 'weak',
      reasons: ['limited-focus-overlap'],
    });
    expect(result).toContain('narrow');
    expect(result).toContain('Response Constraint');
  });

  it('does not contain domain-specific language', () => {
    const insufficient = buildEvidenceConstraint('q', { status: 'insufficient', reasons: [] });
    const weak = buildEvidenceConstraint('q', { status: 'weak', reasons: [] });

    // Must not contain insurance/domain terms
    for (const text of [insufficient, weak]) {
      expect(text).not.toMatch(/insurance|policy|coverage|claim|deductible|endorsement|rider|peril/i);
    }
  });

  it('constraint strings are generic and domain-agnostic', () => {
    const insufficient = buildEvidenceConstraint('q', { status: 'insufficient', reasons: [] });
    const weak = buildEvidenceConstraint('q', { status: 'weak', reasons: [] });

    expect(insufficient).toContain('evidence');
    expect(weak).toContain('evidence');
  });
});
