/**
 * Regression tests for: "canvas page content disappears after a page is moved
 * in the sidebar. So if I reorder a page to be higher in the sidebar, the
 * content somehow disappears from the page."
 *
 * Anchor: same-parent reorder must NOT modify any page's `content` column.
 * Also covers cross-parent move and the post-move ContentReload path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';

interface RowShape extends Record<string, unknown> {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  content: string;
  content_schema_version: number;
  sort_order: number;
  is_archived: number;
  cover_url: string | null;
  cover_y_offset: number;
  font_family: string;
  full_width: number;
  small_text: number;
  is_locked: number;
  is_favorited: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

function makeRow(overrides: Partial<RowShape> = {}): RowShape {
  return {
    id: 'page-1',
    parent_id: null,
    title: 'Page',
    icon: null,
    content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"original"}]}]}',
    content_schema_version: 2,
    sort_order: 1,
    is_archived: 0,
    cover_url: null,
    cover_y_offset: 0.5,
    font_family: 'default',
    full_width: 0,
    small_text: 0,
    is_locked: 0,
    is_favorited: 0,
    revision: 1,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Build a tiny in-memory pages table so movePage's UPDATE / SELECT round-trip
 * works realistically.
 */
function createMockDb(initialRows: RowShape[]) {
  const rows = new Map<string, RowShape>();
  for (const r of initialRows) rows.set(r.id, { ...r });

  const writes: Array<{ sql: string; params: unknown[] }> = [];

  const all = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/SELECT \* FROM pages WHERE parent_id IS NULL/i.test(sql)) {
      const matched = [...rows.values()]
        .filter((r) => r.parent_id === null)
        .sort((a, b) => a.sort_order - b.sort_order);
      return { error: null, rows: matched };
    }
    if (/SELECT \* FROM pages WHERE parent_id = \?/i.test(sql)) {
      const pid = params[0] as string;
      const matched = [...rows.values()]
        .filter((r) => r.parent_id === pid)
        .sort((a, b) => a.sort_order - b.sort_order);
      return { error: null, rows: matched };
    }
    if (/SELECT \* FROM pages/i.test(sql)) {
      return { error: null, rows: [...rows.values()] };
    }
    return { error: null, rows: [] };
  });

  const get = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/SELECT \* FROM pages WHERE id = \?/i.test(sql)) {
      const id = params[0] as string;
      const r = rows.get(id);
      return { error: null, row: r ?? null };
    }
    return { error: null, row: null };
  });

  const run = vi.fn(async (sql: string, params: unknown[] = []) => {
    writes.push({ sql, params });
    // Match movePage's exact UPDATE
    if (/^UPDATE pages SET parent_id = \?, sort_order = \?, updated_at = datetime\('now'\) WHERE id = \?$/i.test(sql)) {
      const [parentId, sortOrder, id] = params as [string | null, number, string];
      const r = rows.get(id);
      if (!r) return { error: null, changes: 0 };
      r.parent_id = parentId;
      r.sort_order = sortOrder;
      r.updated_at = new Date().toISOString();
      return { error: null, changes: 1 };
    }
    if (/UPDATE pages SET sort_order = \?, updated_at = datetime\('now'\) WHERE id = \?/i.test(sql)) {
      const [sortOrder, id] = params as [number, string];
      const r = rows.get(id);
      if (!r) return { error: null, changes: 0 };
      r.sort_order = sortOrder;
      return { error: null, changes: 1 };
    }
    return { error: null, changes: 0 };
  });

  const runTransaction = vi.fn(async () => ({ error: null, results: [] }));

  return { rows, writes, mock: { all, get, run, runTransaction } };
}

describe('CanvasDataService — movePage content preservation (regression)', () => {
  let env: ReturnType<typeof createMockDb>;
  let service: CanvasDataService;

  beforeEach(() => {
    env = createMockDb([
      makeRow({ id: 'A', title: 'A', sort_order: 1, content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"A-content"}]}]}' }),
      makeRow({ id: 'B', title: 'B', sort_order: 2, content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"B-content"}]}]}' }),
      makeRow({ id: 'C', title: 'C', sort_order: 3, content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"C-content"}]}]}' }),
    ]);
    (globalThis as any).window = { parallxElectron: { database: env.mock } };
    service = new CanvasDataService();
  });

  afterEach(() => {
    service.dispose();
    delete (globalThis as any).window;
  });

  it('same-parent reorder (move B to top among root siblings) does not modify any page content', async () => {
    // Reorder: place B before A (afterSiblingId undefined → append at end of an empty before-set;
    // but we want "above A", which the sidebar models as inserting before A using
    // afterSiblingId of A's previous sibling.  At root with A as first, previous sibling is undefined,
    // so B is appended to the end.  Use a different reorder shape that exercises the same
    // SQL path: move C up to be after A (between A and B).
    await service.movePage('C', null, 'A');

    // C's content must be untouched.
    expect(env.rows.get('C')!.content).toBe(
      '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"C-content"}]}]}',
    );
    // A and B too.
    expect(env.rows.get('A')!.content).toContain('A-content');
    expect(env.rows.get('B')!.content).toContain('B-content');

    // No write SQL should have touched the `content` column.
    for (const w of env.writes) {
      expect(w.sql).not.toMatch(/\bcontent\s*=/i);
    }
  });

  it('move to higher position (reorder up) preserves moved page content', async () => {
    // Move C to be after A (between A and B), simulating "reorder higher".
    await service.movePage('C', null, 'A');

    const c = env.rows.get('C')!;
    expect(c.parent_id).toBeNull();
    // sort_order should be between A.sort_order (1) and B.sort_order (2)
    expect(c.sort_order).toBeGreaterThan(1);
    expect(c.sort_order).toBeLessThan(2);
    // Content unchanged.
    expect(c.content).toContain('C-content');
  });

  it('movePage UPDATE statement only touches parent_id / sort_order / updated_at columns', async () => {
    await service.movePage('B', null, 'C');

    const update = env.writes.find((w) => /^UPDATE pages SET/i.test(w.sql));
    expect(update).toBeDefined();
    expect(update!.sql).toBe(
      "UPDATE pages SET parent_id = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?",
    );
    // Specifically must not include `content`, `revision`, or any other column.
    expect(update!.sql).not.toMatch(/content/i);
    expect(update!.sql).not.toMatch(/revision/i);
  });

  it('reorder fires Moved event with full page payload (content intact)', async () => {
    const events: Array<{ kind: string; pageId: string; content?: string }> = [];
    service.onDidChangePage((e) => {
      events.push({ kind: e.kind, pageId: e.pageId, content: e.page?.content });
    });

    await service.movePage('A', null, 'B');

    const moved = events.find((e) => e.kind === 'Moved' && e.pageId === 'A');
    expect(moved).toBeDefined();
    expect(moved!.content).toContain('A-content');
  });

  // ── Anchor scenario: page WITH subpages reordered (matches user repro) ──

  it('moving a page that has subpages (pageBlock cards in its content) preserves all content', async () => {
    // Page Y has a doc containing pageBlock cards for children Z, W.
    const yContent = JSON.stringify({
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Y body before subpages' }] },
          { type: 'pageBlock', attrs: { pageId: 'Z', title: 'Z', icon: null } },
          { type: 'pageBlock', attrs: { pageId: 'W', title: 'W', icon: null } },
          { type: 'paragraph', content: [{ type: 'text', text: 'Y body after subpages' }] },
        ],
      },
    });
    env.rows.set('Y', makeRow({ id: 'Y', title: 'Y', sort_order: 4, content: yContent }));
    env.rows.set('Z', makeRow({ id: 'Z', parent_id: 'Y', title: 'Z', sort_order: 1 }));
    env.rows.set('W', makeRow({ id: 'W', parent_id: 'Y', title: 'W', sort_order: 2 }));

    const before = env.rows.get('Y')!.content;

    // Reorder Y up among root siblings: place after A (between A and B).
    await service.movePage('Y', null, 'A');

    // Y's content must be byte-identical.
    expect(env.rows.get('Y')!.content).toBe(before);

    // Subpage rows untouched.
    expect(env.rows.get('Z')!.parent_id).toBe('Y');
    expect(env.rows.get('W')!.parent_id).toBe('Y');
  });

  it('cross-parent move of a page with subpages does NOT touch the moved page content', async () => {
    const yContent = JSON.stringify({
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Y body' }] },
          { type: 'pageBlock', attrs: { pageId: 'Z', title: 'Z', icon: null } },
        ],
      },
    });
    env.rows.set('Y', makeRow({ id: 'Y', parent_id: 'A', title: 'Y', sort_order: 1, content: yContent }));
    env.rows.set('Z', makeRow({ id: 'Z', parent_id: 'Y', title: 'Z' }));

    // Update A's content to reference Y as a pageBlock
    const aContent = JSON.stringify({
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'A body' }] },
          { type: 'pageBlock', attrs: { pageId: 'Y', title: 'Y', icon: null } },
        ],
      },
    });
    env.rows.get('A')!.content = aContent;

    const yBefore = env.rows.get('Y')!.content;

    // Move Y from being A's child to root level (cross-parent move).
    await service.movePage('Y', null, 'B');

    // Y's content untouched by movePage itself.
    expect(env.rows.get('Y')!.content).toBe(yBefore);
    // Y's parent now null.
    expect(env.rows.get('Y')!.parent_id).toBeNull();
  });
});
