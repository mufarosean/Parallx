// @vitest-environment jsdom
// pdfOutline.test.ts — the PDF pane's outline tree.
//
// Rows learn their pages from the document's destinations, the row of the
// section being read is marked, and the arrow keys walk the tree. The key
// handler belongs to the tree element, which outlives each document: it
// used to be added again for every document opened in the pane, so after a
// second PDF one key press moved two rows.

import { describe, it, expect } from 'vitest';
import { PdfOutline, type PdfOutlineHost } from '../../src/editor/panes/pdf/pdfOutline';
import type { PdfOutlineItem } from '../../src/editor/panes/pdf/pdfTypes';

function item(title: string, page: number, items: PdfOutlineItem[] = []): PdfOutlineItem {
  // An explicit destination: [page index, { name: 'XYZ' }, left, top, zoom].
  return { title, bold: false, italic: false, dest: [page - 1, { name: 'XYZ' }, 0, 700, null], url: null, items };
}

function setup() {
  const tree = document.createElement('div');
  document.body.appendChild(tree);
  const went: unknown[] = [];
  const doc = { getDestination: async () => null, getPageIndex: async () => -1 } as never;
  const host: PdfOutlineHost = {
    document: () => doc,
    pageLabel: () => undefined,
    goToDestination: (dest) => { went.push(dest); },
    scale: () => 1,
    viewHeight: () => 900,
    isShowing: () => true,
  };
  return { tree, went, outline: new PdfOutline(tree, host) };
}

const rows = (tree: HTMLElement) => Array.from(tree.querySelectorAll<HTMLElement>('.pdf-outline-item'));
const key = (k: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('PdfOutline', () => {
  it('shows each entry with the page its destination names', async () => {
    const { tree, outline } = setup();
    outline.render([item('Introduction', 1), item('Data', 3), item('Results', 5)]);
    await settle();
    expect(rows(tree).map((r) => `${r.querySelector('.pdf-outline-title')!.textContent} ${r.querySelector('.pdf-outline-page')!.textContent}`))
      .toEqual(['Introduction 1', 'Data 3', 'Results 5']);
    expect(outline.hasItems).toBe(true);
  });

  it('marks the section being read as the view moves', async () => {
    const { tree, outline } = setup();
    outline.render([item('Introduction', 1), item('Data', 3), item('Results', 5)]);
    await settle();
    outline.updateViewArea(4, 400);
    expect(tree.querySelector('.is-current .pdf-outline-title')!.textContent).toBe('Data');
    outline.updateViewArea(1, null);
    expect(tree.querySelector('.is-current .pdf-outline-title')!.textContent).toBe('Introduction');
  });

  it('moves one row per key press after a second document', async () => {
    const { tree, outline } = setup();
    outline.render([item('First A', 1), item('First B', 2)]);
    await settle();
    outline.render([item('One', 1), item('Two', 2), item('Three', 3)]);
    await settle();
    rows(tree)[0].focus();
    key('ArrowDown');
    expect(document.activeElement?.querySelector('.pdf-outline-title')?.textContent).toBe('Two');
  });

  it('collapses and expands with the arrow keys, and Enter goes to the entry', async () => {
    const { tree, outline, went } = setup();
    outline.render([item('Part', 1, [item('Chapter', 2)]), item('Next', 4)]);
    await settle();
    rows(tree)[0].focus();
    key('ArrowLeft');
    expect(tree.querySelector('.pdf-outline-children')!.classList.contains('pdf-outline-children--collapsed')).toBe(true);
    key('ArrowDown');
    expect(document.activeElement?.querySelector('.pdf-outline-title')?.textContent).toBe('Next');
    key('Enter');
    expect(went).toEqual([[3, { name: 'XYZ' }, 0, 700, null]]);
  });

  it('forgets the document on clear', async () => {
    const { tree, outline } = setup();
    outline.render([item('Introduction', 1)]);
    outline.clear();
    expect(rows(tree)).toHaveLength(0);
    expect(outline.hasItems).toBe(false);
  });
});
