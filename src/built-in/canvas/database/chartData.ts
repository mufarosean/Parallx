// chartData.ts — what a chart view draws (pure): rows grouped by one
// property, measured by count or by a number property's sum or average.

import type { IDatabaseProperty, IDatabaseRow } from './databaseTypes.js';
import { TITLE_KEY } from './databaseTypes.js';
import type { IViewConfig } from './viewConfig.js';
import { groupRows } from './databaseViewModel.js';
import { isChecked, toNumber } from './cellValues.js';
import { dayOfValue, monthOf, monthTitle } from './calendarDates.js';

export interface IChartSlice { readonly key: string; readonly label: string; readonly value: number; readonly color: string }

export interface IChartData {
  readonly kind: 'bar' | 'line' | 'donut';
  readonly slices: readonly IChartSlice[];
  /** What the numbers are: "Count", "Sum of Pages", "Average of Rating". */
  readonly measureLabel: string;
  readonly groupLabel: string;
  readonly total: number;
}

/** Properties a chart can group by: options, checkboxes and dates (by month). */
export function groupableProperties(props: readonly IDatabaseProperty[]): IDatabaseProperty[] {
  return props.filter((p) => ['select', 'status', 'tags', 'checkbox', 'date', 'datetime', 'created_time', 'last_edited_time'].includes(p.type));
}

/** Properties a chart can sum or average. */
export function measurableProperties(props: readonly IDatabaseProperty[]): IDatabaseProperty[] {
  return props.filter((p) => ['number', 'unique_id', 'formula', 'rollup'].includes(p.type));
}

const PALETTE = ['1', '2', '3', '4', '5', '6'];

export function chartData(rows: readonly IDatabaseRow[], props: readonly IDatabaseProperty[], cfg: IViewConfig): IChartData {
  const { kind, aggregate } = cfg.chart;
  const groupProp = props.find((p) => p.id === cfg.chart.groupBy) ?? groupableProperties(props)[0] ?? null;
  const measureProp = aggregate === 'count' ? null : (props.find((p) => p.id === cfg.chart.measure) ?? measurableProperties(props)[0] ?? null);
  const measureLabel = !measureProp ? 'Count' : `${aggregate === 'sum' ? 'Sum' : 'Average'} of ${measureProp.name}`;
  const measure = (group: readonly IDatabaseRow[]): number => {
    if (!measureProp) return group.length;
    const nums = group.map((r) => toNumber(r.values[measureProp.id])).filter((n): n is number => n !== null);
    if (nums.length === 0) return 0;
    const sum = nums.reduce((a, b) => a + b, 0);
    return aggregate === 'sum' ? sum : sum / nums.length;
  };
  let slices: IChartSlice[] = [];
  if (!groupProp) {
    slices = [{ key: 'all', label: 'All rows', value: measure(rows), color: PALETTE[0]! }];
  } else if (groupProp.type === 'checkbox') {
    const yes = rows.filter((r) => isChecked(r.values[groupProp.id]));
    const no = rows.filter((r) => !isChecked(r.values[groupProp.id]));
    slices = [{ key: 'checked', label: 'Checked', value: measure(yes), color: PALETTE[1]! }, { key: 'unchecked', label: 'Unchecked', value: measure(no), color: PALETTE[0]! }];
  } else if (['date', 'datetime', 'created_time', 'last_edited_time'].includes(groupProp.type)) {
    const byMonth = new Map<string, IDatabaseRow[]>();
    for (const r of rows) {
      const day = dayOfValue(r.values[groupProp.id]);
      const key = day ? monthOf(day) : '';
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(r);
    }
    slices = [...byMonth.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([key, group], i) => ({ key, label: key ? monthTitle(key) : `No ${groupProp.name}`, value: measure(group), color: PALETTE[i % PALETTE.length]! }));
  } else {
    const options = ((groupProp.config as { options?: { value: string; color?: string }[] }).options ?? []);
    slices = groupRows(rows, groupProp.id, options.map((o) => o.value)).map((g, i) => ({
      key: g.key, label: g.key || `No ${groupProp.name}`, value: measure(g.rows), color: PALETTE[i % PALETTE.length]!,
    }));
  }
  return { kind, slices, measureLabel, groupLabel: groupProp?.name ?? 'Name', total: slices.reduce((a, s) => a + s.value, 0) };
}

export { TITLE_KEY };
