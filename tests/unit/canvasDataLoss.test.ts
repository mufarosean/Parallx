// @vitest-environment jsdom
//
// canvasDataLoss.test.ts — the "content can be lost" list (C1–C16) from
// docs/CANVAS_ASSESSMENT_2026-10-03.md.  Each test was written to fail on the
// code as it was, then the fix made it pass.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mk, p, t, col, cols, find } from './canvasMatrixHarness';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { decodeCanvasContent } from '../../src/built-in/canvas/contentSchema';
import { wrapUnknownContent, unwrapUnknownContent } from '../../src/built-in/canvas/unknownContent';

// ── Service harness (a pages table in memory) ────────────────────────────────

function pageRow(id: string, content: string): Record<string, unknown> {
  return {
    id, parent_id: null, title: 'Page', icon: null, content,
    content_schema_version: 2, revision: 1, sort_order: 1, is_archived: 0,
    cover_url: null, cover_y_offset: 0.5, font_family: 'default',
    full_width: 0, small_text: 0, is_locked: 0, is_favorited: 0,
    created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
  };
}

function memoryDb() {
  const pages = new Map<string, Record<string, unknown>>();
  const get = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/SELECT \* FROM pages WHERE id = \?/i.test(sql)) return { error: null, row: pages.get(params[0] as string) ?? null };
    return { error: null, row: null };
  });
  const all = vi.fn(async () => ({ error: null, rows: [] }));
  const run = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^UPDATE pages SET/i.test(sql)) {
      const guarded = /revision = \?/i.test(sql);
      const id = params[guarded ? params.length - 2 : params.length - 1] as string;
      const row = pages.get(id);
      if (!row) return { error: null, changes: 0 };
      if (guarded && row.revision !== params[params.length - 1]) return { error: null, changes: 0 };
      if (/content = \?/i.test(sql)) row.content = params[0];
      row.revision = (row.revision as number) + 1;
      return { error: null, changes: 1 };
    }
    return { error: null, changes: 0 };
  });
  return { pages, run, mock: { get, all, run, runTransaction: vi.fn(async () => ({ error: null, results: [] })) } };
}

const docOf = (text: string) => JSON.stringify({ schemaVersion: 2, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });

// ── C1: a block type the editor doesn't know ─────────────────────────────────

describe('C1: unknown block types load, show, and save back unchanged', () => {
  const stored = {
    type: 'doc',
    content: [
      p('keep me'),
      { type: 'syncedBlock', attrs: { id: 's1', source: 'page-9' }, content: [p('inside synced')] },
      cols(col(p('left'), { type: 'databaseInline', attrs: { databaseId: 'db-1' } }), col(p('right'))),
      p('a ', { type: 'mention', attrs: { pageId: 'p-2' } }, ' and ', t('marked', [{ type: 'commentMark', attrs: { thread: 'c1' } }])),
    ],
  };

  it('the editor shows every known block and a placeholder for each unknown one', () => {
    const ed = mk(wrapUnknownContent(stored, mk({ type: 'doc', content: [p()] }).schema));
    const texts: string[] = [];
    ed.state.doc.descendants((n: any) => { if (n.isText) texts.push(n.text); return true; });
    expect(texts).toEqual(['keep me', 'left', 'right', 'a ', ' and ']);
    let placeholders = 0;
    ed.state.doc.descendants((n: any) => { if (n.type.name.startsWith('unsupported')) placeholders++; return true; });
    expect(placeholders).toBe(4);
    expect(() => ed.state.doc.check()).not.toThrow();
  });

  it('saving after an edit writes the unknown blocks back exactly as they were', () => {
    const ed = mk(wrapUnknownContent(stored, mk({ type: 'doc', content: [p()] }).schema));
    const r = find(ed, (n) => n.isTextblock && n.textContent === 'keep me')!;
    ed.commands.insertContentAt(r.pos + 1, 'NEW ');
    const saved = unwrapUnknownContent(ed.getJSON());
    const strip = (j: any): any => JSON.parse(JSON.stringify(j, (k, v) => (k === 'id' && typeof v === 'string' && v.length > 8 ? undefined : v === null ? undefined : v)));
    const expected = JSON.parse(JSON.stringify(stored));
    expected.content[0].content[0].text = 'NEW keep me';
    expect(strip(saved).content[1]).toEqual(expected.content[1]);
    expect(strip(saved).content[2].content[0].content[1]).toEqual(expected.content[2].content[0].content[1]);
    expect(strip(saved).content[3].content[1]).toEqual(expected.content[3].content[1]);
    expect(strip(saved).content[3].content[3]).toEqual(expected.content[3].content[3]);
    expect(strip(saved).content[0].content[0].text).toBe('NEW keep me');
  });
});

// ── C6: content that can't be decoded ────────────────────────────────────────

describe('C6: a page whose stored content cannot be read is never written over', () => {
  let env: ReturnType<typeof memoryDb>;
  let service: CanvasDataService;
  const GARBAGE = '{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"paragraph"';

  beforeEach(async () => {
    env = memoryDb();
    env.pages.set('bad', pageRow('bad', GARBAGE));
    env.pages.set('good', pageRow('good', docOf('fine')));
    (globalThis as any).window = { parallxElectron: { database: env.mock } };
    service = new CanvasDataService();
  });
  afterEach(() => {
    service.dispose();
    delete (globalThis as any).window;
  });

  it('decoding says unreadable and asks for no repair', () => {
    const d = decodeCanvasContent(GARBAGE) as any;
    expect(d.unreadable).toBe(true);
    expect(d.needsRepair).toBe(false);
  });

  it('opening the page writes nothing', async () => {
    const page = await service.getPage('bad');
    const decoded = await service.decodePageContentForEditor(page!) as any;
    expect(decoded.unreadable).toBe(true);
    expect(env.pages.get('bad')!.content).toBe(GARBAGE);
  });

  it('a content write over it is refused, and the stored text stays', async () => {
    await service.getPage('bad');
    await expect(service.updatePage('bad', { content: docOf('typed') })).rejects.toThrow(/cannot be read/);
    expect(env.pages.get('bad')!.content).toBe(GARBAGE);
  });

  it('an auto-save over it never lands', async () => {
    await service.getPage('bad');
    service.scheduleContentSave('bad', JSON.stringify({ type: 'doc', content: [p('typed')] }));
    await service.flushPendingSaves();
    expect(env.pages.get('bad')!.content).toBe(GARBAGE);
  });

  it('a readable page still saves', async () => {
    await service.getPage('good');
    await service.updatePage('good', { content: docOf('typed') });
    expect(env.pages.get('good')!.content).toContain('typed');
  });
});
