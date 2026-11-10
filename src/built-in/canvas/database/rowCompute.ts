// rowCompute.ts — the values a row has without anything being stored (pure).
//
// Created time and last edited time come from the row's page; a formula
// (step 6) from its other cells; a rollup (step 5) from the rows it relates
// to. `withDerivedValues` fills these into each row's values, so the view
// model filters, sorts, groups and calculates on them like any stored cell,
// and the renderers never ask where a value came from.

import type { IDatabaseProperty, IDatabaseRow } from './databaseTypes.js';
import { isComputedType } from '../properties/propertyTypes.js';

/** "YYYY-MM-DDTHH:mm" (local) from a page timestamp (SQLite's UTC "YYYY-MM-DD HH:MM:SS" or ISO), so it sorts and filters as a datetime. */
export function timestampToLocalDatetime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso) ? `${iso.replace(' ', 'T')}Z` : iso;
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return null;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`;
}

export interface IDeriveContext {
  /** A formula's value for a row; null when formulas are not wired (step 6). */
  formula?(prop: IDatabaseProperty, row: IDatabaseRow, values: Record<string, unknown>): unknown;
  /** A rollup's value for a row (step 5). */
  rollup?(prop: IDatabaseProperty, row: IDatabaseRow, values: Record<string, unknown>): unknown;
}

/** Each row with its computed properties filled in. Rows without computed properties come back as they are. */
export function withDerivedValues(rows: readonly IDatabaseRow[], props: readonly IDatabaseProperty[], ctx: IDeriveContext = {}): IDatabaseRow[] {
  const computed = props.filter((p) => isComputedType(p.type));
  if (computed.length === 0) return [...rows];
  // Formulas may read rollups; rollups may read stored cells: created/edited first, then rollups, then formulas.
  const order = [...computed].sort((a, b) => rank(a) - rank(b));
  return rows.map((row) => {
    const values: Record<string, unknown> = { ...row.values };
    for (const p of order) {
      switch (p.type) {
        case 'created_time': values[p.id] = timestampToLocalDatetime(row.createdAt); break;
        case 'last_edited_time': values[p.id] = timestampToLocalDatetime(row.updatedAt); break;
        case 'rollup': values[p.id] = ctx.rollup ? ctx.rollup(p, row, values) : null; break;
        case 'formula': values[p.id] = ctx.formula ? ctx.formula(p, row, values) : null; break;
        default: break;
      }
    }
    return { ...row, values };
  });
}

function rank(p: IDatabaseProperty): number {
  return p.type === 'formula' ? 2 : p.type === 'rollup' ? 1 : 0;
}
