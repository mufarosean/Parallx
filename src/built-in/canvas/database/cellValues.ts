// cellValues.ts — one shape per property type
//
// Cells are written by the property editors, the board, the AI tools and the
// legacy migration.  The editors wrote the right shapes; the AI tools wrote
// whatever the model sent ("false" into a checkbox, which then showed as
// checked, "5" into a number, "Oct 4" into a date).  Every write now goes
// through `coerceCellValue`, and the filters read values through the same
// rules, so a value means one thing everywhere.
//
//   checkbox  true | false            (never-set and cleared read as unchecked)
//   number    finite number | null
//   date      "YYYY-MM-DD" | null
//   datetime  "YYYY-MM-DDTHH:mm" | null   (local time, as the editor writes it)
//   select    option name | null
//   tags      option names[]
//   text, url string | null

import type { PropertyType } from '../properties/propertyTypes.js';

export type CoerceResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function validDate(y: string, m: string, d: string): boolean {
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
}

/** True for a checked checkbox, whatever older writers stored. */
export function isChecked(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['true', 'yes', '1', 'checked', 'on'].includes(v.trim().toLowerCase());
  return false;
}

/** A finite number, or null. Numeric strings count ("5", " 5.0", "1e3"). */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" from a stored date value, or null. */
export function normalizeDateValue(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const d = DATE_RE.exec(s);
  if (d) return validDate(d[1]!, d[2]!, d[3]!) ? s : null;
  const t = DATETIME_RE.exec(s);
  if (t && validDate(t[1]!, t[2]!, t[3]!)) return `${t[1]}-${t[2]}-${t[3]}T${t[4]}:${t[5]}`;
  return null;
}

function yes(value: unknown): CoerceResult { return { ok: true, value }; }
function no(reason: string): CoerceResult { return { ok: false, reason }; }

/** The value to store for a property of `type`, or why it cannot be stored. */
export function coerceCellValue(type: PropertyType, value: unknown): CoerceResult {
  const blank = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  switch (type) {
    case 'checkbox': {
      if (blank) return yes(false);
      if (typeof value === 'boolean') return yes(value);
      if (typeof value === 'number' && (value === 0 || value === 1)) return yes(value === 1);
      if (typeof value === 'string') {
        const s = value.trim().toLowerCase();
        if (['true', 'yes', '1', 'checked', 'on'].includes(s)) return yes(true);
        if (['false', 'no', '0', 'unchecked', 'off'].includes(s)) return yes(false);
      }
      return no(`a checkbox takes true or false, not ${JSON.stringify(value)}`);
    }
    case 'number': {
      if (blank) return yes(null);
      const n = toNumber(value);
      return n === null ? no(`a number column takes a number, not ${JSON.stringify(value)}`) : yes(n);
    }
    case 'date': {
      if (blank) return yes(null);
      const d = normalizeDateValue(value);
      return d ? yes(d.slice(0, 10)) : no(`a date takes YYYY-MM-DD, not ${JSON.stringify(value)}`);
    }
    case 'datetime': {
      if (blank) return yes(null);
      const d = normalizeDateValue(value);
      if (!d) return no(`a date and time takes YYYY-MM-DDTHH:mm, not ${JSON.stringify(value)}`);
      return yes(d.length === 10 ? `${d}T00:00` : d);
    }
    case 'select': {
      if (blank) return yes(null);
      if (Array.isArray(value)) {
        if (value.length > 1) return no('a select takes one option, not a list');
        return coerceCellValue('select', value[0]);
      }
      if (typeof value === 'string' || typeof value === 'number') return yes(String(value).trim());
      return no(`a select takes an option name, not ${JSON.stringify(value)}`);
    }
    case 'tags': {
      if (blank) return yes([]);
      const list = Array.isArray(value) ? value : [value];
      const out: string[] = [];
      for (const item of list) {
        if (typeof item !== 'string' && typeof item !== 'number') return no(`tags are names, not ${JSON.stringify(item)}`);
        const name = String(item).trim();
        if (name && !out.includes(name)) out.push(name);
      }
      return yes(out);
    }
    case 'text':
    case 'url':
    default: {
      if (value === null || value === undefined) return yes(null);
      if (typeof value === 'object') return no(`a ${type} column takes text, not ${JSON.stringify(value)}`);
      return yes(String(value));
    }
  }
}

/** Names in a select/tags value that are not yet options of the property. */
export function missingOptions(type: PropertyType, value: unknown, options: readonly { value: string }[]): string[] {
  if (type !== 'select' && type !== 'tags') return [];
  const names = Array.isArray(value) ? value.map(String) : (typeof value === 'string' && value ? [value] : []);
  const known = new Set(options.map((o) => o.value));
  return names.filter((n) => !known.has(n));
}
