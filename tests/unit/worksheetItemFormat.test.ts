// M99 — Worksheets: pure-logic tests for the item format layer
// (A1 parsing, model-JSON extraction, workbook building, cell serialization).
// Items are WORKBOOKS: one sheet tab per part, question text ON the sheet.

import { describe, it, expect } from 'vitest';
import {
  parseA1, itemToWorkbooks, extractItemsJson, serializeWorkbookCells,
  workbookHasOnSheetQuestion, FIRST_CONTENT_ROW,
  type GeneratedItem,
} from '../../src/built-in/worksheet/itemFormat.js';
import { ATHENA_ROWS, ATHENA_COLUMNS } from '../../src/built-in/worksheet/worksheetConstants.js';

describe('parseA1', () => {
  it('parses simple and double-letter references (zero-based)', () => {
    expect(parseA1('A1')).toEqual({ row: 0, col: 0 });
    expect(parseA1('b4')).toEqual({ row: 3, col: 1 });
    expect(parseA1('AA10')).toEqual({ row: 9, col: 26 });
    expect(parseA1('AN150')).toEqual({ row: 149, col: 39 }); // grid corner
  });

  it('rejects malformed and out-of-grid references', () => {
    expect(parseA1('')).toBeNull();
    expect(parseA1('4B')).toBeNull();
    expect(parseA1('A0')).toBeNull();
    expect(parseA1(`A${ATHENA_ROWS + 1}`)).toBeNull();   // row past 150
    expect(parseA1('AO1')).toBeNull();                    // col past 40 (AN)
    expect(parseA1('$B$4')).toBeNull();
  });

  it('grid bounds match the Athena research doc', () => {
    expect(ATHENA_ROWS).toBe(150);
    expect(ATHENA_COLUMNS).toBe(40);
  });
});

describe('extractItemsJson', () => {
  const valid = JSON.stringify([{
    title: 'Loss Ratio',
    tags: ['ratemaking'],
    solution_notes: 'Divide losses by premium.',
    page: 12,
    parts: [
      {
        name: 'a',
        question: 'Compute the loss ratio.',
        givens: [
          { cell: 'B6', value: 'Earned Premium', bold: true },
          { cell: 'C6', value: 1250.5 },
        ],
        solution: [{ cell: 'C12', formula: '=C8/C6' }],
      },
      {
        name: 'b',
        question: 'Double it.',
        givens: [],
        solution: [{ cell: 'C14', formula: '=C12*2' }],
      },
    ],
  }]);

  it('parses a clean multi-part item with page attribution', () => {
    const { items, error } = extractItemsJson(valid);
    expect(error).toBeNull();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Loss Ratio');
    expect(items[0].page).toBe(12);
    expect(items[0].parts).toHaveLength(2);
    expect(items[0].parts[0].givens).toHaveLength(2);
    expect(items[0].parts[1].solution[0].formula).toBe('=C12*2');
  });

  it('tolerates fences and prose around the array', () => {
    const wrapped = 'Here you go:\n```json\n' + valid + '\n```\nDone.';
    expect(extractItemsJson(wrapped).items).toHaveLength(1);
  });

  it('folds the legacy flat shape into a single part', () => {
    const legacy = JSON.stringify([{
      title: 'Legacy', question: 'Old shape.',
      givens: [{ cell: 'B6', value: 1 }],
      solution: [{ cell: 'C8', formula: '=B6*2' }],
    }]);
    const { items } = extractItemsJson(legacy);
    expect(items).toHaveLength(1);
    expect(items[0].parts).toHaveLength(1);
    expect(items[0].parts[0].name).toBe('');
    expect(items[0].parts[0].question).toBe('Old shape.');
  });

  it('drops cells in the reserved question rows (1-5)', () => {
    const raw = JSON.stringify([{
      title: 't',
      parts: [{
        name: '', question: 'q',
        givens: [{ cell: 'B2', value: 'too high' }, { cell: 'B6', value: 'ok' }],
        solution: [{ cell: 'A1', value: 'reserved' }, { cell: 'C8', formula: '=B6*1' }],
      }],
    }]);
    const { items } = extractItemsJson(raw);
    expect(items[0].parts[0].givens).toHaveLength(1);
    expect(items[0].parts[0].givens[0].cell).toBe('B6');
    expect(items[0].parts[0].solution).toHaveLength(1);
  });

  it('drops parts with no question or solution work, items with no parts', () => {
    const junk = JSON.stringify([
      { title: 't1', parts: [{ name: 'a', question: '', solution: [{ cell: 'A6', value: 1 }] }] },
      { title: 't2', parts: [{ name: 'a', question: 'q', solution: [] }] },
      { title: 'ok', parts: [{ name: 'a', question: 'q', solution: [{ cell: 'A6', value: 1 }] }] },
    ]);
    const { items } = extractItemsJson(junk);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('ok');
  });

  it('drops cells with bad references or formulas without =', () => {
    const raw = JSON.stringify([{
      title: 't',
      parts: [{
        name: '', question: 'q',
        givens: [{ cell: 'ZZ999', value: 1 }, { cell: 'B6', value: 2 }],
        solution: [{ cell: 'C7', formula: 'C1+C2' }, { cell: 'C8', formula: '=B6*2' }],
      }],
    }]);
    const { items } = extractItemsJson(raw);
    expect(items[0].parts[0].givens).toHaveLength(1);
    expect(items[0].parts[0].solution).toHaveLength(1);
    expect(items[0].parts[0].solution[0].cell).toBe('C8');
  });

  it('fails loudly on non-JSON output', () => {
    const { items, error } = extractItemsJson('The material was too thin to make items.');
    expect(items).toHaveLength(0);
    expect(error).toBeTruthy();
  });
});

describe('itemToWorkbooks', () => {
  const item: GeneratedItem = {
    title: 'BF Reserve',
    tags: [],
    solutionNotes: '',
    parts: [
      {
        name: 'a',
        question: 'Estimate the BF reserve.',
        givens: [
          { cell: 'B6', value: 'Expected Losses', bold: true },
          { cell: 'C6', value: 1000 },
          // A given carrying a formula must be stripped to value-only.
          { cell: 'C7', value: 0.6, formula: '=1-0.4' },
        ],
        solution: [
          { cell: 'B12', value: 'Reserve', bold: true },
          { cell: 'C12', formula: '=C6*C7' },
        ],
      },
      {
        name: 'b',
        question: 'Explain the sensitivity to the a priori.',
        givens: [],
        solution: [{ cell: 'B8', value: 'Answer', bold: true }],
      },
    ],
  };

  it('builds one Athena-bounded sheet per part, in order, with tab names', () => {
    const { givensJson, solutionJson } = itemToWorkbooks(item);
    for (const json of [givensJson, solutionJson]) {
      const wb = JSON.parse(json);
      expect(wb.sheetOrder).toEqual(['p0', 'p1']);
      expect(wb.sheets.p0.name).toBe('(a)');
      expect(wb.sheets.p1.name).toBe('(b)');
      expect(wb.sheets.p0.rowCount).toBe(ATHENA_ROWS);
      expect(wb.sheets.p0.columnCount).toBe(ATHENA_COLUMNS);
    }
  });

  it('writes the part question ON the sheet: merged wrap block above content', () => {
    const wb = JSON.parse(itemToWorkbooks(item).givensJson);
    const sheet = wb.sheets.p0;
    expect(sheet.cellData[0][0].v).toBe('Estimate the BF reserve.');
    expect(sheet.cellData[0][0].s.tb).toBe(3); // wrap
    expect(sheet.cellData[0][0].s.vt).toBe(1); // top
    expect(sheet.mergeData).toHaveLength(1);
    expect(sheet.mergeData[0].startRow).toBe(0);
    expect(sheet.mergeData[0].endRow).toBeLessThan(FIRST_CONTENT_ROW);
    expect(sheet.rowData[0].h).toBeGreaterThan(0);
  });

  it('givens are value-only, tinted, and bold where marked', () => {
    const wb = JSON.parse(itemToWorkbooks(item).givensJson);
    const cells = wb.sheets.p0.cellData;
    expect(cells[5][1].v).toBe('Expected Losses');
    expect(cells[5][1].s.bl).toBe(1);
    expect(cells[5][1].s.bg.rgb).toBeTruthy();
    // The formula a given tried to smuggle in is gone; the value stays.
    expect(cells[6][2].v).toBe(0.6);
    expect(cells[6][2].f).toBeUndefined();
    // No solution cells leak into the givens workbook.
    expect(cells[11]).toBeUndefined();
  });

  it('solution layers work cells over the tinted givens with formulas intact', () => {
    const wb = JSON.parse(itemToWorkbooks(item).solutionJson);
    const cells = wb.sheets.p0.cellData;
    expect(cells[5][2].v).toBe(1000);             // given survives
    expect(cells[5][2].s.bg.rgb).toBeTruthy();    // still tinted
    expect(cells[11][2].f).toBe('=C6*C7');        // work formula intact
    expect(cells[11][2].s?.bg).toBeUndefined();   // work is NOT tinted
  });

  it('workbookHasOnSheetQuestion distinguishes new items from legacy ones', () => {
    expect(workbookHasOnSheetQuestion(itemToWorkbooks(item).givensJson)).toBe(true);
    const legacy = JSON.stringify({
      sheetOrder: ['sheet1'],
      sheets: { sheet1: { id: 'sheet1', name: 'Sheet1', cellData: { 1: { 1: { v: 'x' } } } } },
    });
    expect(workbookHasOnSheetQuestion(legacy)).toBe(false);
    expect(workbookHasOnSheetQuestion('not json')).toBe(false);
  });
});

describe('serializeWorkbookCells', () => {
  it('flattens cells to A1 lines, labelling each part tab', () => {
    const { solutionJson } = itemToWorkbooks({
      title: 't', tags: [], solutionNotes: '',
      parts: [
        { name: 'a', question: 'q1', givens: [{ cell: 'B6', value: 5 }], solution: [{ cell: 'B7', value: 10, formula: '=B6*2' }] },
        { name: 'b', question: 'q2', givens: [], solution: [{ cell: 'C6', value: 7 }] },
      ],
    });
    const text = serializeWorkbookCells(solutionJson);
    expect(text).toContain('[Tab: (a)]');
    expect(text).toContain('B6: 5');
    expect(text).toContain('B7: 10 (=B6*2)');
    expect(text).toContain('[Tab: (b)]');
    expect(text).toContain('C6: 7');
  });

  it('omits tab labels for single-sheet snapshots (legacy attempts)', () => {
    const legacy = JSON.stringify({
      sheetOrder: ['sheet1'],
      sheets: { sheet1: { name: 'Sheet1', cellData: { 1: { 1: { v: 5 } } } } },
    });
    const text = serializeWorkbookCells(legacy);
    expect(text).toBe('B2: 5');
  });

  it('returns empty for garbage input instead of throwing', () => {
    expect(serializeWorkbookCells('not json')).toBe('');
    expect(serializeWorkbookCells('{}')).toBe('');
  });
});
