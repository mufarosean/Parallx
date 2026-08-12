// Worksheets: Excel practice-problem import — pure detection/conversion.
// Fixtures model the two REAL formats in the study folder (2026-08-12):
// Rising Fellow side-by-side sheets ("Solution ->" at column K) and
// CAS-style "Item N"/"Answer N" pairs.

import { describe, it, expect } from 'vitest';
import { detectExcelItems, wholeSheetItem, type GridSheet } from '../../src/built-in/worksheet/excelImport.js';

const sheet = (name: string, cells: [number, number, string | number, string | null][], merges: [number, number, number, number][] = []): GridSheet =>
  ({ name, cells, merges, colWidths: [] });

// Rising Fellow style: question left, "Solution ->" at K1 (col 10),
// worked solution with formulas right of it, Self-Rating machinery at D1/E1.
const rfSheet = sheet('Brosius.RF_01', [
  [0, 0, 'RF Brosius - 1', null],
  [0, 3, 'Self-Rating:', null],
  [0, 4, 'Unrated', null],
  [0, 10, 'Solution ->', null],
  [2, 1, 'Given the following information for insurer ABC:', null],
  [5, 1, 'Accident Year', null],
  [7, 2, 470, null],
  [7, 5, 2890, null],
  [15, 1, 'Calculate the estimated ultimate losses for accident year 2013 using the Least Squares method.', null],
  [1, 11, 'There is significant premium growth, so convert to loss ratios.', null],
  [7, 12, 0.163, 'C8/$F8'],
  [16, 12, 42, '=SLOPE(P8:P11,M8:M11)'],
]);

const itemSheet = sheet('Item 1', [
  [0, 0, '1.5 points', null],
  [2, 1, 'A stochastic loss reserving model estimates ultimate losses of $70 million.', null],
  [5, 1, 'Describe what is implied by each exhibit below.', null],
  [53, 0, 'SHOW ALL WORK.', null],
]);
const answerSheet = sheet('Answer 1', [
  [0, 0, 'Points:', null],
  [0, 1, 1.5, null],
  [2, 0, 'Domain:', null],
  [2, 1, 'A: Estimation of Claims Liabilities', null],
  [65, 0, 'Correct / Full-credit Answer:', null],
  [66, 0, 'i. the model expected value is biased high.', null],
]);

describe('detectExcelItems — Item/Answer pairs', () => {
  it('pairs Item N with Answer N; solution carries both tabs', () => {
    const { items, leftovers } = detectExcelItems([itemSheet, answerSheet], 'SP26');
    expect(items).toHaveLength(1);
    expect(leftovers).toEqual([]);
    const item = items[0];
    expect(item.kind).toBe('pair');
    expect(item.title).toBe('SP26 - Item 1');
    expect(item.points).toBe(1.5);
    expect(item.questionMd).toContain('stochastic loss reserving');
    const givens = JSON.parse(item.givensJson);
    expect(givens.sheetOrder).toHaveLength(1);
    const solution = JSON.parse(item.solutionJson);
    expect(solution.sheetOrder).toHaveLength(2);
    const answerTab = solution.sheets[solution.sheetOrder[1]];
    expect(JSON.stringify(answerTab.cellData)).toContain('Full-credit');
  });

  it('an Item with no matching Answer is left over, never half-imported', () => {
    const { items, leftovers } = detectExcelItems([itemSheet], 'SP26');
    expect(items).toEqual([]);
    expect(leftovers).toEqual(['Item 1']);
  });
});

describe('detectExcelItems — side-by-side (Solution -> marker)', () => {
  it('clips the solution region out of the givens, keeps it in the solution', () => {
    const { items } = detectExcelItems([rfSheet], 'Workbook');
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.kind).toBe('split');
    expect(item.title).toBe('RF Brosius - 1');
    expect(item.tags).toBe('brosius');
    const givens = JSON.parse(item.givensJson);
    const givensText = JSON.stringify(givens);
    expect(givensText).toContain('Least Squares');
    expect(givensText).not.toContain('premium growth');   // solution region gone
    expect(givensText).not.toContain('Self-Rating');       // machinery gone
    expect(givensText).not.toContain('SLOPE');             // solution formula gone
    const solution = JSON.stringify(JSON.parse(item.solutionJson));
    expect(solution).toContain('premium growth');
    expect(solution).toContain('=SLOPE(P8:P11,M8:M11)');   // live formula, = prefixed
    expect(solution).toContain('Least Squares');           // question stays visible
  });

  it('question text excludes machinery and solution text', () => {
    const { items } = detectExcelItems([rfSheet], 'Workbook');
    expect(items[0].questionMd).toContain('Calculate the estimated ultimate losses');
    expect(items[0].questionMd).not.toContain('Self-Rating');
    expect(items[0].questionMd).not.toContain('premium growth');
  });
});

describe('detectExcelItems — machinery sheets stay opt-in', () => {
  it('sheets with no structure land in leftovers', () => {
    const dashboard = sheet('Dashboard', [[0, 0, 'Exam 7 Dashboard', null], [5, 2, 'Sort Problems by Rating', null]]);
    const { items, leftovers } = detectExcelItems([dashboard, rfSheet], 'Workbook');
    expect(items).toHaveLength(1);
    expect(leftovers).toEqual(['Dashboard']);
  });

  it('wholeSheetItem imports a leftover with solution = givens', () => {
    const dashboard = sheet('Notes', [[0, 0, 'Some study notes worth keeping', null]]);
    const item = wholeSheetItem(dashboard, 'Workbook');
    expect(item.kind).toBe('whole');
    expect(item.givensJson).toBe(item.solutionJson);
  });
});
