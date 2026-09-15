// Worksheets: hiding the worked solution without hiding the student's work.
// Reproduces Clark RF 1 on 2026-09-14: content to column U (20), borders
// styled out to BL (63), Excel hiding L..U; the student worked in W..AC
// (22..28) with the solution revealed; the saved sheet came back with K..BL
// hidden and the work inside it.
import { describe, it, expect } from 'vitest';
import {
  indexPristine, studentColumns, solutionSegments, applySolutionVisibility, cellHasContent, WORK_COLUMNS_AFTER_SOLUTION, type SheetLike,
} from '../../src/built-in/worksheet/solutionVisibility.js';

const SOLUTION_COL = 10; // K holds the "Solution ->" marker

function clarkPristine(): SheetLike {
  const cellData: Record<number, Record<number, Record<string, unknown>>> = {};
  const put = (r: number, c: number, cell: Record<string, unknown>) => { (cellData[r] ??= {})[c] = cell; };
  put(0, 1, { v: 'RF Clark - 1' });
  put(2, 1, { v: 'Given the following information:' });
  for (let c = 1; c <= 8; c++) put(5, c, { v: c * 10 });
  put(5, SOLUTION_COL, { v: 'Solution ->' });
  for (let c = 11; c <= 20; c++) put(6, c, { f: `=B6*${c}` });
  put(8, 15, { p: { body: { dataStream: 'rich\r\n' } } });
  // The banner row: styled cells, no content, out to BL.
  for (let c = 0; c <= 63; c++) put(30, c, { s: 'border' });
  const columnData: Record<number, { hd?: number; w?: number }> = {};
  for (let c = 11; c <= 20; c++) columnData[c] = { hd: 1 };
  return { columnCount: 68, columnData, cellData, mergeData: [{ startColumn: 1, endColumn: 9 }] };
}

function clarkAttempt(): SheetLike {
  const sheet = clarkPristine();
  const put = (r: number, c: number, cell: Record<string, unknown>) => { (sheet.cellData![r] ??= {})[c] = cell; };
  put(1, 22, { v: 'SD(Total Reserve) = SQRT(Param Var + Process Var)' });
  put(3, 24, { f: '=G17^2' });
  for (let c = 22; c <= 28; c++) put(7, c, { v: c });
  // What the bad build saved: K..BL hidden, work among them.
  sheet.columnData = {};
  for (let c = 10; c <= 63; c++) sheet.columnData[c] = { hd: 1 };
  sheet.columnCount = 90;
  return sheet;
}

const hiddenCols = (sheet: SheetLike) => Object.entries(sheet.columnData ?? {}).filter(([, d]) => d.hd).map(([c]) => Number(c)).sort((a, b) => a - b);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('indexPristine', () => {
  it('ends the solution at the last cell with content, not the last styled cell', () => {
    const p = indexPristine(clarkPristine(), SOLUTION_COL);
    expect(p.lastContentCol).toBe(20);
    expect(p.content.has('6:20')).toBe(true);
    expect(p.content.has('8:15')).toBe(true); // rich text counts
    expect(p.content.has('30:63')).toBe(false); // a border does not
  });
  it('counts a merge only when it starts in the solution', () => {
    const sheet = clarkPristine();
    sheet.mergeData = [{ startColumn: 1, endColumn: 63 }];
    expect(indexPristine(sheet, SOLUTION_COL).lastContentCol).toBe(20);
    sheet.mergeData = [{ startColumn: 12, endColumn: 24 }];
    expect(indexPristine(sheet, SOLUTION_COL).lastContentCol).toBe(24);
  });
  it('knows what content is', () => {
    expect(cellHasContent({ v: 0 })).toBe(true);
    expect(cellHasContent({ v: '' })).toBe(false);
    expect(cellHasContent({ s: 'x' })).toBe(false);
    expect(cellHasContent({ f: '=1' })).toBe(true);
    expect(cellHasContent(null)).toBe(false);
  });
});

describe('the student’s columns', () => {
  it('are the columns holding cells the pristine sheet does not', () => {
    const p = indexPristine(clarkPristine(), SOLUTION_COL);
    expect([...studentColumns(clarkAttempt(), p)].sort((a, b) => a - b)).toEqual(range(22, 28));
    expect(studentColumns(clarkPristine(), p).size).toBe(0);
  });
  it('are never part of the solution segments, even inside the span', () => {
    const p = indexPristine(clarkPristine(), SOLUTION_COL);
    const sheet = clarkAttempt();
    (sheet.cellData![9] ??= {})[15] = { v: 'my note beside the answer' };
    expect(solutionSegments(sheet, SOLUTION_COL, p)).toEqual([{ start: 10, last: 14 }, { start: 16, last: 20 }]);
    expect(solutionSegments(clarkAttempt(), SOLUTION_COL, p)).toEqual([{ start: 10, last: 20 }]);
    expect(solutionSegments(clarkAttempt(), -1, p)).toEqual([]);
  });
});

describe('applySolutionVisibility', () => {
  const p = indexPristine(clarkPristine(), SOLUTION_COL);
  it('hides only the solution and shows the work that a bad snapshot had hidden', () => {
    const sheet = applySolutionVisibility(clarkAttempt(), SOLUTION_COL, p, false);
    expect(hiddenCols(sheet)).toEqual(range(10, 20));
    expect(sheet.columnCount).toBeGreaterThanOrEqual(20 + WORK_COLUMNS_AFTER_SOLUTION);
  });
  it('shows everything from the marker on when revealed, the workbook’s own hidden columns included', () => {
    const sheet = applySolutionVisibility(clarkAttempt(), SOLUTION_COL, p, true);
    expect(hiddenCols(sheet)).toEqual([]);
  });
  it('leaves columns before the marker alone', () => {
    const sheet = clarkAttempt();
    sheet.columnData![3] = { hd: 1, w: 40 };
    applySolutionVisibility(sheet, SOLUTION_COL, p, false);
    expect(sheet.columnData![3]).toEqual({ hd: 1, w: 40 });
    expect(sheet.columnData![25]).toEqual({});
  });
  it('is a no-op for a sheet without a marker', () => {
    const sheet = clarkAttempt();
    applySolutionVisibility(sheet, -1, p, false);
    expect(hiddenCols(sheet)).toEqual(range(10, 63));
  });
});
