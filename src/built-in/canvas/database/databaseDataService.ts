// databaseDataService.ts — renderer-side data service for Notion-style
// databases, over the schema that has existed since migration 006/007.
//
// Composition with the page world:
//   - a database IS a page (databases.id = pages.id) — title/icon on pages;
//   - a ROW is a child page (parent_id = database id) plus a database_pages
//     membership row — so rows nest in the sidebar and open as pages for free;
//   - cell values live in page_property_values (page, property, database);
//   - page CRUD is delegated to CanvasDataService (events, archival, revision
//     discipline all reused, not duplicated).
//
// Self-healing: deleting the database page (any path) cascades cleanup of the
// database tables via the page-change subscription — no orphaned schema rows
// even if SQLite FK enforcement is off.

import { Disposable } from '../../../platform/lifecycle.js';
import { Emitter, Event } from '../../../platform/events.js';
import type { ICanvasDataService } from '../canvasTypes.js';
import { PageChangeKind } from '../canvasTypes.js';
import type { PropertyType } from '../properties/propertyTypes.js';
import type {
  DatabaseViewType,
  IDatabaseInfo,
  IDatabaseProperty,
  IDatabaseRow,
  IDatabaseView,
  IFilterConfig,
  ISortRule,
} from './databaseTypes.js';
import { EMPTY_FILTER } from './databaseTypes.js';
import { parseFilterConfig, parseSortConfig } from './databaseViewModel.js';

interface DatabaseBridge {
  run(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; changes?: number }>;
  get(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; rows?: Record<string, unknown>[] }>;
  runTransaction(operations: { type: 'run' | 'get' | 'all'; sql: string; params?: unknown[] }[]): Promise<{ error: { code: string; message: string } | null; results?: unknown[] }>;
}

function rowToView(r: Record<string, unknown>): IDatabaseView {
  return {
    id: r.id as string,
    databaseId: r.database_id as string,
    name: (r.name as string) ?? 'Default view',
    type: ((r.type as string) === 'board' ? 'board' : 'table') as DatabaseViewType,
    groupBy: (r.group_by as string) ?? null,
    hideEmptyGroups: !!(r.hide_empty_groups as number),
    filter: parseFilterConfig(r.filter_config as string),
    sort: parseSortConfig(r.sort_config as string),
    config: (() => { try { return JSON.parse((r.config as string) || '{}'); } catch { return {}; } })(),
    sortOrder: (r.sort_order as number) ?? 0,
  };
}

function rowToProperty(r: Record<string, unknown>): IDatabaseProperty {
  return {
    id: r.id as string,
    databaseId: r.database_id as string,
    name: r.name as string,
    type: r.type as PropertyType,
    config: (() => { try { return JSON.parse((r.config as string) || '{}'); } catch { return {}; } })(),
    sortOrder: (r.sort_order as number) ?? 0,
  };
}

/** Default schema seeded into a new database. Colors are NAMED (Notion's
 *  palette: default/gray/brown/orange/yellow/green/blue/purple/pink/red) and
 *  resolved to theme-aware CSS by the views — matching Notion's status
 *  defaults: To-do gray, In progress blue, Complete green. */
const DEFAULT_STATUS_OPTIONS = [
  { value: 'To do', color: 'gray' },
  { value: 'In progress', color: 'blue' },
  { value: 'Done', color: 'green' },
];

export class DatabaseDataService extends Disposable {
  private readonly _onDidChangeStructure = this._register(new Emitter<string>()); // databaseId
  /** Properties or views of a database changed. */
  readonly onDidChangeStructure: Event<string> = this._onDidChangeStructure.event;

  private readonly _onDidChangeRows = this._register(new Emitter<string>()); // databaseId
  /** Membership or cell values changed. */
  readonly onDidChangeRows: Event<string> = this._onDidChangeRows.event;

  private readonly _onDidChangeCell = this._register(new Emitter<{ databaseId: string; pageId: string }>());
  /** A single page's cell value changed (page-scoped — used for reindexing). */
  readonly onDidChangeCell: Event<{ databaseId: string; pageId: string }> = this._onDidChangeCell.event;

  /** Known database ids (kept fresh for cheap sync isDatabase checks). */
  private readonly _databaseIds = new Set<string>();
  private _idsLoaded = false;

  constructor(private readonly _pages: ICanvasDataService) {
    super();
    // Self-healing cleanup: when a database PAGE is deleted through any page
    // path, drop the database schema rows too.
    this._register(this._pages.onDidChangePage((e) => {
      if (e.kind === PageChangeKind.Deleted && this._databaseIds.has(e.pageId)) {
        void this._cleanupDatabaseRows(e.pageId);
      }
    }));
  }

  private get _db(): DatabaseBridge {
    const electron = (window as unknown as { parallxElectron?: { database?: DatabaseBridge } }).parallxElectron;
    if (!electron?.database) {
      throw new Error('[DatabaseDataService] window.parallxElectron.database not available');
    }
    return electron.database;
  }

  // ── Databases ──────────────────────────────────────────────────────────────

  async ensureIdsLoaded(): Promise<void> {
    if (this._idsLoaded) return;
    const res = await this._db.all('SELECT id FROM databases');
    if (!res.error) {
      for (const r of res.rows ?? []) this._databaseIds.add(r.id as string);
      this._idsLoaded = true;
    }
  }

  /** Synchronous check against the loaded id set (load via ensureIdsLoaded). */
  isDatabase(pageId: string): boolean {
    return this._databaseIds.has(pageId);
  }

  listDatabaseIds(): readonly string[] {
    return [...this._databaseIds];
  }

  /**
   * Create a database: a page row (delegated — sidebar events fire), the
   * databases row, a starter property (Status select — unless
   * `seedDefaults: false`), and a default table view. Optionally nested
   * under a parent page.
   */
  async createDatabase(opts: { title?: string; parentId?: string | null; seedDefaults?: boolean } = {}): Promise<IDatabaseInfo> {
    const page = opts.parentId
      ? await this._pages.createChildPageWithBlock({ parentId: opts.parentId, title: opts.title || 'Untitled database' })
      : await this._pages.createPage(null, opts.title || 'Untitled database');

    const statusPropId = crypto.randomUUID();
    const viewId = crypto.randomUUID();
    const ops: { type: 'run'; sql: string; params: unknown[] }[] = [
      { type: 'run', sql: 'INSERT INTO databases (id, page_id) VALUES (?, ?)', params: [page.id, page.id] },
    ];
    if (opts.seedDefaults !== false) {
      ops.push({
        type: 'run',
        sql: 'INSERT INTO database_properties (id, database_id, name, type, config, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        params: [statusPropId, page.id, 'Status', 'select', JSON.stringify({ options: DEFAULT_STATUS_OPTIONS }), 1],
      });
    }
    ops.push({
      type: 'run',
      sql: 'INSERT INTO database_views (id, database_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)',
      params: [viewId, page.id, 'Table', 'table', 1],
    });
    const txn = await this._db.runTransaction(ops);
    if (txn.error) throw new Error(`[DatabaseDataService] createDatabase failed: ${txn.error.message}`);

    this._databaseIds.add(page.id);
    this._onDidChangeStructure.fire(page.id);
    return {
      id: page.id, title: page.title, icon: page.icon,
      description: null, isLocked: false,
      createdAt: page.createdAt, updatedAt: page.updatedAt,
    };
  }

  async getDatabase(databaseId: string): Promise<IDatabaseInfo | null> {
    const res = await this._db.get(
      `SELECT d.id, d.description, d.is_locked, d.created_at, d.updated_at, p.title, p.icon
         FROM databases d JOIN pages p ON p.id = d.id WHERE d.id = ?`,
      [databaseId],
    );
    if (res.error || !res.row) return null;
    const r = res.row;
    this._databaseIds.add(databaseId);
    return {
      id: r.id as string, title: r.title as string, icon: (r.icon as string) ?? null,
      description: (r.description as string) ?? null, isLocked: !!(r.is_locked as number),
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    };
  }

  private async _cleanupDatabaseRows(databaseId: string): Promise<void> {
    await this._db.runTransaction([
      { type: 'run', sql: 'DELETE FROM page_property_values WHERE database_id = ?', params: [databaseId] },
      { type: 'run', sql: 'DELETE FROM database_pages WHERE database_id = ?', params: [databaseId] },
      { type: 'run', sql: 'DELETE FROM database_views WHERE database_id = ?', params: [databaseId] },
      { type: 'run', sql: 'DELETE FROM database_properties WHERE database_id = ?', params: [databaseId] },
      { type: 'run', sql: 'DELETE FROM databases WHERE id = ?', params: [databaseId] },
    ]).catch(() => { /* cleanup is best-effort */ });
    this._databaseIds.delete(databaseId);
  }

  // ── Properties (columns) ──────────────────────────────────────────────────

  async listProperties(databaseId: string): Promise<IDatabaseProperty[]> {
    const res = await this._db.all(
      'SELECT * FROM database_properties WHERE database_id = ? ORDER BY sort_order',
      [databaseId],
    );
    if (res.error) throw new Error(res.error.message);
    return (res.rows ?? []).map(rowToProperty);
  }

  async addProperty(databaseId: string, name: string, type: PropertyType, config: Record<string, unknown> = {}): Promise<IDatabaseProperty> {
    const existing = await this.listProperties(databaseId);
    const id = crypto.randomUUID();
    const sortOrder = Math.max(0, ...existing.map((p) => p.sortOrder)) + 1;
    const res = await this._db.run(
      'INSERT INTO database_properties (id, database_id, name, type, config, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      [id, databaseId, name, type, JSON.stringify(config), sortOrder],
    );
    if (res.error) throw new Error(res.error.message);
    this._onDidChangeStructure.fire(databaseId);
    return { id, databaseId, name, type, config, sortOrder };
  }

  async updateProperty(
    databaseId: string,
    propertyId: string,
    patch: Partial<Pick<IDatabaseProperty, 'name' | 'type' | 'config' | 'sortOrder'>>,
  ): Promise<void> {
    const sets: string[] = []; const params: unknown[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
    if (patch.type !== undefined) { sets.push('type = ?'); params.push(patch.type); }
    if (patch.config !== undefined) { sets.push('config = ?'); params.push(JSON.stringify(patch.config)); }
    if (patch.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(patch.sortOrder); }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    params.push(propertyId, databaseId);
    const res = await this._db.run(
      `UPDATE database_properties SET ${sets.join(', ')} WHERE id = ? AND database_id = ?`,
      params,
    );
    if (res.error) throw new Error(res.error.message);
    this._onDidChangeStructure.fire(databaseId);
  }

  async deleteProperty(databaseId: string, propertyId: string): Promise<void> {
    const txn = await this._db.runTransaction([
      { type: 'run', sql: 'DELETE FROM page_property_values WHERE property_id = ? AND database_id = ?', params: [propertyId, databaseId] },
      { type: 'run', sql: 'DELETE FROM database_properties WHERE id = ? AND database_id = ?', params: [propertyId, databaseId] },
    ]);
    if (txn.error) throw new Error(txn.error.message);
    this._onDidChangeStructure.fire(databaseId);
  }

  // ── Views ──────────────────────────────────────────────────────────────────

  async listViews(databaseId: string): Promise<IDatabaseView[]> {
    const res = await this._db.all(
      'SELECT * FROM database_views WHERE database_id = ? ORDER BY sort_order',
      [databaseId],
    );
    if (res.error) throw new Error(res.error.message);
    const views = (res.rows ?? []).map(rowToView);
    if (views.length === 0) {
      // A database must always have at least one view — self-heal.
      const id = crypto.randomUUID();
      await this._db.run(
        'INSERT INTO database_views (id, database_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)',
        [id, databaseId, 'Table', 'table', 1],
      );
      return [{
        id, databaseId, name: 'Table', type: 'table', groupBy: null,
        hideEmptyGroups: false, filter: EMPTY_FILTER, sort: [], config: {}, sortOrder: 1,
      }];
    }
    return views;
  }

  async addView(databaseId: string, name: string, type: DatabaseViewType): Promise<IDatabaseView> {
    const existing = await this.listViews(databaseId);
    const id = crypto.randomUUID();
    const sortOrder = Math.max(0, ...existing.map((v) => v.sortOrder)) + 1;
    const res = await this._db.run(
      'INSERT INTO database_views (id, database_id, name, type, sort_order) VALUES (?, ?, ?, ?, ?)',
      [id, databaseId, name, type, sortOrder],
    );
    if (res.error) throw new Error(res.error.message);
    this._onDidChangeStructure.fire(databaseId);
    return { id, databaseId, name, type, groupBy: null, hideEmptyGroups: false, filter: EMPTY_FILTER, sort: [], config: {}, sortOrder };
  }

  async updateView(
    databaseId: string,
    viewId: string,
    patch: Partial<{
      name: string; type: DatabaseViewType; groupBy: string | null;
      hideEmptyGroups: boolean; filter: IFilterConfig; sort: readonly ISortRule[];
      config: Record<string, unknown>;
    }>,
  ): Promise<void> {
    const sets: string[] = []; const params: unknown[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
    if (patch.type !== undefined) { sets.push('type = ?'); params.push(patch.type); }
    if (patch.groupBy !== undefined) { sets.push('group_by = ?'); params.push(patch.groupBy); }
    if (patch.hideEmptyGroups !== undefined) { sets.push('hide_empty_groups = ?'); params.push(patch.hideEmptyGroups ? 1 : 0); }
    if (patch.filter !== undefined) { sets.push('filter_config = ?'); params.push(JSON.stringify(patch.filter)); }
    if (patch.sort !== undefined) { sets.push('sort_config = ?'); params.push(JSON.stringify(patch.sort)); }
    if (patch.config !== undefined) { sets.push('config = ?'); params.push(JSON.stringify(patch.config)); }
    if (sets.length === 0) return;
    sets.push("updated_at = datetime('now')");
    params.push(viewId, databaseId);
    const res = await this._db.run(
      `UPDATE database_views SET ${sets.join(', ')} WHERE id = ? AND database_id = ?`,
      params,
    );
    if (res.error) throw new Error(res.error.message);
    this._onDidChangeStructure.fire(databaseId);
  }

  async deleteView(databaseId: string, viewId: string): Promise<void> {
    const views = await this.listViews(databaseId);
    if (views.length <= 1) throw new Error('A database must keep at least one view.');
    const res = await this._db.run('DELETE FROM database_views WHERE id = ? AND database_id = ?', [viewId, databaseId]);
    if (res.error) throw new Error(res.error.message);
    this._onDidChangeStructure.fire(databaseId);
  }

  // ── Rows ───────────────────────────────────────────────────────────────────

  /** All member rows with their decoded cell values (unfiltered/unsorted —
   *  evaluation belongs to databaseViewModel). */
  async listRows(databaseId: string): Promise<IDatabaseRow[]> {
    const [membersRes, valuesRes] = await Promise.all([
      this._db.all(
        `SELECT dp.page_id, dp.sort_order, p.title, p.icon, p.created_at, p.updated_at
           FROM database_pages dp JOIN pages p ON p.id = dp.page_id
          WHERE dp.database_id = ? AND p.is_archived = 0
          ORDER BY dp.sort_order`,
        [databaseId],
      ),
      this._db.all(
        'SELECT page_id, property_id, value FROM page_property_values WHERE database_id = ?',
        [databaseId],
      ),
    ]);
    if (membersRes.error) throw new Error(membersRes.error.message);
    if (valuesRes.error) throw new Error(valuesRes.error.message);

    const valuesByPage = new Map<string, Record<string, unknown>>();
    for (const v of valuesRes.rows ?? []) {
      const pageId = v.page_id as string;
      if (!valuesByPage.has(pageId)) valuesByPage.set(pageId, {});
      let decoded: unknown = null;
      try { decoded = JSON.parse((v.value as string) ?? 'null'); } catch { decoded = v.value; }
      valuesByPage.get(pageId)![v.property_id as string] = decoded;
    }

    return (membersRes.rows ?? []).map((m) => ({
      pageId: m.page_id as string,
      title: (m.title as string) ?? 'Untitled',
      icon: (m.icon as string) ?? null,
      sortOrder: (m.sort_order as number) ?? 0,
      values: valuesByPage.get(m.page_id as string) ?? {},
      createdAt: m.created_at as string,
      updatedAt: m.updated_at as string,
    }));
  }

  /** Create a row: a child page of the database + a membership row. */
  async addRow(databaseId: string, title?: string): Promise<IDatabaseRow> {
    const page = await this._pages.createPage(databaseId, title || 'Untitled');
    const orderRes = await this._db.get(
      'SELECT MAX(sort_order) as max_sort FROM database_pages WHERE database_id = ?',
      [databaseId],
    );
    const sortOrder = ((orderRes.row?.max_sort as number) ?? 0) + 1;
    const res = await this._db.run(
      'INSERT INTO database_pages (database_id, page_id, sort_order) VALUES (?, ?, ?)',
      [databaseId, page.id, sortOrder],
    );
    if (res.error) throw new Error(res.error.message);
    this._onDidChangeRows.fire(databaseId);
    return {
      pageId: page.id, title: page.title, icon: page.icon, sortOrder,
      values: {}, createdAt: page.createdAt, updatedAt: page.updatedAt,
    };
  }

  /**
   * Add an EXISTING page as a row — membership only, the page keeps its place
   * in the tree (database membership is the database_pages table, not
   * parent_id). SINGLE-HOME INVARIANT: a page belongs to AT MOST ONE database
   * (its home — Notion semantics; the home's schema IS the page's properties).
   * Adding a page that already has a DIFFERENT home throws. Idempotent for
   * the same home.
   */
  async addExistingPageAsRow(databaseId: string, pageId: string): Promise<void> {
    const home = await this.getHomeDatabaseForPage(pageId);
    if (home && home !== databaseId) {
      const info = await this.getDatabase(home);
      throw new Error(
        `Page ${pageId} already belongs to the database "${info?.title ?? home}" — a page has exactly one home database.`,
      );
    }
    const orderRes = await this._db.get(
      'SELECT MAX(sort_order) as max_sort FROM database_pages WHERE database_id = ?',
      [databaseId],
    );
    const sortOrder = ((orderRes.row?.max_sort as number) ?? 0) + 1;
    const res = await this._db.run(
      'INSERT OR IGNORE INTO database_pages (database_id, page_id, sort_order) VALUES (?, ?, ?)',
      [databaseId, pageId, sortOrder],
    );
    if (res.error) throw new Error(res.error.message);
    this._onDidChangeRows.fire(databaseId);
  }

  /** The page's HOME database (single-home invariant), or null. */
  async getHomeDatabaseForPage(pageId: string): Promise<string | null> {
    const res = await this._db.get(
      'SELECT database_id FROM database_pages WHERE page_id = ? ORDER BY created_at LIMIT 1',
      [pageId],
    );
    return res.row ? (res.row.database_id as string) : null;
  }

  /**
   * Collapse any multi-membership left by earlier versions into the
   * single-home model: the page's home is its first NON-"Tags" membership
   * (richer schema) — else the first membership. Every other membership's
   * values are MERGED into the home (same-named columns created as needed,
   * values copied when the home's cell is empty), then dropped. Idempotent and
   * cheap (no-op when no page has more than one membership).
   */
  async reconcileSingleHome(): Promise<number> {
    const multi = await this._db.all(
      'SELECT page_id FROM database_pages GROUP BY page_id HAVING COUNT(*) > 1',
    );
    const pageIds = (multi.rows ?? []).map((r) => r.page_id as string);
    if (pageIds.length === 0) return 0;

    for (const pageId of pageIds) {
      const memberships = await this._db.all(
        `SELECT dp.database_id, p.title FROM database_pages dp JOIN pages p ON p.id = dp.database_id
          WHERE dp.page_id = ? ORDER BY dp.created_at`,
        [pageId],
      );
      const rows = memberships.rows ?? [];
      if (rows.length <= 1) continue;
      const home = (rows.find((r) => r.title !== 'Tags') ?? rows[0]).database_id as string;
      const homeProps = await this.listProperties(home);
      const homeValues = await this.getRowValues(home, pageId);

      for (const m of rows) {
        const otherId = m.database_id as string;
        if (otherId === home) continue;
        const otherProps = await this.listProperties(otherId);
        const otherValues = await this.getRowValues(otherId, pageId);
        for (const prop of otherProps) {
          const value = otherValues[prop.id];
          if (value === null || value === undefined) continue;
          let target = homeProps.find((p) => p.name.toLowerCase() === prop.name.toLowerCase());
          if (!target) {
            target = await this.addProperty(home, prop.name, prop.type, prop.config);
            homeProps.push(target);
          }
          const existing = homeValues[target.id];
          const empty = existing === null || existing === undefined || existing === '' || (Array.isArray(existing) && existing.length === 0);
          if (empty) await this.setCellValue(home, pageId, target.id, value);
        }
        // Drop the extra membership + its cells (values merged above).
        await this._db.runTransaction([
          { type: 'run', sql: 'DELETE FROM page_property_values WHERE page_id = ? AND database_id = ?', params: [pageId, otherId] },
          { type: 'run', sql: 'DELETE FROM database_pages WHERE database_id = ? AND page_id = ?', params: [otherId, pageId] },
        ]);
        this._onDidChangeRows.fire(otherId);
      }
      this._onDidChangeRows.fire(home);
    }
    return pageIds.length;
  }

  /** Remove a row: drop membership + its cell values, and archive the page (trash). */
  async removeRow(databaseId: string, pageId: string): Promise<void> {
    const txn = await this._db.runTransaction([
      { type: 'run', sql: 'DELETE FROM page_property_values WHERE page_id = ? AND database_id = ?', params: [pageId, databaseId] },
      { type: 'run', sql: 'DELETE FROM database_pages WHERE database_id = ? AND page_id = ?', params: [databaseId, pageId] },
    ]);
    if (txn.error) throw new Error(txn.error.message);
    try { await this._pages.archivePage(pageId); } catch { /* membership already gone; page archive is best-effort */ }
    this._onDidChangeRows.fire(databaseId);
  }

  /** Upsert one cell. Values are stored JSON-encoded. */
  async setCellValue(databaseId: string, pageId: string, propertyId: string, value: unknown): Promise<void> {
    const res = await this._db.run(
      `INSERT INTO page_property_values (page_id, property_id, database_id, value, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(page_id, property_id, database_id)
       DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [pageId, propertyId, databaseId, JSON.stringify(value ?? null)],
    );
    if (res.error) throw new Error(res.error.message);
    this._onDidChangeRows.fire(databaseId);
    this._onDidChangeCell.fire({ databaseId, pageId });
  }

  /** Rename a row (delegates to the page title — cards/sidebar stay in sync). */
  async renameRow(databaseId: string, pageId: string, title: string): Promise<void> {
    await this._pages.updatePage(pageId, { title });
    this._onDidChangeRows.fire(databaseId);
  }

  /** Find a live database by exact page title (e.g. the workspace 'Tags'). */
  async findDatabaseByTitle(title: string): Promise<string | null> {
    const res = await this._db.get(
      'SELECT d.id FROM databases d JOIN pages p ON p.id = d.id WHERE p.title = ? AND p.is_archived = 0',
      [title],
    );
    return res.row ? (res.row.id as string) : null;
  }

  /**
   * Ensure a well-known workspace database exists (created lazily, no Status
   * seed), optionally with one seeded property. Returns the database id and —
   * when a seed property name is given — that property's id.
   *
   * Backs the always-present property panel: the 'Tags' database (every page
   * can be tagged; tagging joins the page to it) and the 'Page properties'
   * bucket ('+ Add property' on a page that's in no other database).
   */
  async ensureWorkspaceDatabase(
    title: string,
    seedProperty?: { name: string; type: PropertyType; config?: Record<string, unknown> },
  ): Promise<{ databaseId: string; propertyId?: string }> {
    let databaseId = await this.findDatabaseByTitle(title);
    if (!databaseId) {
      databaseId = (await this.createDatabase({ title, seedDefaults: false })).id;
    }
    if (!seedProperty) return { databaseId };
    const props = await this.listProperties(databaseId);
    const existing = props.find((p) => p.name.toLowerCase() === seedProperty.name.toLowerCase());
    if (existing) return { databaseId, propertyId: existing.id };
    const created = await this.addProperty(databaseId, seedProperty.name, seedProperty.type, seedProperty.config ?? {});
    return { databaseId, propertyId: created.id };
  }

  /** Notify listeners that a database's rows/cells changed via an external
   *  writer (e.g. the canvas_set_page_property tool's raw upsert) so open
   *  database editors and row sections refresh. */
  notifyRowsChanged(databaseId: string): void {
    this._onDidChangeRows.fire(databaseId);
  }

  /** The databases this page is a member (row) of. Drives the row-page
   *  properties section shown when a row is opened as a page. */
  async listDatabasesForPage(pageId: string): Promise<string[]> {
    const res = await this._db.all('SELECT database_id FROM database_pages WHERE page_id = ?', [pageId]);
    if (res.error) return [];
    return (res.rows ?? []).map((r) => r.database_id as string);
  }

  /** One row's decoded cell values for a database. */
  async getRowValues(databaseId: string, pageId: string): Promise<Record<string, unknown>> {
    const res = await this._db.all(
      'SELECT property_id, value FROM page_property_values WHERE database_id = ? AND page_id = ?',
      [databaseId, pageId],
    );
    const out: Record<string, unknown> = {};
    for (const r of res.rows ?? []) {
      try { out[r.property_id as string] = JSON.parse((r.value as string) ?? 'null'); }
      catch { out[r.property_id as string] = r.value; }
    }
    return out;
  }
}
