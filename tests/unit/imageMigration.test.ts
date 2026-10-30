// imageMigration.test.ts — "Store Pictures as Files" moves the data-URL
// pictures already inside pages (image blocks and covers) out to files,
// through the page rewrite door, and leaves every other picture as it is.
import { describe, it, expect } from 'vitest';
import { dataImageSrcs, replaceImageSrcs, storePicturesAsFiles } from '../../src/built-in/canvas/imageMigration';

const A = 'data:image/png;base64,AAAA', B = 'data:image/jpeg;base64,BBBB', SVG = 'data:image/svg+xml;base64,PHN2Zz4=';
const doc = () => ({ type: 'doc', content: [
  { type: 'image', attrs: { src: A } },
  { type: 'columnList', content: [{ type: 'column', content: [{ type: 'image', attrs: { src: B, width: 200 } }, { type: 'image', attrs: { src: A } }] }] },
  { type: 'image', attrs: { src: SVG } },
  { type: 'image', attrs: { src: 'https://example.com/x.png' } },
] });

describe('moving pictures out of pages', () => {
  it('finds each stored-in-page picture once, nested ones too, not SVGs or links', () => {
    expect(dataImageSrcs(doc())).toEqual([A, B]);
  });

  it('swaps their srcs and keeps the other attributes', () => {
    const d = doc();
    expect(replaceImageSrcs(d, new Map([[A, 'file-a'], [B, 'file-b']]))).toBe(3);
    expect(JSON.stringify(d)).not.toContain('base64,AAAA');
    expect((d.content[1] as any).content[0].content[0].attrs).toEqual({ src: 'file-b', width: 200 });
  });

  it('moves every page\'s pictures and covers, live and in the trash', async () => {
    const pages: Record<string, any> = {
      p1: { id: 'p1', content: JSON.stringify(doc()), coverUrl: B },
      p2: { id: 'p2', content: JSON.stringify({ type: 'doc', content: [] }), coverUrl: 'linear-gradient(red, blue)' },
      t1: { id: 't1', content: JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: B } }] }), coverUrl: null },
    };
    const notified: string[] = [];
    const ds = {
      getPageTree: async () => [{ ...pages.p1, children: [{ ...pages.p2, children: [] }] }],
      getArchivedPages: async () => [{ id: 't1' }],
      getPage: async (id: string) => pages[id],
      decode: (c: string) => JSON.parse(c),
      rewritePageContent: async (id: string, build: (d: any) => any) => {
        const next = build(JSON.parse(pages[id].content));
        if (typeof next === 'string') return { ok: false };
        pages[id] = { ...pages[id], content: JSON.stringify(next) };
        return { ok: true };
      },
      updatePage: async (id: string, u: { coverUrl?: string | null }) => { pages[id] = { ...pages[id], ...u }; },
      notifyExternalPageMutation: async (id: string) => { notified.push(id); },
    };
    const store = async (src: string) => (src === A ? 'parallx-media://workspace/a.png' : src === B ? 'parallx-media://workspace/b.jpg' : src);
    expect(await storePicturesAsFiles(ds as never, store)).toEqual({ pictures: 5, pages: 2 });
    expect(pages.p1.content).not.toMatch(/base64,(AAAA|BBBB)/);
    expect(pages.p1.content).toContain('data:image/svg+xml'); // left as it was
    expect(pages.p1.coverUrl).toBe('parallx-media://workspace/b.jpg');
    expect(pages.p2.coverUrl).toBe('linear-gradient(red, blue)');
    expect(pages.t1.content).toContain('parallx-media://workspace/b.jpg');
    expect(notified).toEqual(['p1', 't1']);
    // A second run finds nothing.
    expect(await storePicturesAsFiles(ds as never, store)).toEqual({ pictures: 0, pages: 0 });
  });
});
