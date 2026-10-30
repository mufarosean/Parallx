// @vitest-environment jsdom
// pdfHighlightStore.test.ts — a PDF's highlights: made from the selection,
// saved per file, toggled off or recoloured by highlighting again, undone
// and redone. Undo belongs to one document: the pane keeps its store when
// it opens another PDF, and an undo there must not bring back a highlight
// from the one before. Asking the AI about a highlight gives it the file,
// the whole page and that file's passages, not only the highlighted words.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PdfHighlightStore, type PdfHighlightStoreHost } from '../../src/editor/panes/pdf/pdfHighlightStore';

function setup(over: Partial<PdfHighlightStoreHost> = {}) {
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
    pageSource: async () => ({}),
    ...over,
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

  it('asks about a highlight with its file, its whole page and passages from that file', async () => {
    vi.useRealTimers();
    const sent: { role: string; content: string }[][] = [];
    const scopes: unknown[] = [];
    const provider = {
      async *sendChatRequest(messages: readonly { role: string; content: string }[]) { sent.push([...messages]); yield { content: 'It is the retention.' }; },
      retrieveContext: async (_q: string, scope?: unknown) => { scopes.push(scope); return '[1] Brosius p.4: the retention is set by treaty.'; },
    };
    const { store, select } = setup({
      commands: () => ({ executeCommand: async <T,>() => provider as T }),
      pageSource: async (n) => ({ fileName: 'brosius.pdf', filePath: '/w/papers/brosius.pdf', pageCount: 12, pageText: `Page ${n}. Excess loss development above the retention.` }),
    });
    await store.load('/w/papers/brosius.pdf');
    select();
    const [hl] = store.createFromSelection('yellow');
    store.openPopover(hl, new DOMRect(0, 0, 10, 10));
    const ask = document.querySelector<HTMLTextAreaElement>('.pdf-highlight-ask')!;
    ask.value = 'What is the retention here?';
    ask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const system = sent[0][0].content;
    expect(system).toContain('"brosius.pdf", page 1 of 12');
    expect(system).toContain('Excess loss\n---');
    expect(system).toContain('Page 1. Excess loss development above the retention.');
    expect(system).toContain('the retention is set by treaty');
    expect(scopes).toEqual([{ filePath: '/w/papers/brosius.pdf' }]);
    expect(sent[0].at(-1)).toEqual({ role: 'user', content: 'What is the retention here?' });
    store.dismissPopover();
  });
});
