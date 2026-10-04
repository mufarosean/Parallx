// canvasSyncedBlock.test.ts — Synced Block storage (migration 018) on a real
// SQLite database, and the self-nesting rule.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { buildDataviewSql } from '../../src/built-in/canvas/extensions/dataviewNode';
import { isSyncCycle } from '../../src/built-in/canvas/extensions/syncedBlockNode';
import { decodeCanvasContent } from '../../src/built-in/canvas/contentSchema';
import { realSqlite } from './realSqlite';

let env: ReturnType<typeof realSqlite>;
let pages: CanvasDataService;
beforeEach(() => {
  env = realSqlite();
  (globalThis as any).window = { parallxElectron: { database: env.bridge } };
  pages = new CanvasDataService();
});
afterEach(() => { pages.dispose(); delete (globalThis as any).window; });

const ids = (nodes: any[]): string[] => nodes.flatMap((n) => [n.id, ...ids(n.children)]);
const withSynced = (syncId: string) => JSON.stringify({ type: 'doc', content: [
  { type: 'paragraph', attrs: { id: 'p' }, content: [{ type: 'text', text: 'before' }] },
  { type: 'syncedRef', attrs: { id: 's', syncId } },
] });

describe('synced block content', () => {
  it('is a page of its own holding the blocks it was made from', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'x' }, content: [{ type: 'text', text: 'Shared' }] }] };
    const syncId = await pages.createSyncedContent(doc);
    const page = await pages.getPage(syncId);
    expect(decodeCanvasContent(page!.content).doc).toMatchObject({ content: [{ type: 'paragraph', content: [{ text: 'Shared' }] }] });
    expect(await pages.isSyncedContent(syncId)).toBe(true);
    const plain = await pages.createPage(null, 'Plain');
    expect(await pages.isSyncedContent(plain.id)).toBe(false);
  });

  it('never shows as a page: not in the tree, Recent, Favorites or a Page List', async () => {
    const plain = await pages.createPage(null, 'Plain');
    const syncId = await pages.createSyncedContent();
    await pages.toggleFavorite(syncId);
    expect(ids(await pages.getPageTree())).toEqual([plain.id]);
    expect((await pages.getRecentPages(10)).map((p) => p.id)).toEqual([plain.id]);
    expect(await pages.getFavoritedPages()).toEqual([]);
    const built = buildDataviewSql({ filter: [] })!;
    const listed = (await env.bridge.all(built.sql, built.params)).rows!.map((r: any) => r.id);
    expect(listed).toEqual([plain.id]);
  });

  it('counts the live pages that hold a copy', async () => {
    const syncId = await pages.createSyncedContent();
    const a = await pages.createPage(null, 'A');
    const b = await pages.createPage(null, 'B');
    expect(await pages.countSyncedCopies(syncId)).toBe(0);
    await pages.updatePage(a.id, { content: withSynced(syncId) });
    await pages.updatePage(b.id, { content: withSynced(syncId) });
    expect(await pages.countSyncedCopies(syncId)).toBe(2);
    await pages.archivePage(b.id);
    expect(await pages.countSyncedCopies(syncId)).toBe(1);
  });
});

describe('a synced block inside itself', () => {
  it('is caught at any depth', () => {
    expect(isSyncCycle(undefined, 'a')).toBe(false);
    expect(isSyncCycle(['a'], 'b')).toBe(false);
    expect(isSyncCycle(['a', 'b'], 'a')).toBe(true);
    expect(isSyncCycle(['a', 'b'], 'b')).toBe(true);
  });
});
