// canvasDatabasesBridge.ts — `parallx.canvas.databases`: the door any tool
// has to canvas databases.
//
// A canvas database is the person's own table: they see it, sort it, edit
// it. A tool that keeps its records there (instead of in a store only it can
// read) gives them that for free. The engine belongs to the canvas, so this
// module holds only the contract and a slot: the canvas puts a host in the
// slot when it starts and takes it out when it stops. A call made while the
// slot is empty is rejected with one sentence; nothing here throws when a
// tool asks for the door or starts listening, whatever order tools start in.
//
// Same shape as the other hubs (dashboardBridge, canvasBlocksBridge): state
// in the module, a per-tool face that is cleaned up with the tool.

import { type IDisposable, toDisposable } from '../../platform/lifecycle.js';

// ─── Contract ────────────────────────────────────────────────────────────────

/** A column of a database. The first is always the title column (`type: 'title'`, named "Name"). */
export interface CanvasDatabaseColumn {
  readonly id: string;
  readonly name: string;
  /** 'title', or a property type: text, number, checkbox, date, datetime, select, status, tags, url, email, phone, files, relation, unique_id, created_time, last_edited_time, formula, rollup. */
  readonly type: string;
  /** Type settings: `options` of a select, status or tags column ({value, color}[]); `databaseId` of a relation; `expression` of a formula; `computedBy` (a tool id) on a column a tool keeps. */
  readonly config: Readonly<Record<string, unknown>>;
}

/** A column to make. */
export interface CanvasDatabaseColumnSpec {
  readonly name: string;
  readonly type: string;
  /**
   * `options`: names (or {value, color}) a select, status or tags column must have.
   * `computedBy`: any truthy value marks the column as kept by the calling tool
   * (its own id is stored, whatever is passed): only that tool writes its cells.
   */
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface CanvasDatabaseInfo {
  readonly id: string;
  readonly title: string;
  /** The database's own page (a database is a page): the same id. */
  readonly pageId: string;
  readonly parentPageId: string | null;
  readonly columns: readonly CanvasDatabaseColumn[];
  /** True while the database is in the Trash: it lists no rows until it is restored. Absent otherwise. */
  readonly trashed?: boolean;
}

export interface CanvasDatabaseRow {
  /** A row is a page: its id. */
  readonly pageId: string;
  readonly title: string;
  /** Cell values by column NAME. An empty cell has no entry. */
  readonly values: Readonly<Record<string, unknown>>;
}

export interface CanvasDatabaseChange {
  /** rows: one was added, removed or retitled. cells: values changed. columns: one was added, changed or deleted. */
  readonly kind: 'rows' | 'cells' | 'columns';
  /** The row, when the change is to one row. */
  readonly pageId?: string;
}

/** `api.canvas.databases`. */
export interface CanvasDatabasesApi {
  list(): Promise<readonly { readonly id: string; readonly title: string }[]>;
  get(databaseId: string): Promise<CanvasDatabaseInfo | null>;
  create(options: { title: string; parentPageId?: string | null; columns?: readonly CanvasDatabaseColumnSpec[] }): Promise<CanvasDatabaseInfo>;
  createPage(options: { title: string; parentPageId?: string | null }): Promise<{ readonly id: string }>;
  ensureColumns(databaseId: string, columns: readonly CanvasDatabaseColumnSpec[]): Promise<readonly CanvasDatabaseColumn[]>;
  listRows(databaseId: string): Promise<readonly CanvasDatabaseRow[]>;
  addRow(databaseId: string, row: { title: string; values?: Readonly<Record<string, unknown>> }): Promise<CanvasDatabaseRow>;
  updateRow(databaseId: string, pageId: string, patch: { title?: string; values?: Readonly<Record<string, unknown>> }): Promise<void>;
  removeRow(databaseId: string, pageId: string): Promise<void>;
  /** Many rows added in one transaction, with one change event (no `pageId`); returned in order. */
  addRows(databaseId: string, rows: readonly { title: string; values?: Readonly<Record<string, unknown>> }[]): Promise<readonly CanvasDatabaseRow[]>;
  /** Many rows changed in one transaction, with one change event; every value is checked before anything is written. */
  updateRows(databaseId: string, patches: readonly { pageId: string; title?: string; values?: Readonly<Record<string, unknown>> }[]): Promise<void>;
  /** Many rows to the Trash, with one change event. */
  removeRows(databaseId: string, pageIds: readonly string[]): Promise<void>;
  onDidChange(databaseId: string, listener: (e: CanvasDatabaseChange) => void): IDisposable;
  open(databaseId: string): Promise<void>;
}

/**
 * What the canvas puts in the slot. Every call names the tool that made it:
 * the host stamps that id on the columns the tool keeps, and lets only that
 * tool write them.
 */
export interface CanvasDatabasesHost {
  list(): Promise<readonly { readonly id: string; readonly title: string }[]>;
  get(databaseId: string): Promise<CanvasDatabaseInfo | null>;
  create(toolId: string, options: { title: string; parentPageId?: string | null; columns?: readonly CanvasDatabaseColumnSpec[] }): Promise<CanvasDatabaseInfo>;
  createPage(options: { title: string; parentPageId?: string | null }): Promise<{ readonly id: string }>;
  ensureColumns(toolId: string, databaseId: string, columns: readonly CanvasDatabaseColumnSpec[]): Promise<readonly CanvasDatabaseColumn[]>;
  listRows(databaseId: string): Promise<readonly CanvasDatabaseRow[]>;
  addRow(toolId: string, databaseId: string, row: { title: string; values?: Readonly<Record<string, unknown>> }): Promise<CanvasDatabaseRow>;
  updateRow(toolId: string, databaseId: string, pageId: string, patch: { title?: string; values?: Readonly<Record<string, unknown>> }): Promise<void>;
  removeRow(databaseId: string, pageId: string): Promise<void>;
  addRows(toolId: string, databaseId: string, rows: readonly { title: string; values?: Readonly<Record<string, unknown>> }[]): Promise<readonly CanvasDatabaseRow[]>;
  updateRows(toolId: string, databaseId: string, patches: readonly { pageId: string; title?: string; values?: Readonly<Record<string, unknown>> }[]): Promise<void>;
  removeRows(databaseId: string, pageIds: readonly string[]): Promise<void>;
  onDidChange(databaseId: string, listener: (e: CanvasDatabaseChange) => void): IDisposable;
  open(databaseId: string): Promise<void>;
}

// ─── Slot ────────────────────────────────────────────────────────────────────

export const CANVAS_DATABASES_UNAVAILABLE = 'Canvas databases are not available';

interface Listening {
  readonly databaseId: string;
  readonly listener: (e: CanvasDatabaseChange) => void;
  attached: IDisposable | null;
}

let _host: CanvasDatabasesHost | null = null;
/** Every tool's listeners, kept here so they outlive a host (the canvas restarting) and precede one. */
const _listening = new Set<Listening>();

function attach(l: Listening): void {
  if (!_host || l.attached) return;
  try { l.attached = _host.onDidChange(l.databaseId, (e) => { try { l.listener(e); } catch (err) { console.error('[api.canvas.databases] listener failed:', err); } }); }
  catch (err) { console.error('[api.canvas.databases] could not listen:', err); }
}
function detach(l: Listening): void {
  try { l.attached?.dispose(); } catch { /* the host is going */ }
  l.attached = null;
}

/** The canvas fills the slot when it starts (`host`) and empties it when it stops (`null`). */
export function setCanvasDatabasesHost(host: CanvasDatabasesHost | null): void {
  for (const l of _listening) detach(l);
  _host = host;
  for (const l of _listening) attach(l);
}

function host(): Promise<CanvasDatabasesHost> {
  return _host ? Promise.resolve(_host) : Promise.reject(new Error(CANVAS_DATABASES_UNAVAILABLE));
}

// ─── Per-tool face ───────────────────────────────────────────────────────────

export function createCanvasDatabasesApi(toolId: string, subscriptions: IDisposable[]): CanvasDatabasesApi {
  return Object.freeze({
    list: () => host().then((h) => h.list()),
    get: (databaseId: string) => host().then((h) => h.get(String(databaseId))),
    create: (options: { title: string; parentPageId?: string | null; columns?: readonly CanvasDatabaseColumnSpec[] }) => host().then((h) => h.create(toolId, options)),
    createPage: (options: { title: string; parentPageId?: string | null }) => host().then((h) => h.createPage(options)),
    ensureColumns: (databaseId: string, columns: readonly CanvasDatabaseColumnSpec[]) => host().then((h) => h.ensureColumns(toolId, String(databaseId), columns)),
    listRows: (databaseId: string) => host().then((h) => h.listRows(String(databaseId))),
    addRow: (databaseId: string, row: { title: string; values?: Readonly<Record<string, unknown>> }) => host().then((h) => h.addRow(toolId, String(databaseId), row)),
    updateRow: (databaseId: string, pageId: string, patch: { title?: string; values?: Readonly<Record<string, unknown>> }) => host().then((h) => h.updateRow(toolId, String(databaseId), String(pageId), patch)),
    removeRow: (databaseId: string, pageId: string) => host().then((h) => h.removeRow(String(databaseId), String(pageId))),
    addRows: (databaseId: string, rows: readonly { title: string; values?: Readonly<Record<string, unknown>> }[]) => host().then((h) => h.addRows(toolId, String(databaseId), rows)),
    updateRows: (databaseId: string, patches: readonly { pageId: string; title?: string; values?: Readonly<Record<string, unknown>> }[]) => host().then((h) => h.updateRows(toolId, String(databaseId), patches)),
    removeRows: (databaseId: string, pageIds: readonly string[]) => host().then((h) => h.removeRows(String(databaseId), pageIds)),
    onDidChange: (databaseId: string, listener: (e: CanvasDatabaseChange) => void): IDisposable => {
      const l: Listening = { databaseId: String(databaseId), listener, attached: null };
      _listening.add(l);
      attach(l);
      const d = toDisposable(() => { detach(l); _listening.delete(l); });
      subscriptions.push(d);
      return d;
    },
    open: (databaseId: string) => host().then((h) => h.open(String(databaseId))),
  });
}
