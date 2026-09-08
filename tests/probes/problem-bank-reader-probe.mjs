// problem-bank-reader-probe.mjs — run the OOXML reader over a real practice
// workbook and measure what it keeps, sheet by sheet, against SheetJS.
//
// Usage: node tests/probes/problem-bank-reader-probe.mjs <workbook.xlsm> [--all]
//   Only sheets named "Paper.Source_NN" (a dot in the name) are problems;
//   --all reads every sheet.
// Exit 1 when any sheet fails an invariant: cell parity with SheetJS (every
// valued cell SheetJS sees, we see), styled cells present, a text box that
// could not be placed, or a parse error. The report is the point: it says
// exactly what a faithful import would carry and what it would lose.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const file = process.argv[2];
const all = process.argv.includes('--all');
if (!file) { console.error('usage: node tests/probes/problem-bank-reader-probe.mjs <workbook.xlsm> [--all]'); process.exit(2); }

// Bundle the TS reader for Node once (esbuild ships with the build).
const esbuild = require('esbuild');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plx-ooxml-'));
const outFile = path.join(outDir, 'ooxml.mjs');
await esbuild.build({ entryPoints: [path.join(ROOT, 'src', 'built-in', 'worksheet', 'ooxml.ts')], bundle: true, platform: 'node', format: 'esm', outfile: outFile, logLevel: 'error' });
const { openXlsx, sheetToSnapshot, findCell } = await import(pathToFileURL(outFile).href);
const XLSX = require('xlsx');

const bytes = fs.readFileSync(file);
const t0 = Date.now();
const book = await openXlsx(bytes);
const sjs = XLSX.read(bytes, { type: 'buffer', cellFormula: true });
const names = book.sheetNames.filter((n) => all || n.includes('.'));
console.log(`${path.basename(file)}: ${book.sheetNames.length} sheets, ${names.length} to read (opened in ${Date.now() - t0} ms)`);

const total = { cells: 0, styledCells: 0, formulas: 0, merges: 0, hiddenColumns: 0, hiddenRows: 0, customRowHeights: 0, images: 0, imagesSkipped: 0, textBoxes: 0, textBoxesDropped: 0, sharedFormulas: 0, styles: 0 };
const failures = [];
let maxMs = 0;
let slowest = '';
for (const name of names) {
  const t1 = Date.now();
  let sheet;
  try { sheet = await book.readSheet(name); } catch (err) { failures.push(`${name}: parse error ${err && err.message}`); continue; }
  const solution = findCell(sheet, (t, r) => r <= 2 && /^solutions?\b/i.test(t.trim()));
  const { workbook, stats } = sheetToSnapshot(sheet, book, { hideFromColumn: solution ? solution.col : undefined });
  const ms = Date.now() - t1;
  if (ms > maxMs) { maxMs = ms; slowest = name; }
  for (const k of Object.keys(total)) if (k in stats) total[k] += stats[k];
  total.sharedFormulas += sheet.sharedFormulas;
  // Parity: every valued or formula cell SheetJS reports must be in our snapshot.
  const ws = sjs.Sheets[name];
  const ours = workbook.sheets[workbook.sheetOrder[0]].cellData;
  let missing = 0;
  let sjsCount = 0;
  if (ws) {
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue;
      const c = ws[addr];
      const has = (c.v !== undefined && c.v !== null && c.v !== '') || (typeof c.f === 'string' && c.f.trim());
      if (!has) continue;
      sjsCount++;
      const pos = XLSX.utils.decode_cell(addr);
      const mine = ours[pos.r]?.[pos.c];
      if (!mine || (mine.v === undefined && mine.f === undefined)) missing++;
    }
  }
  if (missing > 0) failures.push(`${name}: ${missing} of ${sjsCount} SheetJS cells missing from the snapshot`);
  if (stats.cells > 0 && stats.styledCells < stats.cells * 0.9) failures.push(`${name}: only ${stats.styledCells}/${stats.cells} cells styled`);
  if (stats.textBoxesDropped > 0) failures.push(`${name}: ${stats.textBoxesDropped} text box(es) had nowhere to go`);
  if (!solution && name.includes('.')) failures.push(`${name}: no Solution marker in the top rows`);
  // Formula sanity: a shared-formula dependent must not carry the master's literal references unchanged when offset.
  const bad = sheet.cells.filter((c) => c.formula && /_xl(fn|ws|pm)\./.test(String(ours[c.row]?.[c.col]?.f ?? '')));
  if (bad.length) failures.push(`${name}: ${bad.length} formulas still carry _xlfn prefixes`);
}
console.log('totals:', JSON.stringify(total));
console.log(`slowest sheet: ${slowest} (${maxMs} ms)`);
if (failures.length) {
  console.log(`FAIL: ${failures.length} sheet(s) with findings`);
  for (const f of failures.slice(0, 25)) console.log('  ' + f);
  if (failures.length > 25) console.log(`  ... ${failures.length - 25} more`);
  process.exit(1);
}
console.log(`OK: ${names.length} sheets read with formatting; nothing SheetJS sees is missing`);
