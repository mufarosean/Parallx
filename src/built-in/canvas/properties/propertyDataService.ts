// propertyDataService.ts — renderer-side CRUD for Canvas property definitions and page properties
//
// Wraps window.parallxElectron.database.* IPC calls into a typed,
// event-driven API. Provides definition CRUD, page property CRUD,
// and change notifications.
//
// Follows the same pattern as canvasDataService.ts.

import { Disposable } from '../../../platform/lifecycle.js';
import { Emitter, Event } from '../../../platform/events.js';
import {
  isSystemPropertyName,
  type IPropertyDefinition,
  type IPageProperty,
  type IPropertyDataService,
  type IPropertyUsage,
  type PropertyType,
  type PropertyDefinitionChangeEvent,
  type PagePropertyChangeEvent,
} from './propertyTypes.js';

// ─── Database Bridge Type ────────────────────────────────────────────────────

interface DatabaseBridge {
  run(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; changes?: number; lastInsertRowid?: number }>;
  get(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; row?: Record<string, unknown> | null }>;
  all(sql: string, params?: unknown[]): Promise<{ error: { code: string; message: string } | null; rows?: Record<string, unknown>[] }>;
}

// ─── Row Mappers ─────────────────────────────────────────────────────────────

function rowToDefinition(row: Record<string, unknown>): IPropertyDefinition {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(row.config as string || '{}');
  } catch {
    config = {};
  }
  return {
    name: row.name as string,
    type: row.type as PropertyType,
    config,
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToPageProperty(row: Record<string, unknown>): IPageProperty {
  let value: unknown = null;
  try {
    value = JSON.parse(row.value as string ?? 'null');
  } catch {
    value = row.value;
  }
  return {
    id: row.id as string,
    pageId: row.page_id as string,
    key: row.key as string,
    valueType: row.value_type as string,
    value,
  };
}

// ─── PropertyDataService ─────────────────────────────────────────────────────

export class PropertyDataService extends Disposable implements IPropertyDataService {

  // ── Events ──

  private readonly _onDidChangeDefinition = this._register(new Emitter<PropertyDefinitionChangeEvent>());
  readonly onDidChangeDefinition: Event<PropertyDefinitionChangeEvent> = this._onDidChangeDefinition.event;

  private readonly _onDidChangePageProperty = this._register(new Emitter<PagePropertyChangeEvent>());
  readonly onDidChangePageProperty: Event<PagePropertyChangeEvent> = this._onDidChangePageProperty.event;

  // ── Bridge accessor ──

  private get _db(): DatabaseBridge {
    const electron = (window as any).parallxElectron;
    if (!electron?.database) {
      throw new Error('[PropertyDataService] window.parallxElectron.database not available');
    }
    return electron.database;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Definition CRUD
  // ══════════════════════════════════════════════════════════════════════════

  async createDefinition(name: string, type: PropertyType, config: Record<string, unknown> = {}): Promise<IPropertyDefinition> {
    // Calculate sort order: max existing + 1
    const maxResult = await this._db.get(
      'SELECT MAX(sort_order) as max_sort FROM property_definitions',
    );
    if (maxResult.error) throw new Error(maxResult.error.message);
    const sortOrder = ((maxResult.row?.max_sort as number) ?? 0) + 1;

    const result = await this._db.run(
      `INSERT INTO property_definitions (name, type, config, sort_order) VALUES (?, ?, ?, ?)`,
      [name, type, JSON.stringify(config), sortOrder],
    );
    if (result.error) throw new Error(result.error.message);

    const definition = await this.getDefinition(name);
    if (!definition) throw new Error(`[PropertyDataService] Created definition "${name}" not found after insert`);

    this._onDidChangeDefinition.fire({ name, kind: 'created' });
    return definition;
  }

  async getDefinition(name: string): Promise<IPropertyDefinition | null> {
    const result = await this._db.get(
      'SELECT * FROM property_definitions WHERE name = ?',
      [name],
    );
    if (result.error) throw new Error(result.error.message);
    return result.row ? rowToDefinition(result.row) : null;
  }

  async getAllDefinitions(): Promise<IPropertyDefinition[]> {
    const result = await this._db.all(
      'SELECT * FROM property_definitions ORDER BY sort_order',
    );
    if (result.error) throw new Error(result.error.message);
    return (result.rows ?? []).map(rowToDefinition);
  }

  async updateDefinition(
    name: string,
    updates: Partial<Pick<IPropertyDefinition, 'type' | 'config' | 'sortOrder'>>,
  ): Promise<IPropertyDefinition> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.type !== undefined) {
      sets.push('type = ?');
      params.push(updates.type);
    }
    if (updates.config !== undefined) {
      sets.push('config = ?');
      params.push(JSON.stringify(updates.config));
    }
    if (updates.sortOrder !== undefined) {
      sets.push('sort_order = ?');
      params.push(updates.sortOrder);
    }

    if (sets.length === 0) {
      const existing = await this.getDefinition(name);
      if (!existing) throw new Error(`[PropertyDataService] Definition "${name}" not found`);
      return existing;
    }

    sets.push("updated_at = datetime('now')");
    params.push(name);

    const result = await this._db.run(
      `UPDATE property_definitions SET ${sets.join(', ')} WHERE name = ?`,
      params,
    );
    if (result.error) throw new Error(result.error.message);

    const updated = await this.getDefinition(name);
    if (!updated) throw new Error(`[PropertyDataService] Definition "${name}" not found after update`);

    this._onDidChangeDefinition.fire({ name, kind: 'updated' });
    return updated;
  }

  async getPropertyUsage(name: string, excludingPageId?: string): Promise<IPropertyUsage> {
    const result = await this._db.all(
      `SELECT pp.page_id, COALESCE(p.title, 'Untitled') AS title
       FROM page_properties pp
       LEFT JOIN pages p ON pp.page_id = p.id
       WHERE pp.key = ?
       ORDER BY title COLLATE NOCASE, pp.page_id`,
      [name],
    );
    if (result.error) throw new Error(result.error.message);

    const pages = (result.rows ?? []).map((row) => ({
      pageId: row.page_id as string,
      title: (row.title as string) || 'Untitled',
    }));
    const otherPages = excludingPageId
      ? pages.filter((page) => page.pageId !== excludingPageId)
      : pages;

    return {
      totalCount: pages.length,
      pages,
      otherPages,
    };
  }

  async deleteDefinition(name: string): Promise<void> {
    if (isSystemPropertyName(name)) {
      throw new Error(`[PropertyDataService] Cannot delete system property "${name}"`);
    }

    const usage = await this.getPropertyUsage(name);

    // Delete all page properties with this key first
    const propsResult = await this._db.run(
      'DELETE FROM page_properties WHERE key = ?',
      [name],
    );
    if (propsResult.error) throw new Error(propsResult.error.message);

    const result = await this._db.run(
      'DELETE FROM property_definitions WHERE name = ?',
      [name],
    );
    if (result.error) throw new Error(result.error.message);

    this._onDidChangeDefinition.fire({ name, kind: 'deleted' });
    for (const page of usage.pages) {
      this._onDidChangePageProperty.fire({ pageId: page.pageId, key: name, kind: 'removed' });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Page Property CRUD
  // ══════════════════════════════════════════════════════════════════════════

  async getPropertiesForPage(pageId: string): Promise<(IPageProperty & { definition: IPropertyDefinition })[]> {
    // M78 Phase 4 — join `pages` so the system properties `created` and
    // `modified` can be sourced authoritatively from `pages.created_at`
    // / `pages.updated_at`. Removing the on-save denormalised write
    // (one fewer IPC + fewer fsync per autosave) requires read-time
    // resolution to keep the property bar accurate.
    const result = await this._db.all(
      `SELECT pp.*, pd.type AS def_type, pd.config AS def_config,
              pd.sort_order AS def_sort_order, pd.created_at AS def_created_at,
              pd.updated_at AS def_updated_at,
              p.created_at AS _page_created_at,
              p.updated_at AS _page_updated_at
       FROM page_properties pp
       LEFT JOIN property_definitions pd ON pp.key = pd.name
       LEFT JOIN pages p ON pp.page_id = p.id
       WHERE pp.page_id = ?
       ORDER BY pd.sort_order`,
      [pageId],
    );
    if (result.error) throw new Error(result.error.message);

    const toIsoFromSqliteDatetime = (sqlValue: unknown): string | null => {
      if (typeof sqlValue !== 'string' || sqlValue.length === 0) return null;
      // SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" (UTC).
      // Convert to ISO 8601 with `Z` unless a direct tool write already
      // stored an explicit timezone. The property bar editor parses
      // timezone-aware ISO directly via `new Date(...)`. The override
      // is applied AFTER rowToPageProperty, so we are already past the
      // JSON-decode step; wrapping in JSON.stringify here re-encodes it
      // (introducing literal quote characters) and breaks date parsing.
      const normalized = sqlValue.trim().replace(' ', 'T');
      return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
    };

    return (result.rows ?? []).map((row) => {
      const prop = rowToPageProperty(row);
      let defConfig: Record<string, unknown> = {};
      try {
        defConfig = JSON.parse(row.def_config as string || '{}');
      } catch {
        defConfig = {};
      }
      const definition: IPropertyDefinition = {
        name: prop.key,
        type: (row.def_type as PropertyType) ?? 'text',
        config: defConfig,
        sortOrder: (row.def_sort_order as number) ?? 0,
        createdAt: (row.def_created_at as string) ?? '',
        updatedAt: (row.def_updated_at as string) ?? '',
      };
      // Override the stored value for the auto-managed system
      // properties so the user always sees the current pages-table
      // timestamps. Falls back to the stored value if the page lookup
      // didn't return columns (deleted-but-not-yet-cleaned-up row).
      let value = prop.value;
      if (prop.key === 'created') {
        const fresh = toIsoFromSqliteDatetime(row._page_created_at);
        if (fresh !== null) value = fresh;
      } else if (prop.key === 'modified') {
        const fresh = toIsoFromSqliteDatetime(row._page_updated_at);
        if (fresh !== null) value = fresh;
      }
      return { ...prop, value, definition };
    });
  }

  async setProperty(pageId: string, key: string, value: unknown): Promise<IPageProperty> {
    const id = crypto.randomUUID();
    const serializedValue = JSON.stringify(value);

    // Look up the definition to get the value type
    const def = await this.getDefinition(key);
    const valueType = def?.type ?? 'text';

    const result = await this._db.run(
      `INSERT OR REPLACE INTO page_properties (id, page_id, key, value_type, value)
       VALUES (
         COALESCE((SELECT id FROM page_properties WHERE page_id = ? AND key = ?), ?),
         ?, ?, ?, ?
       )`,
      [pageId, key, id, pageId, key, valueType, serializedValue],
    );
    if (result.error) throw new Error(result.error.message);

    // Read back the property
    const readResult = await this._db.get(
      'SELECT * FROM page_properties WHERE page_id = ? AND key = ?',
      [pageId, key],
    );
    if (readResult.error) throw new Error(readResult.error.message);
    if (!readResult.row) throw new Error(`[PropertyDataService] Property "${key}" not found after set`);

    this._onDidChangePageProperty.fire({ pageId, key, kind: 'set' });
    return rowToPageProperty(readResult.row);
  }

  async removeProperty(pageId: string, key: string): Promise<void> {
    const result = await this._db.run(
      'DELETE FROM page_properties WHERE page_id = ? AND key = ?',
      [pageId, key],
    );
    if (result.error) throw new Error(result.error.message);

    this._onDidChangePageProperty.fire({ pageId, key, kind: 'removed' });
  }

  async findPagesByProperty(
    propertyName: string,
    operator: string,
    value?: unknown,
  ): Promise<{ pageId: string; title: string; value: unknown }[]> {
    let whereClause: string;
    const params: unknown[] = [propertyName];

    switch (operator) {
      case 'equals':
        whereClause = 'pp.key = ? AND pp.value = ?';
        params.push(JSON.stringify(value));
        break;
      case 'contains':
        whereClause = "pp.key = ? AND pp.value LIKE ? ESCAPE '\\'";
        params.push(`%${String(value).replace(/[\\%_]/g, '\\$&')}%`);
        break;
      case 'is_empty':
        whereClause = "pp.key = ? AND (pp.value IS NULL OR pp.value = 'null' OR pp.value = '\"\"' OR pp.value = '[]')";
        break;
      case 'is_not_empty':
        whereClause = "pp.key = ? AND pp.value IS NOT NULL AND pp.value != 'null' AND pp.value != '\"\"' AND pp.value != '[]'";
        break;
      case 'greater_than':
        whereClause = 'pp.key = ? AND CAST(pp.value AS REAL) > ?';
        params.push(value as number);
        break;
      case 'less_than':
        whereClause = 'pp.key = ? AND CAST(pp.value AS REAL) < ?';
        params.push(value as number);
        break;
      default:
        throw new Error(`[PropertyDataService] Unknown operator: ${operator}`);
    }

    const result = await this._db.all(
      `SELECT pp.page_id, p.title, pp.value
       FROM page_properties pp
       JOIN pages p ON pp.page_id = p.id
       WHERE ${whereClause}`,
      params,
    );
    if (result.error) throw new Error(result.error.message);

    return (result.rows ?? []).map((row) => {
      let parsedValue: unknown = null;
      try {
        parsedValue = JSON.parse(row.value as string ?? 'null');
      } catch {
        parsedValue = row.value;
      }
      return {
        pageId: row.page_id as string,
        title: row.title as string,
        value: parsedValue,
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Default Properties
  // ══════════════════════════════════════════════════════════════════════════

  async ensureDefaultProperties(): Promise<void> {
    const defaults: { name: string; type: PropertyType; config: Record<string, unknown>; sortOrder: number }[] = [
      { name: 'tags', type: 'tags', config: {}, sortOrder: 1 },
      { name: 'created', type: 'datetime', config: {}, sortOrder: 2 },
      { name: 'modified', type: 'datetime', config: {}, sortOrder: 3 },
    ];

    for (const def of defaults) {
      const existing = await this.getDefinition(def.name);
      if (!existing) {
        await this._db.run(
          'INSERT INTO property_definitions (name, type, config, sort_order) VALUES (?, ?, ?, ?)',
          [def.name, def.type, JSON.stringify(def.config), def.sortOrder],
        );
      }
    }
  }

  /**
   * Backfill the auto-managed `created` / `modified` datetime properties from
   * the `pages` table for any page that doesn't already have an explicit
   * value set. Cheap one-shot scan; safe to call on every activation since
   * it only inserts rows that don't already exist.
   *
   * Stores the datetime as a JSON-encoded ISO string to match
   * `setProperty()`'s `JSON.stringify(value)` encoding so the property bar
   * and dataview consumers see consistent data regardless of which path
   * wrote the value.
   */
  async backfillTimestampProperties(): Promise<void> {
    // `pages.created_at` / `updated_at` come back as `YYYY-MM-DD HH:MM:SS`
    // from SQLite's `datetime('now')` default. Convert to ISO 8601 with `Z`
    // suffix and JSON-encode it (so the stored shape is `"2026-05-11T..."`)
    // to match the format produced by `setProperty('created', toISOString())`.
    const sqlIso = `'"' || strftime('%Y-%m-%dT%H:%M:%SZ', {col}) || '"'`;
    const buildInsert = (key: string, col: 'created_at' | 'updated_at') => `
      INSERT INTO page_properties (id, page_id, key, value_type, value)
      SELECT
        lower(hex(randomblob(16))),
        p.id,
        '${key}',
        'datetime',
        ${sqlIso.replace('{col}', `p.${col}`)}
      FROM pages p
      WHERE NOT EXISTS (
        SELECT 1 FROM page_properties pp WHERE pp.page_id = p.id AND pp.key = '${key}'
      )
    `;

    const createdResult = await this._db.run(buildInsert('created', 'created_at'), []);
    if (createdResult.error) throw new Error(createdResult.error.message);

    const modifiedResult = await this._db.run(buildInsert('modified', 'updated_at'), []);
    if (modifiedResult.error) throw new Error(modifiedResult.error.message);
  }
}
