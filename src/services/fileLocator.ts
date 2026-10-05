// fileLocator.ts — where in a file a quoted passage is.
//
// Each kind of file is addressed by the units its viewer shows: a PDF by
// page (the viewer's page box, 1 = first page of the file), a text file by
// line (the editor's gutter), a spreadsheet by sheet and cell (the
// spreadsheet's own row numbers and column letters). Rich documents with no
// such units (Word, EPUB) can only say whether the quote is there.
//
// The file service owns one locator, so link checks, the AI's file tools and
// search results share one cache of extracted pages, keyed by path and
// invalidated when the file's size or modified time changes.

import type { URI } from '../platform/uri.js';
import { columnLetters, isLocatableQuote, locateQuote } from './quoteLocator.js';

/** One sheet of a workbook as the spreadsheet viewer gets it. */
export interface ILocatorSheet {
  readonly name: string;
  /** Cell text by row, as shown (formatted), blank rows included. */
  readonly rows: readonly (readonly string[])[];
  /** 0-based spreadsheet row of `rows[0]` (row 1 = 0). */
  readonly rowStart?: number;
  /** 0-based spreadsheet column of each row's first entry (A = 0). */
  readonly colStart?: number;
}

export interface IFileLocatorHost {
  stat(uri: URI): Promise<{ size: number; mtime: number }>;
  readText(uri: URI): Promise<string>;
  /** PDF text, one string per page. */
  readPdfPages(uri: URI): Promise<readonly string[]>;
  /** Extracted text of a rich document without page structure (Word, EPUB). */
  readDocumentText(uri: URI): Promise<string>;
  readSpreadsheet(uri: URI): Promise<readonly ILocatorSheet[]>;
}

/** How spots in a file are addressed. */
export type FileAddressing = 'page' | 'line' | 'cell' | 'none';

/** Where one occurrence of a quote is. */
export interface IFileSpot {
  /** PDF page the quote starts on (1-based) and, when it runs on, ends on. */
  readonly page?: number;
  readonly endPage?: number;
  /** Text line the quote starts on (1-based) and ends on. */
  readonly line?: number;
  readonly endLine?: number;
  /** Spreadsheet sheet name and the cell the quote starts in (e.g. "B206"). */
  readonly sheet?: string;
  readonly cell?: string;
  /** The passage as the file has it, whitespace collapsed. */
  readonly text: string;
}

export interface IFileLocateResult {
  readonly addressing: FileAddressing;
  readonly pageCount?: number;
  readonly lineCount?: number;
  readonly sheets?: readonly string[];
  /** Every place the quote was found, in document order. Empty when no quote was given or it was not found. */
  readonly spots: readonly IFileSpot[];
  /** A quote was given but had too few letters and digits to locate reliably. */
  readonly quoteTooShort?: boolean;
}

const PDF_EXTS = new Set(['.pdf']);
const SPREADSHEET_EXTS = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.numbers']);
const UNADDRESSED_EXTS = new Set(['.docx', '.epub']);

/** How a file is addressed, from its name. CSV and TSV open as text, so they go by line. */
export function addressingForPath(path: string): FileAddressing {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
  if (PDF_EXTS.has(ext)) return 'page';
  if (SPREADSHEET_EXTS.has(ext)) return 'cell';
  if (UNADDRESSED_EXTS.has(ext)) return 'none';
  return 'line';
}

type Units =
  | { kind: 'page'; pages: readonly string[] }
  | { kind: 'line'; lines: readonly string[] }
  | { kind: 'cell'; sheets: readonly ILocatorSheet[] }
  | { kind: 'none'; text: string };

interface CacheEntry { readonly size: number; readonly mtime: number; readonly units: Units }

const CACHE_LIMIT = 16;

export class FileLocator {
  private readonly _cache = new Map<string, CacheEntry>();

  constructor(private readonly _host: IFileLocatorHost) {}

  /** A PDF's text, one string per page, or undefined for any other file. */
  async readPdfPages(uri: URI): Promise<readonly string[] | undefined> {
    if (addressingForPath(uri.path) !== 'page') return undefined;
    const units = await this._units(uri);
    return units.kind === 'page' ? units.pages : undefined;
  }

  /**
   * Describe a file's addressing (page count, line count, sheet names) and,
   * when a quote is given, every spot it occurs.
   */
  async locate(uri: URI, quote?: string): Promise<IFileLocateResult> {
    const units = await this._units(uri);
    const q = typeof quote === 'string' ? quote.trim() : '';
    const tooShort = q.length > 0 && !isLocatableQuote(q);
    const wanted = q.length > 0 && !tooShort;

    switch (units.kind) {
      case 'page': {
        const spots = wanted ? locateQuote(units.pages, q).map((m) => ({
          page: m.startUnit + 1,
          ...(m.endUnit !== m.startUnit ? { endPage: m.endUnit + 1 } : {}),
          text: m.text,
        })) : [];
        return { addressing: 'page', pageCount: units.pages.length, spots, ...(tooShort ? { quoteTooShort: true } : {}) };
      }
      case 'line': {
        const spots = wanted ? locateQuote(units.lines, q).map((m) => ({
          line: m.startUnit + 1,
          ...(m.endUnit !== m.startUnit ? { endLine: m.endUnit + 1 } : {}),
          text: m.text,
        })) : [];
        return { addressing: 'line', lineCount: units.lines.length, spots, ...(tooShort ? { quoteTooShort: true } : {}) };
      }
      case 'cell': {
        const spots: IFileSpot[] = [];
        if (wanted) {
          for (const sheet of units.sheets) {
            const cells: string[] = [];
            const refs: string[] = [];
            const colStart = sheet.colStart ?? 0;
            const rowStart = sheet.rowStart ?? 0;
            sheet.rows.forEach((row, r) => {
              const rowNumber = rowStart + r + 1;
              row.forEach((value, c) => {
                if (!value) return;
                cells.push(value);
                refs.push(`${columnLetters(colStart + c)}${rowNumber}`);
              });
            });
            for (const m of locateQuote(cells, q)) {
              spots.push({ sheet: sheet.name, cell: refs[m.startUnit], text: m.text });
            }
          }
        }
        return { addressing: 'cell', sheets: units.sheets.map((s) => s.name), spots, ...(tooShort ? { quoteTooShort: true } : {}) };
      }
      case 'none': {
        const spots = wanted ? locateQuote([units.text], q).map((m) => ({ text: m.text })) : [];
        return { addressing: 'none', spots, ...(tooShort ? { quoteTooShort: true } : {}) };
      }
    }
  }

  private async _units(uri: URI): Promise<Units> {
    const key = uri.path;
    const stat = await this._host.stat(uri);
    const cached = this._cache.get(key);
    if (cached && cached.size === stat.size && cached.mtime === stat.mtime) {
      // Most recently used last.
      this._cache.delete(key);
      this._cache.set(key, cached);
      return cached.units;
    }

    let units: Units;
    switch (addressingForPath(uri.path)) {
      case 'page':
        units = { kind: 'page', pages: await this._host.readPdfPages(uri) };
        break;
      case 'cell':
        units = { kind: 'cell', sheets: await this._host.readSpreadsheet(uri) };
        break;
      case 'none':
        units = { kind: 'none', text: await this._host.readDocumentText(uri) };
        break;
      default: {
        const text = await this._host.readText(uri);
        units = { kind: 'line', lines: text.split('\n').map((l) => l.replace(/\r$/, '')) };
      }
    }

    this._cache.delete(key);
    this._cache.set(key, { size: stat.size, mtime: stat.mtime, units });
    while (this._cache.size > CACHE_LIMIT) {
      const oldest = this._cache.keys().next().value;
      if (oldest === undefined) break;
      this._cache.delete(oldest);
    }
    return units;
  }
}
