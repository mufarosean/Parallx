// calculations.ts — the row under a table column (pure).
//
// Notion's calculations, by what a column holds: every column counts rows
// and empties; numbers add up; dates have an earliest and a latest; a
// checkbox counts what is checked. The result is a number or a date string,
// and a label the footer shows beside it.

import type { PropertyType } from '../properties/propertyTypes.js';
import { isChecked, normalizeDateValue, toNumber } from './cellValues.js';

export type CalcKind =
  | 'none'
  | 'count' | 'count_values' | 'count_unique' | 'count_empty' | 'count_not_empty' | 'percent_empty' | 'percent_not_empty'
  | 'sum' | 'average' | 'median' | 'min' | 'max' | 'range'
  | 'earliest' | 'latest' | 'date_range'
  | 'checked' | 'unchecked' | 'percent_checked' | 'percent_unchecked';

export interface ICalcOption { readonly kind: CalcKind; readonly label: string; readonly group: 'count' | 'number' | 'date' | 'checkbox' }

const COMMON: ICalcOption[] = [
  { kind: 'none', label: 'None', group: 'count' },
  { kind: 'count', label: 'Count all', group: 'count' },
  { kind: 'count_values', label: 'Count values', group: 'count' },
  { kind: 'count_unique', label: 'Count unique values', group: 'count' },
  { kind: 'count_empty', label: 'Count empty', group: 'count' },
  { kind: 'count_not_empty', label: 'Count not empty', group: 'count' },
  { kind: 'percent_empty', label: 'Percent empty', group: 'count' },
  { kind: 'percent_not_empty', label: 'Percent not empty', group: 'count' },
];
const NUMBER: ICalcOption[] = [
  { kind: 'sum', label: 'Sum', group: 'number' },
  { kind: 'average', label: 'Average', group: 'number' },
  { kind: 'median', label: 'Median', group: 'number' },
  { kind: 'min', label: 'Min', group: 'number' },
  { kind: 'max', label: 'Max', group: 'number' },
  { kind: 'range', label: 'Range', group: 'number' },
];
const DATE: ICalcOption[] = [
  { kind: 'earliest', label: 'Earliest date', group: 'date' },
  { kind: 'latest', label: 'Latest date', group: 'date' },
  { kind: 'date_range', label: 'Date range', group: 'date' },
];
const CHECKBOX: ICalcOption[] = [
  { kind: 'none', label: 'None', group: 'count' },
  { kind: 'count', label: 'Count all', group: 'count' },
  { kind: 'checked', label: 'Checked', group: 'checkbox' },
  { kind: 'unchecked', label: 'Unchecked', group: 'checkbox' },
  { kind: 'percent_checked', label: 'Percent checked', group: 'checkbox' },
  { kind: 'percent_unchecked', label: 'Percent unchecked', group: 'checkbox' },
];

/** The calculations a column of `type` offers ('title' is the Name column). */
export function calcOptionsFor(type: PropertyType | 'title'): ICalcOption[] {
  switch (type) {
    case 'checkbox': return CHECKBOX;
    case 'number': case 'formula': case 'rollup': case 'unique_id': return [...COMMON, ...NUMBER];
    case 'date': case 'datetime': case 'created_time': case 'last_edited_time': return [...COMMON, ...DATE];
    default: return COMMON;
  }
}

export function calcLabel(kind: CalcKind): string {
  for (const o of [...COMMON, ...NUMBER, ...DATE, ...CHECKBOX]) if (o.kind === kind) return o.label;
  return 'Calculate';
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function pct(n: number, of: number): string {
  if (of === 0) return '0%';
  return `${Math.round((n / of) * 1000) / 10}%`;
}

function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  return Math.abs(n) >= 1e15 ? String(n) : new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(n);
}

/** The value shown under a column for `kind`, over `values` (one per row; the row's title for the Name column). */
export function calculate(kind: CalcKind, values: readonly unknown[], type: PropertyType | 'title'): string {
  const n = values.length;
  const filled = values.filter((v) => !isEmpty(v));
  switch (kind) {
    case 'none': return '';
    case 'count': return String(n);
    case 'count_values': return String(values.reduce<number>((acc, v) => acc + (Array.isArray(v) ? v.length : (isEmpty(v) ? 0 : 1)), 0));
    case 'count_unique': {
      const seen = new Set<string>();
      for (const v of filled) for (const x of (Array.isArray(v) ? v : [v])) seen.add(JSON.stringify(x));
      return String(seen.size);
    }
    case 'count_empty': return String(n - filled.length);
    case 'count_not_empty': return String(filled.length);
    case 'percent_empty': return pct(n - filled.length, n);
    case 'percent_not_empty': return pct(filled.length, n);
    case 'checked': return String(values.filter(isChecked).length);
    case 'unchecked': return String(values.filter((v) => !isChecked(v)).length);
    case 'percent_checked': return pct(values.filter(isChecked).length, n);
    case 'percent_unchecked': return pct(values.filter((v) => !isChecked(v)).length, n);
    case 'sum': case 'average': case 'median': case 'min': case 'max': case 'range': {
      const nums = filled.map(toNumber).filter((x): x is number => x !== null).sort((a, b) => a - b);
      if (nums.length === 0) return '';
      const sum = nums.reduce((a, b) => a + b, 0);
      if (kind === 'sum') return fmtNumber(sum);
      if (kind === 'average') return fmtNumber(sum / nums.length);
      if (kind === 'median') { const m = nums.length >> 1; return fmtNumber(nums.length % 2 ? nums[m]! : (nums[m - 1]! + nums[m]!) / 2); }
      if (kind === 'min') return fmtNumber(nums[0]!);
      if (kind === 'max') return fmtNumber(nums[nums.length - 1]!);
      return fmtNumber(nums[nums.length - 1]! - nums[0]!);
    }
    case 'earliest': case 'latest': case 'date_range': {
      const dates = filled.map(normalizeDateValue).filter((d): d is string => d !== null).sort();
      if (dates.length === 0) return '';
      const first = dates[0]!, last = dates[dates.length - 1]!;
      if (kind === 'earliest') return first.slice(0, 10);
      if (kind === 'latest') return last.slice(0, 10);
      const days = Math.round((Date.UTC(+last.slice(0, 4), +last.slice(5, 7) - 1, +last.slice(8, 10)) - Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1, +first.slice(8, 10))) / 86_400_000);
      return days === 1 ? '1 day' : `${days} days`;
    }
    default: return type === 'title' ? String(n) : '';
  }
}
