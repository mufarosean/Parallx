// fileLocator.test.ts — where in a file a quote is, in the units its viewer
// shows: PDF page, text line, spreadsheet sheet and cell.

import { describe, it, expect } from 'vitest';
import { FileLocator, addressingForPath, type IFileLocatorHost, type ILocatorSheet } from '../../src/services/fileLocator';
import { URI } from '../../src/platform/uri';

function host(over: Partial<IFileLocatorHost> & { mtime?: () => number } = {}) {
  const reads: string[] = [];
  const h: IFileLocatorHost = {
    stat: async () => ({ size: 100, mtime: over.mtime ? over.mtime() : 1 }),
    readText: async (uri) => { reads.push(uri.path); return 'alpha\r\nthe expected loss is used\r\nto calculate the reserves\r\nomega'; },
    readPdfPages: async (uri) => { reads.push(uri.path); return ['cover page', 'nothing here', 'The expected loss is used to calculate the reserves.']; },
    readDocumentText: async (uri) => { reads.push(uri.path); return 'Word text: the expected loss is used to calculate the reserves.'; },
    readSpreadsheet: async (uri) => { reads.push(uri.path); return sheets; },
    ...over,
  };
  return { h, reads };
}

// A workbook whose "Clark" sheet's used range starts at B3, with a blank row:
// the note sits in workbook cell C6, not "row 3 of the data".
const sheets: ILocatorSheet[] = [
  { name: 'LDF', rows: [['Age', 'LDF'], ['12', '2.5']], rowStart: 0, colStart: 0 },
  {
    name: 'Clark',
    rowStart: 2, // row 3
    colStart: 1, // column B
    rows: [
      ['Step', 'Recipe'],
      ['', ''],
      ['1', 'Fit the growth curve'],
      ['4', 'Use the true ultimate, not the truncated ultimate, when calculating expected incremental losses.'],
    ],
  },
];

describe('addressingForPath', () => {
  it('addresses each kind of file by what its viewer shows', () => {
    expect(addressingForPath('Papers/Clark.pdf')).toBe('page');
    expect(addressingForPath('Cookbook.XLSX')).toBe('cell');
    expect(addressingForPath('notes.txt')).toBe('line');
    expect(addressingForPath('data.csv')).toBe('line'); // CSV opens in the text editor
    expect(addressingForPath('essay.docx')).toBe('none');
  });
});

describe('FileLocator', () => {
  it('finds a quote on its PDF page (1 = first page of the file)', async () => {
    const { h } = host();
    const r = await new FileLocator(h).locate(URI.file('/ws/Clark.pdf'), 'the expected loss is used to calculate the reserves');
    expect(r.addressing).toBe('page');
    expect(r.pageCount).toBe(3);
    expect(r.spots).toEqual([{ page: 3, text: 'The expected loss is used to calculate the reserves' }]);
  });

  it('finds a quote on its text lines, across a line break, with Windows line endings', async () => {
    const { h } = host();
    const r = await new FileLocator(h).locate(URI.file('/ws/recipes.txt'), 'the expected loss is used to calculate the reserves');
    expect(r.addressing).toBe('line');
    expect(r.lineCount).toBe(4);
    expect(r.spots[0]).toMatchObject({ line: 2, endLine: 3 });
  });

  it('names the workbook\'s own cell, counting its first used row and column and blank rows', async () => {
    const { h } = host();
    const r = await new FileLocator(h).locate(URI.file('/ws/Cookbook.xlsx'), 'Use the true ultimate, not the truncated ultimate');
    expect(r.addressing).toBe('cell');
    expect(r.sheets).toEqual(['LDF', 'Clark']);
    // rows[3] → workbook row 3 + 3 = 6; column index 1 → B + 1 = C.
    expect(r.spots).toEqual([expect.objectContaining({ sheet: 'Clark', cell: 'C6' })]);
  });

  it('says whether a quote is in a file with no pages or lines', async () => {
    const { h } = host();
    const loc = new FileLocator(h);
    expect((await loc.locate(URI.file('/ws/essay.docx'), 'expected loss is used to calculate')).spots).toHaveLength(1);
    expect((await loc.locate(URI.file('/ws/essay.docx'), 'expected loss ratio is constant')).spots).toHaveLength(0);
  });

  it('flags a quote too short to place instead of matching it everywhere', async () => {
    const { h } = host();
    const r = await new FileLocator(h).locate(URI.file('/ws/Clark.pdf'), 'ELR');
    expect(r.quoteTooShort).toBe(true);
    expect(r.spots).toEqual([]);
  });

  it('reads a file once until it changes', async () => {
    let mtime = 1;
    const { h, reads } = host({ mtime: () => mtime });
    const loc = new FileLocator(h);
    await loc.readPdfPages(URI.file('/ws/Clark.pdf'));
    await loc.locate(URI.file('/ws/Clark.pdf'), 'expected loss is used to calculate');
    expect(reads).toHaveLength(1);
    mtime = 2;
    await loc.readPdfPages(URI.file('/ws/Clark.pdf'));
    expect(reads).toHaveLength(2);
  });

  it('gives page text only for PDFs', async () => {
    const { h } = host();
    const loc = new FileLocator(h);
    expect(await loc.readPdfPages(URI.file('/ws/Clark.pdf'))).toHaveLength(3);
    expect(await loc.readPdfPages(URI.file('/ws/notes.txt'))).toBeUndefined();
  });
});
