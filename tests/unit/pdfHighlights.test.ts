// pdfHighlights.test.ts — the PDF highlight model, out of the pane.
//
// Highlights live in PDF user space under a colour key. Two rectangle sets
// are "the same highlight" when they cover at least half of the smaller one;
// an undo restores a deleted highlight from a deep copy.

import { describe, it, expect } from 'vitest';
import { HIGHLIGHT_COLORS, cloneHighlight, highlightRgba, highlightSolid, rectsOverlap, type PdfHighlight } from '../../src/editor/panes/pdf/pdfHighlights';

describe('the palette', () => {
  it('answers by key and falls back to the first colour', () => {
    expect(highlightRgba('green')).toBe(HIGHLIGHT_COLORS[1].rgba);
    expect(highlightRgba('no-such-colour')).toBe(HIGHLIGHT_COLORS[0].rgba);
    expect(highlightSolid('rgba(255, 214, 64, 0.40)')).toBe('rgb(255, 214, 64)');
  });
});

describe('rectsOverlap', () => {
  const box = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
  it('is true when the intersection covers half of the smaller set, whichever way the corners are given', () => {
    expect(rectsOverlap([box(0, 0, 10, 10)], [box(5, 0, 15, 10)])).toBe(true);
    expect(rectsOverlap([box(10, 10, 0, 0)], [box(0, 0, 4, 10)])).toBe(true); // 40 of the smaller 40
    expect(rectsOverlap([box(0, 0, 10, 10)], [box(6, 0, 16, 10)])).toBe(false); // 40 of 100
    expect(rectsOverlap([box(0, 0, 10, 10)], [box(20, 20, 30, 30)])).toBe(false);
  });
  it('is false when either set has no area', () => {
    expect(rectsOverlap([], [box(0, 0, 10, 10)])).toBe(false);
    expect(rectsOverlap([box(0, 0, 0, 10)], [box(0, 0, 10, 10)])).toBe(false);
  });
});

describe('cloneHighlight', () => {
  it('copies the rectangles, the thread and the links, not their references', () => {
    const hl: PdfHighlight = {
      id: 'h1', page: 2, color: 'blue', rects: [{ x1: 0, y1: 0, x2: 1, y2: 1 }], text: 't', note: 'n',
      thread: [{ role: 'user', text: 'why', at: 1 }], canvasLinks: [{ pageId: 'p', title: 'T', at: 2 }], createdAt: 3,
    };
    const copy = cloneHighlight(hl);
    expect(copy).toEqual(hl);
    expect(copy.rects[0]).not.toBe(hl.rects[0]);
    expect(copy.thread![0]).not.toBe(hl.thread![0]);
    expect(copy.canvasLinks![0]).not.toBe(hl.canvasLinks![0]);
    expect(cloneHighlight({ ...hl, thread: undefined, canvasLinks: undefined }).thread).toBeUndefined();
  });
});
