// databaseTypes.ts — data model types for the Canvas database system
//
// Defines the database model, property schema, property value types,
// view configuration, filter/sort models, change event types, and the
// IDatabaseDataService interface consumed by all database components.
//
// Dependency rules:
//   - May import type-only from platform/ (events)
//   - May import type-only from canvasTypes (IPage)
//   - Must NOT import from canvas registries or extensions

import type { Event } from '../../../platform/events.js';
import type { IPage } from '../canvasTypes.js';

// ─── Property Type System ────────────────────────────────────────────────────

/**
 * Property type discriminator union.
 * Matches Notion's property types (subset relevant to Parallx).
 */
export type PropertyType =
  | 'title'
  | 'rich_text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'files'
  | 'relation'
  | 'rollup'
  | 'formula'
  | 'created_time'
  | 'last_edited_time'
  | 'unique_id';

/**
 * A select/multi-select/status option.
 */
export interface ISelectOption {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/**
 * Status groups (To-do, In progress, Complete).
 * Each group contains a subset of status options.
 */
export interface IStatusGroup {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly optionIds: string[];
}

/**
 * A rich text segment (simplified Notion format).
 */
export interface IRichTextSegment {
  readonly type: 'text';
  readonly content: string;
  readonly annotations?: {
    readonly bold?: boolean;
    readonly italic?: boolean;
    readonly strikethrough?: boolean;
    readonly underline?: boolean;
    readonly code?: boolean;
    readonly color?: string;
  };
}

/**
 * A file reference (external URL only for M8 — upload deferred).
 */
export interface IFileReference {
  readonly name: string;
  readonly type: 'external';
  readonly external: { readonly url: string };
}

// ─── Property Value (Discriminated Union) ────────────────────────────────────

/**
 * Typed property value stored as JSON in `page_property_values.value`.
 * Matches Notion's API format for future import/export compatibility.
 */
export type IPropertyValue =
  | { readonly type: 'title'; readonly title: IRichTextSegment[] }
  | { readonly type: 'rich_text'; readonly rich_text: IRichTextSegment[] }
  | { readonly type: 'number'; readonly number: number | null }
  | { readonly type: 'select'; readonly select: ISelectOption | null }
  | { readonly type: 'multi_select'; readonly multi_select: ISelectOption[] }
  | { readonly type: 'status'; readonly status: ISelectOption | null }
  | { readonly type: 'date'; readonly date: { readonly start: string; readonly end: string | null; readonly time_zone?: string } | null }
  | { readonly type: 'checkbox'; readonly checkbox: boolean }
  | { readonly type: 'url'; readonly url: string | null }
  | { readonly type: 'email'; readonly email: string | null }
  | { readonly type: 'phone_number'; readonly phone_number: string | null }
  | { readonly type: 'files'; readonly files: IFileReference[] }
  | { readonly type: 'relation'; readonly relation: readonly { readonly id: string }[] }
  | { readonly type: 'rollup'; readonly rollup: { readonly type: string; readonly [key: string]: unknown } }
  | { readonly type: 'formula'; readonly formula: { readonly type: string; readonly [key: string]: unknown } }
  | { readonly type: 'created_time'; readonly created_time: string }
  | { readonly type: 'last_edited_time'; readonly last_edited_time: string }
  | { readonly type: 'unique_id'; readonly unique_id: { readonly prefix: string | null; readonly number: number } };

// ─── Property Config Per Type ────────────────────────────────────────────────

/**
 * Type-specific property configuration stored in `database_properties.config`.
 * Most types have empty config `{}`; these interfaces cover the ones that don't.
 */
export interface INumberPropertyConfig {
  readonly format: 'number' | 'number_with_commas' | 'percent' | 'dollar' | 'euro' | 'pound' | 'yen' | 'yuan';
}

export interface ISelectPropertyConfig {
  readonly options: ISelectOption[];
}

export interface IMultiSelectPropertyConfig {
  readonly options: ISelectOption[];
}

export interface IStatusPropertyConfig {
  readonly options: ISelectOption[];
  readonly groups: IStatusGroup[];
}

export interface IRelationPropertyConfig {
  readonly databaseId: string;
  readonly syncedPropertyId?: string;
  readonly syncedPropertyName?: string;
}

export interface IRollupPropertyConfig {
  readonly relationPropertyId: string;
  readonly relationPropertyName: string;
  readonly rollupPropertyId: string;
  readonly rollupPropertyName: string;
  readonly function: 'count' | 'count_values' | 'sum' | 'average' | 'median' | 'min' | 'max'
    | 'range' | 'earliest_date' | 'latest_date' | 'date_range'
    | 'checked' | 'unchecked' | 'percent_checked' | 'percent_unchecked'
    | 'not_empty' | 'empty' | 'percent_not_empty' | 'percent_empty'
    | 'show_original' | 'show_unique' | 'unique';
}

export interface IFormulaPropertyConfig {
  readonly expression: string;
}

export interface IUniqueIdPropertyConfig {
  readonly prefix: string | null;
}

/**
 * Union of all property config types.
 * Properties with no config use `Record<string, never>` (empty object `{}`).
 */
export type PropertyConfig =
  | INumberPropertyConfig
  | ISelectPropertyConfig
  | IMultiSelectPropertyConfig
  | IStatusPropertyConfig
  | IRelationPropertyConfig
  | IRollupPropertyConfig
  | IFormulaPropertyConfig
  | IUniqueIdPropertyConfig
  | Record<string, never>;

// ─── Core Entities ───────────────────────────────────────────────────────────

/**
 * A database container — links a page to structured data capabilities.
 * `id` always equals `pageId` (DD-0: same UUID).
 */
export interface IDatabase {
  readonly id: string;
  readonly pageId: string;
  readonly description: string | null;
  readonly isLocked: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A property in a database schema (one column).
 */
export interface IDatabaseProperty {
  readonly id: string;
  readonly databaseId: string;
  readonly name: string;
  readonly type: PropertyType;
  readonly config: PropertyConfig;
  /** Page-top visibility when a row is opened as a page. */
  readonly visibility: PropertyVisibility;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A database row — a page enriched with property values in a database context.
 */
export interface IDatabaseRow {
  readonly page: IPage;
  readonly values: Record<string, IPropertyValue>;
  readonly sortOrder: number;
}

// ─── Templates ───────────────────────────────────────────────────────────────

/** Dynamic template value tokens resolved at row-creation time. */
export type TemplateDynamicValue = 'now' | 'today';

/**
 * A single property value in a template — either a static IPropertyValue
 * or a dynamic token that is resolved when the template is applied.
 */
export type TemplatePropertyValue =
  | { readonly mode: 'static'; readonly value: IPropertyValue }
  | { readonly mode: 'dynamic'; readonly token: TemplateDynamicValue };

/**
 * A database template — pre-configured property values + optional page content.
 * Applied when a new row is created to populate default values.
 */
export interface IDatabaseTemplate {
  readonly id: string;
  readonly databaseId: string;
  readonly name: string;
  readonly description: string | null;
  /** Property ID → template value */
  readonly values: Record<string, TemplatePropertyValue>;
  /** Optional JSON Tiptap content to pre-fill the page body */
  readonly contentJson: string | null;
  readonly sortOrder: number;
  readonly createdAt: string;
}

/**
 * Per-view default template (which template to use when creating a row via this view).
 * Stored in IDatabaseViewConfig.
 */
export interface IViewDefaultTemplate {
  readonly templateId: string;
}

// ─── Property Visibility ─────────────────────────────────────────────────────

/**
 * Per-property page-top visibility setting.
 * Controls whether a property is shown above the content body when a row
 * is opened as a page.
 */
export type PropertyVisibility = 'always_show' | 'hide_when_empty' | 'always_hide';

// ─── View Types ──────────────────────────────────────────────────────────────

/**
 * Database view layout types.
 */
export type ViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline';

/**
 * Denormalized view fields stored as dedicated columns on `database_views`.
 * These are queryable via SQL `WHERE` clauses for cross-view operations.
 */
export interface IDatabaseViewColumns {
  readonly groupBy: string | null;
  readonly subGroupBy: string | null;
  readonly boardGroupProperty: string | null;
  readonly hideEmptyGroups: boolean;
  readonly filterConfig: IFilterGroup;
  readonly sortConfig: ISortRule[];
}

/**
 * Remaining view config stored in JSON `config` column.
 * Only read after loading a specific view — never queried across views.
 */
export interface IDatabaseViewConfig {
  readonly visibleProperties?: string[];
  readonly colorRules?: IColorRule[];
  readonly cardSize?: 'small' | 'medium' | 'large';
  readonly dateProperty?: string;
  readonly dateEndProperty?: string;
  readonly columnWidths?: Record<string, number>;
  /**
   * When set, this view is a "linked view" that reads rows/properties from
   * the source database instead of its parent database.  Independent
   * filters, sorts, grouping, and property visibility still live on this
   * view's own config.
   */
  readonly sourceDatabaseId?: string;
  /**
   * Default template ID for new rows created via this view.
   * If null/undefined, new rows get empty default values.
   */
  readonly defaultTemplateId?: string;
}

/**
 * Combined view interface — what consumers receive from DatabaseDataService.
 * Merges view identity + denormalized columns + JSON config.
 */
export interface IDatabaseView extends IDatabaseViewColumns {
  readonly id: string;
  readonly databaseId: string;
  readonly name: string;
  readonly type: ViewType;
  readonly sortOrder: number;
  readonly isLocked: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly config: IDatabaseViewConfig;
}

// ─── Filter & Sort ───────────────────────────────────────────────────────────

/**
 * Filter operators. Not all operators apply to all property types —
 * see `FILTER_OPERATORS_BY_TYPE` for valid combinations.
 */
export type FilterOperator =
  | 'equals'
  | 'does_not_equal'
  | 'contains'
  | 'does_not_contain'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal'
  | 'less_than_or_equal'
  | 'before'
  | 'after'
  | 'on_or_before'
  | 'on_or_after'
  | 'is_within'
  | 'is_empty'
  | 'is_not_empty';

/**
 * A single filter condition on one property.
 */
export interface IFilterRule {
  readonly propertyId: string;
  readonly operator: FilterOperator;
  readonly value?: unknown;
}

/**
 * A compound filter group with AND/OR conjunction.
 * Rules can be nested for complex conditions.
 */
export interface IFilterGroup {
  readonly conjunction: 'and' | 'or';
  readonly rules: readonly (IFilterRule | IFilterGroup)[];
}

/**
 * A sort rule: property + direction.
 */
export interface ISortRule {
  readonly propertyId: string;
  readonly direction: 'ascending' | 'descending';
}

/**
 * A conditional color rule for view rows/cards.
 */
export interface IColorRule {
  readonly filter: IFilterRule;
  readonly color: string;
}

/**
 * Valid filter operators per property type.
 * Used by the filter UI to present appropriate operator choices.
 */
export const FILTER_OPERATORS_BY_TYPE: Readonly<Record<PropertyType, readonly FilterOperator[]>> = {
  title:            ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  rich_text:        ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  number:           ['equals', 'does_not_equal', 'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal', 'is_empty', 'is_not_empty'],
  select:           ['equals', 'does_not_equal', 'is_empty', 'is_not_empty'],
  multi_select:     ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  status:           ['equals', 'does_not_equal', 'is_empty', 'is_not_empty'],
  date:             ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_within', 'is_empty', 'is_not_empty'],
  checkbox:         ['equals'],
  url:              ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  email:            ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  phone_number:     ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  files:            ['is_empty', 'is_not_empty'],
  relation:         ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  rollup:           [],   // operators depend on output type — resolved at runtime
  formula:          [],   // operators depend on output type — resolved at runtime
  created_time:     ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_within', 'is_empty', 'is_not_empty'],
  last_edited_time: ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_within', 'is_empty', 'is_not_empty'],
  unique_id:        ['equals', 'does_not_equal'],
};

// ─── Change Events ───────────────────────────────────────────────────────────

/**
 * Kinds of database-level mutations that fire change events.
 */
export const enum DatabaseChangeKind {
  Created = 'Created',
  Updated = 'Updated',
  Deleted = 'Deleted',
}

/**
 * Event payload when a database is created, updated, or deleted.
 */
export interface DatabaseChangeEvent {
  readonly kind: DatabaseChangeKind;
  readonly databaseId: string;
  readonly database?: IDatabase;
}

/**
 * Event payload when a property is added, updated, removed, or reordered.
 */
export interface PropertyChangeEvent {
  readonly kind: 'Added' | 'Updated' | 'Removed' | 'Reordered';
  readonly databaseId: string;
  readonly propertyId: string;
  readonly property?: IDatabaseProperty;
}

/**
 * Event payload when a row is added, removed, value-updated, or reordered.
 */
export interface RowChangeEvent {
  readonly kind: 'Added' | 'Removed' | 'Updated' | 'Reordered';
  readonly databaseId: string;
  readonly pageId: string;
}

/**
 * Event payload when a view is created, updated, deleted, or reordered.
 */
export interface ViewChangeEvent {
  readonly kind: 'Created' | 'Updated' | 'Deleted' | 'Reordered';
  readonly databaseId: string;
  readonly viewId: string;
  readonly view?: IDatabaseView;
}

// ─── Update Types ────────────────────────────────────────────────────────────

/**
 * Mutable fields accepted by `IDatabaseDataService.updateDatabase()`.
 */
export type DatabaseUpdateData = Partial<Pick<IDatabase, 'description' | 'isLocked'>>;

/**
 * Mutable fields accepted by `IDatabaseDataService.updateProperty()`.
 */
export type PropertyUpdateData = Partial<Pick<IDatabaseProperty, 'name' | 'type' | 'config' | 'visibility'>>;

/**
 * Mutable fields accepted by `IDatabaseDataService.updateView()`.
 */
export type ViewUpdateData = Partial<Pick<IDatabaseView,
  'name' | 'type' | 'groupBy' | 'subGroupBy' | 'boardGroupProperty' |
  'hideEmptyGroups' | 'filterConfig' | 'sortConfig' | 'config' | 'isLocked'
>>;

// ─── IDatabaseDataService ────────────────────────────────────────────────────

/**
 * Public interface for the Canvas database data service.
 *
 * All database components depend on this interface — only the composition
 * root (`main.ts`) imports the concrete `DatabaseDataService` class.
 * This mirrors VS Code's service interface pattern and the existing
 * `ICanvasDataService` in `canvasTypes.ts`.
 */
export interface IDatabaseDataService {

  // ── Events ──

  /** Fires when a database is created, updated, or deleted. */
  readonly onDidChangeDatabase: Event<DatabaseChangeEvent>;

  /** Fires when a property is added, updated, removed, or reordered. */
  readonly onDidChangeProperty: Event<PropertyChangeEvent>;

  /** Fires when a row is added, removed, value-updated, or reordered. */
  readonly onDidChangeRow: Event<RowChangeEvent>;

  /** Fires when a view is created, updated, deleted, or reordered. */
  readonly onDidChangeView: Event<ViewChangeEvent>;

  // ── Database CRUD ──

  /**
   * Create a database for an existing page.
   * Creates the `databases` row (id = pageId) + a default "Title" property +
   * a default "Table" view.
   */
  createDatabase(pageId: string): Promise<IDatabase>;

  /** Get a database by its ID. Returns null if not found. */
  getDatabase(databaseId: string): Promise<IDatabase | null>;

  /** Get a database by its page ID (same UUID, but semantically clearer). */
  getDatabaseByPageId(pageId: string): Promise<IDatabase | null>;

  /**
   * Get the set of page IDs that have an associated database.
   * Used by the sidebar to efficiently detect database pages during tree rendering.
   */
  getDatabasePageIds(): Promise<Set<string>>;

  /** Update database metadata (description, isLocked). */
  updateDatabase(databaseId: string, updates: DatabaseUpdateData): Promise<IDatabase>;

  /**
   * Delete a database and all its properties, views, values, and membership.
   * The page itself is NOT deleted — use CanvasDataService.deletePage() for that.
   * (ON DELETE CASCADE on databases.page_id handles FK cleanup when the page is deleted.)
   */
  deleteDatabase(databaseId: string): Promise<void>;

  // ── Property CRUD ──

  /** Add a new property to a database schema. Returns the created property. */
  addProperty(databaseId: string, name: string, type: PropertyType, config?: PropertyConfig): Promise<IDatabaseProperty>;

  /** Update a property's name, type, or config. Returns the updated property. */
  updateProperty(databaseId: string, propertyId: string, updates: PropertyUpdateData): Promise<IDatabaseProperty>;

  /** Remove a property from the schema + delete all its values. */
  removeProperty(databaseId: string, propertyId: string): Promise<void>;

  /** Reorder properties by providing the full ordered list of property IDs. */
  reorderProperties(databaseId: string, orderedIds: string[]): Promise<void>;

  /** Get all properties for a database, ordered by sort_order. */
  getProperties(databaseId: string): Promise<IDatabaseProperty[]>;

  // ── Row Membership ──

  /**
   * Add a row to a database.
   * If `pageId` is provided, adds an existing page. Otherwise creates a new
   * page via IPC and adds it. Uses `runTransaction` for atomicity.
   * Returns the created/added row.
   */
  addRow(databaseId: string, pageId?: string): Promise<IDatabaseRow>;

  /** Remove a page from a database. Page itself is NOT deleted. */
  removeRow(databaseId: string, pageId: string): Promise<void>;

  /** Get all rows in a database with their property values, ordered by sort_order. */
  getRows(databaseId: string): Promise<IDatabaseRow[]>;

  /** Get page IDs that are members of any database row set (for sidebar filtering). */
  getDatabaseRowPageIds(): Promise<Set<string>>;

  /** Reorder rows by providing the full ordered list of page IDs. */
  reorderRows(databaseId: string, orderedPageIds: string[]): Promise<void>;

  /** Update a row page's title and emit a row-change event for the active database view. */
  updatePageTitle(databaseId: string, pageId: string, title: string): Promise<void>;

  /** Update a row page's icon (or clear it) and emit a row-change event for the active database view. */
  updatePageIcon(databaseId: string, pageId: string, icon: string | null): Promise<void>;

  // ── Property Value CRUD ──

  /** Set a single property value for a page in a database (upsert). */
  setPropertyValue(databaseId: string, pageId: string, propertyId: string, value: IPropertyValue): Promise<void>;

  /** Get all property values for a page in a database. */
  getPropertyValues(databaseId: string, pageId: string): Promise<Record<string, IPropertyValue>>;

  /** Set multiple property values in a single transaction. */
  batchSetPropertyValues(databaseId: string, pageId: string, values: { propertyId: string; value: IPropertyValue }[]): Promise<void>;

  // ── View CRUD ──

  /**
   * Create a new view for a database.
   * Filters/sorts go in denormalized columns; rest in `config` JSON.
   */
  createView(databaseId: string, name: string, type: ViewType, config?: Partial<IDatabaseView>): Promise<IDatabaseView>;

  /** Get all views for a database, ordered by sort_order. */
  getViews(databaseId: string): Promise<IDatabaseView[]>;

  /** Get a single view by ID. */
  getView(viewId: string): Promise<IDatabaseView | null>;

  /** Update a view's config, filters, sorts, etc. */
  updateView(viewId: string, updates: ViewUpdateData): Promise<IDatabaseView>;

  /** Delete a view. Prevents deleting the last view. */
  deleteView(viewId: string): Promise<void>;

  /** Deep-copy a view with all its config. */
  duplicateView(viewId: string): Promise<IDatabaseView>;

  /**
   * Duplicate a database's schema (properties, views, property values, row membership)
   * from an existing database page onto a new target page.
   * The target page must already exist.
   */
  duplicateDatabase(sourceDatabaseId: string, targetPageId: string): Promise<IDatabase>;

  /** Reorder views by providing the full ordered list of view IDs. */
  reorderViews(databaseId: string, orderedIds: string[]): Promise<void>;
}

// ─── Shared Callback Types ───────────────────────────────────────────────────

/** Callback shape for opening an editor tab. Used by views and the editor provider. */
export type OpenEditorFn = (options: {
  typeId: string;
  title: string;
  icon?: string;
  instanceId?: string;
}) => Promise<void>;
