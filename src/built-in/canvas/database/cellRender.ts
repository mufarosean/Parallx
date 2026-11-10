// cellRender.ts — a cell's value, read-only, for every property type.
//
// One renderer for the table, the cards of a board, list or gallery, a
// calendar's chips and a timeline's bars, so a select pill or a date reads
// the same everywhere. Editing is the property editors' job; this only
// shows.

import { createBlock } from '../../../ui/kit.js';
import { createLink } from '../../../ui/link.js';
import type { IDatabaseProperty } from './databaseTypes.js';
import { isChecked, normalizeDateValue } from './cellValues.js';

export const PILL_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

export interface IStoredFile { readonly name: string; readonly src: string }

/** The option colour a select, status or tag value shows in. */
export function optionColor(prop: IDatabaseProperty, value: string): string {
  const options = (prop.config as { options?: { value: string; color?: string }[] }).options ?? [];
  return options.find((o) => o.value === value)?.color ?? 'default';
}

export function pill(container: HTMLElement | null, text: string, color: string): HTMLElement {
  const c = PILL_COLORS.includes(color as never) ? color : 'default';
  return createBlock(container, 'span', { className: `canvas-db-pill canvas-db-pill--${c}`, text });
}

/** "Nov 9, 2026" or "Nov 9, 2026, 14:30" from a stored date; the stored text when it is not one. */
export function formatDateValue(v: unknown): string {
  const d = normalizeDateValue(v);
  if (!d) return v == null ? '' : String(v);
  const date = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), d.length > 10 ? +d.slice(11, 13) : 0, d.length > 10 ? +d.slice(14, 16) : 0);
  const day = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  if (d.length === 10) return day;
  return `${day}, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** "Nov 9, 2026, 14:30" from a page timestamp (SQLite's UTC "YYYY-MM-DD HH:MM:SS" or ISO). */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso) ? `${iso.replace(' ', 'T')}Z` : iso;
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return iso;
  return `${t.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}, ${t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export function formatNumberValue(prop: IDatabaseProperty, n: number): string {
  const format = (prop.config as { format?: string }).format ?? 'number';
  switch (format) {
    case 'percent': return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)}%`;
    case 'dollar': return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
    case 'euro': return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n);
    case 'pound': return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n);
    case 'comma': return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(n);
    default: return String(n);
  }
}

export function filesOf(value: unknown): IStoredFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((f): f is IStoredFile => !!f && typeof f === 'object' && typeof (f as IStoredFile).src === 'string')
    .map((f) => ({ name: f.name || f.src.split('/').pop() || 'file', src: f.src }));
}

export function isImageFile(f: IStoredFile): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(f.src) || /^data:image\//.test(f.src);
}

/** The words a value reads as (for a card line, a chip, a search). */
export function valueText(prop: IDatabaseProperty, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  switch (prop.type) {
    case 'checkbox': return isChecked(value) ? 'Checked' : 'Unchecked';
    case 'date': case 'datetime': return formatDateValue(value);
    case 'created_time': case 'last_edited_time': return formatTimestamp(String(value));
    case 'number': return typeof value === 'number' ? formatNumberValue(prop, value) : String(value);
    case 'files': return filesOf(value).map((f) => f.name).join(', ');
    case 'unique_id': { const prefix = (prop.config as { prefix?: string }).prefix; return `${prefix ? `${prefix}-` : ''}${value}`; }
    default: return Array.isArray(value) ? value.map(String).join(', ') : String(value);
  }
}

/**
 * Render `value` of `prop` into `container` (which is emptied first). Returns
 * true when something was drawn, so a card can skip an empty line.
 */
export function renderCellValue(container: HTMLElement, prop: IDatabaseProperty, value: unknown): boolean {
  container.textContent = '';
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return false;
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { error?: unknown }).error === 'string') {
    createBlock(container, 'span', { className: 'canvas-db-cell__error', text: (value as { error: string }).error, attrs: { role: 'alert' } });
    return true;
  }
  switch (prop.type) {
    case 'select':
    case 'status':
      pill(container, String(value), optionColor(prop, String(value)));
      return true;
    case 'tags':
      for (const v of (Array.isArray(value) ? value : [value])) pill(container, String(v), optionColor(prop, String(v)));
      return true;
    case 'url': {
      const href = /^[a-z][a-z0-9+.-]*:/i.test(String(value)) ? String(value) : `https://${String(value)}`;
      createLink(container, { id: null, href, label: String(value), className: 'canvas-db-cell__link' });
      return true;
    }
    case 'email':
      createLink(container, { id: null, href: `mailto:${String(value)}`, label: String(value), className: 'canvas-db-cell__link' });
      return true;
    case 'phone':
      createLink(container, { id: null, href: `tel:${String(value).replace(/[^\d+]/g, '')}`, label: String(value), className: 'canvas-db-cell__link' });
      return true;
    case 'checkbox':
      createBlock(container, 'span', { className: `canvas-db-check${isChecked(value) ? ' canvas-db-check--on' : ''}`, attrs: { role: 'img', 'aria-label': isChecked(value) ? 'Checked' : 'Unchecked' } });
      return true;
    case 'files': {
      const files = filesOf(value);
      for (const f of files) {
        const chip = createBlock(container, 'span', { className: 'canvas-db-file' });
        if (isImageFile(f)) createBlock(chip, 'img', { className: 'canvas-db-file__thumb', attrs: { src: f.src, alt: '' } });
        createBlock(chip, 'span', { className: 'canvas-db-file__name', text: f.name });
      }
      return files.length > 0;
    }
    case 'relation': {
      const items = Array.isArray(value) ? value : [value];
      for (const it of items) {
        const title = it && typeof it === 'object' ? String((it as { title?: string }).title ?? 'Untitled') : String(it);
        createBlock(container, 'span', { className: 'canvas-db-relation', text: title });
      }
      return items.length > 0;
    }
    default:
      container.textContent = valueText(prop, value);
      return true;
  }
}
