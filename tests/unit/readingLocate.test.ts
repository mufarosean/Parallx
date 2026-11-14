// readingLocate.test.ts — a quote is placed on its page by the document
// reader's reading: in a table, on a figure's caption, or on the lines of a
// page read from its pixels.
import { describe, expect, it } from 'vitest';
import { locateCitedBlock, locateQuoteLines } from '../../src/services/readingLocate';
import type { IDocumentReading, IReadingPage } from '../../src/services/documentReading';

const cells = (rows: string[][]) => rows.flatMap((row, r) => row.map((text, c) => ({ r, c, rs: 1, cs: 1, text })));

const READING: IDocumentReading = {
  version: 1, ocr: false,
  pages: [{ page: 1, width: 600, height: 800, lines: [] }, { page: 2, width: 600, height: 800, lines: [] }],
  blocks: [
    { label: 'text', page: 1, box: [60, 80, 540, 160], text: 'The Bondy method repeats the last selected factor.' },
    { label: 'caption', page: 1, box: [60, 180, 400, 196], text: 'Table 3: Selected development factors' },
    { label: 'table', page: 1, box: [60, 200, 540, 320] },
    { label: 'picture', page: 1, box: [60, 420, 540, 640] },
    { label: 'caption', page: 1, box: [60, 646, 400, 660], text: 'Figure 2. Paid development by age' },
    { label: 'table', page: 2, box: [60, 100, 540, 200] },
  ],
  tables: [
    { page: 1, box: [60, 200, 540, 320], rows: 3, cols: 3, cells: cells([['Age', 'Paid', 'Incurred'], ['108', '1.08', '1.04'], ['120', '1.05', '1.02']]) },
    { page: 2, box: [60, 100, 540, 200], rows: 2, cols: 2, cells: cells([['Year', 'Reserve'], ['2019', '1,250,000']]) },
  ],
};

describe('locateCitedBlock', () => {
  it('finds the table a row was quoted from, names it by its caption, and takes the caption with it', () => {
    expect(locateCitedBlock(READING, 1, '120 1.05 1.02')).toEqual({ kind: 'table', page: 1, box: [60, 180, 540, 320], name: 'Table 3', pageWidth: 600, pageHeight: 800 });
    expect(locateCitedBlock(READING, 1, '108 1.08 1.04 120 1.05 1.02')?.name).toBe('Table 3');
  });

  it('does not need the quote spaced or punctuated as the cells are', () => {
    expect(locateCitedBlock(READING, 1, '120,  1.05,  1.02')?.kind).toBe('table');
    expect(locateCitedBlock(READING, 1, 'Age Paid Incurred 108')?.kind).toBe('table');
  });

  it('leaves ordinary text alone, even when it shares a number with a table', () => {
    expect(locateCitedBlock(READING, 1, 'The Bondy method repeats the last selected factor.')).toBeNull();
    expect(locateCitedBlock(READING, 1, 'The selected factor is 1.05 at maturity')).toBeNull();
  });

  it('finds the figure a caption belongs to, caption included', () => {
    expect(locateCitedBlock(READING, 1, 'Figure 2. Paid development by age')).toEqual({ kind: 'figure', page: 1, box: [60, 420, 540, 660], name: 'Figure 2', pageWidth: 600, pageHeight: 800 });
    expect(locateCitedBlock(READING, 1, 'Paid development by age')?.name).toBe('Figure 2');
  });

  it('a table\'s own caption points at the table', () => {
    expect(locateCitedBlock(READING, 1, 'Table 3: Selected development factors')).toMatchObject({ kind: 'table', name: 'Table 3', box: [60, 180, 540, 320] });
  });

  it('calls a table with no caption a table, and looks only on the page asked for', () => {
    expect(locateCitedBlock(READING, 2, '2019 1,250,000')).toMatchObject({ kind: 'table', name: 'Table', page: 2 });
    expect(locateCitedBlock(READING, 2, '120 1.05 1.02')).toBeNull();
    expect(locateCitedBlock(READING, 3, '120 1.05 1.02')).toBeNull();
  });

  it('gives nothing without a reading or a quote', () => {
    expect(locateCitedBlock(null, 1, '120 1.05 1.02')).toBeNull();
    expect(locateCitedBlock(READING, 1, '')).toBeNull();
    expect(locateCitedBlock(READING, 1, undefined)).toBeNull();
  });

  it('reads Fig. and Exhibit as names too', () => {
    const r: IDocumentReading = { ...READING, blocks: [{ label: 'picture', page: 1, box: [60, 420, 540, 640] }, { label: 'caption', page: 1, box: [60, 646, 400, 660], text: 'Fig. 4A Incurred losses' }, { label: 'caption', page: 1, box: [60, 180, 400, 196], text: 'Exhibit II: factors' }], tables: READING.tables };
    expect(locateCitedBlock(r, 1, 'Fig. 4A Incurred losses')?.name).toBe('Figure 4A');
    expect(locateCitedBlock(r, 1, '120 1.05 1.02')?.name).toBe('Exhibit II');
  });
});

describe('locateQuoteLines', () => {
  const PAGE: IReadingPage = {
    page: 1, width: 1200, height: 1600,
    lines: [
      { text: 'Chapter 7: Reserving', box: [100, 100, 700, 150] },
      { text: 'The ultimate loss is not the same', box: [100, 300, 900, 340] },
      { text: 'as the expected loss.', box: [100, 350, 600, 390] },
      { text: 'Total reserve 1,250,000', box: [100, 500, 700, 540] },
    ],
  };

  it('gives the boxes of the lines that hold the quote', () => {
    expect(locateQuoteLines(PAGE, 'Total reserve 1,250,000')).toEqual([[100, 500, 700, 540]]);
    expect(locateQuoteLines(PAGE, 'the ultimate loss is not the same as the expected loss')).toEqual([[100, 300, 900, 340], [100, 350, 600, 390]]);
    expect(locateQuoteLines(PAGE, 'not the same as the')).toEqual([[100, 300, 900, 340], [100, 350, 600, 390]]);
  });

  it('gives nothing for words that are not on the page, a scrap, or a page with text of its own', () => {
    expect(locateQuoteLines(PAGE, 'Bornhuetter and Ferguson')).toEqual([]);
    expect(locateQuoteLines(PAGE, 'as')).toEqual([]);
    expect(locateQuoteLines({ page: 1, width: 10, height: 10, lines: [] }, 'Total reserve')).toEqual([]);
    expect(locateQuoteLines(undefined, 'Total reserve')).toEqual([]);
  });
});

describe('a cited table\'s heading rows', () => {
  /** A table of `rows` whose cells have boxes: 100 wide, 20 tall, from (60, 200). `heads` says which cells the reader marked as headings. */
  const boxed = (rows: string[][], heads: (r: number, c: number) => boolean): IDocumentReading => ({
    version: 1, ocr: true,
    pages: [{ page: 1, width: 600, height: 800, lines: [] }],
    blocks: [],
    tables: [{
      page: 1, box: [60, 200, 60 + 100 * rows[0].length, 200 + 20 * rows.length], rows: rows.length, cols: rows[0].length,
      cells: rows.flatMap((row, r) => row.map((text, c) => ({ r, c, rs: 1, cs: 1, text, box: [60 + 100 * c, 200 + 20 * r, 160 + 100 * c, 220 + 20 * r] as const, ...(heads(r, c) ? { header: true } : {}) }))),
    }],
  });
  const ROWS = [['Age', 'Paid', 'Incurred'], ['(months)', '(factor)', '(factor)'], ['108', '1.08', '1.04'], ['120', '1.05', '1.02']];

  it('end where the rows the reader marked as headings end', () => {
    expect(locateCitedBlock(boxed(ROWS, (r) => r < 2), 1, '120 1.05 1.02')?.headBottom).toBe(240);
  });

  it('come with where every row parts from the next, so a cut can fall between rows', () => {
    expect(locateCitedBlock(boxed(ROWS, (r) => r < 2), 1, '120 1.05 1.02')?.rowEdges).toEqual([220, 240, 260]);
    // Boxes with a gap between rows: the middle of the gap.
    const gapped = boxed(ROWS, (r) => r < 1);
    const cells = gapped.tables[0].cells.map((c) => ({ ...c, box: [c.box![0], c.box![1] + 2, c.box![2], c.box![3] - 4] as const }));
    expect(locateCitedBlock({ ...gapped, tables: [{ ...gapped.tables[0], cells }] }, 1, '120 1.05 1.02')).toMatchObject({ rowEdges: [219, 239, 259], headBottom: 219 });
  });

  it('are the first row when the reader marked none', () => {
    expect(locateCitedBlock(boxed(ROWS, () => false), 1, '120 1.05 1.02')?.headBottom).toBe(220);
  });

  it('do not take in a row for its own label being marked', () => {
    // The first column holds each row's label: marked in every row, a heading row in none but the first.
    expect(locateCitedBlock(boxed(ROWS, (r, c) => r === 0 || c === 0), 1, '120 1.05 1.02')?.headBottom).toBe(220);
  });

  it('are never more than three rows, and are left out when the cells have no boxes', () => {
    expect(locateCitedBlock(boxed([...ROWS, ['132', '1.03', '1.01']], () => true), 1, '120 1.05 1.02')?.headBottom).toBe(260);
    expect(locateCitedBlock(READING, 1, '120 1.05 1.02')).not.toHaveProperty('headBottom');
    expect(locateCitedBlock(READING, 1, '120 1.05 1.02')).not.toHaveProperty('rowEdges');
  });
});
