// documentReading.ts — where everything on a document's pages is.
//
// The document reader (Docling, electron/doclingBridge.cjs) returns, beside a
// document's text, a reading: each page's size; for a page read from its
// pixels (a scan, a photo of a page), every line with its box; every block
// with its page and box; every table as a grid of cells. The main process
// keeps one reading per document and hands it out by path for as long as the
// document is unchanged.
//
// What uses it: a scan has no text of its own, so its page text (for the
// chat's reading and for finding a quote), the PDF viewer's text layer over
// it, and the place a citation lights up all come from here.
//
// Boxes are [left, top, right, bottom] from the page's top-left corner, in
// the page's own units (PDF points for a PDF, pixels for an image).

export type ReadingBox = readonly [number, number, number, number];

export interface IReadingLine {
  readonly text: string;
  readonly box: ReadingBox;
}

export interface IReadingPage {
  /** 1-based page number. */
  readonly page: number;
  readonly width: number;
  readonly height: number;
  /** Lines the reader found on a page read from its pixels; empty for a page with its own text. */
  readonly lines: readonly IReadingLine[];
}

export interface IReadingBlock {
  /** Docling's label: text, section_header, formula, table, picture, list_item, caption, ... */
  readonly label: string;
  readonly page: number;
  readonly box: ReadingBox;
  readonly text?: string;
}

export interface IReadingTableCell {
  readonly r: number;
  readonly c: number;
  readonly rs: number;
  readonly cs: number;
  readonly text: string;
  readonly box?: ReadingBox;
  readonly header?: boolean;
}

export interface IReadingTable {
  readonly page: number;
  readonly box: ReadingBox;
  readonly rows: number;
  readonly cols: number;
  readonly cells: readonly IReadingTableCell[];
}

export interface IDocumentReading {
  readonly version: number;
  /** True when every page was read from its pixels. */
  readonly ocr: boolean;
  readonly pages: readonly IReadingPage[];
  readonly blocks: readonly IReadingBlock[];
  readonly tables: readonly IReadingTable[];
}

/** Letters and digits in a string: what tells a page with text from a blank one. */
function wordChars(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c > 127) n++;
  }
  return n;
}

/** A page with this few letters and digits has no text of its own (a scan, or blank). */
export const BLANK_PAGE_WORD_CHARS = 3;

export function isBlankPageText(text: string | undefined): boolean {
  return wordChars(text ?? '') < BLANK_PAGE_WORD_CHARS;
}

/** One page of a reading as text: its lines, top to bottom as the reader ordered them. */
export function readingPageText(page: IReadingPage): string {
  return page.lines.map((l) => l.text).join('\n');
}

/** A reading's text, one string per page, in page order; pages the reading skips are ''. */
export function readingPageTexts(reading: IDocumentReading): string[] {
  const count = reading.pages.reduce((n, p) => Math.max(n, p.page), 0);
  const out: string[] = new Array(count).fill('');
  for (const p of reading.pages) if (p.page >= 1) out[p.page - 1] = readingPageText(p);
  return out;
}

/**
 * A file's own page text with the reader's text filled in wherever a page
 * has none: a scanned PDF, or the scanned pages of a mixed one.
 */
export function mergePageTexts(own: readonly string[], reading: IDocumentReading | null | undefined): readonly string[] {
  if (!reading) return own;
  const read = readingPageTexts(reading);
  if (read.every((t) => t.length === 0)) return own;
  const count = Math.max(own.length, read.length);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const mine = own[i] ?? '';
    out.push(isBlankPageText(mine) && read[i] ? read[i] : mine);
  }
  return out;
}

function isBox(v: unknown): v is ReadingBox {
  return Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Check what came over IPC or off disk; anything malformed is dropped, never trusted. */
export function parseReading(raw: unknown): IDocumentReading | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.pages)) return null;
  const pages: IReadingPage[] = [];
  for (const p of r.pages as unknown[]) {
    if (!p || typeof p !== 'object') continue;
    const q = p as Record<string, unknown>;
    const page = Number(q.page); const width = Number(q.width); const height = Number(q.height);
    if (!(page >= 1) || !(width > 0) || !(height > 0)) continue;
    const lines: IReadingLine[] = [];
    for (const l of Array.isArray(q.lines) ? q.lines as unknown[] : []) {
      const m = l as Record<string, unknown> | null;
      if (m && typeof m.text === 'string' && m.text && isBox(m.box)) lines.push({ text: m.text, box: m.box });
    }
    pages.push({ page, width, height, lines });
  }
  const blocks: IReadingBlock[] = [];
  for (const b of Array.isArray(r.blocks) ? r.blocks as unknown[] : []) {
    const m = b as Record<string, unknown> | null;
    if (m && typeof m.label === 'string' && Number(m.page) >= 1 && isBox(m.box)) {
      blocks.push({ label: m.label, page: Number(m.page), box: m.box, ...(typeof m.text === 'string' ? { text: m.text } : {}) });
    }
  }
  const tables: IReadingTable[] = [];
  for (const t of Array.isArray(r.tables) ? r.tables as unknown[] : []) {
    const m = t as Record<string, unknown> | null;
    if (!m || !(Number(m.page) >= 1) || !isBox(m.box) || !Array.isArray(m.cells)) continue;
    const cells: IReadingTableCell[] = [];
    for (const c of m.cells as unknown[]) {
      const k = c as Record<string, unknown> | null;
      if (!k || typeof k.text !== 'string') continue;
      cells.push({
        r: Number(k.r) || 0, c: Number(k.c) || 0, rs: Number(k.rs) || 1, cs: Number(k.cs) || 1, text: k.text,
        ...(isBox(k.box) ? { box: k.box } : {}), ...(k.header === true ? { header: true } : {}),
      });
    }
    tables.push({ page: Number(m.page), box: m.box, rows: Number(m.rows) || 0, cols: Number(m.cols) || 0, cells });
  }
  return { version: Number(r.version) || 1, ocr: r.ocr === true, pages, blocks, tables };
}

/** The reading kept for a file, or null: none yet, the file changed since, or no desktop bridge. */
export async function fetchDocumentReading(fsPath: string): Promise<IDocumentReading | null> {
  const api = (globalThis as { parallxElectron?: { docling?: { reading?: (p: string) => Promise<unknown> } } }).parallxElectron;
  if (!api?.docling?.reading) return null;
  try { return parseReading(await api.docling.reading(fsPath)); } catch { return null; }
}
