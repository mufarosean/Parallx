// databaseDoor.ts — the canvas's side of `api.canvas.databases`.
//
// The contract and the slot live in the core (api/bridges/canvasDatabasesBridge.ts);
// this is the host the canvas puts in the slot. It speaks column NAMES to a
// tool (a tool is written against "Attempts", not against an id that differs
// in every workspace) and ids to the engine, and it carries the calling
// tool's id to the engine's one gate, so a column a tool keeps
// (keptColumns.ts) is written by that tool and nobody else.

import type { IDisposable } from '../../../platform/lifecycle.js';
import { setCanvasDatabasesHost } from '../../../api/bridges/canvasDatabasesBridge.js';
import type {
  CanvasDatabaseChange, CanvasDatabaseColumn, CanvasDatabaseColumnSpec, CanvasDatabaseInfo, CanvasDatabaseRow, CanvasDatabasesHost,
} from '../../../api/bridges/canvasDatabasesBridge.js';
import type { ICanvasDataService } from '../canvasTypes.js';
import type { PropertyType } from '../properties/propertyTypes.js';
import { ALL_PROPERTY_TYPES, defaultConfigFor } from '../properties/propertyTypeMeta.js';
import type { DatabaseDataService } from './databaseDataService.js';
import type { IDatabaseProperty } from './databaseTypes.js';
import { TITLE_KEY } from './databaseTypes.js';
import { PILL_COLORS } from './cellRender.js';
import { keptRefusal, mayWrite, setKeeperNames } from './keptColumns.js';
import { withDerivedValues } from './rowCompute.js';
import { FormulaError, formulaValue } from './formula.js';
import { loadRelatedDatabases, relationConfig, setRelationValue } from './relations.js';
import { rollupValue } from './rollups.js';

/** The title column: every database has it, first, and it is the row's page title. */
const TITLE_COLUMN: CanvasDatabaseColumn = Object.freeze({ id: TITLE_KEY, name: 'Name', type: 'title', config: Object.freeze({}) });

const OPTION_TYPES: readonly string[] = ['select', 'status', 'tags'];
const OPTION_COLORS = PILL_COLORS.filter((c) => c !== 'default');

interface IOption { value: string; color: string; group?: string }

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const column = (p: IDatabaseProperty): CanvasDatabaseColumn => ({ id: p.id, name: p.name, type: p.type, config: p.config });

/** The option names a column spec lists, in order, once each. */
function wantedOptions(spec: CanvasDatabaseColumnSpec): { value: string; color?: string; group?: string }[] {
  const raw = spec.config?.['options'];
  if (!Array.isArray(raw)) return [];
  const out: { value: string; color?: string; group?: string }[] = [];
  for (const o of raw) {
    const value = (typeof o === 'string' ? o : (o && typeof o === 'object' ? String((o as { value?: unknown }).value ?? '') : '')).trim();
    if (!value || out.some((x) => x.value === value)) continue;
    const color = o && typeof o === 'object' && typeof (o as { color?: unknown }).color === 'string' ? (o as { color: string }).color : undefined;
    const group = o && typeof o === 'object' && typeof (o as { group?: unknown }).group === 'string' ? (o as { group: string }).group : undefined;
    out.push({ value, ...(color ? { color } : {}), ...(group ? { group } : {}) });
  }
  return out;
}

/** `have` with every wanted option it lacks added after it (colours in turn); null when none is missing. */
function withOptions(have: readonly IOption[], wanted: readonly { value: string; color?: string; group?: string }[]): IOption[] | null {
  const next = have.map((o) => ({ ...o }));
  for (const w of wanted) {
    if (next.some((o) => o.value === w.value)) continue;
    next.push({ ...w, value: w.value, color: w.color ?? OPTION_COLORS[next.length % OPTION_COLORS.length]! });
  }
  return next.length === have.length ? null : next;
}

/** A spec checked, and the config its column is made with (the calling tool stamped on a kept one). */
function specConfig(toolId: string, spec: CanvasDatabaseColumnSpec): { name: string; type: PropertyType; config: Record<string, unknown> } {
  const name = String(spec?.name ?? '').trim();
  if (!name) throw new Error('A column needs a name.');
  const type = String(spec.type ?? '') as PropertyType;
  if (!ALL_PROPERTY_TYPES.includes(type)) throw new Error(`"${name}": there is no column type "${String(spec.type)}". The types are ${ALL_PROPERTY_TYPES.join(', ')}.`);
  const config: Record<string, unknown> = { ...defaultConfigFor(type), ...(spec.config ?? {}) };
  if (OPTION_TYPES.includes(type)) {
    const wanted = wantedOptions(spec);
    // A status column with no options named keeps the app's own three.
    if (wanted.length > 0 || !Array.isArray(config['options'])) config['options'] = withOptions([], wanted) ?? [];
  }
  // A tool marks a column as its own; it cannot mark one as another tool's.
  if (config['computedBy']) config['computedBy'] = toolId; else delete config['computedBy'];
  return { name, type, config };
}

const isTitleSpec = (spec: CanvasDatabaseColumnSpec): boolean => String(spec?.type ?? '') === 'title';

/**
 * Open the door for as long as the canvas runs: the host goes into the
 * core's slot, and a kept column's tool is named by `toolName` (the tool
 * registry's display name). Disposing closes it again.
 */
export function openDatabaseDoor(db: DatabaseDataService, pages: ICanvasDataService, openPage: (pageId: string) => Promise<void> | void, toolName: (toolId: string) => string | undefined): IDisposable {
  setKeeperNames(toolName);
  setCanvasDatabasesHost(createDatabaseDoor(db, pages, openPage));
  return { dispose: () => { setCanvasDatabasesHost(null); setKeeperNames(null); } };
}

export function createDatabaseDoor(db: DatabaseDataService, pages: ICanvasDataService, openPage: (pageId: string) => Promise<void> | void): CanvasDatabasesHost {
  /** The database's properties; an id that is no database is said so. */
  async function propsOf(databaseId: string): Promise<IDatabaseProperty[]> {
    await db.ensureIdsLoaded();
    if (!db.isDatabase(databaseId) && !(await db.getDatabase(databaseId))) throw new Error(`Database not found: ${databaseId}`);
    return db.listProperties(databaseId);
  }

  /** Values by column name as values by property id; a name the database lacks, or a column kept by another tool, is refused. `title` takes a value given under the title column's name. */
  function byId(toolId: string, props: readonly IDatabaseProperty[], values: Readonly<Record<string, unknown>> | undefined): { cells: Record<string, unknown>; title?: string } {
    const cells: Record<string, unknown> = {};
    let title: string | undefined;
    const unknown: string[] = [];
    for (const [name, value] of Object.entries(values ?? {})) {
      const prop = props.find((p) => p.name === name) ?? props.find((p) => same(p.name, name));
      if (!prop) { if (same(name, TITLE_COLUMN.name)) title = String(value ?? ''); else unknown.push(name); continue; }
      if (!mayWrite(prop, toolId)) throw new Error(keptRefusal(prop));
      cells[prop.id] = value;
    }
    if (unknown.length > 0) {
      throw new Error(`This database has no column named ${unknown.map((n) => `"${n}"`).join(', ')}. Its columns are ${[TITLE_COLUMN.name, ...props.map((p) => p.name)].join(', ')}.`);
    }
    return { cells, title };
  }

  /** A synced relation keeps its mirror in the other database true, so it is written on its own. */
  const isSynced = (p: IDatabaseProperty | undefined): p is IDatabaseProperty => !!p && p.type === 'relation' && relationConfig(p).synced;

  async function info(databaseId: string): Promise<CanvasDatabaseInfo | null> {
    const found = await db.getDatabase(databaseId);
    if (!found) return null;
    const [props, page] = await Promise.all([db.listProperties(databaseId), pages.getPage(databaseId).catch(() => null)]);
    // In the Trash it is still a database (Restore brings it back whole), and says so.
    return { id: found.id, title: found.title, pageId: found.id, parentPageId: page?.parentId ?? null, columns: [TITLE_COLUMN, ...props.map(column)], ...(page?.isArchived ? { trashed: true } : {}) };
  }

  async function ensureColumns(toolId: string, databaseId: string, columns: readonly CanvasDatabaseColumnSpec[]): Promise<readonly CanvasDatabaseColumn[]> {
    let props = await propsOf(databaseId);
    let changed = false;
    for (const spec of columns ?? []) {
      if (isTitleSpec(spec)) continue;
      const want = specConfig(toolId, spec);
      if (same(want.name, TITLE_COLUMN.name) && !props.some((p) => same(p.name, want.name))) continue;
      const existing = props.find((p) => same(p.name, want.name));
      if (!existing) {
        props.push(await db.addProperty(databaseId, want.name, want.type, want.config));
        continue;
      }
      // There already: its type, its settings and its keeper are left alone. Only options it lacks are added.
      if (!OPTION_TYPES.includes(existing.type)) continue;
      const have = Array.isArray(existing.config['options']) ? existing.config['options'] as IOption[] : [];
      const next = withOptions(have, wantedOptions(spec));
      if (next) { await db.setOptions(databaseId, existing.id, next); changed = true; }
    }
    if (changed) props = await db.listProperties(databaseId);
    return [TITLE_COLUMN, ...props.map(column)];
  }

  /** Values by property id as values by column name, the empty ones left out. */
  const byName = (props: readonly IDatabaseProperty[], values: Readonly<Record<string, unknown>>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const p of props) {
      const v = values[p.id];
      if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)) out[p.name] = v;
    }
    return out;
  };

  async function addRow(toolId: string, databaseId: string, row: { title: string; values?: Readonly<Record<string, unknown>> }): Promise<CanvasDatabaseRow> {
    const props = await propsOf(databaseId);
    const { cells, title } = byId(toolId, props, row?.values);
    const synced = Object.keys(cells).filter((id) => isSynced(props.find((p) => p.id === id)));
    const plain = Object.fromEntries(Object.entries(cells).filter(([id]) => !synced.includes(id)));
    const made = await db.addRow(databaseId, String(row?.title ?? title ?? '').trim() || 'Untitled', plain, toolId);
    for (const id of synced) await setRelationValue(db, databaseId, made.pageId, props.find((p) => p.id === id)!, cells[id], toolId);
    return { pageId: made.pageId, title: made.title, values: byName(props, { ...made.values, ...Object.fromEntries(synced.map((id) => [id, cells[id]])) }) };
  }

  /** Many rows at once: one transaction, one change event. A row that sets a synced relation is written on its own, as addRow writes it. */
  async function addRows(toolId: string, databaseId: string, rows: readonly { title: string; values?: Readonly<Record<string, unknown>> }[]): Promise<CanvasDatabaseRow[]> {
    const props = await propsOf(databaseId);
    const prepared = (rows ?? []).map((r) => { const { cells, title } = byId(toolId, props, r?.values); return { title: String(r?.title ?? title ?? '').trim() || 'Untitled', values: cells }; });
    if (prepared.some((r) => Object.keys(r.values).some((id) => isSynced(props.find((p) => p.id === id))))) {
      const out: CanvasDatabaseRow[] = [];
      for (const r of rows) out.push(await addRow(toolId, databaseId, r));
      return out;
    }
    return (await db.addRows(databaseId, prepared, toolId)).map((m) => ({ pageId: m.pageId, title: m.title, values: byName(props, m.values) }));
  }

  async function updateRows(toolId: string, databaseId: string, patches: readonly { pageId: string; title?: string; values?: Readonly<Record<string, unknown>> }[]): Promise<void> {
    const props = await propsOf(databaseId);
    const prepared = (patches ?? []).map((p) => { const { cells, title } = byId(toolId, props, p?.values); const nextTitle = p?.title ?? title; return { pageId: String(p?.pageId ?? ''), values: cells, ...(nextTitle !== undefined ? { title: String(nextTitle) } : {}) }; });
    const synced = prepared.filter((p) => Object.keys(p.values).some((id) => isSynced(props.find((x) => x.id === id))));
    await db.updateRows(databaseId, prepared.map((p) => (synced.includes(p) ? { ...p, values: Object.fromEntries(Object.entries(p.values).filter(([id]) => !isSynced(props.find((x) => x.id === id)))) } : p)), toolId);
    for (const p of synced) for (const [id, v] of Object.entries(p.values)) if (isSynced(props.find((x) => x.id === id))) await setRelationValue(db, databaseId, p.pageId, props.find((x) => x.id === id)!, v, toolId);
  }

  return {
    async list() {
      return (await db.listDatabases()).map((d) => ({ id: d.id, title: d.title }));
    },

    get: (databaseId) => info(databaseId),

    async create(toolId, options) {
      const title = String(options?.title ?? '').trim() || 'Untitled';
      // Checked before anything is made, so a bad column leaves no empty database behind.
      const specs = (options?.columns ?? []).filter((s) => !isTitleSpec(s)).map((s) => specConfig(toolId, s));
      for (const [i, s] of specs.entries()) {
        if (same(s.name, TITLE_COLUMN.name) || specs.findIndex((x) => same(x.name, s.name)) !== i) throw new Error(`Two columns are named "${s.name}".`);
      }
      const made = await db.createDatabase({ title, parentId: options?.parentPageId ?? null, seedDefaults: false });
      // Widths asked for go into the new table view, keyed as the view keys them (a column's id, the title's key).
      const widths: Record<string, number> = {};
      const sized = (spec: CanvasDatabaseColumnSpec): number | null => {
        const w = Number(spec?.width);
        return Number.isFinite(w) && w > 0 ? Math.round(Math.min(640, Math.max(48, w))) : null;
      };
      const asked = (options?.columns ?? []).filter((s) => !isTitleSpec(s));
      const titleWidth = sized((options?.columns ?? []).find(isTitleSpec) as CanvasDatabaseColumnSpec);
      if (titleWidth) widths[TITLE_KEY] = titleWidth;
      for (const [i, s] of specs.entries()) {
        const prop = await db.addProperty(made.id, s.name, s.type, s.config);
        const w = sized(asked[i]);
        if (w && prop?.id) widths[prop.id] = w;
      }
      if (Object.keys(widths).length) {
        const view = (await db.listViews(made.id))[0];
        if (view) await db.updateView(made.id, view.id, { config: { ...(view.config ?? {}), widths } });
      }
      return (await info(made.id))!;
    },

    async createPage(options) {
      const title = String(options?.title ?? '').trim() || 'Untitled';
      const page = options?.parentPageId
        ? await pages.createChildPageWithBlock({ parentId: options.parentPageId, title })
        : await pages.createPage(null, title);
      return { id: page.id };
    },

    ensureColumns,

    async listRows(databaseId) {
      // Three reads however many rows: the columns, the rows, every cell.
      const [props, stored] = await Promise.all([propsOf(databaseId), db.listRows(databaseId)]);
      // What the app computes is read as its value: created and edited time, a formula; a rollup when there is one (it reads the related databases).
      const related = props.some((p) => p.type === 'rollup') ? await loadRelatedDatabases(db, props) : null;
      const cache = new Map();
      const rows = withDerivedValues(stored, props, {
        formula: (prop, row, values) => formulaValue(String(prop.config['expression'] ?? ''), (name) => {
          if (same(name, TITLE_COLUMN.name)) return row.title;
          const p = props.find((x) => same(x.name, name));
          if (!p) throw new FormulaError(`No property named "${name}"`);
          if (p.id === prop.id) throw new FormulaError('A formula cannot use itself');
          return values[p.id];
        }, cache),
        ...(related ? { rollup: (prop, _row, values) => rollupValue(prop, values, props, related) } : {}),
      });
      return rows.map((r): CanvasDatabaseRow => ({ pageId: r.pageId, title: r.title, values: byName(props, r.values) }));
    },

    addRow,

    async updateRow(toolId, databaseId, pageId, patch) {
      const props = await propsOf(databaseId);
      const { cells, title } = byId(toolId, props, patch?.values);
      const synced = Object.keys(cells).filter((id) => isSynced(props.find((p) => p.id === id)));
      const plain = Object.fromEntries(Object.entries(cells).filter(([id]) => !synced.includes(id)));
      const nextTitle = patch?.title ?? title;
      await db.updateRow(databaseId, pageId, { ...(nextTitle !== undefined ? { title: String(nextTitle).trim() || 'Untitled' } : {}), values: plain }, toolId);
      for (const id of synced) await setRelationValue(db, databaseId, pageId, props.find((p) => p.id === id)!, cells[id], toolId);
    },

    addRows,
    updateRows,

    async removeRows(databaseId, pageIds) {
      await propsOf(databaseId);
      await db.removeRows(databaseId, [...(pageIds ?? [])].map(String));
    },

    async removeRow(databaseId, pageId) {
      await propsOf(databaseId);
      await db.removeRow(databaseId, pageId);
    },

    onDidChange(databaseId, listener: (e: CanvasDatabaseChange) => void): IDisposable {
      return db.onDidChange((e) => {
        if (e.databaseId !== databaseId) return;
        listener(e.pageId ? { kind: e.kind, pageId: e.pageId } : { kind: e.kind });
      });
    },

    async open(databaseId) {
      await propsOf(databaseId);
      await openPage(databaseId);
    },
  };
}
