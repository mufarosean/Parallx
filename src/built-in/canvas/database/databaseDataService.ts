// databaseDataService.ts — renderer-side database CRUD + change events
//
// Wraps window.parallxElectron.database.* IPC calls into a typed,
// event-driven API for database operations. Provides database, property,
// row, view, and property value CRUD with change notifications.
//
// Follows the same pattern as CanvasDataService:
//   - Extends Disposable for lifecycle
//   - Uses Emitter<T> for change events
//   - Accesses IPC via private _db bridge accessor
//   - Row mapper functions convert raw SQLite rows to typed interfaces
//
// Dependency rules:
//   - Imports from platform/ (lifecycle, events)
//   - Imports from databaseTypes (local types)
//   - Imports IPage from canvasTypes (type-only, for row model)
//   - Must NOT import from canvas registries, extensions, or CanvasDataService

import { Disposable } from '../../../platform/lifecycle.js';
import { Emitter, type Event } from '../../../platform/events.js';
import type { IPage } from '../canvasTypes.js';
import {
  CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
  encodeCanvasContentFromDoc,
} from '../contentSchema.js';
import {
  type IDatabase,
  type IDatabaseProperty,
  type IDatabaseRow,
  type IDatabaseView,
  type IDatabaseViewConfig,
  type IDatabaseDataService,
  type IPropertyValue,
  type PropertyType,
  type PropertyConfig,
  type ViewType,
  type DatabaseUpdateData,
  type PropertyUpdateData,
  type ViewUpdateData,
  type DatabaseChangeEvent,
  type PropertyChangeEvent,
  type RowChangeEvent,
  type ViewChangeEvent,
  type IFilterGroup,
  type ISortRule,
  DatabaseChangeKind,
} from './databaseTypes.js';

// ─── Database Bridge Type ────────────────────────────────────────────────────

interface DatabaseBridge {
  run(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; changes?: number; lastInsertRowid?: number }>;
  get(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; rows?: Record<string, unknown>[] }>;
  runTransaction(operations: { type: 'run' | 'get' | 'all'; sql: string; params?: unknown[] }[]): Promise<{ error: { code: string; message: string } | null; results?: unknown[] }>;
}

// ─── Row → typed mapping ─────────────────────────────────────────────────────

/** @internal Exported for testing — converts a raw database row to IDatabase. */
export function rowToDatabase(row: Record<string, unknown>): IDatabase {
  return {
    id: row.id as string,
    pageId: row.page_id as string,
    description: (row.description as string) ?? null,
    isLocked: !!(row.is_locked as number),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** @internal Exported for testing — converts a raw database row to IDatabaseProperty. */
export function rowToProperty(row: Record<string, unknown>): IDatabaseProperty {
  let config: PropertyConfig;
  try {
    config = JSON.parse((row.config as string) || '{}');
  } catch {
    config = {} as Record<string, never>;
  }
  return {
    id: row.id as string,
    databaseId: row.database_id as string,
    name: row.name as string,
    type: row.type as PropertyType,
    config,
    visibility: (row.visibility as string as import('./databaseTypes.js').PropertyVisibility) ?? 'always_show',
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** @internal Exported for testing — converts a raw database row to IDatabaseView. */
export function rowToView(row: Record<string, unknown>): IDatabaseView {
  let filterConfig: IFilterGroup;
  try {
    filterConfig = JSON.parse((row.filter_config as string) || '{"conjunction":"and","rules":[]}');
  } catch {
    filterConfig = { conjunction: 'and', rules: [] };
  }

  let sortConfig: ISortRule[];
  try {
    sortConfig = JSON.parse((row.sort_config as string) || '[]');
  } catch {
    sortConfig = [];
  }

  let config: IDatabaseViewConfig;
  try {
    config = JSON.parse((row.config as string) || '{}');
  } catch {
    config = {};
  }

  return {
    id: row.id as string,
    databaseId: row.database_id as string,
    name: row.name as string,
    type: row.type as ViewType,
    groupBy: (row.group_by as string) ?? null,
    subGroupBy: (row.sub_group_by as string) ?? null,
    boardGroupProperty: (row.board_group_property as string) ?? null,
    hideEmptyGroups: !!(row.hide_empty_groups as number),
    filterConfig,
    sortConfig,
    config,
    sortOrder: row.sort_order as number,
    isLocked: !!(row.is_locked as number),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** @internal Exported for testing — converts a raw page row to IPage. */
export function rowToPage(row: Record<string, unknown>): IPage {
  return {
    id: row.id as string,
    parentId: (row.parent_id as string) ?? null,
    title: row.title as string,
    icon: (row.icon as string) ?? null,
    content: row.content as string,
    contentSchemaVersion: (row.content_schema_version as number) ?? CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
    revision: (row.revision as number) ?? 1,
    sortOrder: row.sort_order as number,
    isArchived: !!(row.is_archived as number),
    coverUrl: (row.cover_url as string) ?? null,
    coverYOffset: (row.cover_y_offset as number) ?? 0.5,
    fontFamily: (row.font_family as 'default' | 'serif' | 'mono') ?? 'default',
    fullWidth: !!(row.full_width as number),
    smallText: !!(row.small_text as number),
    isLocked: !!(row.is_locked as number),
    isFavorited: !!(row.is_favorited as number),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** @internal Parse a JSON property value string. */
export function parsePropertyValue(json: string): IPropertyValue {
  try {
    return JSON.parse(json);
  } catch {
    // Fallback: treat as null rich_text
    return { type: 'rich_text', rich_text: [] };
  }
}

// ─── DatabaseDataService ─────────────────────────────────────────────────────

/**
 * Renderer-side data service for Canvas databases.
 *
 * Created eagerly in canvas/main.ts alongside CanvasDataService (DD-1).
 * All database access goes through IPC to the main process. This service
 * provides typed methods, change events, and transactional operations.
 */
export class DatabaseDataService extends Disposable implements IDatabaseDataService {

  // ── Events ──

  private readonly _onDidChangeDatabase = this._register(new Emitter<DatabaseChangeEvent>());
  readonly onDidChangeDatabase: Event<DatabaseChangeEvent> = this._onDidChangeDatabase.event;

  private readonly _onDidChangeProperty = this._register(new Emitter<PropertyChangeEvent>());
  readonly onDidChangeProperty: Event<PropertyChangeEvent> = this._onDidChangeProperty.event;

  private readonly _onDidChangeRow = this._register(new Emitter<RowChangeEvent>());
  readonly onDidChangeRow: Event<RowChangeEvent> = this._onDidChangeRow.event;

  private readonly _onDidChangeView = this._register(new Emitter<ViewChangeEvent>());
  readonly onDidChangeView: Event<ViewChangeEvent> = this._onDidChangeView.event;

  // ── Bridge accessor (same pattern as CanvasDataService) ──

  private get _db(): DatabaseBridge {
    const electron = (window as any).parallxElectron;
    if (!electron?.database) {
      throw new Error('[DatabaseDataService] window.parallxElectron.database not available');
    }
    return electron.database;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Database CRUD
  // ══════════════════════════════════════════════════════════════════════════

  async createDatabase(pageId: string): Promise<IDatabase> {
    const titlePropertyId = crypto.randomUUID();
    const defaultViewId = crypto.randomUUID();

    // Transaction: create database + default "Name" property + default "Table" view
    const result = await this._db.runTransaction([
      {
        type: 'run',
        sql: `INSERT INTO databases (id, page_id) VALUES (?, ?)`,
        params: [pageId, pageId],
      },
      {
        type: 'run',
        sql: `INSERT INTO database_properties (id, database_id, name, type, sort_order)
              VALUES (?, ?, 'Name', 'title', 0)`,
        params: [titlePropertyId, pageId],
      },
      {
        type: 'run',
        sql: `INSERT INTO database_views (id, database_id, name, type, sort_order, config)
              VALUES (?, ?, 'Table', 'table', 0, ?)`,
        params: [defaultViewId, pageId, JSON.stringify({ visibleProperties: [titlePropertyId] })],
      },
    ]);
    if (result.error) throw new Error(result.error.message);

    const db = await this.getDatabase(pageId);
    if (!db) throw new Error(`[DatabaseDataService] Created database "${pageId}" not found after insert`);

    this._onDidChangeDatabase.fire({ kind: DatabaseChangeKind.Created, databaseId: pageId, database: db });
    return db;
  }

  async getDatabase(databaseId: string): Promise<IDatabase | null> {
    const result = await this._db.get(
      'SELECT * FROM databases WHERE id = ?',
      [databaseId],
    );
    if (result.error) throw new Error(result.error.message);
    return result.row ? rowToDatabase(result.row) : null;
  }

  async getDatabaseByPageId(pageId: string): Promise<IDatabase | null> {
    // Since id = page_id (DD-0), this is the same query — but semantically
    // clearer when the caller has a page ID rather than a database ID.
    const result = await this._db.get(
      'SELECT * FROM databases WHERE page_id = ?',
      [pageId],
    );
    if (result.error) throw new Error(result.error.message);
    return result.row ? rowToDatabase(result.row) : null;
  }

  async getDatabasePageIds(): Promise<Set<string>> {
    const result = await this._db.all('SELECT page_id FROM databases');
    if (result.error) throw new Error(result.error.message);
    const ids = new Set<string>();
    for (const row of result.rows ?? []) {
      if (typeof row.page_id === 'string') ids.add(row.page_id);
    }
    return ids;
  }

  async updateDatabase(databaseId: string, updates: DatabaseUpdateData): Promise<IDatabase> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      params.push(updates.description);
    }
    if (updates.isLocked !== undefined) {
      setClauses.push('is_locked = ?');
      params.push(updates.isLocked ? 1 : 0);
    }

    if (setClauses.length === 0) {
      const db = await this.getDatabase(databaseId);
      if (!db) throw new Error(`[DatabaseDataService] Database "${databaseId}" not found`);
      return db;
    }

    setClauses.push("updated_at = datetime('now')");
    params.push(databaseId);

    const result = await this._db.run(
      `UPDATE databases SET ${setClauses.join(', ')} WHERE id = ?`,
      params,
    );
    if (result.error) throw new Error(result.error.message);

    const db = await this.getDatabase(databaseId);
    if (!db) throw new Error(`[DatabaseDataService] Database "${databaseId}" not found after update`);

    this._onDidChangeDatabase.fire({ kind: DatabaseChangeKind.Updated, databaseId, database: db });
    return db;
  }

  async deleteDatabase(databaseId: string): Promise<void> {
    // ON DELETE CASCADE handles properties, views, values, and membership
    const result = await this._db.run(
      'DELETE FROM databases WHERE id = ?',
      [databaseId],
    );
    if (result.error) throw new Error(result.error.message);

    this._onDidChangeDatabase.fire({ kind: DatabaseChangeKind.Deleted, databaseId });
  }

  /**
   * Duplicate a database's schema (properties, views, property values, row membership)
   * from an existing source database onto a new target page.
   * The target page must already exist. A new database record is created for `targetPageId`.
   */
  async duplicateDatabase(sourceDatabaseId: string, targetPageId: string): Promise<IDatabase> {
    // 1. Create the database record for the target page
    const sourceDb = await this.getDatabase(sourceDatabaseId);
    if (!sourceDb) throw new Error(`[DatabaseDataService] Source database "${sourceDatabaseId}" not found`);

    const newDb = await this.createDatabase(targetPageId);

    // 2. Copy properties (createDatabase already made a "Title" prop — remove it first, then copy all)
    const sourceProps = await this.getProperties(sourceDatabaseId);
    const newDefaultProps = await this.getProperties(targetPageId);
    // Remove auto-created default properties
    for (const defProp of newDefaultProps) {
      await this.removeProperty(targetPageId, defProp.id);
    }

    // Map old property IDs → new property IDs
    const propIdMap = new Map<string, string>();
    for (const prop of sourceProps) {
      const newProp = await this.addProperty(targetPageId, prop.name, prop.type, prop.config ?? undefined);
      propIdMap.set(prop.id, newProp.id);
    }

    // 3. Copy views (createDatabase already made a default view — remove it first)
    const sourceViews = await this.getViews(sourceDatabaseId);
    const newDefaultViews = await this.getViews(targetPageId);
    for (const defView of newDefaultViews) {
      // Force-delete by running SQL directly (deleteView prevents deleting last view)
      await this._db.run('DELETE FROM database_views WHERE id = ?', [defView.id]);
    }

    for (const view of sourceViews) {
      // Remap visibleProperties to new IDs
      let config = view.config ? { ...view.config } : undefined;
      if (config?.visibleProperties) {
        config.visibleProperties = config.visibleProperties
          .map(id => propIdMap.get(id))
          .filter((id): id is string => id !== undefined);
      }
      await this.createView(targetPageId, view.name, view.type, {
        groupBy: view.groupBy ? propIdMap.get(view.groupBy) ?? view.groupBy : undefined,
        subGroupBy: view.subGroupBy ? propIdMap.get(view.subGroupBy) ?? view.subGroupBy : undefined,
        boardGroupProperty: view.boardGroupProperty ? propIdMap.get(view.boardGroupProperty) ?? view.boardGroupProperty : undefined,
        hideEmptyGroups: view.hideEmptyGroups,
        filterConfig: view.filterConfig,
        sortConfig: view.sortConfig,
        config,
        isLocked: false,
      });
    }

    // 4. Copy row membership and property values
    const sourceRows = await this.getRows(sourceDatabaseId);
    for (const row of sourceRows) {
      await this.addRow(targetPageId, row.page.id);
      const values = await this.getPropertyValues(sourceDatabaseId, row.page.id);
      const batch: { propertyId: string; value: IPropertyValue }[] = [];
      for (const [oldPropId, val] of Object.entries(values)) {
        const newPropId = propIdMap.get(oldPropId);
        if (newPropId) {
          batch.push({ propertyId: newPropId, value: val });
        }
      }
      if (batch.length > 0) {
        await this.batchSetPropertyValues(targetPageId, row.page.id, batch);
      }
    }

    this._onDidChangeDatabase.fire({ kind: DatabaseChangeKind.Created, databaseId: targetPageId, database: newDb });
    return newDb;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Property CRUD
  // ══════════════════════════════════════════════════════════════════════════

  async addProperty(databaseId: string, name: string, type: PropertyType, config?: PropertyConfig): Promise<IDatabaseProperty> {
    const propertyId = crypto.randomUUID();
    const configJson = JSON.stringify(config ?? {});

    // Calculate sort order: max sort_order + 1
    const maxResult = await this._db.get(
      'SELECT MAX(sort_order) as max_sort FROM database_properties WHERE database_id = ?',
      [databaseId],
    );
    if (maxResult.error) throw new Error(maxResult.error.message);
    const sortOrder = ((maxResult.row?.max_sort as number) ?? 0) + 1;

    const result = await this._db.run(
      `INSERT INTO database_properties (id, database_id, name, type, config, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [propertyId, databaseId, name, type, configJson, sortOrder],
    );
    if (result.error) throw new Error(result.error.message);

    const property = await this._getProperty(databaseId, propertyId);
    if (!property) throw new Error(`[DatabaseDataService] Created property "${propertyId}" not found after insert`);

    this._onDidChangeProperty.fire({ kind: 'Added', databaseId, propertyId, property });
    return property;
  }

  async updateProperty(databaseId: string, propertyId: string, updates: PropertyUpdateData): Promise<IDatabaseProperty> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      params.push(updates.name);
    }
    if (updates.type !== undefined) {
      setClauses.push('type = ?');
      params.push(updates.type);
    }
    if (updates.config !== undefined) {
      setClauses.push('config = ?');
      params.push(JSON.stringify(updates.config));
    }

    if (setClauses.length === 0) {
      const property = await this._getProperty(databaseId, propertyId);
      if (!property) throw new Error(`[DatabaseDataService] Property "${propertyId}" not found`);
      return property;
    }

    setClauses.push("updated_at = datetime('now')");
    params.push(propertyId, databaseId);

    const result = await this._db.run(
      `UPDATE database_properties SET ${setClauses.join(', ')} WHERE id = ? AND database_id = ?`,
      params,
    );
    if (result.error) throw new Error(result.error.message);

    const property = await this._getProperty(databaseId, propertyId);
    if (!property) throw new Error(`[DatabaseDataService] Property "${propertyId}" not found after update`);

    this._onDidChangeProperty.fire({ kind: 'Updated', databaseId, propertyId, property });
    return property;
  }

  async removeProperty(databaseId: string, propertyId: string): Promise<void> {
    // ON DELETE CASCADE on page_property_values handles value cleanup
    const result = await this._db.run(
      'DELETE FROM database_properties WHERE id = ? AND database_id = ?',
      [propertyId, databaseId],
    );
    if (result.error) throw new Error(result.error.message);

    this._onDidChangeProperty.fire({ kind: 'Removed', databaseId, propertyId });
  }

  async reorderProperties(databaseId: string, orderedIds: string[]): Promise<void> {
    const operations = orderedIds.map((id, index) => ({
      type: 'run' as const,
      sql: `UPDATE database_properties SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND database_id = ?`,
      params: [index, id, databaseId],
    }));

    const result = await this._db.runTransaction(operations);
    if (result.error) throw new Error(result.error.message);

    this._onDidChangeProperty.fire({ kind: 'Reordered', databaseId, propertyId: '' });
  }

  async getProperties(databaseId: string): Promise<IDatabaseProperty[]> {
    const result = await this._db.all(
      'SELECT * FROM database_properties WHERE database_id = ? ORDER BY sort_order',
      [databaseId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.rows ?? []).map(rowToProperty);
  }

  /** @internal Get a single property. */
  private async _getProperty(databaseId: string, propertyId: string): Promise<IDatabaseProperty | null> {
    const result = await this._db.get(
      'SELECT * FROM database_properties WHERE id = ? AND database_id = ?',
      [propertyId, databaseId],
    );
    if (result.error) throw new Error(result.error.message);
    return result.row ? rowToProperty(result.row) : null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Row Membership
  // ══════════════════════════════════════════════════════════════════════════

  async addRow(databaseId: string, pageId?: string): Promise<IDatabaseRow> {
    // Calculate sort order for the new row
    const maxResult = await this._db.get(
      'SELECT MAX(sort_order) as max_sort FROM database_pages WHERE database_id = ?',
      [databaseId],
    );
    if (maxResult.error) throw new Error(maxResult.error.message);
    const sortOrder = ((maxResult.row?.max_sort as number) ?? 0) + 1;

    let actualPageId: string;

    if (pageId) {
      // Add an existing page to the database
      actualPageId = pageId;
      const result = await this._db.run(
        `INSERT INTO database_pages (database_id, page_id, sort_order) VALUES (?, ?, ?)`,
        [databaseId, pageId, sortOrder],
      );
      if (result.error) throw new Error(result.error.message);
    } else {
      // Create a new page and add it — atomic transaction
      actualPageId = crypto.randomUUID();
      const initialContent = encodeCanvasContentFromDoc({ type: 'doc', content: [{ type: 'paragraph' }] });

      const result = await this._db.runTransaction([
        {
          type: 'run',
          sql: `INSERT INTO pages (id, title, content, content_schema_version, sort_order) VALUES (?, 'Untitled', ?, ?, ?)`,
          params: [actualPageId, initialContent.storedContent, initialContent.schemaVersion, sortOrder],
        },
        {
          type: 'run',
          sql: `INSERT INTO database_pages (database_id, page_id, sort_order) VALUES (?, ?, ?)`,
          params: [databaseId, actualPageId, sortOrder],
        },
      ]);
      if (result.error) throw new Error(result.error.message);
    }

    // Create default property values for the new row (Title property gets page title)
    const properties = await this.getProperties(databaseId);
    if (properties.length > 0) {
      const page = await this._getPageById(actualPageId);
      const valueOps = properties.map(prop => {
        let defaultValue: IPropertyValue;
        if (prop.type === 'title') {
          defaultValue = { type: 'title', title: [{ type: 'text', content: page?.title ?? 'Untitled' }] };
        } else {
          defaultValue = _defaultPropertyValue(prop.type);
        }
        return {
          type: 'run' as const,
          sql: `INSERT OR IGNORE INTO page_property_values (page_id, property_id, database_id, value)
                VALUES (?, ?, ?, ?)`,
          params: [actualPageId, prop.id, databaseId, JSON.stringify(defaultValue)],
        };
      });
      const valResult = await this._db.runTransaction(valueOps);
      if (valResult.error) throw new Error(valResult.error.message);
    }

    const row = await this._getRow(databaseId, actualPageId);
    if (!row) throw new Error(`[DatabaseDataService] Row "${actualPageId}" not found after insert`);

    this._onDidChangeRow.fire({ kind: 'Added', databaseId, pageId: actualPageId });
    return row;
  }

  async removeRow(databaseId: string, pageId: string): Promise<void> {
    // Remove membership + values (ON DELETE CASCADE on database_pages doesn't cascade
    // to page_property_values, so we delete values explicitly in a transaction)
    const result = await this._db.runTransaction([
      {
        type: 'run',
        sql: 'DELETE FROM page_property_values WHERE page_id = ? AND database_id = ?',
        params: [pageId, databaseId],
      },
      {
        type: 'run',
        sql: 'DELETE FROM database_pages WHERE database_id = ? AND page_id = ?',
        params: [databaseId, pageId],
      },
    ]);
    if (result.error) throw new Error(result.error.message);

    this._onDidChangeRow.fire({ kind: 'Removed', databaseId, pageId });
  }

  async getRows(databaseId: string): Promise<IDatabaseRow[]> {
    // Join database_pages with pages to get full page data + sort_order
    const result = await this._db.all(
      `SELECT p.*, dp.sort_order as dp_sort_order
       FROM database_pages dp
       JOIN pages p ON p.id = dp.page_id
       WHERE dp.database_id = ?
       ORDER BY dp.sort_order`,
      [databaseId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = result.rows ?? [];

    // Get all property values for this database in one query
    const valuesResult = await this._db.all(
      `SELECT page_id, property_id, value FROM page_property_values WHERE database_id = ?`,
      [databaseId],
    );
    if (valuesResult.error) throw new Error(valuesResult.error.message);

    // Build a map: pageId → { propertyId → value }
    const valuesByPage = new Map<string, Record<string, IPropertyValue>>();
    for (const vRow of (valuesResult.rows ?? [])) {
      const pid = vRow.page_id as string;
      const propId = vRow.property_id as string;
      if (!valuesByPage.has(pid)) valuesByPage.set(pid, {});
      valuesByPage.get(pid)![propId] = parsePropertyValue(vRow.value as string);
    }

    return rows.map(row => ({
      page: rowToPage(row),
      values: valuesByPage.get(row.id as string) ?? {},
      sortOrder: row.dp_sort_order as number,
    }));
  }

  async reorderRows(databaseId: string, orderedPageIds: string[]): Promise<void> {
    const operations = orderedPageIds.map((pageId, index) => ({
      type: 'run' as const,
      sql: `UPDATE database_pages SET sort_order = ? WHERE database_id = ? AND page_id = ?`,
      params: [index, databaseId, pageId],
    }));

    const result = await this._db.runTransaction(operations);
    if (result.error) throw new Error(result.error.message);

    this._onDidChangeRow.fire({ kind: 'Reordered', databaseId, pageId: '' });
  }

  /** @internal Get a single row with its property values. */
  private async _getRow(databaseId: string, pageId: string): Promise<IDatabaseRow | null> {
    const dpResult = await this._db.get(
      'SELECT sort_order FROM database_pages WHERE database_id = ? AND page_id = ?',
      [databaseId, pageId],
    );
    if (dpResult.error) throw new Error(dpResult.error.message);
    if (!dpResult.row) return null;

    const page = await this._getPageById(pageId);
    if (!page) return null;

    const values = await this.getPropertyValues(databaseId, pageId);
    return {
      page,
      values,
      sortOrder: dpResult.row.sort_order as number,
    };
  }

  /** @internal Get a page by ID (direct SQL, no dependency on CanvasDataService). */
  private async _getPageById(pageId: string): Promise<IPage | null> {
    const result = await this._db.get('SELECT * FROM pages WHERE id = ?', [pageId]);
    if (result.error) throw new Error(result.error.message);
    return result.row ? rowToPage(result.row) : null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Property Value CRUD
  // ══════════════════════════════════════════════════════════════════════════

  async setPropertyValue(databaseId: string, pageId: string, propertyId: string, value: IPropertyValue): Promise<void> {
    const result = await this._db.run(
      `INSERT INTO page_property_values (page_id, property_id, database_id, value, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(page_id, property_id, database_id)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [pageId, propertyId, databaseId, JSON.stringify(value)],
    );
    if (result.error) throw new Error(result.error.message);

    this._onDidChangeRow.fire({ kind: 'Updated', databaseId, pageId });
  }

  async getPropertyValues(databaseId: string, pageId: string): Promise<Record<string, IPropertyValue>> {
    const result = await this._db.all(
      'SELECT property_id, value FROM page_property_values WHERE page_id = ? AND database_id = ?',
      [pageId, databaseId],
    );
    if (result.error) throw new Error(result.error.message);

    const values: Record<string, IPropertyValue> = {};
    for (const row of (result.rows ?? [])) {
      values[row.property_id as string] = parsePropertyValue(row.value as string);
    }
    return values;
  }

  async batchSetPropertyValues(databaseId: string, pageId: string, values: { propertyId: string; value: IPropertyValue }[]): Promise<void> {
    if (values.length === 0) return;

    const operations = values.map(({ propertyId, value }) => ({
      type: 'run' as const,
      sql: `INSERT INTO page_property_values (page_id, property_id, database_id, value, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(page_id, property_id, database_id)
            DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      params: [pageId, propertyId, databaseId, JSON.stringify(value)],
    }));

    const result = await this._db.runTransaction(operations);
    if (result.error) throw new Error(result.error.message);

    this._onDidChangeRow.fire({ kind: 'Updated', databaseId, pageId });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // View CRUD
  // ══════════════════════════════════════════════════════════════════════════

  async createView(databaseId: string, name: string, type: ViewType, config?: Partial<IDatabaseView>): Promise<IDatabaseView> {
    const viewId = crypto.randomUUID();

    // Calculate sort order
    const maxResult = await this._db.get(
      'SELECT MAX(sort_order) as max_sort FROM database_views WHERE database_id = ?',
      [databaseId],
    );
    if (maxResult.error) throw new Error(maxResult.error.message);
    const sortOrder = ((maxResult.row?.max_sort as number) ?? 0) + 1;

    const filterConfig = config?.filterConfig ? JSON.stringify(config.filterConfig) : '{"conjunction":"and","rules":[]}';
    const sortCfg = config?.sortConfig ? JSON.stringify(config.sortConfig) : '[]';
    const jsonConfig = config?.config ? JSON.stringify(config.config) : '{}';

    const result = await this._db.run(
      `INSERT INTO database_views
        (id, database_id, name, type, group_by, sub_group_by, board_group_property,
         hide_empty_groups, filter_config, sort_config, config, sort_order, is_locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        viewId, databaseId, name, type,
        config?.groupBy ?? null,
        config?.subGroupBy ?? null,
        config?.boardGroupProperty ?? null,
        config?.hideEmptyGroups ? 1 : 0,
        filterConfig, sortCfg, jsonConfig,
        sortOrder,
        config?.isLocked ? 1 : 0,
      ],
    );
    if (result.error) throw new Error(result.error.message);

    const view = await this.getView(viewId);
    if (!view) throw new Error(`[DatabaseDataService] Created view "${viewId}" not found after insert`);

    this._onDidChangeView.fire({ kind: 'Created', databaseId, viewId, view });
    return view;
  }

  async getViews(databaseId: string): Promise<IDatabaseView[]> {
    const result = await this._db.all(
      'SELECT * FROM database_views WHERE database_id = ? ORDER BY sort_order',
      [databaseId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.rows ?? []).map(rowToView);
  }

  async getView(viewId: string): Promise<IDatabaseView | null> {
    const result = await this._db.get(
      'SELECT * FROM database_views WHERE id = ?',
      [viewId],
    );
    if (result.error) throw new Error(result.error.message);
    return result.row ? rowToView(result.row) : null;
  }

  async updateView(viewId: string, updates: ViewUpdateData): Promise<IDatabaseView> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      params.push(updates.name);
    }
    if (updates.type !== undefined) {
      setClauses.push('type = ?');
      params.push(updates.type);
    }
    if (updates.groupBy !== undefined) {
      setClauses.push('group_by = ?');
      params.push(updates.groupBy);
    }
    if (updates.subGroupBy !== undefined) {
      setClauses.push('sub_group_by = ?');
      params.push(updates.subGroupBy);
    }
    if (updates.boardGroupProperty !== undefined) {
      setClauses.push('board_group_property = ?');
      params.push(updates.boardGroupProperty);
    }
    if (updates.hideEmptyGroups !== undefined) {
      setClauses.push('hide_empty_groups = ?');
      params.push(updates.hideEmptyGroups ? 1 : 0);
    }
    if (updates.filterConfig !== undefined) {
      setClauses.push('filter_config = ?');
      params.push(JSON.stringify(updates.filterConfig));
    }
    if (updates.sortConfig !== undefined) {
      setClauses.push('sort_config = ?');
      params.push(JSON.stringify(updates.sortConfig));
    }
    if (updates.config !== undefined) {
      setClauses.push('config = ?');
      params.push(JSON.stringify(updates.config));
    }
    if (updates.isLocked !== undefined) {
      setClauses.push('is_locked = ?');
      params.push(updates.isLocked ? 1 : 0);
    }

    if (setClauses.length === 0) {
      const view = await this.getView(viewId);
      if (!view) throw new Error(`[DatabaseDataService] View "${viewId}" not found`);
      return view;
    }

    setClauses.push("updated_at = datetime('now')");
    params.push(viewId);

    const result = await this._db.run(
      `UPDATE database_views SET ${setClauses.join(', ')} WHERE id = ?`,
      params,
    );
    if (result.error) throw new Error(result.error.message);

    const view = await this.getView(viewId);
    if (!view) throw new Error(`[DatabaseDataService] View "${viewId}" not found after update`);

    this._onDidChangeView.fire({ kind: 'Updated', databaseId: view.databaseId, viewId, view });
    return view;
  }

  async deleteView(viewId: string): Promise<void> {
    // Get the view first to know its databaseId and to prevent deleting the last view
    const view = await this.getView(viewId);
    if (!view) throw new Error(`[DatabaseDataService] View "${viewId}" not found`);

    const views = await this.getViews(view.databaseId);
    if (views.length <= 1) {
      throw new Error('[DatabaseDataService] Cannot delete the last view of a database');
    }

    const result = await this._db.run(
      'DELETE FROM database_views WHERE id = ?',
      [viewId],
    );
    if (result.error) throw new Error(result.error.message);

    this._onDidChangeView.fire({ kind: 'Deleted', databaseId: view.databaseId, viewId });
  }

  async duplicateView(viewId: string): Promise<IDatabaseView> {
    const original = await this.getView(viewId);
    if (!original) throw new Error(`[DatabaseDataService] View "${viewId}" not found`);

    // Deep-copy config into a new view with a new ID
    return this.createView(original.databaseId, `${original.name} (copy)`, original.type, {
      groupBy: original.groupBy,
      subGroupBy: original.subGroupBy,
      boardGroupProperty: original.boardGroupProperty,
      hideEmptyGroups: original.hideEmptyGroups,
      filterConfig: original.filterConfig,
      sortConfig: original.sortConfig,
      config: original.config,
      isLocked: false, // copies are always unlocked
    });
  }

  async reorderViews(databaseId: string, orderedIds: string[]): Promise<void> {
    const operations = orderedIds.map((id, index) => ({
      type: 'run' as const,
      sql: `UPDATE database_views SET sort_order = ?, updated_at = datetime('now') WHERE id = ?`,
      params: [index, id],
    }));

    const result = await this._db.runTransaction(operations);
    if (result.error) throw new Error(result.error.message);

    this._onDidChangeView.fire({ kind: 'Reordered', databaseId, viewId: '' });
  }
}

// ─── Default Property Values ─────────────────────────────────────────────────

/** Return a sensible default value for a property type (used when creating new rows). */
function _defaultPropertyValue(type: PropertyType): IPropertyValue {
  switch (type) {
    case 'title':           return { type: 'title', title: [{ type: 'text', content: '' }] };
    case 'rich_text':       return { type: 'rich_text', rich_text: [] };
    case 'number':          return { type: 'number', number: null };
    case 'select':          return { type: 'select', select: null };
    case 'multi_select':    return { type: 'multi_select', multi_select: [] };
    case 'status':          return { type: 'status', status: null };
    case 'date':            return { type: 'date', date: null };
    case 'checkbox':        return { type: 'checkbox', checkbox: false };
    case 'url':             return { type: 'url', url: null };
    case 'email':           return { type: 'email', email: null };
    case 'phone_number':    return { type: 'phone_number', phone_number: null };
    case 'files':           return { type: 'files', files: [] };
    case 'relation':        return { type: 'relation', relation: [] };
    case 'rollup':          return { type: 'rollup', rollup: { type: 'number', number: null } };
    case 'formula':         return { type: 'formula', formula: { type: 'string', string: '' } };
    case 'created_time':    return { type: 'created_time', created_time: new Date().toISOString() };
    case 'last_edited_time': return { type: 'last_edited_time', last_edited_time: new Date().toISOString() };
    case 'unique_id':       return { type: 'unique_id', unique_id: { prefix: null, number: 0 } };
  }
}
