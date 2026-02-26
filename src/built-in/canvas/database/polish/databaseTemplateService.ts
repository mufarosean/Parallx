// databaseTemplateService.ts — Template, conditional color, locking, and unique ID logic
//
// Phase 9 utility functions — these are pure functions operating on database
// types, consumed by views and the data service layer.
//
// Gate compliance: imports only from databaseRegistry (parent gate).

import type {
  IDatabaseTemplate,
  TemplatePropertyValue,
  IPropertyValue,
  IDatabaseProperty,
  IColorRule,
  IDatabaseRow,
  IDatabaseView,
  IDatabase,
  PropertyVisibility,
  IDatabaseDataService,
} from '../databaseRegistry.js';

import { evaluateFilter } from '../databaseRegistry.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a template property value to a concrete IPropertyValue.
 * Static values are returned as-is. Dynamic tokens are resolved at call time.
 */
export function resolveTemplateValue(tv: TemplatePropertyValue): IPropertyValue {
  if (tv.mode === 'static') {
    return tv.value;
  }

  // Dynamic tokens
  switch (tv.token) {
    case 'now': {
      const now = new Date().toISOString();
      return { type: 'date', date: { start: now, end: null, timeZone: null } } as IPropertyValue;
    }
    case 'today': {
      const today = new Date();
      const y = today.getUTCFullYear();
      const m = String(today.getUTCMonth() + 1).padStart(2, '0');
      const d = String(today.getUTCDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      return { type: 'date', date: { start: dateStr, end: null, timeZone: null } } as IPropertyValue;
    }
    default:
      return { type: 'rich_text', rich_text: [] } as IPropertyValue;
  }
}

/**
 * Apply a template to generate property values for a new row.
 * Returns a map of propertyId → IPropertyValue.
 *
 * Properties not specified in the template are not included
 * (they'll get default values from the data service).
 */
export function applyTemplate(
  template: IDatabaseTemplate,
  properties: IDatabaseProperty[],
): Record<string, IPropertyValue> {
  const result: Record<string, IPropertyValue> = {};
  const propMap = new Map(properties.map(p => [p.id, p]));

  for (const [propId, tv] of Object.entries(template.values)) {
    if (propMap.has(propId)) {
      result[propId] = resolveTemplateValue(tv);
    }
  }

  return result;
}

/**
 * Select the best template for a new row creation.
 * Priority: view's default template > first template in database > undefined.
 */
export function selectTemplate(
  templates: IDatabaseTemplate[],
  view: IDatabaseView,
): IDatabaseTemplate | undefined {
  if (templates.length === 0) return undefined;

  const defaultId = view.config.defaultTemplateId;
  if (defaultId) {
    const found = templates.find(t => t.id === defaultId);
    if (found) return found;
  }

  // If only one template, use it automatically
  if (templates.length === 1) return templates[0];

  // Multiple templates, no default — return undefined (caller should show picker)
  return undefined;
}

/**
 * Create a template object (in-memory). Persistence is the caller's responsibility.
 */
export function createTemplate(
  id: string,
  databaseId: string,
  name: string,
  values: Record<string, TemplatePropertyValue>,
  options?: { description?: string; contentJson?: string; sortOrder?: number },
): IDatabaseTemplate {
  return {
    id,
    databaseId,
    name,
    description: options?.description ?? null,
    values,
    contentJson: options?.contentJson ?? null,
    sortOrder: options?.sortOrder ?? 0,
    createdAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Conditional Color
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate color rules for a row and return the first matching color.
 * Returns `undefined` if no rules match.
 *
 * Color rules use the same IFilterRule evaluation as the filter engine,
 * so the existing `evaluateFilter()` function is reused.
 */
export function evaluateColorRules(
  colorRules: readonly IColorRule[],
  row: IDatabaseRow,
  properties: IDatabaseProperty[],
): string | undefined {
  if (!colorRules || colorRules.length === 0) return undefined;

  for (const rule of colorRules) {
    // Wrap the single filter rule in a filter group for evaluateFilter()
    const filterGroup = { conjunction: 'and' as const, rules: [rule.filter] };
    if (evaluateFilter(row, filterGroup, properties)) {
      return rule.color;
    }
  }

  return undefined;
}

/**
 * Construct a CSS style string for conditional coloring.
 * The color name maps to CSS custom properties or inline background.
 */
export function colorRuleToStyle(color: string): string {
  // Use CSS custom properties for theme support
  return `background-color: var(--db-row-color-${color}, ${_fallbackColor(color)})`;
}

/** Fallback colors when CSS variables aren't defined. */
function _fallbackColor(name: string): string {
  const COLORS: Record<string, string> = {
    red:    'rgba(255, 0, 0, 0.08)',
    orange: 'rgba(255, 165, 0, 0.08)',
    yellow: 'rgba(255, 255, 0, 0.08)',
    green:  'rgba(0, 128, 0, 0.08)',
    blue:   'rgba(0, 0, 255, 0.08)',
    purple: 'rgba(128, 0, 128, 0.08)',
    pink:   'rgba(255, 192, 203, 0.08)',
    gray:   'rgba(128, 128, 128, 0.08)',
  };
  return COLORS[name] ?? 'rgba(128, 128, 128, 0.06)';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Database & View Locking
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a database is locked (prevents property add/remove/rename).
 */
export function isDatabaseLocked(database: IDatabase): boolean {
  return database.isLocked;
}

/**
 * Check if a view is locked (prevents filter/sort/grouping/visibility changes).
 */
export function isViewLocked(view: IDatabaseView): boolean {
  return view.isLocked;
}

/**
 * Guard that throws if the database is locked.
 * Call before schema mutations (add/remove/rename properties).
 */
export function assertDatabaseNotLocked(database: IDatabase): void {
  if (database.isLocked) {
    throw new Error(`Database "${database.id}" is locked — schema changes are not allowed`);
  }
}

/**
 * Guard that throws if the view is locked.
 * Call before view config mutations (filter/sort/group/visibility changes).
 */
export function assertViewNotLocked(view: IDatabaseView): void {
  if (view.isLocked) {
    throw new Error(`View "${view.id}" is locked — configuration changes are not allowed`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Unique ID Auto-Increment
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the next unique ID number for a database.
 * Scans all existing rows to find the current max, then returns max + 1.
 */
export function computeNextUniqueId(
  rows: IDatabaseRow[],
  uniqueIdProperty: IDatabaseProperty,
): number {
  let max = 0;

  for (const row of rows) {
    const val = row.values[uniqueIdProperty.id];
    if (val && val.type === 'unique_id') {
      const num = (val as unknown as { unique_id: { number: number } }).unique_id.number;
      if (num > max) max = num;
    }
  }

  return max + 1;
}

/**
 * Create an IPropertyValue for a unique_id with auto-incremented number.
 */
export function makeUniqueIdValue(
  nextNumber: number,
  prefix: string | null,
): IPropertyValue {
  return {
    type: 'unique_id',
    unique_id: { prefix, number: nextNumber },
  } as IPropertyValue;
}

/**
 * Format a unique ID for display (e.g., "TASK-42" or "42").
 */
export function formatUniqueId(prefix: string | null, num: number): string {
  return prefix ? `${prefix}-${num}` : String(num);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Property Page-Top Visibility
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Determine whether a property should be visible on the page-top property bar.
 * @param visibility - The property's visibility setting
 * @param value - The current value of the property for the row
 * @returns true if the property should be displayed
 */
export function isPropertyVisibleOnPage(
  visibility: PropertyVisibility,
  value: IPropertyValue | undefined,
): boolean {
  switch (visibility) {
    case 'always_show':
      return true;
    case 'always_hide':
      return false;
    case 'hide_when_empty':
      return !_isValueEmpty(value);
    default:
      return true;
  }
}

/** Check if a property value is "empty" for visibility purposes. */
function _isValueEmpty(value: IPropertyValue | undefined): boolean {
  if (!value) return true;

  switch (value.type) {
    case 'title':
    case 'rich_text':
      return (value as unknown as { [k: string]: readonly { content: string }[] })[value.type]
        .every(s => s.content === '');
    case 'number':
      return (value as unknown as { number: number | null }).number == null;
    case 'checkbox':
      return false; // checkbox is never "empty" — it's always true/false
    case 'select':
    case 'status':
      return (value as unknown as { [k: string]: { name: string } | null })[value.type] == null;
    case 'multi_select':
      return (value as unknown as { multi_select: unknown[] }).multi_select.length === 0;
    case 'date':
      return (value as unknown as { date: { start: string | null } | null }).date?.start == null;
    case 'url':
      return !(value as unknown as { url: string | null }).url;
    case 'email':
      return !(value as unknown as { email: string | null }).email;
    case 'phone_number':
      return !(value as unknown as { phone_number: string | null }).phone_number;
    case 'files':
      return (value as unknown as { files: unknown[] }).files.length === 0;
    case 'relation':
      return (value as unknown as { relation: unknown[] }).relation.length === 0;
    default:
      return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DatabaseRowPropertyBar data helper
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gather the property bar data for a database row page.
 * Returns the properties + values that should be rendered above the page body.
 */
export async function getPropertyBarData(
  dataService: IDatabaseDataService,
  pageId: string,
): Promise<{ properties: IDatabaseProperty[]; values: Record<string, IPropertyValue> } | null> {
  const db = await dataService.getDatabaseByPageId(pageId);
  if (!db) {
    // Page could be a row in some database — check if it's in a database's rows
    // We need the database ID. Check all databases (expensive, but only called on page open).
    const dbIds = await dataService.getDatabasePageIds();
    for (const dbPageId of dbIds) {
      const rows = await dataService.getRows(dbPageId);
      const row = rows.find(r => r.page.id === pageId);
      if (row) {
        const properties = await dataService.getProperties(dbPageId);
        return {
          properties: properties.filter(p =>
            isPropertyVisibleOnPage(p.visibility, row.values[p.id])
          ),
          values: row.values,
        };
      }
    }
    return null;
  }

  // pageId IS the database page — not a row page, don't show bar
  return null;
}
