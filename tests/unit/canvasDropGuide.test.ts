import { describe, expect, it } from 'vitest';

import { gapGuideViewportTop } from '../../src/built-in/canvas/plugins/columnDropPlugin';

// Two stacked blocks with a gap between them: A.bottom=100, B.top=112.
const A = { top: 60, bottom: 100 };
const B = { top: 112, bottom: 160 };

describe('gapGuideViewportTop — one stable line per boundary', () => {
  it('resolves "below A" and "above B" to the SAME line (no jiggle)', () => {
    const belowA = gapGuideViewportTop(A, B, 'below'); // cursor in A's lower half
    const aboveB = gapGuideViewportTop(B, A, 'above'); // cursor in B's upper half
    expect(belowA).toBe(aboveB);
    expect(belowA).toBe(106); // centered in the 100→112 gap
  });

  it('centers in a wider gap too (columns)', () => {
    const lo = { top: 0, bottom: 50 };
    const hi = { top: 90, bottom: 140 }; // 40px gap
    expect(gapGuideViewportTop(lo, hi, 'below')).toBe(70);
    expect(gapGuideViewportTop(hi, lo, 'above')).toBe(70);
  });

  it('falls back to just outside the edge when there is no neighbor', () => {
    expect(gapGuideViewportTop(A, null, 'above')).toBe(A.top - 1);
    expect(gapGuideViewportTop(A, null, 'below')).toBe(A.bottom + 1);
  });
});
