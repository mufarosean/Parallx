// M99 — Worksheets: pure-logic tests for the item format layer
// (A1 parsing, model-JSON extraction, workbook building, cell serialization).

import { describe, it, expect } from 'vitest';
import {
  parseA1, itemToWorkbooks, extractItemsJson, serializeWorkbookCells,
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
    question: 'Compute the loss ratio.',
    tags: ['ratemaking'],
    givens: [
      { cell: 'B2', value: 'Earned Premium', bold: true },
      { cell: 'C2', value: 1250.5 },
    ],
    solution: [{ cell: 'C8', formula: '=C4/C2' }],
    solution_notes: 'Divide losses by premium.',
    page: 12,
  }]);

  it('parses a clean item with page attribution', () => {
    const { items, error } = extractItemsJson(valid);
    expect(error).toBeNull();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Loss Ratio');
    expect(items[0].page).toBe(12);
    expect(items[0].givens).toHaveLength(2);
    expect(items[0].solution[0].formula).toBe('=C4/C2');
  });

  it('tolerates fences and prose around the array', () => {
    const wrapped = 'Here you go:\n```json\n' + valid + '\n```\nDone.';
    expect(extractItemsJson(wrapped).items).toHaveLength(1);
  });

  it('drops items with no title, question, or solution work', () => {
    const junk = JSON.stringify([
      { title: '', question: 'q', solution: [{ cell: 'A1', value: 1 }] },
      { title: 't', question: 'q', solution: [] },
      { title: 'ok', question: 'q', givens: [], solution: [{ cell: 'A1', value: 1 }] },
    ]);
    const { items } = extractItemsJson(junk);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('ok');
  });

  it('drops cells with bad references or formulas without =', () => {
    const raw = JSON.stringify([{
      title: 't', question: 'q',
      givens: [{ cell: 'ZZ999', value: 1 }, { cell: 'B2', value: 2 }],
      solution: [{ cell: 'C3', formula: 'C1+C2' }, { cell: 'C4', formula: '=B2*2' }],
    }]);
    const { items } = extractItemsJson(raw);
    expect(items[0].givens).toHaveLength(1);
    expect(items[0].solution).toHaveLength(1);
    expect(items[0].solution[0].cell).toBe('C4');
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
    question: 'Estimate the BF reserve.',
    tags: [],
    givens: [
      { cell: 'B2', value: 'Expected Losses', bold: true },
      { cell: 'C2', value: 1000 },
      // A given carrying a formula must be stripped to value-only.
      { cell: 'C3', value: 0.6, formula: '=1-0.4' },
    ],
    solution: [
      { cell: 'B8', value: 'Reserve', bold: true },
      { cell: 'C8', formula: '=C2*C3' },
    ],
    solutionNotes: '',
  };

  it('builds Athena-bounded single-sheet workbooks', () => {
    const { givensJson, solutionJson } = itemToWorkbooks(item);
    for (const json of [givensJson, solutionJson]) {
      const wb = JSON.parse(json);
      expect(wb.sheetOrder).toEqual(['sheet1']);
      expect(wb.sheets.sheet1.rowCount).toBe(ATHENA_ROWS);
      expect(wb.sheets.sheet1.columnCount).toBe(ATHENA_COLUMNS);
    }
  });

  it('givens are value-only, tinted, and bold where marked', () => {
    const wb = JSON.parse(itemToWorkbooks(item).givensJson);
    const cells = wb.sheets.sheet1.cellData;
    expect(cells[1][1].v).toBe('Expected Losses');
    expect(cells[1][1].s.bl).toBe(1);
    expect(cells[1][1].s.bg.rgb).toBeTruthy();
    // The formula a given tried to smuggle in is gone; the value stays.
    expect(cells[2][2].v).toBe(0.6);
    expect(cells[2][2].f).toBeUndefined();
    // No solution cells leak into the givens workbook.
    expect(cells[7]).toBeUndefined();
  });

  it('solution layers work cells over the tinted givens with formulas intact', () => {
    const wb = JSON.parse(itemToWorkbooks(item).solutionJson);
    const cells = wb.sheets.sheet1.cellData;
    expect(cells[1][2].v).toBe(1000);            // given survives
    expect(cells[1][2].s.bg.rgb).toBeTruthy();   // still tinted
    expect(cells[7][2].f).toBe('=C2*C3');        // work formula intact
    expect(cells[7][2].s?.bg).toBeUndefined();   // work is NOT tinted
  });
});

describe('serializeWorkbookCells', () => {
  it('flattens cells to A1 lines with values and formulas', () => {
    const { solutionJson } = itemToWorkbooks({
      title: 't', question: 'q', tags: [], solutionNotes: '',
      givens: [{ cell: 'B2', value: 5 }],
      solution: [{ cell: 'B3', value: 10, formula: '=B2*2' }],
    });
    const text = serializeWorkbookCells(solutionJson);
    expect(text).toContain('B2: 5');
    expect(text).toContain('B3: 10 (=B2*2)');
  });

  it('returns empty for garbage input instead of throwing', () => {
    expect(serializeWorkbookCells('not json')).toBe('');
    expect(serializeWorkbookCells('{}')).toBe('');
  });
});
