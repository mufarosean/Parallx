// readingLocate.ts — where on a page a quote is, by the document reader's reading.
//
// A citation carries the words it rests on. The reader's reading
// (documentReading.ts) knows where the things on a page are: every table with
// its cells, every block with its box, and, for a page read from its pixels,
// every line. So a quote can be placed without asking any model for
// coordinates:
//
// - locateCitedBlock: the quote sits in a table, or is a figure's caption.
//   The table or the figure is what was cited, and it has a box and a name.
// - locateQuoteLines: on a page read from its pixels (a scan, a photo of a
//   page), the lines that hold the quote.
//
// Pure: no DOM, no IPC.

import { quoteSkeleton } from './quoteLocator.js';
import type { IDocumentReading, IReadingBlock, IReadingPage, IReadingTable, ReadingBox } from './documentReading.js';

export interface ICitedBlock {
  readonly kind: 'table' | 'figure';
  readonly page: number;
  /** [left, top, right, bottom] from the page's top-left corner, in the reading page's units. */
  readonly box: ReadingBox;
  /** What it is called on the page ("Table 3", "Figure 2"), or the plain word for it. */
  readonly name: string;
  /** The reading page's size: what the box is measured against. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  /**
   * For a table whose cells have boxes: where its rows part (the middle of
   * the gap between one row and the next, down the page), and which of those
   * is the end of its heading rows. A table too tall to show whole is shown
   * as its heading and the rows the quote is in, cut between rows.
   */
  readonly rowEdges?: readonly number[];
  readonly headBottom?: number;
}

/** A quote's tokens: its words and numbers, lower case, without the punctuation round them. */
function tokensOf(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.,'%-]*/gu) ?? [])
    .map((t) => t.replace(/[.,'-]+$/, ''))
    .filter((t) => t.length > 0);
}

/** A table's text, row by row and cell by cell. */
function tableText(table: IReadingTable): string {
  return [...table.cells].sort((a, b) => a.r - b.r || a.c - b.c).map((c) => c.text).join(' ');
}

/** How much of the quote a table holds: 1 when its text has the quote whole, else the share of the quote's tokens found in its cells. */
function tableHolds(table: IReadingTable, quote: string, quoteTokens: readonly string[]): number {
  const text = tableText(table);
  const needle = quoteSkeleton(quote);
  if (needle.length >= 4 && quoteSkeleton(text).includes(needle)) return 1;
  if (quoteTokens.length < 2) return 0;
  const cells = new Set(tokensOf(text));
  const found = quoteTokens.filter((t) => cells.has(t)).length;
  return found >= 2 ? found / quoteTokens.length : 0;
}

/** A quote must be this much inside a table for the table to be what was cited. */
const TABLE_SHARE = 0.8;
/** A caption belongs to the block this near it, as a share of the page's height. */
const CAPTION_REACH = 0.12;

const union = (a: ReadingBox, b: ReadingBox): ReadingBox => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
/** The gap between two boxes up and down the page; 0 when they overlap. */
const gap = (a: ReadingBox, b: ReadingBox): number => Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3]));
const overlapsAcross = (a: ReadingBox, b: ReadingBox): boolean => Math.min(a[2], b[2]) > Math.max(a[0], b[0]);

const NAMED = /^\s*(table|figure|fig\.?|exhibit|chart|schedule|appendix)\s+([A-Za-z]?\d+(?:[.-]\d+)*[A-Za-z]?|[IVXLC]+)\b/i;

/** "Table 3" from a caption that starts with it; undefined otherwise. */
function nameIn(caption: string | undefined): string | undefined {
  const m = caption?.match(NAMED);
  if (!m) return undefined;
  const word = /^fig/i.test(m[1]) ? 'Figure' : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return `${word} ${m[2]}`;
}

/** A table's heading is its first row and the rows under it whose every cell is a heading; never more rows than this. */
const MAX_HEADING_ROWS = 3;

/** How many of a table's leading rows are its heading. */
function headingRows(table: IReadingTable): number {
  let count = 0, seen = 0;
  for (let r = 0; r < table.rows && seen < MAX_HEADING_ROWS; r++) {
    const row = table.cells.filter((c) => c.r === r && c.text.trim().length > 0);
    if (row.length === 0) continue;
    // The first row with anything in it is a heading whatever the reader marked. After it, a row is one only
    // when every cell is marked: the reader marks a row's own label too, so one marked cell does not make it one.
    if (seen > 0 && !row.every((c) => c.header)) break;
    seen++;
    count = r + 1;
  }
  return count;
}

/**
 * Where a table's rows part, by its cells' boxes: the middle of the gap
 * between each row and the next, and the one that ends the heading rows.
 * Nothing when the cells carry no boxes.
 */
function rowsOf(table: IReadingTable): { rowEdges?: number[]; headBottom?: number } {
  const tops: number[] = [], bottoms: number[] = [];
  for (const c of table.cells) {
    // A cell that spans rows says nothing about where one row ends.
    if (!c.box || c.rs !== 1) continue;
    tops[c.r] = Math.min(tops[c.r] ?? c.box[1], c.box[1]);
    bottoms[c.r] = Math.max(bottoms[c.r] ?? c.box[3], c.box[3]);
  }
  const heading = headingRows(table);
  const rowEdges: number[] = [];
  let headBottom: number | undefined;
  let above: number | undefined;
  for (let r = 0; r < tops.length; r++) {
    if (tops[r] === undefined) continue;
    if (above !== undefined) {
      const edge = (bottoms[above] + tops[r]) / 2;
      rowEdges.push(edge);
      if (above < heading && r >= heading) headBottom = edge;
    }
    above = r;
  }
  return rowEdges.length === 0 ? {} : { rowEdges, ...(headBottom === undefined ? {} : { headBottom }) };
}

/** The caption that goes with a box: the nearest one above or below it, within reach and over the same part of the page. */
function captionFor(box: ReadingBox, captions: readonly IReadingBlock[], pageHeight: number): IReadingBlock | undefined {
  let best: { block: IReadingBlock; distance: number } | undefined;
  for (const c of captions) {
    const distance = gap(box, c.box);
    if (distance > pageHeight * CAPTION_REACH || !overlapsAcross(box, c.box)) continue;
    if (!best || distance < best.distance) best = { block: c, distance };
  }
  return best?.block;
}

/**
 * The table or figure on `page` that a quote points at, or null when the
 * quote is ordinary text (it is then washed as text, as before).
 */
export function locateCitedBlock(reading: IDocumentReading | null | undefined, page: number, quote: string | undefined): ICitedBlock | null {
  const sheet = reading?.pages.find((p) => p.page === page);
  const text = quote?.replace(/\s+/g, ' ').trim() ?? '';
  if (!reading || !sheet || !text) return null;
  const captions = reading.blocks.filter((b) => b.page === page && b.label === 'caption' && !!b.text);
  const sized = { page, pageWidth: sheet.width, pageHeight: sheet.height };

  // In a table: the one that holds the most of the quote.
  const tokens = [...new Set(tokensOf(text))];
  let table: { table: IReadingTable; share: number } | undefined;
  for (const t of reading.tables) {
    if (t.page !== page) continue;
    const share = tableHolds(t, text, tokens);
    if (share >= TABLE_SHARE && (!table || share > table.share)) table = { table: t, share };
  }
  if (table) {
    // Its caption is part of it: framed together, the name sits clear of the caption instead of on it.
    const caption = captionFor(table.table.box, captions, sheet.height);
    return { kind: 'table', box: caption ? union(table.table.box, caption.box) : table.table.box, name: nameIn(caption?.text) ?? 'Table', ...sized, ...rowsOf(table.table) };
  }

  // A caption's own words: the figure (or table) it belongs to, with the caption.
  const needle = quoteSkeleton(text);
  if (needle.length < 6) return null;
  const caption = captions.find((c) => { const s = quoteSkeleton(c.text ?? ''); return s.includes(needle) || (s.length >= 12 && needle.includes(s)); });
  if (!caption) return null;
  let owner: { block: IReadingBlock; distance: number } | undefined;
  for (const b of reading.blocks) {
    if (b.page !== page || (b.label !== 'picture' && b.label !== 'chart' && b.label !== 'table')) continue;
    const distance = gap(b.box, caption.box);
    if (distance > sheet.height * CAPTION_REACH || !overlapsAcross(b.box, caption.box)) continue;
    if (!owner || distance < owner.distance) owner = { block: b, distance };
  }
  if (!owner) return null;
  const kind = owner.block.label === 'table' ? 'table' : 'figure';
  return { kind, box: union(owner.block.box, caption.box), name: nameIn(caption.text) ?? (kind === 'table' ? 'Table' : 'Figure'), ...sized };
}

/**
 * On a page read from its pixels: the boxes of the lines that hold the
 * quote, top to bottom. Empty when the quote is not on the page (or the
 * page has no lines: it has text of its own).
 */
export function locateQuoteLines(page: IReadingPage | null | undefined, quote: string | undefined): ReadingBox[] {
  const needle = quoteSkeleton(quote ?? '');
  if (!page || page.lines.length === 0 || needle.length < 4) return [];
  const skeletons = page.lines.map((l) => quoteSkeleton(l.text));
  const at = skeletons.join('').indexOf(needle);
  if (at < 0) return [];
  const out: ReadingBox[] = [];
  let offset = 0;
  for (let i = 0; i < skeletons.length; i++) {
    const end = offset + skeletons[i].length;
    if (skeletons[i].length > 0 && end > at && offset < at + needle.length) out.push(page.lines[i].box);
    offset = end;
  }
  return out;
}
