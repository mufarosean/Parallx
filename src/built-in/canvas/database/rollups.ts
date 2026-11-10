// rollups.ts — a rollup's value (pure): one function over a property of the
// rows a relation points at. Counts and sums come back as numbers, dates as
// stored date strings, "show original" as the list of values.

import type { IDatabaseProperty, IDatabaseRow } from './databaseTypes.js';
import { TITLE_KEY } from './databaseTypes.js';
import type { PropertyType } from '../properties/propertyTypes.js';
import { calcOptionsFor, calculate, type CalcKind } from './calculations.js';
import { toNumber } from './cellValues.js';
import { relationConfig, relationIds, type IRelatedDatabase } from './relations.js';

export type RollupKind = 'show_original' | Exclude<CalcKind, 'none'>;

export interface IRollupConfig { readonly relationId: string; readonly propertyId: string; readonly function: RollupKind }

export function rollupConfig(prop: Pick<IDatabaseProperty, 'config'>): IRollupConfig {
  const c = prop.config;
  const fn = typeof c['function'] === 'string' ? c['function'] : 'show_original';
  return {
    relationId: typeof c['relationId'] === 'string' ? c['relationId'] : '',
    propertyId: typeof c['propertyId'] === 'string' && c['propertyId'] ? c['propertyId'] : TITLE_KEY,
    function: fn as RollupKind,
  };
}

/** The functions a rollup over a property of `type` offers: show original, then the column's calculations. */
export function rollupOptionsFor(type: PropertyType | 'title'): { kind: RollupKind; label: string }[] {
  return [{ kind: 'show_original', label: 'Show original' }, ...calcOptionsFor(type).filter((o) => o.kind !== 'none').map((o) => ({ kind: o.kind as RollupKind, label: o.label }))];
}

/** What a rollup produces, so views can sort, filter and chart it: a number, a date string, text, or a list. */
export function rollupResultType(fn: RollupKind): PropertyType | 'list' {
  if (fn === 'show_original') return 'list';
  if (fn === 'earliest' || fn === 'latest') return 'date';
  if (fn === 'date_range' || fn.startsWith('percent')) return 'text';
  return 'number';
}

/** The rollup value of `row`, given its database's properties and the related databases' rows. */
export function rollupValue(prop: IDatabaseProperty, values: Readonly<Record<string, unknown>>, props: readonly IDatabaseProperty[], related: ReadonlyMap<string, IRelatedDatabase>): unknown {
  const cfg = rollupConfig(prop);
  const relation = props.find((p) => p.id === cfg.relationId && p.type === 'relation');
  if (!relation) return null;
  const target = related.get(relationConfig(relation).databaseId);
  if (!target) return null;
  const ids = relationIds(values[relation.id]);
  const rows = ids.map((id) => target.rows.get(id)).filter((r): r is IDatabaseRow => !!r);
  const srcProp = cfg.propertyId === TITLE_KEY ? null : target.props.find((p) => p.id === cfg.propertyId) ?? null;
  const type: PropertyType | 'title' = srcProp?.type ?? 'title';
  const vals = rows.map((r) => (srcProp ? r.values[srcProp.id] : r.title));
  if (cfg.function === 'show_original') return srcProp ? vals.filter((v) => v !== null && v !== undefined && v !== '') : rows.map((r) => ({ id: r.pageId, title: r.title, icon: r.icon }));
  const text = calculate(cfg.function, vals, type);
  if (rollupResultType(cfg.function) === 'number') { const n = toNumber(text.replace(/,/g, '')); return n ?? (text === '' ? null : text); }
  return text === '' ? null : text;
}

/** The property a rollup shows, so a cell renders a rolled-up select as pills and a rolled-up date as a date. */
export function rollupDisplayProperty(prop: IDatabaseProperty, props: readonly IDatabaseProperty[], related: ReadonlyMap<string, IRelatedDatabase>): IDatabaseProperty {
  const cfg = rollupConfig(prop);
  const relation = props.find((p) => p.id === cfg.relationId);
  const target = relation ? related.get(relationConfig(relation).databaseId) : undefined;
  const src = target?.props.find((p) => p.id === cfg.propertyId);
  if (cfg.function === 'show_original') return src ? { ...prop, type: src.type, config: src.config } : { ...prop, type: 'relation' };
  const rt = rollupResultType(cfg.function);
  return { ...prop, type: rt === 'list' ? 'text' : rt, config: {} };
}
