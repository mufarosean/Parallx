// pdfSelectionOverlay.test.ts — how a PDF selection's boxes are merged:
// the word boxes of a line join into one bar, separate lines stay separate,
// and a wide gap (another column) splits a line.

import { describe, it, expect } from 'vitest';
import { mergeSelectionRects } from '../../src/editor/panes/pdf/pdfSelectionOverlay';

const box = (left: number, top: number, width: number, height = 12) => ({ left, top, width, height });

describe('mergeSelectionRects', () => {
  it('joins the word boxes of one line into one bar', () => {
    expect(mergeSelectionRects([box(10, 100, 40), box(54, 100, 30), box(88, 101, 50, 11)]))
      .toEqual([{ left: 10, top: 100, width: 128, height: 12 }]);
  });

  it('keeps lines apart, top to bottom', () => {
    const merged = mergeSelectionRects([box(10, 120, 60), box(10, 100, 80)]);
    expect(merged.map((r) => r.top)).toEqual([100, 120]);
  });

  it('splits a line at a gap wider than a line height and a half', () => {
    const merged = mergeSelectionRects([box(10, 100, 40), box(300, 100, 40)]);
    expect(merged).toHaveLength(2);
  });

  it('returns nothing for nothing', () => {
    expect(mergeSelectionRects([])).toEqual([]);
  });
});
