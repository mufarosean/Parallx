// rollupEngine.ts — Rollup property computation engine
//
// A rollup property aggregates values from pages linked via a relation.
// Configuration: relation property → target property → aggregation function.
//
// Example: Database "Projects" has a relation "Tasks" pointing to Database "Tasks".
// A rollup property "Completion" on Projects could reference:
//   - Relation: "Tasks" (relation property ID)
//   - Property: "Status" (property on the related database)
//   - Function: "percent_checked" → computes % of linked tasks with checkbox = true
//
// Gate compliance: imports only from databaseRegistry (parent gate).

import type {
  IDatabaseDataService,
  IDatabaseProperty,
  IDatabaseRow,
  IPropertyValue,
  IRelationPropertyConfig,
  IRollupPropertyConfig,
} from '../databaseRegistry.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** All supported rollup aggregation functions. */
export type RollupFunction = IRollupPropertyConfig['function'];

/**
 * The computed result of a rollup evaluation.
 * The `type` field indicates how to render/display the result.
 */
export interface IRollupResult {
  readonly type: 'number' | 'date' | 'string' | 'boolean' | 'percent' | 'array';
  readonly value: unknown;
}

// ─── Value Extraction ────────────────────────────────────────────────────────

/**
 * Extract a primitive value from an IPropertyValue for aggregation.
 * Returns `undefined` for values that cannot be numerically/textually aggregated.
 */
function extractNumericValue(value: IPropertyValue | undefined): number | undefined {
  if (!value) return undefined;
  switch (value.type) {
    case 'number': return value.number ?? undefined;
    case 'checkbox': return value.checkbox ? 1 : 0;
    default: return undefined;
  }
}

/**
 * Extract a date string from an IPropertyValue.
 */
function extractDateValue(value: IPropertyValue | undefined): string | undefined {
  if (!value) return undefined;
  switch (value.type) {
    case 'date': return value.date?.start ?? undefined;
    case 'created_time': return value.created_time ?? undefined;
    case 'last_edited_time': return value.last_edited_time ?? undefined;
    default: return undefined;
  }
}

/**
 * Extract a string representation from an IPropertyValue.
 */
function extractStringValue(value: IPropertyValue | undefined): string | undefined {
  if (!value) return undefined;
  switch (value.type) {
    case 'title': return value.title.map(s => s.content).join('');
    case 'rich_text': return value.rich_text.map(s => s.content).join('');
    case 'number': return value.number != null ? String(value.number) : undefined;
    case 'select': return value.select?.name ?? undefined;
    case 'multi_select': return value.multi_select.map(s => s.name).join(', ');
    case 'status': return value.status?.name ?? undefined;
    case 'date': return value.date?.start ?? undefined;
    case 'checkbox': return value.checkbox ? 'true' : 'false';
    case 'url': return value.url ?? undefined;
    case 'email': return value.email ?? undefined;
    case 'phone_number': return value.phone_number ?? undefined;
    default: return undefined;
  }
}

/**
 * Check if a property value is "empty" (null / blank / no selection).
 */
function isEmptyValue(value: IPropertyValue | undefined): boolean {
  if (!value) return true;
  switch (value.type) {
    case 'title': return value.title.length === 0 || value.title.every(s => !s.content);
    case 'rich_text': return value.rich_text.length === 0 || value.rich_text.every(s => !s.content);
    case 'number': return value.number == null;
    case 'select': return value.select == null;
    case 'multi_select': return value.multi_select.length === 0;
    case 'status': return value.status == null;
    case 'date': return value.date == null || !value.date.start;
    case 'checkbox': return false; // checkbox is never "empty" — false is a value
    case 'url': return !value.url;
    case 'email': return !value.email;
    case 'phone_number': return !value.phone_number;
    case 'relation': return value.relation.length === 0;
    case 'files': return value.files.length === 0;
    default: return true;
  }
}

/**
 * Check if a property value is "checked" (checkbox = true).
 */
function isCheckedValue(value: IPropertyValue | undefined): boolean {
  if (!value) return false;
  return value.type === 'checkbox' && value.checkbox === true;
}

// ─── Aggregation Functions ───────────────────────────────────────────────────

/** Compute median of a sorted numeric array. */
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Evaluate a rollup aggregation function over a set of property values.
 *
 * @param fn - The aggregation function name
 * @param values - The source property values (one per linked row)
 * @returns The computed rollup result
 */
export function evaluateRollupFunction(
  fn: RollupFunction,
  values: (IPropertyValue | undefined)[],
): IRollupResult {
  switch (fn) {
    // ── Count ──
    case 'count':
      return { type: 'number', value: values.length };

    case 'count_values':
      return { type: 'number', value: values.filter(v => !isEmptyValue(v)).length };

    // ── Numeric aggregations ──
    case 'sum': {
      const nums = values.map(extractNumericValue).filter((n): n is number => n !== undefined);
      return { type: 'number', value: nums.reduce((a, b) => a + b, 0) };
    }
    case 'average': {
      const nums = values.map(extractNumericValue).filter((n): n is number => n !== undefined);
      return { type: 'number', value: nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0 };
    }
    case 'median': {
      const nums = values.map(extractNumericValue).filter((n): n is number => n !== undefined);
      return { type: 'number', value: median(nums) };
    }
    case 'min': {
      const nums = values.map(extractNumericValue).filter((n): n is number => n !== undefined);
      return { type: 'number', value: nums.length > 0 ? Math.min(...nums) : 0 };
    }
    case 'max': {
      const nums = values.map(extractNumericValue).filter((n): n is number => n !== undefined);
      return { type: 'number', value: nums.length > 0 ? Math.max(...nums) : 0 };
    }
    case 'range': {
      const nums = values.map(extractNumericValue).filter((n): n is number => n !== undefined);
      if (nums.length === 0) return { type: 'number', value: 0 };
      return { type: 'number', value: Math.max(...nums) - Math.min(...nums) };
    }

    // ── Date aggregations ──
    case 'earliest_date': {
      const dates = values.map(extractDateValue).filter((d): d is string => d !== undefined);
      if (dates.length === 0) return { type: 'date', value: null };
      dates.sort();
      return { type: 'date', value: dates[0] };
    }
    case 'latest_date': {
      const dates = values.map(extractDateValue).filter((d): d is string => d !== undefined);
      if (dates.length === 0) return { type: 'date', value: null };
      dates.sort();
      return { type: 'date', value: dates[dates.length - 1] };
    }
    case 'date_range': {
      const dates = values.map(extractDateValue).filter((d): d is string => d !== undefined);
      if (dates.length < 2) return { type: 'number', value: 0 };
      dates.sort();
      const earliest = new Date(dates[0]).getTime();
      const latest = new Date(dates[dates.length - 1]).getTime();
      const days = Math.round((latest - earliest) / (1000 * 60 * 60 * 24));
      return { type: 'number', value: days };
    }

    // ── Checkbox aggregations ──
    case 'checked':
      return { type: 'number', value: values.filter(isCheckedValue).length };
    case 'unchecked':
      return { type: 'number', value: values.filter(v => !isCheckedValue(v)).length };
    case 'percent_checked': {
      if (values.length === 0) return { type: 'percent', value: 0 };
      return { type: 'percent', value: (values.filter(isCheckedValue).length / values.length) * 100 };
    }
    case 'percent_unchecked': {
      if (values.length === 0) return { type: 'percent', value: 0 };
      return { type: 'percent', value: (values.filter(v => !isCheckedValue(v)).length / values.length) * 100 };
    }

    // ── Emptiness aggregations ──
    case 'empty':
      return { type: 'number', value: values.filter(isEmptyValue).length };
    case 'not_empty':
      return { type: 'number', value: values.filter(v => !isEmptyValue(v)).length };
    case 'percent_empty': {
      if (values.length === 0) return { type: 'percent', value: 0 };
      return { type: 'percent', value: (values.filter(isEmptyValue).length / values.length) * 100 };
    }
    case 'percent_not_empty': {
      if (values.length === 0) return { type: 'percent', value: 0 };
      return { type: 'percent', value: (values.filter(v => !isEmptyValue(v)).length / values.length) * 100 };
    }

    // ── Collection functions ──
    case 'show_original': {
      const strings = values.map(extractStringValue).filter((s): s is string => s !== undefined);
      return { type: 'array', value: strings };
    }
    case 'show_unique': {
      const strings = values.map(extractStringValue).filter((s): s is string => s !== undefined);
      return { type: 'array', value: [...new Set(strings)] };
    }
    case 'unique':
      return { type: 'number', value: new Set(values.map(extractStringValue).filter(s => s !== undefined)).size };

    default:
      return { type: 'number', value: 0 };
  }
}

// ─── Full Rollup Evaluation ──────────────────────────────────────────────────

/**
 * Compute a rollup property value for a single row.
 *
 * Resolution chain:
 * 1. Read the rollup config (relation property → target property → function)
 * 2. Read the relation value for this row (list of linked page IDs)
 * 3. Fetch rows from the related database
 * 4. Extract the rollup target property value from each linked row
 * 5. Apply the aggregation function
 *
 * @param dataService - Database data service for cross-database queries
 * @param rollupProperty - The rollup property definition
 * @param rowValues - All property values for the current row
 * @param relatedProperties - Properties of the source database (to find the relation)
 * @returns The computed rollup result, or null if config is incomplete
 */
export async function computeRollup(
  dataService: IDatabaseDataService,
  rollupProperty: IDatabaseProperty,
  rowValues: Record<string, IPropertyValue>,
  relatedProperties: IDatabaseProperty[],
): Promise<IRollupResult | null> {
  const config = rollupProperty.config as IRollupPropertyConfig;
  if (!config.relationPropertyId || !config.rollupPropertyId || !config.function) {
    return null;
  }

  // 1. Find the relation property in the same database
  const relationProperty = relatedProperties.find(p => p.id === config.relationPropertyId);
  if (!relationProperty || relationProperty.type !== 'relation') return null;

  const relationConfig = relationProperty.config as IRelationPropertyConfig;
  if (!relationConfig.databaseId) return null;

  // 2. Get linked page IDs from the relation value
  const relationValue = rowValues[relationProperty.id];
  if (!relationValue || relationValue.type !== 'relation') {
    return evaluateRollupFunction(config.function, []);
  }

  const linkedIds = new Set(relationValue.relation.map(r => r.id));
  if (linkedIds.size === 0) {
    return evaluateRollupFunction(config.function, []);
  }

  // 3. Fetch rows from the related database
  const relatedRows = await dataService.getRows(relationConfig.databaseId);

  // 4. Extract the target property value from each linked row
  const targetValues: (IPropertyValue | undefined)[] = [];
  for (const row of relatedRows) {
    if (linkedIds.has(row.page.id)) {
      targetValues.push(row.values[config.rollupPropertyId]);
    }
  }

  // 5. Aggregate
  return evaluateRollupFunction(config.function, targetValues);
}

/**
 * Compute rollup values for all rollup properties in a set of rows.
 *
 * This is the batch entry point used by views when rendering. It computes
 * rollup values for every row and every rollup property in one pass.
 *
 * @returns A map of `pageId → propertyId → IRollupResult`
 */
export async function computeRollups(
  dataService: IDatabaseDataService,
  _databaseId: string,
  rows: IDatabaseRow[],
  properties: IDatabaseProperty[],
): Promise<Map<string, Map<string, IRollupResult>>> {
  const rollupProperties = properties.filter(p => p.type === 'rollup');
  if (rollupProperties.length === 0) return new Map();

  const result = new Map<string, Map<string, IRollupResult>>();

  for (const row of rows) {
    const rowRollups = new Map<string, IRollupResult>();
    for (const prop of rollupProperties) {
      const rollupResult = await computeRollup(dataService, prop, row.values, properties);
      if (rollupResult) {
        rowRollups.set(prop.id, rollupResult);
      }
    }
    if (rowRollups.size > 0) {
      result.set(row.page.id, rowRollups);
    }
  }

  return result;
}

// ─── Rollup → IPropertyValue Conversion ──────────────────────────────────────

/**
 * Convert a rollup result to an IPropertyValue for storage/display.
 */
export function rollupResultToPropertyValue(result: IRollupResult): IPropertyValue {
  switch (result.type) {
    case 'number':
      return {
        type: 'rollup',
        rollup: { type: 'number', number: result.value as number | null },
      };
    case 'percent':
      return {
        type: 'rollup',
        rollup: { type: 'number', number: result.value as number },
      };
    case 'date':
      return {
        type: 'rollup',
        rollup: { type: 'date', date: result.value as string | null },
      };
    case 'string':
      return {
        type: 'rollup',
        rollup: { type: 'string', string: result.value as string },
      };
    case 'boolean':
      return {
        type: 'rollup',
        rollup: { type: 'boolean', boolean: result.value as boolean },
      };
    case 'array':
      return {
        type: 'rollup',
        rollup: { type: 'array', array: result.value as string[] },
      };
    default:
      return {
        type: 'rollup',
        rollup: { type: 'number', number: null },
      };
  }
}
