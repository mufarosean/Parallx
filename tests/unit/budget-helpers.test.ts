// Unit tests for the Budget extension's pure helpers.
// Imported via the __testables named export added at the bottom of main.js.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/budget/main.js';

const {
  median,
  coefficientOfVariation,
  gapDays,
  addDays,
  inferCadence,
  parseCsvLine,
  ruleMatchesMerchant,
} = __testables;

describe('median', () => {
  it('returns 0 for an empty array', () => {
    expect(median([])).toBe(0);
  });
  it('handles odd-length arrays', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('handles even-length arrays (mean of two middle values)', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('is order-independent', () => {
    expect(median([10, 1, 5, 3, 7])).toBe(5);
  });
});

describe('coefficientOfVariation', () => {
  it('returns 0 for empty/single element arrays', () => {
    expect(coefficientOfVariation([])).toBe(0);
    expect(coefficientOfVariation([42])).toBe(0);
  });
  it('returns 0 for constant arrays', () => {
    expect(coefficientOfVariation([5, 5, 5, 5])).toBe(0);
  });
  it('is small for low-variance data', () => {
    const cv = coefficientOfVariation([100, 102, 98, 101, 99]);
    expect(cv).toBeLessThan(0.05);
  });
  it('is large for high-variance data', () => {
    const cv = coefficientOfVariation([10, 200, 50, 1000]);
    expect(cv).toBeGreaterThan(0.5);
  });
});

describe('gapDays', () => {
  it('counts whole-day gaps from d1 to d2', () => {
    expect(gapDays('2026-01-01', '2026-01-08')).toBe(7);
  });
  it('returns negative when d2 precedes d1', () => {
    expect(gapDays('2026-01-08', '2026-01-01')).toBe(-7);
  });
  it('handles month boundaries', () => {
    expect(gapDays('2026-01-30', '2026-02-02')).toBe(3);
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    expect(addDays('2026-01-01', 7)).toBe('2026-01-08');
  });
  it('rolls over months', () => {
    expect(addDays('2026-01-30', 5)).toBe('2026-02-04');
  });
  it('rolls over years', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
  it('handles negative days', () => {
    expect(addDays('2026-02-02', -3)).toBe('2026-01-30');
  });
});

describe('inferCadence', () => {
  it('classifies weekly (5–9 days)', () => {
    expect(inferCadence(7)).toBe('weekly');
    expect(inferCadence(5)).toBe('weekly');
    expect(inferCadence(9)).toBe('weekly');
  });
  it('classifies biweekly (12–16 days)', () => {
    expect(inferCadence(14)).toBe('biweekly');
    expect(inferCadence(12)).toBe('biweekly');
  });
  it('classifies monthly (26–35 days)', () => {
    expect(inferCadence(30)).toBe('monthly');
    expect(inferCadence(28)).toBe('monthly');
    expect(inferCadence(31)).toBe('monthly');
  });
  it('classifies quarterly (80–100 days)', () => {
    expect(inferCadence(91)).toBe('quarterly');
  });
  it('classifies yearly (350–380 days)', () => {
    expect(inferCadence(365)).toBe('yearly');
  });
  it('returns null for gaps outside known buckets', () => {
    expect(inferCadence(3)).toBeNull();
    expect(inferCadence(20)).toBeNull();
    expect(inferCadence(60)).toBeNull();
    expect(inferCadence(200)).toBeNull();
  });
});

describe('parseCsvLine', () => {
  it('splits a simple line', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('handles quoted fields with embedded commas', () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });
  it('handles escaped double quotes ""', () => {
    expect(parseCsvLine('a,"she said ""hi""",b')).toEqual(['a', 'she said "hi"', 'b']);
  });
  it('trims whitespace', () => {
    expect(parseCsvLine('  a  , b ,c')).toEqual(['a', 'b', 'c']);
  });
  it('returns one empty string for empty input', () => {
    expect(parseCsvLine('')).toEqual(['']);
  });
});

describe('ruleMatchesMerchant', () => {
  it('exact match is case-insensitive', () => {
    const rule = { pattern: 'STARBUCKS', match_type: 'exact' };
    expect(ruleMatchesMerchant(rule, 'starbucks')).toBe(true);
    expect(ruleMatchesMerchant(rule, 'Starbucks #123')).toBe(false);
  });
  it('contains match handles partial', () => {
    const rule = { pattern: 'starbucks', match_type: 'contains' };
    expect(ruleMatchesMerchant(rule, 'STARBUCKS #123 SEATTLE')).toBe(true);
    expect(ruleMatchesMerchant(rule, 'PEETS COFFEE')).toBe(false);
  });
  it('regex match supports anchors and character classes', () => {
    const rule = { pattern: '^AMZN MKTP', match_type: 'regex' };
    expect(ruleMatchesMerchant(rule, 'AMZN MKTP US*1234')).toBe(true);
    expect(ruleMatchesMerchant(rule, 'WHOLE FOODS AMZN MKTP')).toBe(false);
  });
  it('invalid regex returns false (does not throw)', () => {
    const rule = { pattern: '[unclosed', match_type: 'regex' };
    expect(ruleMatchesMerchant(rule, 'anything')).toBe(false);
  });
  it('returns false for empty inputs', () => {
    expect(ruleMatchesMerchant(null, 'starbucks')).toBe(false);
    expect(ruleMatchesMerchant({ pattern: 'x', match_type: 'exact' }, '')).toBe(false);
    expect(ruleMatchesMerchant({ pattern: '', match_type: 'exact' }, 'x')).toBe(false);
  });
});
