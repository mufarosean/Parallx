// spreadsheetReadingRows.test.ts — the spreadsheet viewer's rows carry the
// workbook's own coordinates.
//
// The viewer used to drop blank rows and start numbering at the used range,
// so "row 206" on screen was not Excel's row 206 and a cited cell could not
// be found. Blank rows are kept and the range's first row and column ride
// along with each sheet.

import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const { extractSpreadsheetReadingData } = require('../../electron/documentExtractor.cjs');

let dir: string | undefined;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = undefined; });

describe('extractSpreadsheetReadingData', () => {
  it('keeps blank rows and reports where the used range starts', async () => {
    const ws = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_aoa(ws, [['Step', 'Recipe']], { origin: 'B3' });
    XLSX.utils.sheet_add_aoa(ws, [['4', 'Use the true ultimate']], { origin: 'B6' });
    // The used range, as Excel records it (its <dimension>).
    ws['!ref'] = 'B3:C6';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cape Cod');
    dir = await mkdtemp(path.join(tmpdir(), 'px-sheet-'));
    const file = path.join(dir, 'cookbook.xlsx');
    await writeFile(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    const { sheets } = await extractSpreadsheetReadingData(file);
    const sheet = sheets[0];
    expect(sheet.rowStart).toBe(2); // row 3
    expect(sheet.colStart).toBe(1); // column B
    // Rows 3, 4, 5, 6: the two blank rows are kept, so index 3 is row 6.
    expect(sheet.rows).toHaveLength(4);
    expect(sheet.rows[1]).toEqual(['', '']);
    expect(sheet.rows[3]).toEqual(['4', 'Use the true ultimate']);
  });
});
