// @vitest-environment jsdom
//
// mindmapDataService.test.ts — the mindmap data layer over a scripted bridge
// and a fake page service, the same harness shape as
// canvasDatabaseDataService.test.ts. Pins the database-pattern composition:
// a mindmap IS a page, the mindmaps row follows the page's lifecycle, and
// doc saves announce themselves with their writer.

import { describe, expect, it, vi } from 'vitest';
import { MindmapDataService, MINDMAP_PAGE_ICON } from '../../src/built-in/canvas/mindmap/mindmapDataService';
import { PageChangeKind } from '../../src/built-in/canvas/canvasTypes';
import { emptyMindmapDoc, serializeMindmapDoc } from '../../src/built-in/canvas/mindmap/mindmapModel';

function makeEnv() {
  const maps = new Map<string, string>(); // id → data json
  const pages = new Map<string, { id: string; title: string; icon: string | null }>();
  let pageListener: ((e: { kind: PageChangeKind; pageId: string }) => void) | null = null;
  let nextId = 0;

  const bridge = {
    run: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/^INSERT INTO mindmaps/i.test(sql)) {
        maps.set(params[0] as string, params[1] as string);
        return { error: null, changes: 1 };
      }
      if (/^UPDATE mindmaps SET data/i.test(sql)) {
        if (!maps.has(params[1] as string)) return { error: null, changes: 0 };
        maps.set(params[1] as string, params[0] as string);
        return { error: null, changes: 1 };
      }
      if (/^DELETE FROM mindmaps/i.test(sql)) {
        maps.delete(params[0] as string);
        return { error: null, changes: 1 };
      }
      return { error: { code: 'ERR', message: `unexpected sql: ${sql}` } };
    }),
    get: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/^SELECT data FROM mindmaps/i.test(sql)) {
        const data = maps.get(params[0] as string);
        return { error: null, row: data === undefined ? null : { data } };
      }
      return { error: { code: 'ERR', message: `unexpected sql: ${sql}` } };
    }),
    all: vi.fn(async (sql: string) => {
      if (/^SELECT id FROM mindmaps/i.test(sql)) {
        return { error: null, rows: [...maps.keys()].map((id) => ({ id })) };
      }
      return { error: { code: 'ERR', message: `unexpected sql: ${sql}` } };
    }),
  };

  const pagesService: any = {
    onDidChangePage: (fn: any) => { pageListener = fn; return { dispose: () => { pageListener = null; } }; },
    createPage: vi.fn(async (_parent: string | null, title: string) => {
      const id = `page-${++nextId}`;
      pages.set(id, { id, title, icon: null });
      return pages.get(id);
    }),
    createChildPageWithBlock: vi.fn(async (opts: { parentId: string; title?: string }) => {
      const id = `child-${++nextId}-of-${opts.parentId}`;
      pages.set(id, { id, title: opts.title ?? 'Untitled', icon: null });
      return pages.get(id);
    }),
    updatePage: vi.fn(async (id: string, updates: { title?: string; icon?: string }) => {
      const p = pages.get(id);
      if (p) Object.assign(p, updates);
      return p;
    }),
    getPage: vi.fn(async (id: string) => pages.get(id) ?? null),
  };

  const service = new MindmapDataService(pagesService);
  service.attachDatabase(bridge as any);
  return {
    service, bridge, pages, maps, pagesService,
    firePageDeleted: (pageId: string) => pageListener?.({ kind: PageChangeKind.Deleted, pageId }),
  };
}

describe('createMindmap', () => {
  it('creates a page, stamps the icon, and seeds a one-node document', async () => {
    const { service, maps, pages } = makeEnv();
    const page = await service.createMindmap({ title: 'Reserving Models' });
    expect(pages.get(page.id)?.icon).toBe(MINDMAP_PAGE_ICON);
    expect(service.isMindmap(page.id)).toBe(true);
    const stored = JSON.parse(maps.get(page.id)!);
    expect(stored.nodes).toHaveLength(1);
    expect(stored.nodes[0].label).toBe('Reserving Models');
  });

  it('nests under a parent via the child-page-with-block path', async () => {
    const { service, pagesService } = makeEnv();
    await service.createMindmap({ title: 'Nested', parentId: 'parent-1' });
    expect(pagesService.createChildPageWithBlock).toHaveBeenCalledWith({ parentId: 'parent-1', title: 'Nested' });
    expect(pagesService.createPage).not.toHaveBeenCalled();
  });
});

describe('doc round-trip and change events', () => {
  it('saves announce their writer; getDoc parses what was stored', async () => {
    const { service } = makeEnv();
    const page = await service.createMindmap({ title: 'T' });
    const events: Array<{ pageId: string; source: string }> = [];
    service.onDidChangeDoc((e) => events.push(e));

    const doc = emptyMindmapDoc('T');
    await service.saveDoc(page.id, doc, 'ai');
    expect(events).toEqual([{ pageId: page.id, source: 'ai' }]);
    expect((await service.getDoc(page.id))!.nodes[0].label).toBe('T');
  });

  it('getDoc returns null for a page that is not a mindmap', async () => {
    const { service } = makeEnv();
    expect(await service.getDoc('nope')).toBeNull();
  });

  it('a corrupt stored payload still yields an openable document', async () => {
    const { service, maps } = makeEnv();
    const page = await service.createMindmap({ title: 'T' });
    maps.set(page.id, '{broken');
    const doc = await service.getDoc(page.id);
    expect(doc!.nodes.length).toBeGreaterThan(0);
  });
});

describe('identity and self-healing', () => {
  it('ensureIdsLoaded hydrates isMindmap from the table', async () => {
    const { service, maps } = makeEnv();
    maps.set('pre-existing', serializeMindmapDoc(emptyMindmapDoc('Old')));
    expect(service.isMindmap('pre-existing')).toBe(false);
    await service.ensureIdsLoaded();
    expect(service.isMindmap('pre-existing')).toBe(true);
  });

  it('page deletion drops the mindmaps row and the id', async () => {
    const { service, maps, firePageDeleted } = makeEnv();
    const page = await service.createMindmap({ title: 'Doomed' });
    firePageDeleted(page.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.isMindmap(page.id)).toBe(false);
    expect(maps.has(page.id)).toBe(false);
  });

  it("a non-mindmap page's deletion touches nothing", async () => {
    const { service, bridge, firePageDeleted } = makeEnv();
    firePageDeleted('some-canvas-page');
    await new Promise((r) => setTimeout(r, 0));
    expect(bridge.run).not.toHaveBeenCalled();
    expect(service.isMindmap('some-canvas-page')).toBe(false);
  });
});
