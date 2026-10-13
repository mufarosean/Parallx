// @vitest-environment jsdom
// canvasKeyboardWidths.test.ts — the keyboard's column-width drags on a page:
// with the caret in a table cell or a layout column, Wider and Narrower size
// that column as dragging its edge does; elsewhere they pass the key on.
// docs/ACCESSIBILITY.md, section 6.

import { describe, expect, it } from 'vitest';
import { TextSelection } from '@tiptap/pm/state';
import { mk, p, col, cols, find } from './canvasMatrixHarness';
import { resizeColumnBy } from '../../src/built-in/canvas/config/blockStateRegistry/tableOps';
import { resizeLayoutColumnBy } from '../../src/built-in/canvas/config/blockStateRegistry/columnCreation';

const caretIn = (ed: ReturnType<typeof mk>, text: string) => {
  const r = find(ed, (n) => n.type.name === 'paragraph' && n.textContent === text)!;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, r.pos + 1)));
};
const cell = (text: string) => ({ type: 'tableCell', content: [p(text)] });

describe('Wider and Narrower on a page', () => {
  it('size the caret\'s table column, every cell in it', () => {
    const ed = mk({ type: 'doc', content: [{ type: 'table', content: [
      { type: 'tableRow', content: [cell('a1'), cell('b1')] },
      { type: 'tableRow', content: [cell('a2'), cell('b2')] },
    ] }] });
    caretIn(ed, 'b1');
    expect(resizeColumnBy(ed, 24)).toBe(true);
    const widths: (number[] | null)[] = [];
    ed.state.doc.descendants((n) => { if (n.type.name === 'tableCell') widths.push(n.attrs.colwidth); return true; });
    // jsdom draws nothing, so the column starts at the 80px minimum; the next step adds 24.
    expect(widths).toEqual([null, [80], null, [80]]);
    expect(resizeColumnBy(ed, 24)).toBe(true);
    const after: (number[] | null)[] = [];
    ed.state.doc.descendants((n) => { if (n.type.name === 'tableCell') after.push(n.attrs.colwidth); return true; });
    expect(after).toEqual([null, [104], null, [104]]);
    expect(resizeColumnBy(ed, -1000)).toBe(true);
    expect(resizeColumnBy(ed, -24)).toBe(false); // at the minimum
  });

  it('size the caret\'s layout column against its neighbour, never under 10%', () => {
    const ed = mk({ type: 'doc', content: [cols(col(p('left')), col(p('right'))), p('after')] });
    // jsdom lays nothing out: the layout is 1000px wide (its DOM is redrawn as widths change).
    const measure = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) { return this.classList.contains('canvas-column-list') ? ({ width: 1000 } as DOMRect) : measure.call(this); };
    caretIn(ed, 'left');
    expect(resizeLayoutColumnBy(ed, 100)).toBe(true);
    const widths = () => { const out: number[] = []; ed.state.doc.descendants((n) => { if (n.type.name === 'column') out.push(n.attrs.width); return true; }); return out; };
    expect(widths()).toEqual([60, 40]);
    caretIn(ed, 'right'); // the last column grows from the one on its left
    expect(resizeLayoutColumnBy(ed, 100)).toBe(true);
    expect(widths()).toEqual([50, 50]);
    expect(resizeLayoutColumnBy(ed, 10_000)).toBe(true);
    expect(widths()).toEqual([10, 90]);
    expect(resizeLayoutColumnBy(ed, 100)).toBe(false);
    HTMLElement.prototype.getBoundingClientRect = measure;
  });

  it('pass the key on with the caret outside', () => {
    const ed = mk({ type: 'doc', content: [p('plain')] });
    caretIn(ed, 'plain');
    expect(resizeColumnBy(ed, 24)).toBeUndefined();
    expect(resizeLayoutColumnBy(ed, 24)).toBeUndefined();
  });
});
