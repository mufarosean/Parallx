/**
 * Canvas page writes are serialized per page.
 *
 * The bug: the title debounce (300 ms) and the body debounce (500 ms) both
 * bump the row's revision, and when they overlapped the second one read the
 * same revision as the first and failed its optimistic check. The user, alone
 * on the page, was told "This page was changed elsewhere" and offered a Reload
 * that would have thrown away their own keystrokes.
 *
 * The contract now: writes from this service never conflict with each other;
 * a writer this service never saw (another window or process) still does.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';

function doc(text: string): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
}

function makePageRow(id: string, content: string): Record<string, unknown> {
  return {
    id, parent_id: null, title: 'Page', icon: null, content,
    content_schema_version: 2, revision: 1, sort_order: 1, is_archived: 0,
    cover_url: null, cover_y_offset: 0.5, font_family: 'default',
    full_width: 0, small_text: 0, is_locked: 0, is_favorited: 0,
    created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * A pages table whose UPDATE reads the row, yields (so another write can
 * interleave exactly the way IPC round-trips let them), then applies the
 * optimistic-revision check. Title writes and content writes are both
 * modelled; every UPDATE bumps `revision`, as the real SQL does.
 */
function createMockDb() {
  const pages = new Map<string, Record<string, unknown>>();

  const get = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/SELECT \* FROM pages WHERE id = \?/i.test(sql)) {
      return { error: null, row: pages.get(params[0] as string) ?? null };
    }
    return { error: null, row: null };
  });
  const all = vi.fn(async () => ({ error: null, rows: [] }));

  const run = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^UPDATE pages SET/i.test(sql)) {
      const guarded = /revision = \?/i.test(sql);
      const id = params[guarded ? params.length - 2 : params.length - 1] as string;
      const expectedRevision = guarded ? (params[params.length - 1] as number) : undefined;
      const row = pages.get(id);
      const seen = row ? (row.revision as number) : undefined;
      await tick(); // the interleaving window
      if (!row) return { error: null, changes: 0 };
      if (expectedRevision !== undefined && seen !== expectedRevision) {
        return { error: null, changes: 0 };
      }
      if (/title = \?/i.test(sql)) row.title = params[0];
      if (/content = \?/i.test(sql)) row.content = params[0];
      row.revision = (row.revision as number) + 1;
      return { error: null, changes: 1 };
    }
    return { error: null, changes: 0 };
  });

  return { pages, mock: { get, all, run, runTransaction: vi.fn(async () => ({ error: null, results: [] })) } };
}

describe('CanvasDataService — serialized page writes', () => {
  let env: ReturnType<typeof createMockDb>;
  let service: CanvasDataService;

  beforeEach(async () => {
    env = createMockDb();
    env.pages.set('p1', makePageRow('p1', doc('original')));
    (globalThis as any).window = { parallxElectron: { database: env.mock } };
    service = new CanvasDataService();
    await service.getPage('p1'); // seeds the known revision, as opening a page does
  });

  afterEach(() => {
    service.dispose();
    delete (globalThis as any).window;
  });

  it('a title save overlapping a guarded body save is not a conflict', async () => {
    const title = service.updatePage('p1', { title: 'Renamed' });
    const body = service.updatePage('p1', { content: doc('typed'), expectedRevision: 1 });
    await expect(Promise.all([title, body])).resolves.toBeDefined();
    const row = env.pages.get('p1')!;
    expect(row.title).toBe('Renamed');
    expect(row.content).toContain('"text":"typed"');
    expect(row.revision).toBe(3);
  });

  it('many interleaved writers from one service all land, in order', async () => {
    const writes = [
      service.updatePage('p1', { icon: 'star' }),
      service.updatePage('p1', { content: doc('a'), expectedRevision: 1 }),
      service.updatePage('p1', { title: 'T' }),
      service.updatePage('p1', { content: doc('b'), expectedRevision: 1 }),
    ];
    await expect(Promise.all(writes)).resolves.toBeDefined();
    expect(env.pages.get('p1')!.content).toContain('"text":"b"');
    expect(env.pages.get('p1')!.revision).toBe(5);
  });

  it('a writer this service never saw still conflicts', async () => {
    env.pages.get('p1')!.revision = 7; // another window/process committed
    await expect(
      service.updatePage('p1', { content: doc('stale'), expectedRevision: 1 }),
    ).rejects.toThrow(/Revision conflict/);
  });

  it('a failed write does not block the next one', async () => {
    env.pages.get('p1')!.revision = 7;
    await service.updatePage('p1', { content: doc('stale'), expectedRevision: 1 }).catch(() => undefined);
    await expect(service.updatePage('p1', { title: 'After' })).resolves.toBeDefined();
    expect(env.pages.get('p1')!.title).toBe('After');
  });
});
