// scanPageDoc.ts — what the document reader read, as a page.
//
// Open As Page turns a reading (services/documentReading.ts: every block of a
// document with its page and box, every table as a grid of cells) into the
// JSON a page is stored as, block by block and in the reader's order:
//
//   title, section heading  → a heading
//   text, caption, footnote → a paragraph
//   list items in a row     → one bulleted list
//   a table                 → a real table: its heading cells, its spans
//   code                    → a code block
//   a figure                → a picture, cut from the document
//   a formula               → a picture, cut from the document (the reader
//                             turns formulas into LaTeX only when asked, and
//                             a reading does not say whether it was)
//
// Running heads and feet (page_header, page_footer) are left out: on a page
// that is one long sheet they are noise.
//
// Every block made is given an id, and the id is given its anchor: the page
// of the document it came from and its box there. A table's cells get their
// own anchors, so a cell can be checked against the very cell it was read
// from. The pictures are named for the caller to cut and fill in.
//
// Pure: no DOM, no IPC.

import type { IDocumentReading, IReadingBlock, IReadingTable, ReadingBox } from '../../services/documentReading.js';
import type { ScanAnchor } from '../../services/scanPageLinks.js';
import type { TipTapNode } from './markdownImport.js';

/** A block that is a picture of a piece of the document: its image is cut and its `src` set by the caller. */
export interface IScanPagePicture {
  readonly blockId: string;
  readonly page: number;
  readonly box: ReadingBox;
  readonly what: 'figure' | 'formula';
}

export interface IScanPageDoc {
  /** `{ type: 'doc', content }`, ready to be stored as a page's content. */
  readonly doc: TipTapNode;
  /** Block id to where the block came from. */
  readonly anchors: Record<string, ScanAnchor>;
  /** Page number to [width, height], as the reader measured each page. */
  readonly pageSizes: Record<string, readonly [number, number]>;
  readonly pictures: IScanPagePicture[];
}

export interface IScanPageDocOptions {
  /** Where the page says it came from, as its first line: the file's name, and a link that opens it. */
  readonly source?: { readonly name: string; readonly href: string };
  /** Makes the block ids. Defaults to crypto.randomUUID(). */
  readonly newId?: () => string;
}

/** Labels of blocks that are left out of the page. */
const LEFT_OUT = new Set(['page_header', 'page_footer']);
const oneLine = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
const anchorOf = (page: number, box: ReadingBox): ScanAnchor => [page, box[0], box[1], box[2], box[3]];
const sameBox = (a: ReadingBox, b: ReadingBox): boolean => a.every((v, i) => Math.abs(v - b[i]) < 0.5);

/** The table of the reading a block labelled `table` stands for: the one on its page with its box, else the nearest on that page not yet used. */
function tableFor(block: IReadingBlock, tables: readonly IReadingTable[], used: Set<IReadingTable>): IReadingTable | undefined {
  const onPage = tables.filter((t) => t.page === block.page && !used.has(t));
  const exact = onPage.find((t) => sameBox(t.box, block.box));
  if (exact) return exact;
  let best: { table: IReadingTable; distance: number } | undefined;
  for (const t of onPage) {
    const distance = Math.abs(t.box[0] - block.box[0]) + Math.abs(t.box[1] - block.box[1]);
    if (!best || distance < best.distance) best = { table: t, distance };
  }
  return best?.table;
}

export function buildScanPageDoc(reading: IDocumentReading, options: IScanPageDocOptions = {}): IScanPageDoc {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const anchors: Record<string, ScanAnchor> = {};
  const pictures: IScanPagePicture[] = [];
  const content: TipTapNode[] = [];

  const text = (value: string): TipTapNode[] => (value ? [{ type: 'text', text: value }] : []);
  const paragraph = (value: string): TipTapNode => {
    const inline = text(value);
    return inline.length > 0 ? { type: 'paragraph', attrs: { id: newId() }, content: inline } : { type: 'paragraph', attrs: { id: newId() } };
  };
  /** Give a block its anchor and put it on the page. */
  const place = (node: TipTapNode, block: { page: number; box: ReadingBox }): void => {
    anchors[node.attrs!.id as string] = anchorOf(block.page, block.box);
    content.push(node);
  };

  if (options.source) {
    content.push({
      type: 'paragraph', attrs: { id: newId() },
      content: [{ type: 'text', text: 'From ' }, { type: 'text', text: options.source.name, marks: [{ type: 'link', attrs: { href: options.source.href } }] }],
    });
  }

  const usedTables = new Set<IReadingTable>();
  /** The list being built: items one after another in the reading are one list. */
  let list: TipTapNode | null = null;

  for (const block of reading.blocks) {
    if (LEFT_OUT.has(block.label)) continue;
    const words = oneLine(block.text);

    if (block.label === 'list_item') {
      if (!words) continue;
      if (!list) { list = { type: 'bulletList', attrs: { id: newId() }, content: [] }; content.push(list); }
      const item: TipTapNode = { type: 'listItem', attrs: { id: newId() }, content: [paragraph(words)] };
      anchors[item.attrs!.id as string] = anchorOf(block.page, block.box);
      list.content!.push(item);
      continue;
    }
    list = null;

    switch (block.label) {
      case 'title':
      case 'section_header':
        if (words) place({ type: 'heading', attrs: { id: newId(), level: block.label === 'title' ? 1 : 2 }, content: text(words) }, block);
        break;
      case 'table': {
        const table = tableFor(block, reading.tables, usedTables);
        const node = table ? tableNode(table, newId, anchors) : null;
        if (table) usedTables.add(table);
        if (node) place(node, block);
        // A table the reader could not lay out as a grid is still on the page: as its picture.
        else { const image: TipTapNode = { type: 'image', attrs: { id: newId(), src: '', alt: 'Table' } }; pictures.push({ blockId: image.attrs!.id as string, page: block.page, box: block.box, what: 'figure' }); place(image, block); }
        break;
      }
      case 'picture':
      case 'chart':
      case 'formula': {
        const what = block.label === 'formula' ? 'formula' : 'figure';
        const image: TipTapNode = { type: 'image', attrs: { id: newId(), src: '', alt: what === 'formula' ? (words || 'Formula') : 'Figure' } };
        pictures.push({ blockId: image.attrs!.id as string, page: block.page, box: block.box, what });
        place(image, block);
        break;
      }
      case 'code':
        if (block.text?.trim()) place({ type: 'codeBlock', attrs: { id: newId() }, content: [{ type: 'text', text: block.text.replace(/\r\n/g, '\n').trimEnd() }] }, block);
        break;
      default:
        if (words) place(paragraph(words), block);
    }
  }

  // A table the reader found that no block stood for (its block was missing): at the end, not lost.
  for (const table of reading.tables) {
    if (usedTables.has(table)) continue;
    const node = tableNode(table, newId, anchors);
    if (node) place(node, table);
  }

  // A page has at least one block.
  if (content.length === 0) content.push({ type: 'paragraph', attrs: { id: newId() } });

  const pageSizes: Record<string, readonly [number, number]> = {};
  for (const p of reading.pages) pageSizes[String(p.page)] = [p.width, p.height];
  return { doc: { type: 'doc', content }, anchors, pageSizes, pictures };
}

/**
 * A reading's table as a table of the page: every place of its grid filled
 * once (a cell that spans keeps its span; a place the reader left empty gets
 * an empty cell), heading cells as heading cells. Null when it has no cells.
 */
function tableNode(table: IReadingTable, newId: () => string, anchors: Record<string, ScanAnchor>): TipTapNode | null {
  const cells = table.cells.filter((c) => c.r >= 0 && c.c >= 0);
  if (cells.length === 0) return null;
  const rows = Math.max(table.rows, ...cells.map((c) => c.r + Math.max(1, c.rs)));
  const cols = Math.max(table.cols, ...cells.map((c) => c.c + Math.max(1, c.cs)));
  // No heading marked anywhere: the first row is the heading, as on most tables.
  const marked = cells.some((c) => c.header);
  type Placed = { r: number; c: number; rs: number; cs: number; text: string; box?: ReadingBox; header?: boolean };
  /** Which cell holds each place of the grid. */
  const holder: (Placed | undefined)[][] = Array.from({ length: rows }, () => new Array<Placed | undefined>(cols).fill(undefined));
  const starts = new Map<string, Placed>();
  for (const c of [...cells].sort((a, b) => a.r - b.r || a.c - b.c)) {
    // A place two cells claim (a span run over it, or the same place twice): the first keeps it and takes the other's words, so nothing read is lost.
    const there = holder[c.r][c.c];
    if (there) { const more = oneLine(c.text); if (more) there.text = oneLine(`${there.text} ${more}`); continue; }
    const rs = Math.min(Math.max(1, c.rs), rows - c.r), cs = Math.min(Math.max(1, c.cs), cols - c.c);
    // A span that would run over a place already taken is cut back to one place.
    let free = true;
    for (let r = c.r; r < c.r + rs && free; r++) for (let k = c.c; k < c.c + cs; k++) if (holder[r][k]) { free = false; break; }
    const placed: Placed = { ...c, rs: free ? rs : 1, cs: free ? cs : 1 };
    for (let r = c.r; r < c.r + placed.rs; r++) for (let k = c.c; k < c.c + placed.cs; k++) holder[r][k] = placed;
    starts.set(`${c.r}:${c.c}`, placed);
  }
  const rowNodes: TipTapNode[] = [];
  for (let r = 0; r < rows; r++) {
    const rowCells: TipTapNode[] = [];
    for (let k = 0; k < cols; k++) {
      const c = starts.get(`${r}:${k}`);
      if (!c && holder[r][k]) continue; // under a span from the left or from above
      const words = oneLine(c?.text);
      const heading = c ? (marked ? c.header === true : r === 0) : (!marked && r === 0);
      const cell: TipTapNode = {
        type: heading ? 'tableHeader' : 'tableCell',
        attrs: { id: newId(), ...(c && c.cs > 1 ? { colspan: c.cs } : {}), ...(c && c.rs > 1 ? { rowspan: c.rs } : {}) },
        content: [words ? { type: 'paragraph', attrs: { id: newId() }, content: [{ type: 'text', text: words }] } : { type: 'paragraph', attrs: { id: newId() } }],
      };
      if (c?.box) anchors[cell.attrs!.id as string] = anchorOf(table.page, c.box);
      rowCells.push(cell);
    }
    // A row wholly under spans from above is kept, empty: the spans count on it being there.
    rowNodes.push({ type: 'tableRow', attrs: { id: newId() }, content: rowCells });
  }
  return rowNodes.length > 0 ? { type: 'table', attrs: { id: newId() }, content: rowNodes } : null;
}

/** Put the pictures that were cut into the page: each named block gets its `src`; a block whose picture could not be cut is taken out. */
export function fillScanPagePictures(page: IScanPageDoc, sources: ReadonlyMap<string, string>): void {
  const wanted = new Set(page.pictures.map((p) => p.blockId));
  page.doc.content = (page.doc.content ?? []).filter((node) => {
    const id = node.attrs?.id as string | undefined;
    if (node.type !== 'image' || !id || !wanted.has(id)) return true;
    const src = sources.get(id);
    if (!src) { delete page.anchors[id]; return false; }
    node.attrs = { ...node.attrs, src };
    return true;
  });
  if (page.doc.content.length === 0) page.doc.content.push({ type: 'paragraph' });
}
