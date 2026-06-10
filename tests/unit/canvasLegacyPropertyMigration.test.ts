import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { runLegacyPropertyMigration, mapLegacyColor } from '../../src/built-in/canvas/database/legacyPropertyMigration';

// ── In-memory store: database tables + legacy tables + fake page service ──

function makeEnv() {
  const databases = new Map<string, Record<string, unknown>>();
  const props: Record<string, unknown>[] = [];
  const views: Record<string, unknown>[] = [];
  const members: Record<string, unknown>[] = [];
  const values: Record<string, unknown>[] = [];
  const pages = new Map<string, { id: string; parentId: string | null; title: string; icon: string | null; archived: boolean }>();
  // Legacy tables
  const legacyDefs: Record<string, unknown>[] = [];
  const legacyValues: Record<string, unknown>[] = [];

  function runSync(sql: string, params: unknown[] = []): { error: null; changes: number } {
    if (/^INSERT INTO databases/i.test(sql)) {
      databases.set(params[0] as string, { id: params[0], page_id: params[1] });
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
    if (/^INSERT (OR IGNORE )?INTO database_pages/i.test(sql)) {
      const exists = members.some((m) => m.database_id === params[0] && m.page_id === params[1]);
      if (exists) return { error: null, changes: 0 };
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
    return { error: null, changes: 0 };
  }

  const bridge = {
    run: vi.fn(async (sql: string, params: unknown[] = []) => runSync(sql, params)),
    get: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/SELECT MAX\(sort_order\) as max_sort FROM database_pages/i.test(sql)) {
        const max = Math.max(0, ...members.filter((m) => m.database_id === params[0]).map((m) => m.sort_order as number));
        return { error: null, row: { max_sort: max } };
      }
      if (/SELECT d\.id FROM databases d JOIN pages p/i.test(sql)) {
        for (const d of databases.values()) {
          const p = pages.get(d.id as string);
          if (p && !p.archived && p.title === params[0]) return { error: null, row: { id: d.id } };
        }
        return { error: null, row: null };
      }
      if (/FROM databases d JOIN pages p/i.test(sql)) {
        const d = databases.get(params[0] as string);
        const p = pages.get(params[0] as string);
        if (!d || !p) return { error: null, row: null };
        return { error: null, row: { ...d, description: null, is_locked: 0, created_at: 'now', updated_at: 'now', title: p.title, icon: p.icon } };
      }
      return { error: null, row: null };
    }),
    all: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM property_definitions/i.test(sql)) return { error: null, rows: [...legacyDefs] };
      if (/FROM page_properties pp JOIN pages p/i.test(sql)) {
        return {
          error: null,
          rows: legacyValues
            .filter((v) => pages.has(v.page_id as string))
            .map((v) => ({ ...v, is_archived: pages.get(v.page_id as string)!.archived ? 1 : 0 })),
        };
      }
      if (/SELECT id FROM databases/i.test(sql)) return { error: null, rows: [...databases.keys()].map((id) => ({ id })) };
      if (/FROM database_properties WHERE database_id/i.test(sql)) {
        return { error: null, rows: props.filter((p) => p.database_id === params[0]) };
      }
      if (/FROM database_views WHERE database_id/i.test(sql)) {
        return { error: null, rows: views.filter((v) => v.database_id === params[0]) };
      }
      if (/FROM database_pages dp JOIN pages p/i.test(sql)) {
        return {
          error: null,
          rows: members.filter((m) => m.database_id === params[0]).map((m) => {
            const p = pages.get(m.page_id as string)!;
            return { page_id: p.id, sort_order: m.sort_order, title: p.title, icon: p.icon, created_at: 'now', updated_at: 'now' };
          }),
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

  let nextPage = 0;
  const pagesService = {
    onDidChangePage: () => ({ dispose() {} }),
    createPage: vi.fn(async (parentId?: string | null, title?: string) => {
      const id = `db-page-${++nextPage}`;
      pages.set(id, { id, parentId: parentId ?? null, title: title || 'Untitled', icon: null, archived: false });
      return { id, title: title || 'Untitled', icon: null, parentId: parentId ?? null, createdAt: 'now', updatedAt: 'now' };
    }),
    createChildPageWithBlock: vi.fn(),
    archivePage: vi.fn(),
    updatePage: vi.fn(),
  };

  function addUserPage(id: string, title: string, archived = false): void {
    pages.set(id, { id, parentId: null, title, icon: null, archived });
  }
  function addLegacyDef(name: string, type: string, config: Record<string, unknown> = {}): void {
    legacyDefs.push({ name, type, config: JSON.stringify(config), sort_order: legacyDefs.length });
  }
  function addLegacyValue(pageId: string, key: string, value: unknown): void {
    legacyValues.push({ page_id: pageId, key, value_type: 'json', value: JSON.stringify(value) });
  }

  return { bridge, pagesService, pages, databases, props, members, values, addUserPage, addLegacyDef, addLegacyValue };
}

let env: ReturnType<typeof makeEnv>;
let svc: DatabaseDataService;
let backups: string[];

beforeEach(() => {
  env = makeEnv();
  backups = [];
  (globalThis as any).window = { parallxElectron: { database: env.bridge } };
  svc = new DatabaseDataService(env.pagesService as never);
});
afterEach(() => { svc.dispose(); delete (globalThis as any).window; });

function deps(opts: { failBackup?: boolean } = {}) {
  return {
    bridge: env.bridge,
    db: svc,
    writeBackup: async (json: string) => {
      if (opts.failBackup) throw new Error('disk full');
      backups.push(json);
    },
  };
}

describe('legacy property migration', () => {
  it('migrates tags into a Tags database and custom values into Migrated properties — backup written first, tree untouched', async () => {
    env.addLegacyDef('tags', 'tags', { options: [{ value: 'work', color: 'rgba(125, 145, 235, 0.30)' }] });
    env.addLegacyDef('priority', 'select', { options: [{ value: 'High', color: 'rgba(224, 162, 78, 0.30)' }] });
    env.addLegacyDef('created', 'datetime');
    env.addUserPage('p1', 'Project notes');
    env.addUserPage('p2', 'Reading list');
    env.addLegacyValue('p1', 'tags', ['work', 'q3']);
    env.addLegacyValue('p2', 'tags', ['reading']);
    env.addLegacyValue('p1', 'priority', 'High');
    env.addLegacyValue('p1', 'created', '2026-01-01T00:00:00Z'); // system — backup only

    const result = await runLegacyPropertyMigration(deps());
    expect(result).not.toBe('nothing-to-migrate');
    const r = result as Exclude<typeof result, string>;
    expect(r.migratedTagPages).toBe(2);
    expect(r.migratedCustomValues).toBe(1);

    // Backup captured everything, including the system rows.
    expect(backups).toHaveLength(1);
    const backup = JSON.parse(backups[0]);
    expect(backup.values).toHaveLength(4);
    expect(backup.definitions).toHaveLength(3);

    // Tags database: both pages are members with their tag values; colors mapped.
    const tagsDb = [...env.databases.keys()].find((id) => env.pages.get(id)?.title === 'Tags')!;
    expect(tagsDb).toBeDefined();
    const tagsProp = env.props.find((p) => p.database_id === tagsDb && p.name === 'Tags')!;
    expect(JSON.parse(tagsProp.config as string).options).toEqual([{ value: 'work', color: 'blue' }]);
    const tagRows = await svc.listRows(tagsDb);
    expect(tagRows.map((x) => x.pageId).sort()).toEqual(['p1', 'p2']);
    expect(tagRows.find((x) => x.pageId === 'p1')!.values[tagsProp.id as string]).toEqual(['work', 'q3']);

    // Migrated properties database holds the custom value.
    const customDb = [...env.databases.keys()].find((id) => env.pages.get(id)?.title === 'Migrated properties')!;
    const prioProp = env.props.find((p) => p.database_id === customDb && p.name === 'priority')!;
    expect(JSON.parse(prioProp.config as string).options).toEqual([{ value: 'High', color: 'orange' }]);
    const customRows = await svc.listRows(customDb);
    expect(customRows.map((x) => x.pageId)).toEqual(['p1']);

    // The user's pages did NOT move in the tree.
    expect(env.pages.get('p1')!.parentId).toBeNull();
    expect(env.pages.get('p2')!.parentId).toBeNull();
    // No Status seed on migration databases.
    expect(env.props.filter((p) => p.name === 'Status')).toHaveLength(0);
  });

  it('returns nothing-to-migrate (and writes NO backup) when only system timestamps exist', async () => {
    env.addLegacyDef('created', 'datetime');
    env.addUserPage('p1', 'A page');
    env.addLegacyValue('p1', 'created', '2026-01-01T00:00:00Z');
    env.addLegacyValue('p1', 'modified', '2026-01-02T00:00:00Z');

    expect(await runLegacyPropertyMigration(deps())).toBe('nothing-to-migrate');
    expect(backups).toHaveLength(0);
    expect(env.databases.size).toBe(0);
  });

  it('ABORTS without writing anything when the backup fails', async () => {
    env.addUserPage('p1', 'A page');
    env.addLegacyValue('p1', 'tags', ['x']);

    await expect(runLegacyPropertyMigration(deps({ failBackup: true }))).rejects.toThrow('disk full');
    expect(env.databases.size).toBe(0);
    expect(env.members).toHaveLength(0);
  });

  it('skips archived pages (backup still includes them)', async () => {
    env.addUserPage('live', 'Live page');
    env.addUserPage('dead', 'Trashed page', true);
    env.addLegacyValue('live', 'tags', ['keep']);
    env.addLegacyValue('dead', 'tags', ['gone']);

    const r = await runLegacyPropertyMigration(deps()) as { migratedTagPages: number; skippedArchived: number };
    expect(r.migratedTagPages).toBe(1);
    expect(r.skippedArchived).toBe(1);
    expect(JSON.parse(backups[0]).values).toHaveLength(2);
  });

  it('is idempotent: a second run reuses the databases and creates no duplicates', async () => {
    env.addUserPage('p1', 'Page');
    env.addLegacyValue('p1', 'tags', ['x']);

    await runLegacyPropertyMigration(deps());
    const dbCount = env.databases.size;
    const memberCount = env.members.length;
    const propCount = env.props.length;

    await runLegacyPropertyMigration(deps());
    expect(env.databases.size).toBe(dbCount);
    expect(env.members).toHaveLength(memberCount);
    expect(env.props).toHaveLength(propCount);
  });
});

describe('mapLegacyColor', () => {
  it('keeps named colors, maps known legacy rgba strings, hashes unknowns deterministically', () => {
    expect(mapLegacyColor('green', 'x')).toBe('green');
    expect(mapLegacyColor('rgba(222, 122, 142, 0.30)', 'x')).toBe('pink');
    const a = mapLegacyColor('#123456', 'some-tag');
    expect(a).toBe(mapLegacyColor('#123456', 'some-tag')); // deterministic
    expect(['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']).toContain(a);
  });
});
