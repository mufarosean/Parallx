// filterEngine.ts — Filter evaluation, sort application, and row grouping
//
// Pure data-transformation functions — no UI, no side effects.
// Used by DatabaseEditorPane to transform rows before passing to views.
//
// Dependencies: databaseRegistry (type-only)

import type {
  IDatabaseRow,
  IDatabaseProperty,
  IFilterRule,
  IFilterGroup,
  IPropertyValue,
  ISortRule,
  PropertyType,
  ISelectOption,
} from '../databaseRegistry.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Filter Evaluation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate a compound filter tree against a single row.
 * Returns true if the row passes the filter.
 */
export function evaluateFilter(
  row: IDatabaseRow,
  filter: IFilterGroup,
  properties: IDatabaseProperty[],
): boolean {
  if (!filter.rules || filter.rules.length === 0) return true;

  const results = filter.rules.map(rule => {
    if (_isFilterGroup(rule)) {
      return evaluateFilter(row, rule, properties);
    }
    return _evaluateRule(row, rule, properties);
  });

  return filter.conjunction === 'and'
    ? results.every(Boolean)
    : results.some(Boolean);
}

function _isFilterGroup(rule: IFilterRule | IFilterGroup): rule is IFilterGroup {
  return 'conjunction' in rule && 'rules' in rule;
}

function _evaluateRule(
  row: IDatabaseRow,
  rule: IFilterRule,
  properties: IDatabaseProperty[],
): boolean {
  const prop = properties.find(p => p.id === rule.propertyId);
  if (!prop) return true; // Unknown property — pass through

  const value = prop.type === 'title'
    ? { type: 'title' as const, title: [{ type: 'text' as const, content: row.page.title }] }
    : row.values[rule.propertyId];

  return _evaluateOperator(prop.type, value, rule.operator, rule.value);
}

function _evaluateOperator(
  propType: PropertyType,
  value: IPropertyValue | undefined,
  operator: string,
  filterValue: unknown,
): boolean {
  // ── Empty/not-empty checks (work on any type) ──
  if (operator === 'is_empty') return _isEmpty(propType, value);
  if (operator === 'is_not_empty') return !_isEmpty(propType, value);

  // ── Type-specific evaluation ──
  switch (propType) {
    case 'title':
    case 'rich_text':
    case 'url':
    case 'email':
    case 'phone_number':
      return _evaluateTextOperator(_extractText(propType, value), operator, String(filterValue ?? ''));

    case 'number':
      return _evaluateNumberOperator(
        value?.type === 'number' ? value.number : null,
        operator,
        typeof filterValue === 'number' ? filterValue : Number(filterValue),
      );

    case 'select':
    case 'status':
      return _evaluateSelectOperator(
        _extractOptionName(value),
        operator,
        String(filterValue ?? ''),
      );

    case 'multi_select':
      return _evaluateMultiSelectOperator(
        value?.type === 'multi_select' ? value.multi_select : [],
        operator,
        String(filterValue ?? ''),
      );

    case 'checkbox':
      return _evaluateCheckboxOperator(
        value?.type === 'checkbox' ? value.checkbox : false,
        operator,
        filterValue,
      );

    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return _evaluateDateOperator(
        _extractDateString(propType, value),
        operator,
        String(filterValue ?? ''),
      );

    case 'relation':
      return _evaluateRelationOperator(
        value?.type === 'relation' ? value.relation : [],
        operator,
        String(filterValue ?? ''),
      );

    case 'unique_id': {
      const display = value?.type === 'unique_id'
        ? `${value.unique_id.prefix ? value.unique_id.prefix + '-' : ''}${value.unique_id.number}`
        : '';
      return _evaluateTextOperator(display, operator, String(filterValue ?? ''));
    }

    default:
      return true;
  }
}

// ─── Value Extraction ────────────────────────────────────────────────────────

function _extractText(_propType: PropertyType, value: IPropertyValue | undefined): string {
  if (!value) return '';
  switch (value.type) {
    case 'title': return value.title.map(s => s.content).join('');
    case 'rich_text': return value.rich_text.map(s => s.content).join('');
    case 'url': return value.url ?? '';
    case 'email': return value.email ?? '';
    case 'phone_number': return value.phone_number ?? '';
    default: return '';
  }
}

function _extractOptionName(value: IPropertyValue | undefined): string {
  if (!value) return '';
  if (value.type === 'select') return value.select?.name ?? '';
  if (value.type === 'status') return value.status?.name ?? '';
  return '';
}

function _extractDateString(_propType: PropertyType, value: IPropertyValue | undefined): string | null {
  if (!value) return null;
  if (value.type === 'date') return value.date?.start ?? null;
  if (value.type === 'created_time') return value.created_time;
  if (value.type === 'last_edited_time') return value.last_edited_time;
  return null;
}

// ─── Emptiness Check ─────────────────────────────────────────────────────────

function _isEmpty(_propType: PropertyType, value: IPropertyValue | undefined): boolean {
  if (!value) return true;
  switch (value.type) {
    case 'title': return value.title.length === 0 || value.title.every(s => !s.content);
    case 'rich_text': return value.rich_text.length === 0 || value.rich_text.every(s => !s.content);
    case 'number': return value.number == null;
    case 'select': return value.select == null;
    case 'multi_select': return value.multi_select.length === 0;
    case 'status': return value.status == null;
    case 'date': return value.date == null;
    case 'checkbox': return false; // Checkbox is never "empty"
    case 'url': return !value.url;
    case 'email': return !value.email;
    case 'phone_number': return !value.phone_number;
    case 'files': return value.files.length === 0;
    case 'relation': return value.relation.length === 0;
    case 'created_time': return !value.created_time;
    case 'last_edited_time': return !value.last_edited_time;
    case 'unique_id': return false; // Always has a value
    default: return true;
  }
}

// ─── Type-Specific Evaluation ────────────────────────────────────────────────

function _evaluateTextOperator(text: string, operator: string, filterValue: string): boolean {
  const tLower = text.toLowerCase();
  const fLower = filterValue.toLowerCase();
  switch (operator) {
    case 'equals': return tLower === fLower;
    case 'does_not_equal': return tLower !== fLower;
    case 'contains': return tLower.includes(fLower);
    case 'does_not_contain': return !tLower.includes(fLower);
    case 'starts_with': return tLower.startsWith(fLower);
    case 'ends_with': return tLower.endsWith(fLower);
    default: return true;
  }
}

function _evaluateNumberOperator(num: number | null, operator: string, filterValue: number): boolean {
  if (num == null) return false;
  switch (operator) {
    case 'equals': return num === filterValue;
    case 'does_not_equal': return num !== filterValue;
    case 'greater_than': return num > filterValue;
    case 'less_than': return num < filterValue;
    case 'greater_than_or_equal': return num >= filterValue;
    case 'less_than_or_equal': return num <= filterValue;
    default: return true;
  }
}

function _evaluateSelectOperator(optionName: string, operator: string, filterValue: string): boolean {
  const nLower = optionName.toLowerCase();
  const fLower = filterValue.toLowerCase();
  switch (operator) {
    case 'equals': return nLower === fLower;
    case 'does_not_equal': return nLower !== fLower;
    default: return true;
  }
}

function _evaluateMultiSelectOperator(options: ISelectOption[], operator: string, filterValue: string): boolean {
  const fLower = filterValue.toLowerCase();
  const names = options.map(o => o.name.toLowerCase());
  switch (operator) {
    case 'contains': return names.some(n => n === fLower);
    case 'does_not_contain': return !names.some(n => n === fLower);
    default: return true;
  }
}

function _evaluateCheckboxOperator(checked: boolean, operator: string, filterValue: unknown): boolean {
  if (operator === 'equals') {
    const target = filterValue === true || filterValue === 'true';
    return checked === target;
  }
  return true;
}

function _evaluateDateOperator(dateStr: string | null, operator: string, filterValue: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr).getTime();
  if (isNaN(d)) return false;

  if (operator === 'is_within') {
    return _isWithinRelativePeriod(d, filterValue);
  }

  const f = new Date(filterValue).getTime();
  if (isNaN(f)) return false;

  switch (operator) {
    case 'equals': return _sameDay(d, f);
    case 'before': return d < f;
    case 'after': return d > f;
    case 'on_or_before': return d <= _endOfDay(f);
    case 'on_or_after': return d >= _startOfDay(f);
    default: return true;
  }
}

function _sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

function _startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function _endOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function _isWithinRelativePeriod(ts: number, period: string): boolean {
  const now = Date.now();
  const dayMs = 86400000;
  switch (period) {
    case 'past_week': return ts >= now - 7 * dayMs && ts <= now;
    case 'past_month': return ts >= now - 30 * dayMs && ts <= now;
    case 'past_year': return ts >= now - 365 * dayMs && ts <= now;
    case 'next_week': return ts >= now && ts <= now + 7 * dayMs;
    case 'next_month': return ts >= now && ts <= now + 30 * dayMs;
    case 'next_year': return ts >= now && ts <= now + 365 * dayMs;
    case 'this_week': {
      const start = _startOfWeek(now);
      return ts >= start && ts < start + 7 * dayMs;
    }
    default: return true;
  }
}

function _startOfWeek(ts: number): number {
  const d = new Date(ts);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function _evaluateRelationOperator(
  relations: readonly { readonly id: string }[],
  operator: string,
  filterValue: string,
): boolean {
  const ids = relations.map(r => r.id);
  switch (operator) {
    case 'contains': return ids.includes(filterValue);
    case 'does_not_contain': return !ids.includes(filterValue);
    default: return true;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Sort Application
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply sort rules to rows. Returns a new sorted array (does not mutate).
 * If no sorts, returns rows in their original sort_order.
 */
export function applySorts(
  rows: IDatabaseRow[],
  sorts: ISortRule[],
  properties: IDatabaseProperty[],
): IDatabaseRow[] {
  if (sorts.length === 0) return [...rows];

  return [...rows].sort((a, b) => {
    for (const sort of sorts) {
      const prop = properties.find(p => p.id === sort.propertyId);
      if (!prop) continue;

      const aVal = prop.type === 'title'
        ? { type: 'title' as const, title: [{ type: 'text' as const, content: a.page.title }] }
        : a.values[sort.propertyId];

      const bVal = prop.type === 'title'
        ? { type: 'title' as const, title: [{ type: 'text' as const, content: b.page.title }] }
        : b.values[sort.propertyId];

      const cmp = _compareValues(prop.type, aVal, bVal);
      if (cmp !== 0) {
        return sort.direction === 'ascending' ? cmp : -cmp;
      }
    }
    // Stable fallback: sort_order
    return a.sortOrder - b.sortOrder;
  });
}

function _compareValues(
  propType: PropertyType,
  a: IPropertyValue | undefined,
  b: IPropertyValue | undefined,
): number {
  // Nulls/empty sort to bottom
  const aEmpty = !a || _isEmpty(propType, a);
  const bEmpty = !b || _isEmpty(propType, b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  switch (propType) {
    case 'title':
    case 'rich_text':
    case 'url':
    case 'email':
    case 'phone_number': {
      const aText = _extractText(propType, a).toLowerCase();
      const bText = _extractText(propType, b).toLowerCase();
      return aText.localeCompare(bText);
    }

    case 'number': {
      const aNum = a?.type === 'number' ? a.number ?? 0 : 0;
      const bNum = b?.type === 'number' ? b.number ?? 0 : 0;
      return aNum - bNum;
    }

    case 'select':
    case 'status': {
      const aName = _extractOptionName(a);
      const bName = _extractOptionName(b);
      return aName.localeCompare(bName);
    }

    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const aDate = _extractDateString(propType, a);
      const bDate = _extractDateString(propType, b);
      return (aDate ?? '').localeCompare(bDate ?? '');
    }

    case 'checkbox': {
      const aBool = a?.type === 'checkbox' ? a.checkbox : false;
      const bBool = b?.type === 'checkbox' ? b.checkbox : false;
      return aBool === bBool ? 0 : aBool ? -1 : 1;
    }

    case 'multi_select': {
      const aLen = a?.type === 'multi_select' ? a.multi_select.length : 0;
      const bLen = b?.type === 'multi_select' ? b.multi_select.length : 0;
      return aLen - bLen;
    }

    default:
      return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Row Grouping
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A row group: a label + its rows + optional sub-groups.
 */
export interface IRowGroup {
  readonly key: string;
  readonly label: string;
  readonly color?: string;
  readonly rows: IDatabaseRow[];
  readonly subGroups?: IRowGroup[];
}

/**
 * Group rows by a property and optionally by a sub-property.
 * Returns an array of groups. Rows without a value go into a "No value" group.
 * For Select/Status, groups follow option order from the property config.
 */
export function groupRows(
  rows: IDatabaseRow[],
  groupByPropId: string | null,
  subGroupByPropId: string | null,
  properties: IDatabaseProperty[],
  hideEmptyGroups: boolean,
): IRowGroup[] {
  if (!groupByPropId) {
    return [{ key: '__all__', label: 'All', rows }];
  }

  const prop = properties.find(p => p.id === groupByPropId);
  if (!prop) return [{ key: '__all__', label: 'All', rows }];

  const groupMap = new Map<string, IDatabaseRow[]>();
  const orderedKeys: string[] = [];

  // Pre-populate ordered keys for Select/Status (to respect option order)
  const optionOrder = _getOptionOrder(prop);
  for (const key of optionOrder) {
    groupMap.set(key, []);
    orderedKeys.push(key);
  }

  // Assign rows to groups
  for (const row of rows) {
    const key = _getGroupKey(prop, row);
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
      orderedKeys.push(key);
    }
    groupMap.get(key)!.push(row);
  }

  // Build group objects
  let groups: IRowGroup[] = orderedKeys.map(key => {
    const groupRows = groupMap.get(key) ?? [];
    const info = _getGroupInfo(prop, key);

    let subGroups: IRowGroup[] | undefined;
    if (subGroupByPropId && groupRows.length > 0) {
      subGroups = _buildSubGroups(groupRows, subGroupByPropId, properties, hideEmptyGroups);
    }

    return {
      key,
      label: info.label,
      color: info.color,
      rows: groupRows,
      subGroups,
    };
  });

  if (hideEmptyGroups) {
    groups = groups.filter(g => g.rows.length > 0);
  }

  return groups;
}

function _buildSubGroups(
  rows: IDatabaseRow[],
  subGroupByPropId: string,
  properties: IDatabaseProperty[],
  hideEmptyGroups: boolean,
): IRowGroup[] {
  // Recursive call without further sub-grouping
  return groupRows(rows, subGroupByPropId, null, properties, hideEmptyGroups);
}

function _getGroupKey(prop: IDatabaseProperty, row: IDatabaseRow): string {
  if (prop.type === 'title') return row.page.title || 'Untitled';

  const value = row.values[prop.id];
  if (!value) return '__no_value__';

  switch (value.type) {
    case 'select': return value.select?.name ?? '__no_value__';
    case 'status': return value.status?.name ?? '__no_value__';
    case 'checkbox': return value.checkbox ? 'Checked' : 'Unchecked';
    case 'number': return value.number != null ? String(value.number) : '__no_value__';
    case 'date': return value.date?.start?.slice(0, 10) ?? '__no_value__';
    case 'multi_select': return value.multi_select.length > 0
      ? value.multi_select.map(o => o.name).join(', ')
      : '__no_value__';
    case 'rich_text': return value.rich_text.map(s => s.content).join('') || '__no_value__';
    case 'url': return value.url ?? '__no_value__';
    case 'email': return value.email ?? '__no_value__';
    case 'created_time': return value.created_time?.slice(0, 10) ?? '__no_value__';
    case 'last_edited_time': return value.last_edited_time?.slice(0, 10) ?? '__no_value__';
    default: return '__no_value__';
  }
}

function _getOptionOrder(prop: IDatabaseProperty): string[] {
  const config = prop.config as { options?: ISelectOption[] } | undefined;
  if (!config?.options) return [];
  return config.options.map(o => o.name);
}

function _getGroupInfo(prop: IDatabaseProperty, key: string): { label: string; color?: string } {
  if (key === '__no_value__') return { label: 'No value' };
  if (key === '__all__') return { label: 'All' };

  const config = prop.config as { options?: ISelectOption[] } | undefined;
  if (config?.options) {
    const opt = config.options.find(o => o.name === key);
    if (opt) return { label: opt.name, color: opt.color };
  }

  return { label: key };
}

/**
 * Apply the full data pipeline: filter → sort → group.
 * Convenience function for DatabaseEditorPane.
 */
export function applyViewDataPipeline(
  rows: IDatabaseRow[],
  view: { filterConfig: IFilterGroup; sortConfig: ISortRule[]; groupBy: string | null; subGroupBy: string | null; hideEmptyGroups: boolean },
  properties: IDatabaseProperty[],
): { filteredRows: IDatabaseRow[]; sortedRows: IDatabaseRow[]; groups: IRowGroup[] } {
  // 1. Filter
  const filteredRows = rows.filter(row => evaluateFilter(row, view.filterConfig, properties));
  // 2. Sort
  const sortedRows = applySorts(filteredRows, view.sortConfig, properties);
  // 3. Group
  const groups = groupRows(sortedRows, view.groupBy, view.subGroupBy, properties, view.hideEmptyGroups);

  return { filteredRows, sortedRows, groups };
}
