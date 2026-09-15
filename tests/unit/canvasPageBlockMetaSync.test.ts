// @vitest-environment jsdom
// canvasPageBlockMetaSync.test.ts — a pageBlock card whose stored title
// drifted from the live page resyncs; it must not strike itself out.
//
// Regression: Tiptap core hands a raw addNodeView only
// { node, view, getPos, decorations, editor, extension, HTMLAttributes };
// `updateAttributes` is a MARK-view prop. The sync path called it unguarded,
// so every card whose child page had been renamed after embedding threw
// inside the try, hit the broken-on-throw catch, and rendered
// "(unavailable)" while hover preview and click still resolved the page.

import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { PageBlock, type IPageBlockDataAccess, type IPageBlockPage } from '../../src/built-in/canvas/extensions/pageBlockNode';

type Listener = (e: { pageId: string; page?: IPageBlockPage }) => void;

function fakeDataService(page: IPageBlockPage | null, opts: { throwOnGet?: boolean } = {}) {
  const listeners = new Set<Listener>();
  const ds = {
    getPage: vi.fn(async () => {
      if (opts.throwOnGet) throw new Error('db down');
      return page;
    }),
    updatePage: vi.fn(async (_id: string, updates: { icon?: string | null }) => ({ ...(page as IPageBlockPage), ...updates })),
    decodePageContentForEditor: vi.fn(async () => ({ doc: { type: 'doc', content: [] }, recovered: false })),
    moveBlocksBetweenPagesAtomic: vi.fn(),
    movePageWithBlocks: vi.fn(),
    appendBlocksToPage: vi.fn(),
    fireContentReload: vi.fn(),
    onDidChangePage: (l: Listener) => { listeners.add(l); return { dispose() { listeners.delete(l); } }; },
    emit(e: { pageId: string; page?: IPageBlockPage }) { for (const l of listeners) l(e); },
  };
  return ds as unknown as IPageBlockDataAccess & { emit(e: { pageId: string; page?: IPageBlockPage }): void };
}

function make(dataService: IPageBlockDataAccess, attrs: Record<string, unknown>): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ dropcursor: false }),
      PageBlock.configure({ dataService, currentPageId: 'parent' }),
    ],
    content: { type: 'doc', content: [{ type: 'pageBlock', attrs }] },
  });
}

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const card = (ed: Editor) => ed.view.dom.querySelector('.canvas-page-block')!;
const titleOf = (ed: Editor) => card(ed).querySelector('.canvas-page-block-title')!.textContent;
const broken = (ed: Editor) => card(ed).classList.contains('canvas-page-block--broken');

describe('pageBlock metadata sync', () => {
  it('a child renamed after embedding resyncs the card and the stored attrs', async () => {
    const ds = fakeDataService({ id: 'child', title: 'Anya', icon: null });
    const ed = make(ds, { pageId: 'child', title: 'Untitled', icon: null });
    try {
      await flush();
      expect(broken(ed)).toBe(false);
      expect(titleOf(ed)).toBe('Anya');
      expect(ed.state.doc.firstChild!.attrs.title).toBe('Anya');
      // The resync is housekeeping, never an undo step.
      expect(ed.can().undo()).toBe(false);
    } finally { ed.destroy(); }
  });

  it('a child whose icon changed resyncs the stored icon', async () => {
    const ds = fakeDataService({ id: 'child', title: 'Anya', icon: 'star' });
    const ed = make(ds, { pageId: 'child', title: 'Anya', icon: null });
    try {
      await flush();
      expect(broken(ed)).toBe(false);
      expect(ed.state.doc.firstChild!.attrs.icon).toBe('star');
    } finally { ed.destroy(); }
  });

  it('a page-change event while the parent is open persists the new title', async () => {
    const ds = fakeDataService({ id: 'child', title: 'Anya', icon: null });
    const ed = make(ds, { pageId: 'child', title: 'Anya', icon: null });
    try {
      await flush();
      ds.emit({ pageId: 'child', page: { id: 'child', title: 'Anya Bio', icon: null } });
      expect(titleOf(ed)).toBe('Anya Bio');
      expect(ed.state.doc.firstChild!.attrs.title).toBe('Anya Bio');
    } finally { ed.destroy(); }
  });

  it('a stored title that already matches dispatches nothing', async () => {
    const ds = fakeDataService({ id: 'child', title: 'Anya', icon: null });
    const ed = make(ds, { pageId: 'child', title: 'Anya', icon: null });
    try {
      const before = ed.state.doc;
      await flush();
      expect(ed.state.doc).toBe(before);
      expect(broken(ed)).toBe(false);
    } finally { ed.destroy(); }
  });

  it('a deleted child is marked as deleted, a failed lookup as unavailable', async () => {
    const gone = make(fakeDataService(null), { pageId: 'child', title: 'Anya', icon: null });
    const down = make(fakeDataService(null, { throwOnGet: true }), { pageId: 'child', title: 'Anya', icon: null });
    try {
      await flush();
      expect(broken(gone)).toBe(true);
      expect(titleOf(gone)).toBe('(deleted page)');
      expect(broken(down)).toBe(true);
      expect(titleOf(down)).toBe('(unavailable)');
    } finally { gone.destroy(); down.destroy(); }
  });
});
