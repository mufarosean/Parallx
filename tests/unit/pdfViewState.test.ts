// pdfViewState.test.ts — where a reader was in a PDF: read, parsed back
// from storage (only fields of the right type), and applied scale first,
// then page, then the exact offsets.

import { describe, it, expect } from 'vitest';
import { applyViewState, parseViewState, readViewState } from '../../src/editor/panes/pdf/pdfViewState';

describe('PDF view state', () => {
  it('reads the page, scale and offsets, with defaults before a document opens', () => {
    const viewer = { currentPageNumber: 4, currentScaleValue: 'page-width' } as never;
    const container = { scrollLeft: 0, scrollTop: 1830 } as never;
    expect(readViewState(viewer, container, 'page-fit')).toEqual({ page: 4, scaleValue: 'page-width', scrollLeft: 0, scrollTop: 1830 });
    expect(readViewState(null, null, 'page-fit')).toEqual({ page: 1, scaleValue: 'page-fit', scrollLeft: 0, scrollTop: 0 });
  });

  it('keeps only fields of the right type from storage', () => {
    expect(parseViewState({ page: '3', scaleValue: 1.5, scrollTop: 200, extra: true }))
      .toEqual({ page: undefined, scaleValue: undefined, scrollLeft: undefined, scrollTop: 200 });
  });

  it('applies scale, then page, then the offsets, and ignores a page past the end', () => {
    const order: string[] = [];
    const viewer = {
      set currentScaleValue(v: string) { order.push(`scale ${v}`); },
      set currentPageNumber(n: number) { order.push(`page ${n}`); },
    } as never;
    const container = {
      set scrollTop(v: number) { order.push(`top ${v}`); },
      set scrollLeft(v: number) { order.push(`left ${v}`); },
    } as never;
    applyViewState({ page: 5, scaleValue: '1.25', scrollTop: 900, scrollLeft: 0 }, viewer, container, 8);
    expect(order).toEqual(['scale 1.25', 'page 5', 'top 900']);
    order.length = 0;
    applyViewState({ page: 12 }, viewer, container, 8);
    expect(order).toEqual([]);
  });
});
