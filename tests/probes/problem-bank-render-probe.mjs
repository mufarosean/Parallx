// problem-bank-render-probe.mjs — render one workbook sheet through the
// real engine bundle in a HIDDEN window and save a screenshot, so a
// formatting claim can be checked by eye against Excel.
//
// Run (Electron, not Node):
//   env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron tests/probes/problem-bank-render-probe.mjs <workbook.xlsm> <sheet name> <out.png> [--reveal]
// Requires dist/renderer/worksheet-univer.js (npm run build). Without
// --reveal the solution columns (right of the "Solution" marker) stay
// hidden, as they will in the problem tab. No window ever appears.
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const [file, sheetName, outPng] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const reveal = process.argv.includes('--reveal');
if (!file || !sheetName || !outPng) { console.error('usage: electron problem-bank-render-probe.mjs <workbook> <sheet> <out.png> [--reveal]'); app.exit(2); }

const bundle = path.join(ROOT, 'dist', 'renderer', 'worksheet-univer.js');
if (!fs.existsSync(bundle)) { console.error('dist/renderer/worksheet-univer.js is missing; run npm run build first'); app.exit(2); }

app.whenReady().then(async () => {
  const esbuild = require('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plx-render-'));
  const readerFile = path.join(tmp, 'ooxml.mjs');
  await esbuild.build({ entryPoints: [path.join(ROOT, 'src', 'built-in', 'worksheet', 'ooxml.ts')], bundle: true, platform: 'node', format: 'esm', outfile: readerFile, logLevel: 'error' });
  const { openXlsx, sheetToSnapshot, findCell } = await import(pathToFileURL(readerFile).href);
  const book = await openXlsx(fs.readFileSync(file));
  const sheet = await book.readSheet(sheetName);
  const solution = findCell(sheet, (t, r) => r <= 2 && /^solutions?\b/i.test(t.trim()));
  const rating = findCell(sheet, (t, r) => r <= 2 && /^self-rating/i.test(t.trim()));
  const drop = new Set();
  if (rating) { drop.add(`${rating.row}:${rating.col}`); drop.add(`${rating.row}:${rating.col + 1}`); }
  const { workbook, stats } = sheetToSnapshot(sheet, book, { dropCells: drop, hideFromColumn: !reveal && solution ? solution.col : undefined, unitId: 'probe', sheetId: 'probe-sheet' });
  console.log('snapshot:', JSON.stringify(stats));
  // PLX_STRIP=rowData,columnData,mergeData,styles,resources drops parts of the snapshot, to isolate what the engine dislikes.
  for (const key of String(process.env.PLX_STRIP || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (key === 'styles') { workbook.styles = {}; for (const row of Object.values(workbook.sheets['probe-sheet'].cellData)) for (const cell of Object.values(row)) delete cell.s; }
    else if (key === 'resources') delete workbook.resources;
    else delete workbook.sheets['probe-sheet'][key];
    console.log('stripped', key);
  }

  // The page: the engine bundle + CSS from dist, the snapshot inlined.
  const json = JSON.stringify(workbook).replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, 'dist', 'renderer', 'worksheet-univer.css')).href}">
<style>html,body{margin:0;height:100%;background:#fff}#host{position:absolute;inset:0}</style></head>
<body><div id="host"></div>
<script>window.__SNAPSHOT__ = ${json};</script>
<script type="module">
  import { createWorksheetHost } from '${pathToFileURL(bundle).href}';
  try {
    window.__HOST__ = createWorksheetHost({ container: document.getElementById('host'), snapshot: window.__SNAPSHOT__, darkMode: false });
    window.__READY__ = true;
  } catch (err) { window.__ERROR__ = String(err && err.stack || err); }
</script></body></html>`;
  const page = path.join(tmp, 'render.html');
  fs.writeFileSync(page, html);

  const win = new BrowserWindow({ show: false, width: 1700, height: 1000, webPreferences: { webSecurity: false, contextIsolation: false, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  // Offscreen rendering: the engine draws with requestAnimationFrame, which a hidden on-screen window never runs; offscreen windows keep a frame clock.
  win.webContents.setFrameRate(30);
  let lastFrame = null;
  win.webContents.on('paint', (_e, _dirty, image) => { lastFrame = image; });
  const consoleLines = [];
  win.webContents.on('console-message', (ev) => { const m = ev && ev.message !== undefined ? ev.message : String(ev); if (/error|warn|fail/i.test(m)) consoleLines.push(m.slice(0, 300)); });
  await win.loadFile(page);
  const deadline = Date.now() + 15000;
  let ready = false;
  let error = null;
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript('({ ready: !!window.__READY__, error: window.__ERROR__ || null })');
    if (state.error) { error = state.error; break; }
    if (state.ready) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (error) { console.error('mount failed:', error); app.exit(1); return; }
  if (!ready) { console.error('mount timed out'); app.exit(1); return; }
  await new Promise((r) => setTimeout(r, 2500));
  let image = await win.webContents.capturePage();
  if (image.isEmpty() && lastFrame) image = lastFrame;
  fs.writeFileSync(outPng, image.toPNG());
  const diag = await win.webContents.executeJavaScript(`(() => {
    const canvases = [...document.querySelectorAll('canvas')].map((c) => c.width + 'x' + c.height);
    let cells = -1, sheets = -1, err = '';
    try { const snap = window.__HOST__ && window.__HOST__.getSnapshot(); if (snap) { sheets = Object.keys(snap.sheets).length; const s = snap.sheets[snap.sheetOrder[0]]; cells = Object.values(s.cellData || {}).reduce((n, r) => n + Object.keys(r).length, 0); } } catch (e) { err = String(e); }
    return { canvases, cells, sheets, err, hostChildren: document.getElementById('host').children.length };
  })()`);
  console.log(`rendered ${sheetName} -> ${outPng} (${image.getSize().width}x${image.getSize().height}); engine sees ${diag.cells} cells in ${diag.sheets} sheet(s); canvases ${diag.canvases.join(', ')}; host children ${diag.hostChildren}${diag.err ? '; snapshot error ' + diag.err : ''}`);
  if (consoleLines.length) { console.log(`renderer console (${consoleLines.length}):`); for (const l of consoleLines.slice(0, 12)) console.log('  ' + l); }
  app.exit(0);
}).catch((err) => { console.error('probe error:', err && err.stack || err); app.exit(2); });
