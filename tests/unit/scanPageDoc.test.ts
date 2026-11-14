// scanPageDoc.test.ts — what the document reader read becomes a page, and
// every block of it remembers where on the document it came from.
import { describe, expect, it } from 'vitest';
import { buildScanPageDoc, fillScanPagePictures } from '../../src/built-in/canvas/scanPageDoc';
import { markdownToTiptapJson, type TipTapNode } from '../../src/built-in/canvas/markdownImport';
import { tiptapJsonToMarkdown } from '../../src/built-in/canvas/markdownExport';
import type { IDocumentReading } from '../../src/services/documentReading';

/** Ids in the order they are asked for: b1, b2, … */
const counter = () => { let n = 0; return () => `b${++n}`; };

const READING: IDocumentReading = {
  version: 1, ocr: true,
  pages: [{ page: 1, width: 595, height: 842, lines: [] }, { page: 2, width: 595, height: 842, lines: [] }],
  blocks: [
    { label: 'page_header', page: 1, box: [60, 20, 540, 34], text: 'Exam 7, Fall 2019' },
    { label: 'title', page: 1, box: [60, 60, 400, 90], text: 'Appendix C' },
    { label: 'text', page: 1, box: [60, 110, 540, 150], text: 'Factors are selected\nfrom the triangle below.' },
    { label: 'caption', page: 1, box: [60, 170, 400, 186], text: 'Table 3: Selected development factors' },
    { label: 'table', page: 1, box: [60, 190, 540, 260] },
    { label: 'list_item', page: 1, box: [72, 280, 540, 296], text: 'Paid factors come first.' },
    { label: 'list_item', page: 1, box: [72, 300, 540, 316], text: 'Incurred factors follow.' },
    { label: 'section_header', page: 2, box: [60, 60, 300, 80], text: 'The tail' },
    { label: 'formula', page: 2, box: [200, 100, 400, 140] },
    { label: 'picture', page: 2, box: [60, 160, 540, 400] },
    { label: 'page_footer', page: 2, box: [280, 800, 320, 814], text: '2' },
  ],
  tables: [{
    page: 1, box: [60, 190, 540, 260], rows: 3, cols: 3,
    cells: [
      { r: 0, c: 0, rs: 1, cs: 1, text: 'Age', header: true, box: [60, 190, 220, 212] }, { r: 0, c: 1, rs: 1, cs: 1, text: 'Paid', header: true, box: [220, 190, 380, 212] }, { r: 0, c: 2, rs: 1, cs: 1, text: 'Incurred', header: true, box: [380, 190, 540, 212] },
      { r: 1, c: 0, rs: 1, cs: 1, text: '108', box: [60, 214, 220, 236] }, { r: 1, c: 1, rs: 1, cs: 1, text: '1.08', box: [220, 214, 380, 236] }, { r: 1, c: 2, rs: 1, cs: 1, text: '1.04', box: [380, 214, 540, 236] },
      { r: 2, c: 0, rs: 1, cs: 1, text: '120', box: [60, 238, 220, 260] }, { r: 2, c: 1, rs: 1, cs: 1, text: '1.05', box: [220, 238, 380, 260] }, { r: 2, c: 2, rs: 1, cs: 1, text: '1.02', box: [380, 238, 540, 260] },
    ],
  }],
};

const types = (nodes: TipTapNode[] | undefined) => (nodes ?? []).map((n) => n.type);
const textOf = (node: TipTapNode): string => (node.text ?? '') + (node.content ?? []).map(textOf).join('');
/** Every node of a page, depth first. */
const walk = (node: TipTapNode, out: TipTapNode[] = []): TipTapNode[] => { out.push(node); for (const c of node.content ?? []) walk(c, out); return out; };

describe('a reading as a page', () => {
  const page = buildScanPageDoc(READING, { newId: counter() });
  const blocks = page.doc.content!;

  it('makes each block in the reader\'s order, and leaves the running heads and feet out', () => {
    expect(types(blocks)).toEqual(['heading', 'paragraph', 'paragraph', 'table', 'bulletList', 'heading', 'image', 'image']);
    expect(textOf(page.doc)).not.toContain('Exam 7, Fall 2019');
    expect(blocks[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(blocks[5]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(textOf(blocks[1])).toBe('Factors are selected from the triangle below.'); // one paragraph, its line break gone
  });

  it('gathers list items that follow one another into one list', () => {
    const list = blocks[4];
    expect(types(list.content)).toEqual(['listItem', 'listItem']);
    expect(list.content!.map(textOf)).toEqual(['Paid factors come first.', 'Incurred factors follow.']);
  });

  it('makes a real table: heading cells where the reader marked them, a paragraph in every cell', () => {
    const table = blocks[3];
    expect(types(table.content)).toEqual(['tableRow', 'tableRow', 'tableRow']);
    expect(types(table.content![0].content)).toEqual(['tableHeader', 'tableHeader', 'tableHeader']);
    expect(types(table.content![2].content)).toEqual(['tableCell', 'tableCell', 'tableCell']);
    expect(table.content![2].content!.map(textOf)).toEqual(['120', '1.05', '1.02']);
    expect(table.content![2].content![1].content![0].type).toBe('paragraph');
  });

  it('gives every block an id, each one once', () => {
    const ids = walk(page.doc).filter((n) => n.type !== 'doc' && n.type !== 'text').map((n) => n.attrs?.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('remembers where each block came from: its page and its box', () => {
    expect(page.anchors[blocks[0].attrs!.id as string]).toEqual([1, 60, 60, 400, 90]);
    expect(page.anchors[blocks[5].attrs!.id as string]).toEqual([2, 60, 60, 300, 80]);
    expect(page.anchors[blocks[4].content![1].attrs!.id as string]).toEqual([1, 72, 300, 540, 316]); // a list item, not the list
    expect(page.anchors[blocks[4].attrs!.id as string]).toBeUndefined();
    expect(page.pageSizes).toEqual({ 1: [595, 842], 2: [595, 842] });
  });

  it('remembers each cell of a table by its own box, and the table by the whole of it', () => {
    const table = blocks[3];
    expect(page.anchors[table.attrs!.id as string]).toEqual([1, 60, 190, 540, 260]);
    const paid120 = table.content![2].content![1];
    expect(page.anchors[paid120.attrs!.id as string]).toEqual([1, 220, 238, 380, 260]);
  });

  it('names the figures and the formulas as pictures to be cut from the document', () => {
    expect(page.pictures).toEqual([
      { blockId: blocks[6].attrs!.id, page: 2, box: [200, 100, 400, 140], what: 'formula' },
      { blockId: blocks[7].attrs!.id, page: 2, box: [60, 160, 540, 400], what: 'figure' },
    ]);
    expect(blocks[6].attrs).toMatchObject({ src: '', alt: 'Formula' });
  });

  it('is a page the app can write out and read back', () => {
    const filled = buildScanPageDoc(READING, { newId: counter() });
    fillScanPagePictures(filled, new Map(filled.pictures.map((p) => [p.blockId, `parallx-media://workspace/.parallx/media/${p.what}.jpg`])));
    const markdown = tiptapJsonToMarkdown(filled.doc as never);
    expect(markdown).toContain('| Age | Paid | Incurred |');
    expect(markdown).toMatch(/\| 120 \| 1\.05 \| 1\.02\s+\|/);
    expect(markdown).toContain('# Appendix C');
    expect(markdown).toContain('- Paid factors come first.');
    expect(types(markdownToTiptapJson(markdown).content)).toEqual(types(filled.doc.content));
  });
});

describe('where the page says it came from', () => {
  it('opens with a line that names the file and links to it', () => {
    const page = buildScanPageDoc(READING, { newId: counter(), source: { name: 'exam-2019.pdf', href: 'parallx://explorer/file?path=Scans%2Fexam-2019.pdf' } });
    const first = page.doc.content![0];
    expect(textOf(first)).toBe('From exam-2019.pdf');
    expect(first.content![1].marks).toEqual([{ type: 'link', attrs: { href: 'parallx://explorer/file?path=Scans%2Fexam-2019.pdf' } }]);
    expect(page.anchors[first.attrs!.id as string]).toBeUndefined(); // it came from nowhere on the document
  });
});

describe('tables that are not a plain grid', () => {
  const grid = (cells: IDocumentReading['tables'][number]['cells'], rows: number, cols: number): IDocumentReading => ({
    version: 1, ocr: false, pages: [{ page: 1, width: 600, height: 800, lines: [] }],
    blocks: [{ label: 'table', page: 1, box: [0, 0, 300, 100] }],
    tables: [{ page: 1, box: [0, 0, 300, 100], rows, cols, cells }],
  });
  const cell = (r: number, c: number, text: string, more: Partial<IDocumentReading['tables'][number]['cells'][number]> = {}) => ({ r, c, rs: 1, cs: 1, text, ...more });
  const shape = (reading: IDocumentReading) => buildScanPageDoc(reading, { newId: counter() }).doc.content![0].content!.map((row) => row.content!.map((c) => `${c.type === 'tableHeader' ? 'H' : 'C'}:${textOf(c)}${c.attrs?.colspan ? `:c${c.attrs.colspan}` : ''}${c.attrs?.rowspan ? `:r${c.attrs.rowspan}` : ''}`));

  it('keeps a cell that spans columns or rows, and leaves out the places under it', () => {
    expect(shape(grid([cell(0, 0, 'Factors', { cs: 2, header: true }), cell(1, 0, 'Paid'), cell(1, 1, 'Incurred')], 2, 2))).toEqual([['H:Factors:c2'], ['C:Paid', 'C:Incurred']]);
    expect(shape(grid([cell(0, 0, 'Year', { rs: 2, header: true }), cell(0, 1, '2019'), cell(1, 1, '2020')], 2, 2))).toEqual([['H:Year:r2', 'C:2019'], ['C:2020']]);
  });

  it('fills a place the reader left empty, so the grid holds', () => {
    expect(shape(grid([cell(0, 0, 'Age', { header: true }), cell(0, 1, 'Paid', { header: true }), cell(1, 1, '1.05')], 2, 2))).toEqual([['H:Age', 'H:Paid'], ['C:', 'C:1.05']]);
  });

  it('takes the first row as the heading when the reader marked none', () => {
    expect(shape(grid([cell(0, 0, 'Age'), cell(0, 1, 'Paid'), cell(1, 0, '120'), cell(1, 1, '1.05')], 2, 2))).toEqual([['H:Age', 'H:Paid'], ['C:120', 'C:1.05']]);
  });

  it('loses no words when two cells claim one place: the first keeps the place and takes the other one in', () => {
    expect(shape(grid([cell(0, 0, 'A', { rs: 2 }), cell(0, 1, 'B'), cell(1, 0, 'C', { cs: 2 }), cell(1, 1, 'D'), cell(1, 1, 'again')], 2, 2))).toEqual([['H:A C:r2', 'H:B'], ['C:D again']]);
  });

  it('shows a table the reader could not lay out as its picture, and keeps a table that had no block of its own', () => {
    const noGrid = buildScanPageDoc(grid([], 0, 0), { newId: counter() });
    expect(types(noGrid.doc.content)).toEqual(['image']);
    expect(noGrid.pictures).toHaveLength(1);
    const orphan: IDocumentReading = { ...grid([cell(0, 0, 'Age'), cell(1, 0, '120')], 2, 1), blocks: [] };
    expect(types(buildScanPageDoc(orphan, { newId: counter() }).doc.content)).toEqual(['table']);
  });
});

describe('the pictures, once cut', () => {
  it('each block gets its picture; one that could not be cut is taken out, with its anchor', () => {
    const page = buildScanPageDoc(READING, { newId: counter() });
    const [formula, figure] = page.pictures;
    fillScanPagePictures(page, new Map([[figure.blockId, 'parallx-media://workspace/.parallx/media/abc.jpg']]));
    const images = page.doc.content!.filter((n) => n.type === 'image');
    expect(images).toHaveLength(1);
    expect(images[0].attrs).toMatchObject({ id: figure.blockId, src: 'parallx-media://workspace/.parallx/media/abc.jpg' });
    expect(page.anchors[formula.blockId]).toBeUndefined();
    expect(page.anchors[figure.blockId]).toEqual([2, 60, 160, 540, 400]);
  });

  it('an empty reading is still a page', () => {
    const page = buildScanPageDoc({ version: 1, ocr: false, pages: [], blocks: [], tables: [] }, { newId: counter() });
    expect(types(page.doc.content)).toEqual(['paragraph']);
    expect(page.anchors).toEqual({});
  });
});
