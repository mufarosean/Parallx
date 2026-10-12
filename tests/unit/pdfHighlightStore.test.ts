// @vitest-environment jsdom
// pdfHighlightStore.test.ts — a PDF's highlights: made from the selection,
// saved per file, toggled off or recoloured by highlighting again, undone
// and redone. Undo belongs to one document: the pane keeps its store when
// it opens another PDF, and an undo there must not bring back a highlight
// from the one before.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PdfHighlightStore, type PdfHighlightStoreHost } from '../../src/editor/panes/pdf/pdfHighlightStore';

function setup() {
  const saved = new Map<string, string>();
  const storage = {
    get: async (k: string) => saved.get(k),
    set: async (k: string, v: string) => { saved.set(k, v); },
  } as never;

  // One page with a text layer holding a selectable word.
  const container = document.createElement('div');
  const page = document.createElement('div');
  page.className = 'page';
  page.dataset.pageNumber = '1';
  const textLayer = document.createElement('div');
  textLayer.className = 'textLayer';
  textLayer.textContent = 'Excess loss development';
  page.appendChild(textLayer);
  container.appendChild(page);
  document.body.appendChild(container);

  // Viewport and PDF space are the same here.
  const viewport = { convertToPdfPoint: (x: number, y: number) => [x, y], convertToViewportPoint: (x: number, y: number) => [x, y] };
  const host: PdfHighlightStoreHost = {
    storage: () => storage,
    commands: () => undefined,
    viewerContainer: () => container,
    pageView: () => ({ div: page, viewport }),
    selectionRects: () => [{ left: 10, top: 20, width: 100, height: 12 }],
    capturedText: () => 'Excess loss',
    clearSelectionOverlay: () => {},
    continueInChat: () => {},
  };
  const select = () => {
    const range = document.createRange();
    range.setStart(textLayer.firstChild!, 0);
    range.setEnd(textLayer.firstChild!, 11);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  };
  const boxes = () => Array.from(page.querySelectorAll<HTMLElement>('.pdf-highlight-box'));
  return { store: new PdfHighlightStore(host), saved, select, boxes };
}

describe('PdfHighlightStore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.textContent = ''; });

  it('highlights the selection and saves it under the file', async () => {
    const { store, saved, select, boxes } = setup();
    await store.load('C:/papers/brosius.pdf');
    select();
    const made = store.createFromSelection('green');
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ page: 1, color: 'green', text: 'Excess loss' });
    expect(boxes()).toHaveLength(1);
    vi.advanceTimersByTime(300);
    expect(JSON.parse(saved.get('parallx.pdfHighlights:C:/papers/brosius.pdf')!)).toHaveLength(1);
    expect(store.color).toBe('green');
  });

  it('highlighting the same passage again toggles it off, or recolours it', async () => {
    const { store, select, boxes } = setup();
    await store.load('a.pdf');
    select();
    store.createFromSelection('yellow');
    select();
    const recoloured = store.createFromSelection('blue');
    expect(recoloured[0].color).toBe('blue');
    expect(boxes()).toHaveLength(1);
    select();
    expect(store.createFromSelection('blue')).toEqual([]);
    expect(boxes()).toHaveLength(0);
  });

  it('undoes and redoes a highlight', async () => {
    const { store, select, boxes } = setup();
    await store.load('a.pdf');
    select();
    store.createFromSelection('yellow');
    expect(store.undo()).toBe(true);
    expect(boxes()).toHaveLength(0);
    expect(store.redo()).toBe(true);
    expect(boxes()).toHaveLength(1);
  });

  it('has nothing to undo in a newly opened document', async () => {
    const { store, saved, select } = setup();
    await store.load('a.pdf');
    select();
    store.createFromSelection('yellow');
    store.close();
    await store.load('b.pdf');
    expect(store.undo()).toBe(false);
    vi.advanceTimersByTime(300);
    expect(saved.get('parallx.pdfHighlights:b.pdf')).toBeUndefined();
  });

  it('writes a pending save when the document closes', async () => {
    const { store, saved, select } = setup();
    await store.load('a.pdf');
    select();
    store.createFromSelection('pink');
    store.close();
    expect(JSON.parse(saved.get('parallx.pdfHighlights:a.pdf')!)[0].color).toBe('pink');
  });
});
