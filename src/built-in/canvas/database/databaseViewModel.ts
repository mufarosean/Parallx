// databaseViewModel.ts — the PURE evaluation core of database views.
//
// Filtering, sorting, and grouping run in memory over the fetched rows (local
// SQLite, workspace-scale data) with typed comparisons — and being pure, every
// behavior is unit-testable without a DB or DOM. The data service fetches; this
// module evaluates; the views render.

import type { IDatabaseRow, IFilterConfig, IFilterRule, ISortRule } from './databaseTypes.js';
import { TITLE_KEY } from './databaseTypes.js';

function cellOf(row: IDatabaseRow, propertyId: string): unknown {
  return propertyId === TITLE_KEY ? row.title : row.values[propertyId];
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function asComparable(v: unknown): number | string | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    // Numeric strings compare numerically; dates/ISO strings compare lexically
    // (ISO-8601 sorts correctly as text).
    return v.trim() !== '' && !Number.isNaN(n) && /^-?[\d.]+$/.test(v.trim()) ? n : v;
  }
  return null;
}

export function ruleMatches(row: IDatabaseRow, rule: IFilterRule): boolean {
  const v = cellOf(row, rule.propertyId);
  switch (rule.op) {
    case 'is_empty': return isEmptyValue(v);
    case 'is_not_empty': return !isEmptyValue(v);
    case 'equals': {
      if (Array.isArray(v)) return v.some((x) => String(x) === String(rule.value));
      if (typeof v === 'boolean' || typeof rule.value === 'boolean') {
        return Boolean(v) === Boolean(rule.value === true || rule.value === 'true');
      }
      return String(v ?? '') === String(rule.value ?? '');
    }
    case 'not_equals': return !ruleMatches(row, { ...rule, op: 'equals' });
    case 'contains': {
      const needle = String(rule.value ?? '').toLowerCase();
      if (needle === '') return true;
      if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase().includes(needle));
      return String(v ?? '').toLowerCase().includes(needle);
    }
    case 'greater_than': {
      const a = asComparable(v); const b = asComparable(rule.value);
      if (a === null || b === null) return false;
      return typeof a === 'number' && typeof b === 'number' ? a > b : String(a) > String(b);
    }
    case 'less_than': {
      const a = asComparable(v); const b = asComparable(rule.value);
      if (a === null || b === null) return false;
      return typeof a === 'number' && typeof b === 'number' ? a < b : String(a) < String(b);
    }
    default: return true;
  }
}

export function applyFilter(rows: readonly IDatabaseRow[], filter: IFilterConfig): IDatabaseRow[] {
  if (!filter || filter.rules.length === 0) return [...rows];
  return rows.filter((row) =>
    filter.conjunction === 'or'
      ? filter.rules.some((r) => ruleMatches(row, r))
      : filter.rules.every((r) => ruleMatches(row, r)),
  );
}

export function applySort(rows: readonly IDatabaseRow[], sort: readonly ISortRule[]): IDatabaseRow[] {
  const out = [...rows];
  if (!sort || sort.length === 0) {
    // Default: the database's manual membership order.
    return out.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  out.sort((a, b) => {
    for (const rule of sort) {
      const av = cellOf(a, rule.propertyId);
      const bv = cellOf(b, rule.propertyId);
      const ae = isEmptyValue(av); const be = isEmptyValue(bv);
      if (ae && be) continue;
      if (ae) return 1;  // empties last, regardless of direction
      if (be) return -1;
      const ac = asComparable(Array.isArray(av) ? av.join(',') : av);
      const bc = asComparable(Array.isArray(bv) ? bv.join(',') : bv);
      let cmp: number;
      if (typeof ac === 'number' && typeof bc === 'number') cmp = ac - bc;
      else cmp = String(ac).localeCompare(String(bc), undefined, { sensitivity: 'base' });
      if (cmp !== 0) return rule.dir === 'desc' ? -cmp : cmp;
    }
    return a.sortOrder - b.sortOrder;
  });
  return out;
}

export interface IRowGroup {
  /** The group's raw value ('' for the no-value group). */
  readonly key: string;
  readonly rows: IDatabaseRow[];
}

/**
 * Group rows by a property's value. `optionOrder` (the select property's
 * configured options) fixes the column order; unknown values follow in
 * first-seen order; the no-value group ('') is always last.
 */
export function groupRows(
  rows: readonly IDatabaseRow[],
  propertyId: string,
  optionOrder: readonly string[] = [],
): IRowGroup[] {
  const buckets = new Map<string, IDatabaseRow[]>();
  for (const opt of optionOrder) buckets.set(opt, []);
  for (const row of rows) {
    const raw = cellOf(row, propertyId);
    const keys = Array.isArray(raw)
      ? (raw.length > 0 ? raw.map(String) : [''])
      : [isEmptyValue(raw) ? '' : String(raw)];
    for (const key of keys) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(row);
    }
  }
  const groups: IRowGroup[] = [];
  for (const [key, groupRows] of buckets) {
    if (key === '') continue;
    groups.push({ key, rows: groupRows });
  }
  const empty = buckets.get('');
  if (empty) groups.push({ key: '', rows: empty });
  return groups;
}

/** JSON-decode helpers for the persisted view columns (defensive). */
export function parseFilterConfig(json: string | null | undefined): IFilterConfig {
  try {
    const parsed = JSON.parse(json || '');
    if (parsed && Array.isArray(parsed.rules)) {
      return { conjunction: parsed.conjunction === 'or' ? 'or' : 'and', rules: parsed.rules };
    }
  } catch { /* fall through */ }
  return { conjunction: 'and', rules: [] };
}

export function parseSortConfig(json: string | null | undefined): ISortRule[] {
  try {
    const parsed = JSON.parse(json || '');
    if (Array.isArray(parsed)) {
      return parsed.filter((r) => r && typeof r.propertyId === 'string' && (r.dir === 'asc' || r.dir === 'desc'));
    }
  } catch { /* fall through */ }
  return [];
}
