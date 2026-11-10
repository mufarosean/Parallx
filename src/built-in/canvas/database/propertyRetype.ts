// propertyRetype.ts — change a property's type, carrying its values over
// (docs/DATABASES.md). Text that repeats belongs in a select: this is how a
// text column becomes one, its distinct values turned into options. Every
// plain type converts to every other plain type; a value that does not fit
// the new type is cleared, and the user is asked first when any would be.

import type { PropertyType } from '../properties/propertyTypes.js';
import { DEFAULT_STATUS_OPTIONS, defaultConfigFor, propertyTypeMeta } from '../properties/propertyTypeMeta.js';
import type { IExtensionMenuItem } from '../../../ui/contextMenu.js';
import { showConfirmModal } from '../../../api/notificationService.js';
import type { DatabaseDataService } from './databaseDataService.js';
import type { IDatabaseProperty } from './databaseTypes.js';
import { coerceCellValue } from './cellValues.js';
import { PILL_COLORS, valueText } from './cellRender.js';

/** The types a column can be changed between: the plain ones, whose values are text, numbers, dates or option names. */
export const RETYPE_TYPES: readonly PropertyType[] = ['text', 'number', 'select', 'tags', 'status', 'date', 'datetime', 'checkbox', 'url', 'email', 'phone'];

export function canRetype(prop: IDatabaseProperty): boolean { return RETYPE_TYPES.includes(prop.type); }

interface IOption { value: string; color: string; group?: string }
const optionsOf = (prop: IDatabaseProperty): IOption[] => ((prop.config as { options?: IOption[] }).options ?? []).map((o) => ({ ...o }));
const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** A cell's content as text, the way the user typed it (not formatted). */
function textOf(from: IDatabaseProperty, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Checked' : '';
  if (Array.isArray(value)) return value.map(String).join(', ');
  return valueText(from, value);
}

/** What a cell of `from` holding `value` holds once the column is `to`; null (or [] for tags, false for a checkbox) when it does not carry over. */
export function convertValue(from: IDatabaseProperty, to: PropertyType, value: unknown): unknown {
  const text = textOf(from, value);
  switch (to) {
    case 'tags': {
      const names = Array.isArray(value) ? value.map(String) : text.split(',').map((s) => s.trim());
      return names.filter((n, i, all) => n && all.indexOf(n) === i);
    }
    case 'select': case 'status': return Array.isArray(value) ? (value.length ? String(value[0]) : null) : (text || null);
    case 'number': {
      if (typeof value === 'number') return value;
      if (typeof value === 'boolean') return value ? 1 : 0;
      const digits = text.replace(/[^0-9.eE+-]/g, '');
      const n = Number(digits);
      return /\d/.test(digits) && Number.isFinite(n) ? n : null;
    }
    case 'checkbox': return typeof value === 'boolean' ? value : /^(yes|true|1|checked|done|x)$/i.test(text);
    case 'date': case 'datetime': case 'email': {
      const c = coerceCellValue(to, text || null);
      return c.ok ? c.value : null;
    }
    default: return text || null;
  }
}

/** The new column's config: for a select, tags or status, options for every value (old options keep their colours). */
export function retypeConfig(from: IDatabaseProperty, to: PropertyType, converted: readonly unknown[]): Record<string, unknown> {
  const base = defaultConfigFor(to);
  if (to !== 'select' && to !== 'tags' && to !== 'status') return base;
  const old = (from.type === 'select' || from.type === 'tags' || from.type === 'status') ? optionsOf(from) : [];
  const names = converted.flatMap((v) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []));
  const options: IOption[] = old.map((o) => ({ value: o.value, color: o.color, group: o.group }));
  for (const name of names) if (!options.some((o) => o.value === name)) options.push({ value: name, color: PILL_COLORS[1 + (options.length % (PILL_COLORS.length - 1))]! });
  if (to === 'status') {
    for (const o of options) if (!o.group) o.group = 'todo';
    for (const d of DEFAULT_STATUS_OPTIONS) if (!options.some((o) => o.value === d.value)) options.push({ ...d });
  } else {
    for (const o of options) delete o.group;
  }
  return { ...base, options };
}

/** Asks before a change that clears values: `lost` of `total` cells do not fit. */
export type IRetypeConfirm = (lost: number, total: number, to: PropertyType) => Promise<boolean>;

const confirmInDialog: IRetypeConfirm = (lost, total, to) => showConfirmModal(document.body, {
  message: `Change the type to ${propertyTypeMeta(to).label}?`,
  detail: `${lost} of ${total} values do not fit a ${propertyTypeMeta(to).label} column and will be cleared.`,
  confirmLabel: 'Change Type',
  danger: true,
});

/** Change `prop` to `to`, converting every cell. Returns false when the user kept the old type. */
export async function changePropertyType(db: DatabaseDataService, databaseId: string, prop: IDatabaseProperty, to: PropertyType, confirm: IRetypeConfirm = confirmInDialog): Promise<boolean> {
  if (prop.type === to || !RETYPE_TYPES.includes(to) || !canRetype(prop)) return false;
  const rows = await db.listRows(databaseId);
  const cells = rows.map((r) => ({ pageId: r.pageId, before: r.values[prop.id], after: convertValue(prop, to, r.values[prop.id]) }));
  const filled = cells.filter((c) => !isBlank(c.before));
  const lost = filled.filter((c) => isBlank(c.after) || c.after === false).length;
  if (lost > 0 && !(await confirm(lost, filled.length, to))) return false;
  await db.updateProperty(databaseId, prop.id, { type: to, config: retypeConfig(prop, to, cells.map((c) => c.after)) });
  for (const c of cells) {
    if (JSON.stringify(c.after ?? null) !== JSON.stringify(c.before ?? null)) await db.setCellValue(databaseId, c.pageId, prop.id, c.after);
  }
  return true;
}

/** The Change Type menu: every plain type, the current one checked. */
export function retypeMenuItems(db: DatabaseDataService, databaseId: string, prop: IDatabaseProperty): IExtensionMenuItem[] {
  return RETYPE_TYPES.map((t) => {
    const meta = propertyTypeMeta(t);
    return { label: meta.label, icon: meta.icon, checked: prop.type === t, onSelect: () => void changePropertyType(db, databaseId, prop, t) };
  });
}
