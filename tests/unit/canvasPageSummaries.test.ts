// canvasPageSummaries.test.ts — the page tree without bodies.
//
// Quick Open, the sidebar and pickers only need titles and places, so
// `getPageSummaryTree` must give the same tree as `getPageTree` without ever
// asking SQLite for the `content` column.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CanvasDataService, PAGE_SUMMARY_COLUMNS, rowToPage, rowToPageSummary } from '../../src/built-in/canvas/canvasDataService';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { realSqlite } from './realSqlite';

let env: ReturnType<typeof realSqlite>;
let pages: CanvasDataService;
let dbs: DatabaseDataService;
let queries: string[];

beforeEach(() => {
  env = realSqlite();
  queries = [];
  const all = env.bridge.all;
  env.bridge.all = async (sql: string, params?: unknown[]) => { queries.push(sql); return all(sql, params); };
  (globalThis as any).window = { parallxElectron: { database: env.bridge } };
  pages = new CanvasDataService();
  dbs = new DatabaseDataService(pages);
});
afterEach(() => {
  dbs.dispose();
  pages.dispose();
  delete (globalThis as any).window;
});

const ids = (nodes: { id: string; children: any[] }[]): string[] => nodes.flatMap((n) => [n.id, ...ids(n.children)]);

describe('getPageSummaryTree', () => {
  it('is the same tree as getPageTree, without the bodies and without reading them', async () => {
    const notes = await pages.createPage(null, 'Notes');
    const child = await pages.createPage(notes.id, 'Chain Ladder');
    await pages.updatePage(child.id, { content: '{"type":"doc","content":[{"type":"paragraph"}]}' });
    await dbs.ensureWorkspaceDatabase('page-properties');

    const full = await pages.getPageTree();
    queries.length = 0;
    const summary = await pages.getPageSummaryTree();

    expect(ids(summary)).toEqual(ids(full));
    expect(summary[0].children[0].title).toBe('Chain Ladder');
    expect(summary[0].children[0].updatedAt).toBe(full[0].children[0].updatedAt);
    for (const node of [...summary, ...summary[0].children]) expect(node).not.toHaveProperty('content');

    const pageQueries = queries.filter((q) => /FROM pages/i.test(q));
    expect(pageQueries.length).toBeGreaterThan(0);
    for (const q of pageQueries) {
      expect(q).not.toMatch(/SELECT \*/i);
      expect(q).not.toMatch(/\bcontent\b/);
    }
  });
});

describe('row mapping', () => {
  it('a summary row maps every column but content; a full row adds the body', () => {
    const row = { id: 'p1', parent_id: null, title: 'T', icon: null, content: '{"x":1}', content_schema_version: 2, revision: 3,
      sort_order: 1, is_archived: 0, cover_url: null, cover_y_offset: 0.5, font_family: 'default', full_width: 1,
      small_text: 0, is_locked: 0, is_favorited: 1, created_at: 'c', updated_at: 'u' };
    const summary = rowToPageSummary(row);
    expect(summary).not.toHaveProperty('content');
    expect(summary.fullWidth).toBe(true);
    expect(summary.isFavorited).toBe(true);
    expect(rowToPage(row)).toEqual({ ...summary, content: '{"x":1}' });
  });

  it('the summary column list names everything rowToPageSummary reads, and never content', () => {
    const columns = PAGE_SUMMARY_COLUMNS.split(',').map((c) => c.trim());
    expect(columns).not.toContain('content');
    const read = new Set(['id', 'parent_id', 'title', 'icon', 'content_schema_version', 'revision', 'sort_order', 'is_archived',
      'cover_url', 'cover_y_offset', 'font_family', 'full_width', 'small_text', 'is_locked', 'is_favorited', 'created_at', 'updated_at']);
    expect(new Set(columns)).toEqual(read);
  });
});
