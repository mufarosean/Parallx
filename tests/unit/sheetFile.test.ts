// sheetFile.test.ts — the `.sheet` file: what is written, what is read back,
// what is refused, and the names a new sheet may take.

import { describe, expect, it } from 'vitest';
import { cleanSheetName, parseSheetFile, serializeSheetFile, sheetFilePathOf, sheetTitle, uniqueSheetFileName, SHEET_FILE_FORMAT } from '../../src/built-in/worksheet/sheetFile';

const workbook = { id: 'wb1', name: 'Budget', sheetOrder: ['s1'], sheets: { s1: { id: 's1', name: 'Sheet1', cellData: { 0: { 0: { v: 'Rent' }, 1: { v: 1850 } } } } } } as never;

describe('the sheet file', () => {
  it('reads back what it wrote', () => {
    const text = serializeSheetFile(workbook);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text).format).toBe(SHEET_FILE_FORMAT);
    expect(parseSheetFile(text)).toEqual({ workbook });
  });

  it('opens an empty file and a new file as a new sheet', () => {
    expect(parseSheetFile('')).toEqual({ workbook: null });
    expect(parseSheetFile('  \n')).toEqual({ workbook: null });
    expect(parseSheetFile(serializeSheetFile(null))).toEqual({ workbook: null });
  });

  it('refuses what is not a sheet, with a reason, so nothing is saved over it', () => {
    expect(parseSheetFile('this is not a workbook').error).toMatch(/not a sheet file/);
    expect(parseSheetFile('{"hello":1}').error).toMatch(/not a sheet file/);
    expect(parseSheetFile('[1,2]').error).toMatch(/not a sheet file/);
    expect(parseSheetFile(JSON.stringify({ format: SHEET_FILE_FORMAT, version: 99, workbook })).error).toMatch(/newer version/);
    expect(parseSheetFile(JSON.stringify({ format: SHEET_FILE_FORMAT, version: 1, workbook: { sheets: 3 } })).error).toMatch(/damaged/);
  });

  it('knows a file pane from the others, and names it', () => {
    expect(sheetFilePathOf('file:/work/Budget 2026.sheet')).toBe('/work/Budget 2026.sheet');
    expect(sheetFilePathOf('file:C:\\work\\Budget.sheet')).toBe('C:\\work\\Budget.sheet');
    expect(sheetFilePathOf('scratch')).toBeNull();
    expect(sheetFilePathOf('item:12')).toBeNull();
    expect(sheetTitle('/work/Budget 2026.sheet')).toBe('Budget 2026');
    expect(sheetTitle('C:\\work\\Budget.SHEET')).toBe('Budget');
    expect(sheetTitle('/work/notes.txt')).toBe('notes.txt');
  });

  it('makes a typed name safe for a file', () => {
    expect(cleanSheetName('  Budget 2026  ')).toBe('Budget 2026');
    expect(cleanSheetName('a/b\\c:d*e?"f<g>h|i')).toBe('a b c d e f g h i');
    expect(cleanSheetName('Budget.sheet')).toBe('Budget');
    expect(cleanSheetName('trailing. .')).toBe('trailing');
    expect(cleanSheetName('')).toBe('Untitled');
    expect(cleanSheetName('///')).toBe('Untitled');
  });

  it('finds the first free file name, whatever the case of those taken', () => {
    expect(uniqueSheetFileName('Budget', [])).toBe('Budget.sheet');
    expect(uniqueSheetFileName('Budget', ['budget.SHEET'])).toBe('Budget 2.sheet');
    expect(uniqueSheetFileName('Budget', ['Budget.sheet', 'Budget 2.sheet', 'notes.md'])).toBe('Budget 3.sheet');
    expect(uniqueSheetFileName('', ['Untitled.sheet'])).toBe('Untitled 2.sheet');
  });
});
