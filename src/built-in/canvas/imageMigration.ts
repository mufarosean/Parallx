// imageMigration.ts — move the pictures already inside pages out to files.
//
// Since pictures put on a page are stored as workspace files (imageStore.ts),
// only the pages written before still carry base64 data URLs: in their image
// blocks and in their covers. "Canvas: Store Pictures as Files" moves them,
// page by page through the data service's own rewrite door (the open editor
// reloads; a page that cannot be read is left alone). The pictures look the
// same; the pages get smaller. Their version history keeps the old copies.

import { storeImageSrc, parseImageDataUrl } from './imageStore.js';
import type { IPage } from './canvasTypes.js';

interface INode { type?: string; attrs?: Record<string, unknown>; content?: INode[] }

/** Every image block's data-URL src the store keeps, each once. */
export function dataImageSrcs(doc: unknown): string[] {
  const out = new Set<string>();
  const walk = (n: INode | undefined) => {
    if (!n || typeof n !== 'object') return;
    const src = n.type === 'image' ? n.attrs?.src : undefined;
    if (typeof src === 'string' && parseImageDataUrl(src)) out.add(src);
    n.content?.forEach(walk);
  };
  walk(doc as INode);
  return [...out];
}

/** The doc with image srcs swapped per `map`; how many were swapped. */
export function replaceImageSrcs(doc: unknown, map: ReadonlyMap<string, string>): number {
  let n = 0;
  const walk = (node: INode | undefined) => {
    if (!node || typeof node !== 'object') return;
    const src = node.type === 'image' ? node.attrs?.src : undefined;
    const to = typeof src === 'string' ? map.get(src) : undefined;
    if (to && to !== src) { node.attrs = { ...node.attrs, src: to }; n++; }
    node.content?.forEach(walk);
  };
  walk(doc as INode);
  return n;
}

/** As much of the canvas data service as the move uses. */
export interface IImageMigrationSource {
  getPageTree(): Promise<(IPage & { children: unknown[] })[]>;
  getArchivedPages(): Promise<{ id: string }[]>;
  getPage(id: string): Promise<IPage | null>;
  rewritePageContent(pageId: string, build: (doc: any) => any | string, opts?: { source?: 'user' | 'ai' | 'restore' }): Promise<{ ok: boolean }>;
  updatePage(pageId: string, updates: { coverUrl?: string | null }): Promise<unknown>;
  notifyExternalPageMutation(pageId: string, kind: 'updated'): Promise<void>;
  decode(content: string): unknown;
}

/** Move every page's stored-in-page pictures to files. Returns the pictures and pages changed. */
export async function storePicturesAsFiles(ds: IImageMigrationSource, store: (src: string) => Promise<string> = storeImageSrc): Promise<{ pictures: number; pages: number }> {
  const ids: string[] = [];
  const walk = (nodes: { id: string; children: unknown[] }[]) => { for (const p of nodes) { ids.push(p.id); walk(p.children as never); } };
  walk(await ds.getPageTree());
  for (const a of await ds.getArchivedPages()) if (!ids.includes(a.id)) ids.push(a.id);
  let pictures = 0, pages = 0;
  for (const id of ids) {
    const page = await ds.getPage(id);
    if (!page) continue;
    let changed = 0;
    const map = new Map<string, string>();
    for (const src of dataImageSrcs(ds.decode(page.content))) {
      const to = await store(src);
      if (to !== src) map.set(src, to);
    }
    if (map.size) {
      let swapped = 0;
      const res = await ds.rewritePageContent(id, (doc) => { swapped = replaceImageSrcs(doc, map); return swapped ? doc : 'No pictures to move.'; }, { source: 'user' });
      if (res.ok) changed += swapped;
    }
    if (page.coverUrl && parseImageDataUrl(page.coverUrl)) {
      const to = await store(page.coverUrl);
      if (to !== page.coverUrl) { await ds.updatePage(id, { coverUrl: to }); changed++; }
    }
    if (changed) { pictures += changed; pages++; await ds.notifyExternalPageMutation(id, 'updated').catch(() => undefined); }
  }
  return { pictures, pages };
}
