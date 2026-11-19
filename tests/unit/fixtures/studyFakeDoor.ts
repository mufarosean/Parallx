// studyFakeDoor.ts — the stand-in for the core's door (api.canvas.databases)
// that keeps its databases in memory and counts every write Study makes. Kept
// apart from studyDoor.ts (which also opens SQLite) so a jsdom test can use it.

export type Row = { pageId: string; title: string; values: Record<string, unknown> };
type Col = { id: string; name: string; type: string; config: Record<string, unknown> };
type Db = { id: string; title: string; parentPageId: string | null; columns: Col[]; rows: Row[]; trashed?: boolean };

/** The door, in memory: values by column name, a change event after every write, as the canvas's does. */
export function fakeDoor() {
  const dbs = new Map<string, Db>();
  const listeners = new Map<string, Set<(e: { kind: string; pageId?: string }) => void>>();
  const writes: string[] = [];
  let n = 0;
  const id = (p: string) => `${p}-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const fire = (dbId: string, kind: string, pageId?: string) => { for (const l of [...(listeners.get(dbId) || [])]) l(pageId ? { kind, pageId } : { kind }); };
  const need = (dbId: string) => { const d = dbs.get(dbId); if (!d) throw new Error(`Database not found: ${dbId}`); return d; };
  const col = (d: Db, name: string) => { const c = d.columns.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!c) throw new Error(`This database has no column named "${name}".`); return c; };
  const TITLE: Col = { id: 'title', name: 'Name', type: 'title', config: {} };
  const options = (spec: any) => (Array.isArray(spec?.config?.options) ? { options: spec.config.options.map((o: any) => (typeof o === 'string' ? { value: o, color: 'gray' } : o)) } : {});
  const door = {
    list: async () => [...dbs.values()].filter((d) => !d.trashed).map((d) => ({ id: d.id, title: d.title })),
    get: async (dbId: string) => { const d = dbs.get(dbId); return d ? { id: d.id, title: d.title, pageId: d.id, parentPageId: d.parentPageId, columns: [TITLE, ...d.columns.map((c) => ({ ...c }))], ...(d.trashed ? { trashed: true } : {}) } : null; },
    create: async (o: { title: string; parentPageId?: string; columns?: any[] }) => {
      const d: Db = { id: id('db'), title: o.title, parentPageId: o.parentPageId ?? null, columns: (o.columns || []).map((s) => ({ id: id('col'), name: s.name, type: s.type, config: { ...(s.config || {}), ...options(s) } })), rows: [] };
      dbs.set(d.id, d); writes.push(`create ${o.title}`);
      return door.get(d.id);
    },
    createPage: async (o: { title: string }) => { writes.push(`page ${o.title}`); return { id: id('page') }; },
    ensureColumns: async (dbId: string, specs: any[]) => {
      const d = need(dbId);
      for (const s of specs) {
        const have = d.columns.find((c) => c.name.toLowerCase() === String(s.name).toLowerCase());
        if (!have) { d.columns.push({ id: id('col'), name: s.name, type: s.type, config: { ...(s.config || {}), ...options(s) } }); writes.push(`column ${d.title}.${s.name}`); fire(dbId, 'columns'); continue; }
        // As the canvas's door: a column that is there only gains the listed options it lacks.
        const lacking = (options(s).options || []).filter((o: any) => Array.isArray(have.config.options) && !(have.config.options as any[]).some((x) => x.value === o.value));
        if (lacking.length) { (have.config.options as any[]).push(...lacking); writes.push(`options ${d.title}.${have.name}: ${lacking.map((o: any) => o.value).join(', ')}`); fire(dbId, 'columns'); }
      }
      return [TITLE, ...d.columns];
    },
    listRows: async (dbId: string) => (need(dbId).trashed ? [] : need(dbId).rows).map((r) => ({ pageId: r.pageId, title: r.title, values: Object.fromEntries(Object.entries(r.values).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))) })),
    addRow: async (dbId: string, row: { title: string; values?: Record<string, unknown> }) => {
      const d = need(dbId); const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row.values || {})) values[col(d, k).name] = v;
      const made = { pageId: id('row'), title: row.title, values };
      d.rows.push(made); writes.push(`add ${d.title}: ${row.title}`); fire(dbId, 'rows', made.pageId);
      return { ...made, values: { ...values } };
    },
    updateRow: async (dbId: string, pageId: string, patch: { title?: string; values?: Record<string, unknown> }) => {
      const d = need(dbId); const r = d.rows.find((x) => x.pageId === pageId);
      if (!r) throw new Error('Row not found');
      for (const [k, v] of Object.entries(patch.values || {})) r.values[col(d, k).name] = v;
      if (patch.title !== undefined) r.title = patch.title;
      writes.push(`update ${d.title}: ${r.title} ${JSON.stringify(patch.values || {})}`); fire(dbId, patch.title !== undefined ? 'rows' : 'cells', pageId);
    },
    removeRow: async (dbId: string, pageId: string) => { const d = need(dbId); d.rows = d.rows.filter((r) => r.pageId !== pageId); fire(dbId, 'rows', pageId); },
    // Many rows at once, as the canvas's door: every value checked first, one change event.
    addRows: async (dbId: string, rows: { title: string; values?: Record<string, unknown> }[]) => {
      const d = need(dbId);
      const made = rows.map((row) => { const values: Record<string, unknown> = {}; for (const [k, v] of Object.entries(row.values || {})) values[col(d, k).name] = v; return { pageId: id('row'), title: row.title, values }; });
      d.rows.push(...made); writes.push(`add ${made.length} to ${d.title}`); fire(dbId, 'rows');
      return made.map((m) => ({ ...m, values: Object.fromEntries(Object.entries(m.values).filter(([, v]) => v !== null && v !== undefined && v !== '')) }));
    },
    updateRows: async (dbId: string, patches: { pageId: string; title?: string; values?: Record<string, unknown> }[]) => {
      const d = need(dbId);
      for (const p of patches) { if (!d.rows.some((x) => x.pageId === p.pageId)) throw new Error(`Page ${p.pageId} is not a row of this database.`); for (const k of Object.keys(p.values || {})) col(d, k); }
      for (const p of patches) { const r = d.rows.find((x) => x.pageId === p.pageId)!; for (const [k, v] of Object.entries(p.values || {})) r.values[col(d, k).name] = v; if (p.title !== undefined) r.title = p.title; }
      writes.push(`update ${patches.length} in ${d.title}: ${patches.map((p) => Object.keys(p.values || {}).join(',')).join(' ')}`); fire(dbId, 'cells');
    },
    removeRows: async (dbId: string, pageIds: string[]) => { const d = need(dbId); d.rows = d.rows.filter((r) => !pageIds.includes(r.pageId)); writes.push(`remove ${pageIds.length} from ${d.title}`); fire(dbId, 'rows'); },
    onDidChange: (dbId: string, l: (e: { kind: string; pageId?: string }) => void) => { if (!listeners.has(dbId)) listeners.set(dbId, new Set()); listeners.get(dbId)!.add(l); return { dispose: () => listeners.get(dbId)!.delete(l) }; },
    open: async () => {},
  };
  /** What the person does in the table: the same store, the same events, not counted as Study's writes. */
  const person = {
    database: (title: string, columns: { name: string; type: string; options?: string[] }[], rows: { title: string; values: Record<string, unknown> }[]) => {
      const d: Db = { id: id('db'), title, parentPageId: null, columns: columns.map((c) => ({ id: id('col'), name: c.name, type: c.type, config: c.options ? { options: c.options.map((value) => ({ value, color: 'gray' })) } : {} })), rows: rows.map((r) => ({ pageId: id('row'), title: r.title, values: { ...r.values } })) };
      dbs.set(d.id, d);
      return d;
    },
    edit: (d: Db, title: string, patch: { title?: string; values?: Record<string, unknown> }) => { const r = d.rows.find((x) => x.title === title)!; Object.assign(r.values, patch.values || {}); if (patch.title) r.title = patch.title; fire(d.id, patch.title ? 'rows' : 'cells', r.pageId); },
    add: (d: Db, title: string, values: Record<string, unknown>) => { const r = { pageId: id('row'), title, values }; d.rows.push(r); fire(d.id, 'rows', r.pageId); },
    remove: (d: Db, title: string) => { const r = d.rows.find((x) => x.title === title)!; d.rows = d.rows.filter((x) => x !== r); fire(d.id, 'rows', r.pageId); },
    renameColumn: (d: Db, from: string, to: string) => { d.columns.find((c) => c.name === from)!.name = to; for (const r of d.rows) if (from in r.values) { r.values[to] = r.values[from]; delete r.values[from]; } fire(d.id, 'columns'); },
    /** The database's page sent to the Trash, and restored: still a database, listing no rows meanwhile. */
    trash: (d: Db) => { d.trashed = true; fire(d.id, 'rows'); },
    restore: (d: Db) => { d.trashed = false; fire(d.id, 'rows'); },
    /** A row restored from the Trash: the same page. */
    putBack: (d: Db, row: Row) => { d.rows.push(row); fire(d.id, 'rows', row.pageId); },
    dropColumn: (d: Db, name: string) => { d.columns = d.columns.filter((c) => c.name !== name); for (const r of d.rows) delete r.values[name]; fire(d.id, 'columns'); },
  };
  return { door, dbs, writes, person, byTitle: (t: string) => [...dbs.values()].find((d) => d.title === t)! };
}

