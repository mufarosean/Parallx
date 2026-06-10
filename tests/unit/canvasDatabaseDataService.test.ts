import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { PageChangeKind } from '../../src/built-in/canvas/canvasTypes';

// ── In-memory store for the five database tables + a fake page service ──

function makeEnv() {
  const databases = new Map<string, Record<string, unknown>>();
  const props: Record<string, unknown>[] = [];
  const views: Record<string, unknown>[] = [];
  const members: Record<string, unknown>[] = [];
  const values: Record<string, unknown>[] = [];
  const pages = new Map<string, { id: string; parentId: string | null; title: string; icon: string | null; archived: boolean }>();

  function runSync(sql: string, params: unknown[] = []): { error: null; changes: number } {
    if (/^INSERT INTO databases/i.test(sql)) {
      databases.set(params[0] as string, { id: params[0], page_id: params[1], description: null, is_locked: 0, created_at: 'now', updated_at: 'now' });
      return { error: null, changes: 1 };
    }
    if (/^INSERT INTO database_properties/i.test(sql)) {
      props.push({ id: params[0], database_id: params[1], name: params[2], type: params[3], config: params[4], sort_order: params[5] });
      return { error: null, changes: 1 };
    }
    if (/^INSERT INTO database_views/i.test(sql)) {
      views.push({ id: params[0], database_id: params[1], name: params[2], type: params[3], sort_order: params[4], group_by: null, hide_empty_groups: 0, filter_config: '{"conjunction":"and","rules":[]}', sort_config: '[]', config: '{}' });
      return { error: null, changes: 1 };
    }
    if (/^INSERT INTO database_pages/i.test(sql)) {
      members.push({ database_id: params[0], page_id: params[1], sort_order: params[2] });
      return { error: null, changes: 1 };
    }
    if (/^INSERT INTO page_property_values/i.test(sql)) {
      const [pageId, propertyId, databaseId, value] = params as string[];
      const existing = values.find((v) => v.page_id === pageId && v.property_id === propertyId && v.database_id === databaseId);
      if (existing) existing.value = value;
      else values.push({ page_id: pageId, property_id: propertyId, database_id: databaseId, value });
      return { error: null, changes: 1 };
    }
    if (/^UPDATE database_properties SET/i.test(sql)) {
      const id = params[params.length - 2]; const dbId = params[params.length - 1];
      const p = props.find((x) => x.id === id && x.database_id === dbId);
      if (p && /name = \?/.test(sql)) p.name = params[0];
      return { error: null, changes: p ? 1 : 0 };
    }
    if (/^UPDATE database_views SET/i.test(sql)) return { error: null, changes: 1 };
    if (/^DELETE FROM page_property_values WHERE property_id/i.test(sql)) {
      for (let i = values.length - 1; i >= 0; i--) if (values[i].property_id === params[0] && values[i].database_id === params[1]) values.splice(i, 1);
      return { error: null, changes: 1 };
    }
    if (/^DELETE FROM page_property_values WHERE page_id/i.test(sql)) {
      for (let i = values.length - 1; i >= 0; i--) if (values[i].page_id === params[0] && values[i].database_id === params[1]) values.splice(i, 1);
      return { error: null, changes: 1 };
    }
    if (/^DELETE FROM page_property_values WHERE database_id/i.test(sql)) {
      for (let i = values.length - 1; i >= 0; i--) if (values[i].database_id === params[0]) values.splice(i, 1);
      return { error: null, changes: 1 };
    }
    if (/^DELETE FROM database_properties WHERE id/i.test(sql)) {
      const i = props.findIndex((x) => x.id === params[0] && x.database_id === params[1]);
      if (i >= 0) props.splice(i, 1);
      return { error: null, changes: 1 };
    }
    if (/^DELETE FROM database_properties WHERE database_id/i.test(sql)) {
      for (let i = props.length - 1; i >= 0; i--) if (props[i].database_id === params[0]) props.splice(i, 1);
      return { error: null, changes: 1 };
    }
    if (/^DELETE FROM database_views WHERE id/i.test(sql)) {
      const i = views.findIndex((x) => x.id === params[0] && x.database_id === params[1]);
      if (i >= 0) views.splice(i, 1);
      return { error: null, changes: 1 };
    }
    if (/^DELETE FROM database_views WHERE database_id/i.test(sql)) {
      for (let i = views.length - 1; i >= 0; i--) if (views[i].database_id === params[0]) views.splice(i, 1);
      return { error: null, changes: 1 };
    }
    if (/^DELETE FROM database_pages WHERE database_id = \? AND page_id/i.test(sql)) {
      const i = members.findIndex((x) => x.database_id === params[0] && x.page_id === params[1]);
      if (i >= 0) members.splice(i, 1);
      return { error: null, changes: 1 };
    }
    if (/^DELETE FROM database_pages WHERE database_id/i.test(sql)) {
      for (let i = members.length - 1; i >= 0; i--) if (members[i].database_id === params[0]) members.splice(i, 1);
      return { error: null, changes: 1 };
    }
    if (/^DELETE FROM databases WHERE id/i.test(sql)) {
      databases.delete(params[0] as string);
      return { error: null, changes: 1 };
    }
    return { error: null, changes: 0 };
  }

  const bridge = {
    run: vi.fn(async (sql: string, params: unknown[] = []) => runSync(sql, params)),
    get: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/SELECT MAX\(sort_order\) as max_sort FROM database_pages/i.test(sql)) {
        const max = Math.max(0, ...members.filter((m) => m.database_id === params[0]).map((m) => m.sort_order as number));
        return { error: null, row: { max_sort: max } };
      }
      if (/FROM databases d JOIN pages p/i.test(sql)) {
        const d = databases.get(params[0] as string);
        const p = pages.get(params[0] as string);
        if (!d || !p) return { error: null, row: null };
        return { error: null, row: { ...d, title: p.title, icon: p.icon } };
      }
      return { error: null, row: null };
    }),
    all: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/SELECT id FROM databases/i.test(sql)) return { error: null, rows: [...databases.keys()].map((id) => ({ id })) };
      if (/FROM database_properties WHERE database_id/i.test(sql)) {
        return { error: null, rows: props.filter((p) => p.database_id === params[0]).sort((a, b) => (a.sort_order as number) - (b.sort_order as number)) };
      }
      if (/FROM database_views WHERE database_id/i.test(sql)) {
        return { error: null, rows: views.filter((v) => v.database_id === params[0]).sort((a, b) => (a.sort_order as number) - (b.sort_order as number)) };
      }
      if (/FROM database_pages dp JOIN pages p/i.test(sql)) {
        return {
          error: null,
          rows: members
            .filter((m) => m.database_id === params[0])
            .map((m) => {
              const p = pages.get(m.page_id as string);
              return p && !p.archived
                ? { page_id: p.id, sort_order: m.sort_order, title: p.title, icon: p.icon, created_at: 'now', updated_at: 'now' }
                : null;
            })
            .filter(Boolean) as Record<string, unknown>[],
        };
      }
      if (/FROM page_property_values WHERE database_id/i.test(sql)) {
        return { error: null, rows: values.filter((v) => v.database_id === params[0]) };
      }
      return { error: null, rows: [] };
    }),
    runTransaction: vi.fn(async (ops: { type: string; sql: string; params?: unknown[] }[]) => {
      const results = ops.map((op) => (op.type === 'run' ? runSync(op.sql, op.params ?? []) : { error: null }));
      return { error: null, results };
    }),
  };

  const pageListeners: ((e: { kind: PageChangeKind; pageId: string }) => void)[] = [];
  let nextPage = 0;
  const pagesService = {
    onDidChangePage: (fn: (e: { kind: PageChangeKind; pageId: string }) => void) => { pageListeners.push(fn); return { dispose() {} }; },
    createPage: vi.fn(async (parentId?: string | null, title?: string) => {
      const id = `page-${++nextPage}`;
      pages.set(id, { id, parentId: parentId ?? null, title: title || 'Untitled', icon: null, archived: false });
      return { id, title: title || 'Untitled', icon: null, parentId: parentId ?? null, createdAt: 'now', updatedAt: 'now' };
    }),
    createChildPageWithBlock: vi.fn(async ({ parentId, title }: { parentId: string; title?: string }) => {
      const id = `page-${++nextPage}`;
      pages.set(id, { id, parentId, title: title || 'Untitled', icon: null, archived: false });
      return { id, title: title || 'Untitled', icon: null, parentId, createdAt: 'now', updatedAt: 'now' };
    }),
    archivePage: vi.fn(async (id: string) => { const p = pages.get(id); if (p) p.archived = true; }),
    updatePage: vi.fn(async (id: string, patch: { title?: string }) => {
      const p = pages.get(id)!; if (patch.title) p.title = patch.title; return p;
    }),
  };

  return { bridge, pagesService, pages, databases, props, views, members, values, firePageEvent: (e: { kind: PageChangeKind; pageId: string }) => pageListeners.forEach((f) => f(e)) };
}

let env: ReturnType<typeof makeEnv>;
let svc: DatabaseDataService;

beforeEach(() => {
  env = makeEnv();
  (globalThis as any).window = { parallxElectron: { database: env.bridge } };
  svc = new DatabaseDataService(env.pagesService as never);
});
afterEach(() => { svc.dispose(); delete (globalThis as any).window; });

describe('DatabaseDataService', () => {
  it('createDatabase seeds the page, a Status select property, and a default table view', async () => {
    const db = await svc.createDatabase({ title: 'Projects' });
    expect(env.databases.has(db.id)).toBe(true);
    const props = await svc.listProperties(db.id);
    expect(props).toHaveLength(1);
    expect(props[0].name).toBe('Status');
    expect(props[0].type).toBe('select');
    expect((props[0].config as { options: { value: string }[] }).options.map((o) => o.value)).toEqual(['To do', 'In progress', 'Done']);
    const views = await svc.listViews(db.id);
    expect(views).toHaveLength(1);
    expect(views[0].type).toBe('table');
    expect(svc.isDatabase(db.id)).toBe(true);
  });

  it('addRow creates a CHILD page of the database + membership; listRows assembles values', async () => {
    const db = await svc.createDatabase({ title: 'T' });
    const [status] = await svc.listProperties(db.id);
    const row = await svc.addRow(db.id, 'Task one');

    expect(env.pages.get(row.pageId)!.parentId).toBe(db.id); // sidebar nesting for free
    await svc.setCellValue(db.id, row.pageId, status.id, 'Done');

    const rows = await svc.listRows(db.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Task one');
    expect(rows[0].values[status.id]).toBe('Done');
  });

  it('setCellValue upserts (second write replaces, not duplicates)', async () => {
    const db = await svc.createDatabase({});
    const [status] = await svc.listProperties(db.id);
    const row = await svc.addRow(db.id);
    await svc.setCellValue(db.id, row.pageId, status.id, 'To do');
    await svc.setCellValue(db.id, row.pageId, status.id, 'Done');
    const rows = await svc.listRows(db.id);
    expect(rows[0].values[status.id]).toBe('Done');
    expect(env.values).toHaveLength(1);
  });

  it('removeRow drops membership + values and archives the page; archived rows vanish from listRows', async () => {
    const db = await svc.createDatabase({});
    const [status] = await svc.listProperties(db.id);
    const row = await svc.addRow(db.id, 'Doomed');
    await svc.setCellValue(db.id, row.pageId, status.id, 'To do');

    await svc.removeRow(db.id, row.pageId);

    expect(env.pages.get(row.pageId)!.archived).toBe(true);
    expect(await svc.listRows(db.id)).toHaveLength(0);
    expect(env.values).toHaveLength(0);
  });

  it('deleteProperty removes the column and its cell values', async () => {
    const db = await svc.createDatabase({});
    const est = await svc.addProperty(db.id, 'Estimate', 'number');
    const row = await svc.addRow(db.id);
    await svc.setCellValue(db.id, row.pageId, est.id, 5);

    await svc.deleteProperty(db.id, est.id);
    expect(await svc.listProperties(db.id)).toHaveLength(1); // Status remains
    expect(env.values).toHaveLength(0);
  });

  it('refuses to delete the last view; self-heals a view-less database', async () => {
    const db = await svc.createDatabase({});
    const [view] = await svc.listViews(db.id);
    await expect(svc.deleteView(db.id, view.id)).rejects.toThrow(/at least one view/);

    const board = await svc.addView(db.id, 'Board', 'board');
    await svc.deleteView(db.id, view.id); // now allowed
    const remaining = await svc.listViews(db.id);
    expect(remaining.map((v) => v.id)).toEqual([board.id]);
  });

  it('cleans up all database tables when the database PAGE is deleted (self-healing)', async () => {
    const db = await svc.createDatabase({});
    const row = await svc.addRow(db.id);
    const [status] = await svc.listProperties(db.id);
    await svc.setCellValue(db.id, row.pageId, status.id, 'To do');

    env.firePageEvent({ kind: PageChangeKind.Deleted, pageId: db.id });
    await new Promise((r) => setTimeout(r, 0)); // cleanup is async

    expect(env.databases.size).toBe(0);
    expect(env.props).toHaveLength(0);
    expect(env.views).toHaveLength(0);
    expect(env.members).toHaveLength(0);
    expect(env.values).toHaveLength(0);
    expect(svc.isDatabase(db.id)).toBe(false);
  });

  it('view updates persist filter/sort/groupBy round-trip', async () => {
    const db = await svc.createDatabase({});
    const [view] = await svc.listViews(db.id);
    // The mock's UPDATE database_views is a no-op recorder; assert the SQL fired
    // with the JSON payloads (round-trip parsing is covered by the view model).
    await svc.updateView(db.id, view.id, {
      filter: { conjunction: 'or', rules: [{ propertyId: 'p', op: 'equals', value: 'x' }] },
      sort: [{ propertyId: '__title', dir: 'asc' }],
      groupBy: 'p',
    });
    const updateCall = env.bridge.run.mock.calls.find(([sql]) => /UPDATE database_views SET/.test(sql as string));
    expect(updateCall).toBeDefined();
    expect(String(updateCall![0])).toContain('group_by = ?');
    expect(String(updateCall![1])).toContain('"conjunction":"or"');
  });
});
