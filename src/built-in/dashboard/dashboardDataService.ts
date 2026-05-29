// dashboardDataService.ts — DB wrapper for the dashboard tool.
//
// Owns dashboard_pages + dashboard_widgets. Exposes typed CRUD,
// change events, and a small set of "fan-out" helpers (load page + all
// its widgets in one round trip). Same access pattern as
// CanvasDataService — typed wrapper around window.parallxElectron.database.

import { Disposable } from '../../platform/lifecycle.js';
import { Emitter, type Event } from '../../platform/events.js';
import type {
  DashboardChangeEvent,
  DashboardPageRow,
  DashboardWidgetRow,
  WidgetAppearance,
  WidgetPlacement,
  WidgetRefreshPolicy,
  WidgetStatus,
} from './dashboardTypes.js';
import { DASHBOARD_LIMITS, DEFAULT_WIDGET_APPEARANCE } from './dashboardTypes.js';

// ─── DB bridge type ──────────────────────────────────────────────────────────

interface DatabaseBridge {
  run(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; changes?: number }>;
  get(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; rows?: Record<string, unknown>[] }>;
}

// ─── Row mapping helpers ─────────────────────────────────────────────────────

function rowToPage(row: Record<string, unknown>): DashboardPageRow {
  return {
    id: row.id as string,
    name: (row.name as string) ?? 'Untitled',
    position: (row.position as number) ?? 0,
    headerHidden: Number(row.header_hidden ?? 0) === 1,
    createdAt: (row.created_at as number) ?? 0,
    updatedAt: (row.updated_at as number) ?? 0,
  };
}

function parseAppearance(raw: string | undefined): WidgetAppearance {
  if (!raw) return DEFAULT_WIDGET_APPEARANCE;
  try {
    const p = JSON.parse(raw) as Partial<WidgetAppearance>;
    return {
      background: p.background === 'transparent' || p.background === 'custom' ? p.background : 'default',
      backgroundColor: typeof p.backgroundColor === 'string' ? p.backgroundColor : null,
      border: p.border === 'none' || p.border === 'custom' ? p.border : 'default',
      borderColor: typeof p.borderColor === 'string' ? p.borderColor : null,
      title: typeof p.title === 'string' && p.title.trim() ? p.title : null,
      titleHidden: p.titleHidden === true,
    };
  } catch {
    return DEFAULT_WIDGET_APPEARANCE;
  }
}

function rowToWidget(row: Record<string, unknown>): DashboardWidgetRow {
  const placement: WidgetPlacement = {
    row: (row.row as number) ?? 0,
    col: (row.col as number) ?? 0,
    rowSpan: (row.row_span as number) ?? 1,
    colSpan: (row.col_span as number) ?? 4,
  };

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse((row.config_json as string) ?? '{}') ?? {};
  } catch { /* keep default */ }

  let policy: WidgetRefreshPolicy = { kind: 'manual' };
  try {
    const parsed = JSON.parse((row.refresh_policy_json as string) ?? '{"kind":"manual"}') as WidgetRefreshPolicy;
    if (parsed && typeof parsed === 'object' && 'kind' in parsed) policy = parsed;
  } catch { /* keep default */ }

  const status = (row.status as WidgetStatus) ?? 'ok';

  return {
    id: row.id as string,
    pageId: row.page_id as string,
    widgetTypeId: row.widget_type_id as string,
    placement,
    position: (row.position as number) ?? 0,
    config,
    refreshPolicy: policy,
    appearance: parseAppearance(row.appearance_json as string | undefined),
    cachedOutput: (row.cached_output as string) ?? null,
    cachedAt: (row.cached_at as number) ?? null,
    status,
    errorMessage: (row.error_message as string) ?? null,
    createdAt: (row.created_at as number) ?? 0,
    updatedAt: (row.updated_at as number) ?? 0,
  };
}

// ─── ID generation ───────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  // Compact, sortable-by-time random id. crypto.randomUUID is broadly
  // available in Electron renderer; fall back to a timestamp+random pair
  // if unavailable. The dashboard never relies on opaque UUID format.
  const cryptoApi = (globalThis as any).crypto;
  if (cryptoApi?.randomUUID) {
    return `${prefix}-${cryptoApi.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class DashboardDataService extends Disposable {
  private readonly _onDidChange = this._register(new Emitter<DashboardChangeEvent>());
  /** Fires when pages or widgets mutate. */
  readonly onDidChange: Event<DashboardChangeEvent> = this._onDidChange.event;

  // ── DB accessor ──

  private get _db(): DatabaseBridge {
    const electron = (window as any).parallxElectron;
    if (!electron?.database) {
      throw new Error('[DashboardDataService] window.parallxElectron.database not available');
    }
    return electron.database as DatabaseBridge;
  }

  // ── Pages ───────────────────────────────────────────────────────────────

  async listPages(): Promise<DashboardPageRow[]> {
    const res = await this._db.all(
      `SELECT id, name, position, header_hidden, created_at, updated_at
         FROM dashboard_pages
        ORDER BY position ASC, created_at ASC`,
    );
    if (res.error) {
      console.error('[DashboardDataService] listPages failed:', res.error.message);
      return [];
    }
    return (res.rows ?? []).map(rowToPage);
  }

  async getPage(id: string): Promise<DashboardPageRow | null> {
    const res = await this._db.get(
      `SELECT id, name, position, header_hidden, created_at, updated_at
         FROM dashboard_pages WHERE id = ?`,
      [id],
    );
    if (res.error || !res.row) return null;
    return rowToPage(res.row);
  }

  async createPage(name: string = 'Dashboard'): Promise<DashboardPageRow> {
    const id = generateId('dash');
    const now = Date.now();

    // Append at end — find current max position.
    const maxRes = await this._db.get(
      `SELECT COALESCE(MAX(position), -1) AS maxpos FROM dashboard_pages`,
    );
    const nextPos = ((maxRes.row?.maxpos as number) ?? -1) + 1;

    const res = await this._db.run(
      `INSERT INTO dashboard_pages (id, name, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, name, nextPos, now, now],
    );
    if (res.error) throw new Error(`createPage failed: ${res.error.message}`);

    const page: DashboardPageRow = { id, name, position: nextPos, headerHidden: false, createdAt: now, updatedAt: now };
    this._onDidChange.fire({ kind: 'page-created', pageId: id });
    return page;
  }

  async renamePage(id: string, name: string): Promise<void> {
    const now = Date.now();
    const res = await this._db.run(
      `UPDATE dashboard_pages SET name = ?, updated_at = ? WHERE id = ?`,
      [name, now, id],
    );
    if (res.error) throw new Error(`renamePage failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'page-renamed', pageId: id });
  }

  async removePage(id: string): Promise<void> {
    const res = await this._db.run(`DELETE FROM dashboard_pages WHERE id = ?`, [id]);
    if (res.error) throw new Error(`removePage failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'page-removed', pageId: id });
  }

  async setPageHeaderHidden(id: string, hidden: boolean): Promise<void> {
    const res = await this._db.run(
      `UPDATE dashboard_pages SET header_hidden = ?, updated_at = ? WHERE id = ?`,
      [hidden ? 1 : 0, Date.now(), id],
    );
    if (res.error) throw new Error(`setPageHeaderHidden failed: ${res.error.message}`);
  }

  /**
   * Convenience — return any existing page, or create a default one if none exist.
   * Used by the dashboard's first-open auto-create path.
   */
  async ensureDefaultPage(): Promise<DashboardPageRow> {
    const pages = await this.listPages();
    if (pages.length > 0) return pages[0];
    return this.createPage('Dashboard');
  }

  // ── Widgets ─────────────────────────────────────────────────────────────

  async listWidgets(pageId: string): Promise<DashboardWidgetRow[]> {
    const res = await this._db.all(
      `SELECT id, page_id, widget_type_id, row, col, row_span, col_span, position,
              config_json, refresh_policy_json, appearance_json, cached_output, cached_at, status,
              error_message, created_at, updated_at
         FROM dashboard_widgets
        WHERE page_id = ?
        ORDER BY row ASC, col ASC, position ASC`,
      [pageId],
    );
    if (res.error) {
      console.error('[DashboardDataService] listWidgets failed:', res.error.message);
      return [];
    }
    return (res.rows ?? []).map(rowToWidget);
  }

  async getWidget(id: string): Promise<DashboardWidgetRow | null> {
    const res = await this._db.get(
      `SELECT id, page_id, widget_type_id, row, col, row_span, col_span, position,
              config_json, refresh_policy_json, appearance_json, cached_output, cached_at, status,
              error_message, created_at, updated_at
         FROM dashboard_widgets WHERE id = ?`,
      [id],
    );
    if (res.error || !res.row) return null;
    return rowToWidget(res.row);
  }

  async createWidget(input: {
    pageId: string;
    widgetTypeId: string;
    placement: WidgetPlacement;
    config: Record<string, unknown>;
    refreshPolicy: WidgetRefreshPolicy;
  }): Promise<DashboardWidgetRow> {
    const id = generateId('widget');
    const now = Date.now();

    // Append-at-end ordering for same-cell ties — find max position on the page.
    const maxRes = await this._db.get(
      `SELECT COALESCE(MAX(position), -1) AS maxpos FROM dashboard_widgets WHERE page_id = ?`,
      [input.pageId],
    );
    const nextPos = ((maxRes.row?.maxpos as number) ?? -1) + 1;

    const res = await this._db.run(
      `INSERT INTO dashboard_widgets
         (id, page_id, widget_type_id, row, col, row_span, col_span, position,
          config_json, refresh_policy_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?)`,
      [
        id, input.pageId, input.widgetTypeId,
        input.placement.row, input.placement.col,
        input.placement.rowSpan, input.placement.colSpan, nextPos,
        JSON.stringify(input.config),
        JSON.stringify(input.refreshPolicy),
        now, now,
      ],
    );
    if (res.error) throw new Error(`createWidget failed: ${res.error.message}`);

    const widget: DashboardWidgetRow = {
      id,
      pageId: input.pageId,
      widgetTypeId: input.widgetTypeId,
      placement: input.placement,
      position: nextPos,
      config: input.config,
      refreshPolicy: input.refreshPolicy,
      appearance: DEFAULT_WIDGET_APPEARANCE,
      cachedOutput: null,
      cachedAt: null,
      status: 'ok',
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this._onDidChange.fire({ kind: 'widget-added', pageId: input.pageId, widgetId: id });
    return widget;
  }

  async updateWidgetPlacement(id: string, placement: WidgetPlacement): Promise<void> {
    const now = Date.now();
    const res = await this._db.run(
      `UPDATE dashboard_widgets
          SET row = ?, col = ?, row_span = ?, col_span = ?, updated_at = ?
        WHERE id = ?`,
      [placement.row, placement.col, placement.rowSpan, placement.colSpan, now, id],
    );
    if (res.error) throw new Error(`updateWidgetPlacement failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'widget-updated', widgetId: id });
  }

  async updateWidgetConfig(id: string, config: Record<string, unknown>): Promise<void> {
    const now = Date.now();
    const res = await this._db.run(
      `UPDATE dashboard_widgets SET config_json = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(config), now, id],
    );
    if (res.error) throw new Error(`updateWidgetConfig failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'widget-updated', widgetId: id });
  }

  async updateWidgetAppearance(id: string, appearance: WidgetAppearance): Promise<void> {
    const now = Date.now();
    const res = await this._db.run(
      `UPDATE dashboard_widgets SET appearance_json = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(appearance), now, id],
    );
    if (res.error) throw new Error(`updateWidgetAppearance failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'widget-updated', widgetId: id });
  }

  async updateWidgetRefreshPolicy(id: string, policy: WidgetRefreshPolicy): Promise<void> {
    const now = Date.now();
    const res = await this._db.run(
      `UPDATE dashboard_widgets SET refresh_policy_json = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(policy), now, id],
    );
    if (res.error) throw new Error(`updateWidgetRefreshPolicy failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'widget-updated', widgetId: id });
  }

  async setWidgetCachedOutput(id: string, output: string): Promise<void> {
    // Hard limit — truncate larger outputs and prefix a marker.
    const truncated = output.length > DASHBOARD_LIMITS.MAX_CACHED_OUTPUT_BYTES
      ? `[Truncated, ${output.length} bytes total]\n\n${output.slice(0, DASHBOARD_LIMITS.MAX_CACHED_OUTPUT_BYTES)}`
      : output;

    const now = Date.now();
    const res = await this._db.run(
      `UPDATE dashboard_widgets
          SET cached_output = ?, cached_at = ?, status = 'ok', error_message = NULL, updated_at = ?
        WHERE id = ?`,
      [truncated, now, now, id],
    );
    if (res.error) throw new Error(`setWidgetCachedOutput failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'widget-cache', widgetId: id });
  }

  async setWidgetError(id: string, message: string): Promise<void> {
    const now = Date.now();
    const res = await this._db.run(
      `UPDATE dashboard_widgets
          SET status = 'error', error_message = ?, updated_at = ?
        WHERE id = ?`,
      [message, now, id],
    );
    if (res.error) throw new Error(`setWidgetError failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'widget-status', widgetId: id });
  }

  async clearWidgetError(id: string): Promise<void> {
    const now = Date.now();
    const res = await this._db.run(
      `UPDATE dashboard_widgets
          SET status = 'ok', error_message = NULL, updated_at = ?
        WHERE id = ?`,
      [now, id],
    );
    if (res.error) throw new Error(`clearWidgetError failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'widget-status', widgetId: id });
  }

  async setWidgetStatus(id: string, status: WidgetStatus): Promise<void> {
    const now = Date.now();
    const res = await this._db.run(
      `UPDATE dashboard_widgets SET status = ?, updated_at = ? WHERE id = ?`,
      [status, now, id],
    );
    if (res.error) throw new Error(`setWidgetStatus failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'widget-status', widgetId: id });
  }

  async removeWidget(id: string): Promise<void> {
    const res = await this._db.run(`DELETE FROM dashboard_widgets WHERE id = ?`, [id]);
    if (res.error) throw new Error(`removeWidget failed: ${res.error.message}`);
    this._onDidChange.fire({ kind: 'widget-removed', widgetId: id });
  }
}
