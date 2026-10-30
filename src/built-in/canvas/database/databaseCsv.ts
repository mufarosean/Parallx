// databaseCsv.ts — a database view as CSV, and CSV back into rows (pure).
//
// The CSV itself follows RFC 4180: fields are separated by commas, records
// by CRLF, and a field holding a comma, a quote or a line break is quoted
// with its quotes doubled.  Reading is lenient: LF or CR line ends, a UTF-8
// byte-order mark, and short records are all accepted.
//
// Cells are written as text the way the table shows them:
//   select    the option name
//   tags      the names joined with ", " (a list of anything else the same)
//   date      the stored "YYYY-MM-DD" ("YYYY-MM-DDTHH:mm" for a date and time)
//   checkbox  true | false
//   number    the number
// and read back through the same rules every other write uses
// (cellValues.ts), so a CSV this module wrote imports as the same cells.

import type { IDatabaseProperty, IDatabaseRow, IDatabaseView } from './databaseTypes.js';
import { applyFilter, applySort } from './databaseViewModel.js';
import { coerceCellValue, isChecked, normalizeDateValue, toNumber } from './cellValues.js';
import type { PropertyType } from '../properties/propertyTypes.js';

/** Excel reads a UTF-8 file as the system code page unless it starts with one. */
export const UTF8_BOM = '﻿';

// ── CSV text ────────────────────────────────────────────────────────────────

function quoteField(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/** Records as CSV text: CRLF between records, no line end after the last. */
export function serializeCsv(records: readonly (readonly string[])[]): string {
  return records.map((r) => r.map(quoteField).join(',')).join('\r\n');
}

/**
 * The records of a CSV text.  A blank line is not a record; a line holding
 * only `""` is (one empty field).  A quote inside an unquoted field is kept
 * as text, as spreadsheets do.
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;     // inside a quoted field
  let wasQuoted = false;  // the current field opened with a quote
  const endField = () => { record.push(field); field = ''; wasQuoted = false; };
  const endRecord = () => {
    const blank = record.length === 0 && field === '' && !wasQuoted;
    endField();
    if (!blank) records.push(record);
    record = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '' && !wasQuoted) { quoted = true; wasQuoted = true; continue; }
    if (c === ',') { endField(); continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRecord();
      continue;
    }
    field += c;
  }
  if (field !== '' || wasQuoted || record.length > 0) endRecord();
  return records;
}

// ── Export ──────────────────────────────────────────────────────────────────

/** A cell as the text the table shows for it. */
export function cellToCsvText(type: PropertyType, value: unknown): string {
  if (type === 'checkbox') return isChecked(value) ? 'true' : 'false';
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => cellToCsvText('text', v)).filter((s) => s !== '').join(', ');
  if (type === 'number') { const n = toNumber(value); return n === null ? String(value) : String(n); }
  if (type === 'date' || type === 'datetime') return normalizeDateValue(value) ?? String(value);
  if (typeof value === 'object') {
    const title = (value as { title?: unknown }).title;
    return typeof title === 'string' ? title : JSON.stringify(value);
  }
  return String(value);
}

/** The properties a view shows, in their column order. */
export function visibleProperties(props: readonly IDatabaseProperty[], view: Pick<IDatabaseView, 'config'>): IDatabaseProperty[] {
  const hidden = new Set(Array.isArray(view.config['hidden']) ? (view.config['hidden'] as unknown[]).map(String) : []);
  return props.filter((p) => !hidden.has(p.id));
}

/**
 * What a view shows, as CSV records: a header of "Name" and the visible
 * property names, then one record per row the view's filter keeps, in its
 * sort order.
 */
export function databaseViewToRecords(
  props: readonly IDatabaseProperty[],
  view: Pick<IDatabaseView, 'config' | 'filter' | 'sort'>,
  rows: readonly IDatabaseRow[],
): string[][] {
  const shown = visibleProperties(props, view);
  const typeOf = (id: string) => props.find((p) => p.id === id)?.type;
  const ordered = applySort(applyFilter(rows, view.filter, typeOf), view.sort);
  return [
    ['Name', ...shown.map((p) => p.name)],
    ...ordered.map((row) => [row.title, ...shown.map((p) => cellToCsvText(p.type, row.values[p.id]))]),
  ];
}

/** Records as a CSV file's text: the byte-order mark Excel needs, a final line end. */
export function csvFileText(records: readonly (readonly string[])[]): string {
  return UTF8_BOM + serializeCsv(records) + '\r\n';
}

/** The view as a CSV file's text. */
export function databaseViewToCsv(
  props: readonly IDatabaseProperty[],
  view: Pick<IDatabaseView, 'config' | 'filter' | 'sort'>,
  rows: readonly IDatabaseRow[],
): string {
  return csvFileText(databaseViewToRecords(props, view, rows));
}

// ── Import ──────────────────────────────────────────────────────────────────

export interface ICsvImportColumn {
  /** The column's place in each record. */
  readonly index: number;
  /** The header, trimmed; "Column N" for an empty one. */
  readonly name: string;
  /** The existing property it fills, or null: a text property is made for it. */
  readonly propertyId: string | null;
}

export interface ICsvImportPlan {
  /** The column that holds row titles, or -1 when the file has none. */
  readonly titleColumn: number;
  readonly columns: readonly ICsvImportColumn[];
  /** The data records (the header left out, blank records too). */
  readonly records: readonly (readonly string[])[];
}

/**
 * How a CSV's columns land in a database.  The title is the column headed
 * "Name" (any case), else "Title", else the first column, as Notion reads
 * it.  Every other column fills the property of the same name (any case),
 * each property once; a column without one gets a new text property.  A
 * column whose header repeats one already placed is left out.
 */
export function planCsvImport(table: readonly (readonly string[])[], props: readonly Pick<IDatabaseProperty, 'id' | 'name'>[]): ICsvImportPlan {
  const header = (table[0] ?? []).map((h) => h.trim());
  const lower = header.map((h) => h.toLowerCase());
  let titleColumn = lower.indexOf('name');
  if (titleColumn < 0) titleColumn = lower.indexOf('title');
  if (titleColumn < 0 && header.length > 0) titleColumn = 0;

  const used = new Set<string>();
  const placed = new Set<string>();
  const columns: ICsvImportColumn[] = [];
  header.forEach((raw, index) => {
    if (index === titleColumn) return;
    const name = raw || `Column ${index + 1}`;
    const key = name.toLowerCase();
    if (placed.has(key)) return;
    placed.add(key);
    const prop = props.find((p) => p.name.trim().toLowerCase() === key && !used.has(p.id));
    if (prop) used.add(prop.id);
    columns.push({ index, name, propertyId: prop?.id ?? null });
  });

  const records = table.slice(1).filter((r) => r.some((cell) => cell.trim() !== ''));
  return { titleColumn, columns, records };
}

/** A CSV cell as the value a property of `type` stores, or why it cannot be. */
export function csvTextToValue(type: PropertyType, text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (type === 'tags') return coerceCellValue('tags', text.split(',').map((s) => s.trim()).filter(Boolean));
  if (type === 'text' || type === 'url') return coerceCellValue(type, text);
  return coerceCellValue(type, text.trim());
}

/**
 * One record's title and cell values.  An empty cell is left unset, and a
 * cell its property cannot take (a word in a number column) is left out and
 * counted, so one bad cell does not lose the row.
 */
export function csvRecordToRow(
  record: readonly string[],
  titleColumn: number,
  columns: readonly { readonly index: number; readonly propertyId: string; readonly type: PropertyType }[],
): { title: string; values: Record<string, unknown>; skipped: number } {
  const title = titleColumn >= 0 ? (record[titleColumn] ?? '').trim() : '';
  const values: Record<string, unknown> = {};
  let skipped = 0;
  for (const col of columns) {
    const text = record[col.index] ?? '';
    if (text.trim() === '') continue;
    const result = csvTextToValue(col.type, text);
    if (result.ok) values[col.propertyId] = result.value;
    else skipped++;
  }
  return { title, values, skipped };
}
