/**
 * M77 Phase 1 — atomic page-hierarchy operations.
 *
 * Locks in the fix for the dual-write inconsistency between DB parent_id
 * and embedded pageBlock nodes. Each test reproduces a scenario where the
 * legacy two-step flow could fail partially; the atomic helpers either
 * apply every write or none.
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

function emptyDoc(): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
}

function docWithPageBlock(childIds: string[]): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph' },
      ...childIds.map((id) => ({ type: 'pageBlock', attrs: { pageId: id, title: 'Child', icon: null } })),
    ],
  });
}

function makeRow(overrides: Partial<RowShape> = {}): RowShape {
  return {
    id: 'page-1',
    parent_id: null,
    title: 'Page',
    icon: null,
    content: emptyDoc(),
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
 * In-memory pages table. Handles SELECT, INSERT, UPDATE and runTransaction
 * — runTransaction actually applies each op against the same store so we
 * can assert on the final state rather than just the SQL strings.
 */
function createMockDb(initialRows: RowShape[]) {
  const rows = new Map<string, RowShape>();
  for (const r of initialRows) rows.set(r.id, { ...r });

  const writes: Array<{ sql: string; params: unknown[] }> = [];

  function runSync(sql: string, params: unknown[]): { error: null; changes: number; lastInsertRowid?: number } {
    writes.push({ sql, params });
    if (/^INSERT INTO pages /i.test(sql)) {
      const [id, parent, title, content, schemaVersion, sortOrder] = params as [
        string, string | null, string, string, number, number,
      ];
      const row = makeRow({
        id, parent_id: parent, title, content,
        content_schema_version: schemaVersion, sort_order: sortOrder, revision: 1,
      });
      rows.set(id, row);
      return { error: null, changes: 1 };
    }
    if (/UPDATE pages SET parent_id = \?, sort_order = \?, updated_at = datetime\('now'\) WHERE id = \?/i.test(sql)) {
      const [parentId, sortOrder, id] = params as [string | null, number, string];
      const r = rows.get(id);
      if (!r) return { error: null, changes: 0 };
      r.parent_id = parentId;
      r.sort_order = sortOrder;
      r.updated_at = new Date().toISOString();
      return { error: null, changes: 1 };
    }
    // Any content-touching UPDATE with a revision guard. Covers both
    // movePageWithBlocks' inline transaction SQL and updatePage's
    // dynamic SET-clause order.
    if (/^UPDATE pages\s+SET .*content = \?.*WHERE id = \? AND revision = \?/is.test(sql)) {
      // Params order: [content, schemaVersion, ...maybeOthers, id, expectedRevision]
      const last = params.length;
      const expectedRevision = params[last - 1] as number;
      const id = params[last - 2] as string;
      const content = params[0] as string;
      const schemaVersion = params[1] as number;
      const r = rows.get(id);
      if (!r) return { error: null, changes: 0 };
      if (r.revision !== expectedRevision) return { error: null, changes: 0 };
      r.content = content;
      r.content_schema_version = schemaVersion;
      r.revision = r.revision + 1;
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
  }

  function getSync(sql: string, params: unknown[]): { error: null; row: RowShape | null | Record<string, unknown> } {
    if (/SELECT \* FROM pages WHERE id = \?/i.test(sql)) {
      const id = params[0] as string;
      return { error: null, row: rows.get(id) ?? null };
    }
    if (/SELECT MAX\(sort_order\) as max_sort FROM pages WHERE parent_id IS NULL/i.test(sql)) {
      const max = Math.max(0, ...[...rows.values()].filter((r) => r.parent_id === null).map((r) => r.sort_order));
      return { error: null, row: { max_sort: max } };
    }
    if (/SELECT MAX\(sort_order\) as max_sort FROM pages WHERE parent_id = \?/i.test(sql)) {
      const pid = params[0] as string;
      const max = Math.max(0, ...[...rows.values()].filter((r) => r.parent_id === pid).map((r) => r.sort_order));
      return { error: null, row: { max_sort: max } };
    }
    return { error: null, row: null };
  }

  const all = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/WITH RECURSIVE subtree/i.test(sql)) {
      // Recursive subtree query: collect rootPageId + all transitive descendants.
      const rootId = params[0] as string;
      const collected = new Set<string>();
      const queue = [rootId];
      while (queue.length > 0) {
        const cur = queue.shift() as string;
        if (collected.has(cur)) continue;
        collected.add(cur);
        for (const r of rows.values()) {
          if (r.parent_id === cur) queue.push(r.id);
        }
      }
      return { error: null, rows: Array.from(collected).map((id) => ({ id })) };
    }
    if (/SELECT \* FROM pages WHERE parent_id IS NULL/i.test(sql)) {
      return {
        error: null,
        rows: [...rows.values()].filter((r) => r.parent_id === null).sort((a, b) => a.sort_order - b.sort_order),
      };
    }
    if (/SELECT \* FROM pages WHERE parent_id = \?/i.test(sql)) {
      const pid = params[0] as string;
      return {
        error: null,
        rows: [...rows.values()].filter((r) => r.parent_id === pid).sort((a, b) => a.sort_order - b.sort_order),
      };
    }
    if (/SELECT \* FROM pages/i.test(sql)) {
      return { error: null, rows: [...rows.values()] };
    }
    return { error: null, rows: [] };
  });

  const get = vi.fn(async (sql: string, params: unknown[] = []) => getSync(sql, params));
  const run = vi.fn(async (sql: string, params: unknown[] = []) => runSync(sql, params));

  const runTransaction = vi.fn(async (ops: Array<{ type: string; sql: string; params?: unknown[] }>) => {
    const results: unknown[] = [];
    for (const op of ops) {
      if (op.type === 'run') results.push(runSync(op.sql, op.params ?? []));
      else if (op.type === 'get') results.push(getSync(op.sql, op.params ?? []));
      else results.push({ error: null, rows: [] });
    }
    return { error: null, results };
  });

  return { rows, writes, mock: { all, get, run, runTransaction } };
}

describe('CanvasDataService — movePageWithBlocks (M77 Phase 1)', () => {
  let env: ReturnType<typeof createMockDb>;
  let service: CanvasDataService;

  beforeEach(() => {
    env = createMockDb([
      makeRow({ id: 'A', title: 'A', sort_order: 1, content: emptyDoc() }),
      makeRow({ id: 'B', title: 'B', sort_order: 2, content: docWithPageBlock(['child']) }),
      makeRow({ id: 'C', title: 'C', sort_order: 3, content: emptyDoc() }),
      makeRow({ id: 'child', title: 'Child', parent_id: 'B', sort_order: 1, content: emptyDoc() }),
    ]);
    (globalThis as any).window = { parallxElectron: { database: env.mock } };
    service = new CanvasDataService();
  });

  afterEach(() => {
    service.dispose();
    delete (globalThis as any).window;
  });

  it('removes block from old parent and adds block to new parent in one transaction', async () => {
    await service.movePageWithBlocks({
      pageId: 'child',
      newParentId: 'A',
    });

    // child now belongs to A
    expect(env.rows.get('child')!.parent_id).toBe('A');
    // B no longer has child's pageBlock
    expect(env.rows.get('B')!.content).not.toContain('"pageId":"child"');
    // A now contains child's pageBlock
    expect(env.rows.get('A')!.content).toContain('"pageId":"child"');
  });

  it('uses a single runTransaction call for the move + both content updates', async () => {
    await service.movePageWithBlocks({ pageId: 'child', newParentId: 'A' });

    // The transaction should fire exactly once for the move.
    expect(env.mock.runTransaction).toHaveBeenCalledTimes(1);
    const [opsArg] = env.mock.runTransaction.mock.calls[0];
    const ops = opsArg as Array<{ sql: string }>;
    // Expect three ops: page row update + old parent content + new parent content.
    expect(ops.length).toBe(3);
    expect(ops[0].sql).toMatch(/UPDATE pages SET parent_id = /);
    expect(ops[1].sql).toMatch(/UPDATE pages[\s\S]*SET content = /);
    expect(ops[2].sql).toMatch(/UPDATE pages[\s\S]*SET content = /);
  });

  it('skips content rewrites when the parent does not change (reorder within same parent)', async () => {
    await service.movePageWithBlocks({
      pageId: 'C',
      newParentId: null,
      afterSiblingId: 'A',
    });

    // No content writes — only sort_order on C
    const contentWrites = env.writes.filter((w) => /UPDATE pages.*SET content/i.test(w.sql));
    expect(contentWrites).toHaveLength(0);
    expect(env.rows.get('C')!.sort_order).toBeGreaterThan(1);
    expect(env.rows.get('C')!.sort_order).toBeLessThan(2);
  });

  it('skips redundant updates when new parent has no block and there is nothing to remove from old', async () => {
    // Move a page whose old parent has no pageBlock for it.
    // A has child=null in content; move A under C.
    await service.movePageWithBlocks({ pageId: 'A', newParentId: 'C' });
    // A's parent_id updated
    expect(env.rows.get('A')!.parent_id).toBe('C');
    // Only ONE op in the transaction: the page row update (no old parent
    // content because A wasn't in any parent's content, and the new
    // parent C gets A's pageBlock appended).
    const [opsArg] = env.mock.runTransaction.mock.calls[0];
    const ops = opsArg as Array<{ sql: string }>;
    // page row + new parent content = 2 ops; no old parent content op
    // because A was at root and there is no root "page" to update.
    expect(ops.length).toBe(2);
    expect(ops[1].sql).toMatch(/UPDATE pages[\s\S]*SET content = /);
  });

  it('rejects cycle: cannot move page into its own subtree', async () => {
    await expect(
      service.movePageWithBlocks({ pageId: 'B', newParentId: 'child' }),
    ).rejects.toThrow(/Cannot move/);
  });
});

describe('CanvasDataService — createChildPageWithBlock (M77 Phase 1)', () => {
  let env: ReturnType<typeof createMockDb>;
  let service: CanvasDataService;

  beforeEach(() => {
    env = createMockDb([
      makeRow({ id: 'parent', title: 'Parent', content: emptyDoc() }),
    ]);
    (globalThis as any).window = { parallxElectron: { database: env.mock } };
    service = new CanvasDataService();
  });

  afterEach(() => {
    service.dispose();
    delete (globalThis as any).window;
  });

  it('inserts the page and adds a pageBlock to the parent in a single transaction', async () => {
    const created = await service.createChildPageWithBlock({ parentId: 'parent', title: 'New' });
    expect(created.parentId).toBe('parent');
    expect(created.title).toBe('New');

    // Parent now contains a pageBlock pointing at the new page.
    expect(env.rows.get('parent')!.content).toContain(`"pageId":"${created.id}"`);

    // Single runTransaction with INSERT + UPDATE.
    expect(env.mock.runTransaction).toHaveBeenCalledTimes(1);
    const [opsArg] = env.mock.runTransaction.mock.calls[0];
    const ops = opsArg as Array<{ sql: string }>;
    expect(ops.length).toBe(2);
    expect(ops[0].sql).toMatch(/INSERT INTO pages/);
    expect(ops[1].sql).toMatch(/UPDATE pages[\s\S]*SET content = /);
  });

  it('omits the parent content update when parentId is null (root-level page)', async () => {
    await service.createChildPageWithBlock({ parentId: null, title: 'Root page' });
    const [opsArg] = env.mock.runTransaction.mock.calls[0];
    const ops = opsArg as Array<{ sql: string }>;
    expect(ops.length).toBe(1);
    expect(ops[0].sql).toMatch(/INSERT INTO pages/);
  });
});

describe('CanvasDataService — reconcileParentBlockState (M77 Phase 1)', () => {
  let env: ReturnType<typeof createMockDb>;
  let service: CanvasDataService;

  beforeEach(() => {
    env = createMockDb([
      // Parent has TWO pageBlocks: one valid (validChild belongs to it),
      // one orphan (orphanChild was moved away to root).
      makeRow({
        id: 'parent',
        title: 'Parent',
        content: docWithPageBlock(['validChild', 'orphanChild']),
      }),
      makeRow({ id: 'validChild', parent_id: 'parent', sort_order: 1 }),
      // orphanChild is at root, not under 'parent'
      makeRow({ id: 'orphanChild', parent_id: null, sort_order: 1 }),
    ]);
    (globalThis as any).window = { parallxElectron: { database: env.mock } };
    service = new CanvasDataService();
  });

  afterEach(() => {
    service.dispose();
    delete (globalThis as any).window;
  });

  it('removes orphan pageBlocks and leaves valid ones in place', async () => {
    const removed = await service.reconcileParentBlockState('parent');
    expect(removed).toBe(1);

    const parent = env.rows.get('parent')!;
    expect(parent.content).toContain('"pageId":"validChild"');
    expect(parent.content).not.toContain('"pageId":"orphanChild"');
  });

  it('returns 0 and does not write when no orphans exist', async () => {
    // Start fresh — set up parent with only a valid block.
    env = createMockDb([
      makeRow({ id: 'parent', title: 'Parent', content: docWithPageBlock(['validChild']) }),
      makeRow({ id: 'validChild', parent_id: 'parent' }),
    ]);
    (globalThis as any).window = { parallxElectron: { database: env.mock } };
    service.dispose();
    service = new CanvasDataService();

    const removed = await service.reconcileParentBlockState('parent');
    expect(removed).toBe(0);

    // No content writes happened.
    const contentWrites = env.writes.filter((w) => /UPDATE pages.*SET content/i.test(w.sql));
    expect(contentWrites).toHaveLength(0);
  });

  it('returns 0 for a missing page', async () => {
    const removed = await service.reconcileParentBlockState('nonexistent');
    expect(removed).toBe(0);
  });
});
