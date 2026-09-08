// worksheet-dashboard-probe.mjs — render the Problem Bank dashboard pane in
// a HIDDEN window over a synthetic bank and save a screenshot, so the layout
// (tiles, lists, stacked bars, the two line charts, the hover tooltip) can be
// checked by eye in both themes without launching the app.
//
// Run (Electron, not Node):
//   env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron tests/probes/worksheet-dashboard-probe.mjs <out.png> [--light] [--hover] [--empty]
// Bundles src/built-in/worksheet/dashboardPane.ts with worksheetData.ts
// swapped for a stub that returns the synthetic bank. No window ever appears.
import { app, BrowserWindow, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const [outPng] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const light = process.argv.includes('--light');
const hover = process.argv.includes('--hover');
const empty = process.argv.includes('--empty');
if (!outPng) { console.error('usage: electron worksheet-dashboard-probe.mjs <out.png> [--light] [--hover] [--empty]'); app.exit(2); }

// A bank that exercises every list: due, struggling, weakest, quick wins.
const STUB = `
const DAY = 86400000;
const NOW = Date.parse('2026-09-08T15:00:00');
const PAPERS = [['brosius', 22], ['clark', 18], ['friedland', 25], ['hurlimann', 14], ['mack1994', 12], ['meyers', 20], ['shapland', 21], ['venter', 16], ['verrall', 10]];
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const items = []; const attempts = [];
let id = 1;
for (const [paper, n] of PAPERS) {
  const coverage = paper === 'verrall' ? 0.1 : paper === 'clark' ? 0.35 : 0.65;
  for (let i = 1; i <= n; i++) {
    const rated = rnd() < coverage;
    const r = rnd();
    const state = !rated ? '' : r < 0.5 ? 'easy' : r < 0.8 ? 'medium' : 'hard';
    const ago = Math.floor(rnd() * 30);
    const it = { id, title: paper.charAt(0).toUpperCase() + paper.slice(1) + ' RF ' + i, paper, source: rnd() < 0.8 ? 'rf' : 'cas', kind: rnd() < 0.7 ? 'quant' : 'qual', quadrant: 1 + Math.floor(rnd() * 4), attemptState: state, attemptCount: rated ? 1 : 0, seconds: rated ? 300 + Math.floor(rnd() * 900) : 0, lastAttemptAt: rated ? NOW - ago * DAY : 0, hasSheet: true, tags: '' };
    if (rated) {
      const imported = ago > 12;
      attempts.push({ itemId: id, selfGrade: state, at: it.lastAttemptAt, seconds: it.seconds, sessionId: '', imported });
    }
    items.push(it); id++;
  }
}
// Three problems rated Hard again and again.
for (const it of items.filter((x) => x.attemptState === 'hard').slice(0, 3)) {
  it.attemptCount = 3;
  attempts.push({ itemId: it.id, selfGrade: 'hard', at: it.lastAttemptAt - 9 * DAY, seconds: 400, sessionId: '', imported: false });
  attempts.push({ itemId: it.id, selfGrade: 'hard', at: it.lastAttemptAt - 4 * DAY, seconds: 380, sessionId: '', imported: false });
}
const snapshots = [];
for (let d = 0; d < 11; d++) {
  const t = new Date(Date.parse('2026-06-10T12:00:00') + d * 7 * DAY);
  const day = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  snapshots.push({ day, attempted: 0.04 + d * 0.03, score: 0.55 + d * 0.012, source: 'workbook' });
}
export async function listItems() { return ${empty ? '[]' : 'items'}; }
export async function listCompletedAttempts() { return ${empty ? '[]' : 'attempts'}; }
export async function listProgressSnapshots() { return ${empty ? '[]' : 'snapshots'}; }
export function onWorksheetDataChanged() { return { dispose() {} }; }
`;

app.whenReady().then(async () => {
  nativeTheme.themeSource = light ? 'light' : 'dark';
  const esbuild = require('esbuild');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plx-dash-'));
  const stubFile = path.join(tmp, 'worksheetData.stub.js');
  fs.writeFileSync(stubFile, STUB);
  const bundle = path.join(tmp, 'dashboard.js');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'built-in', 'worksheet', 'dashboardPane.ts')],
    bundle: true, platform: 'browser', format: 'esm', outfile: bundle, logLevel: 'error',
    plugins: [{ name: 'stub-data', setup(b) { b.onResolve({ filter: /worksheetData\.js$/ }, () => ({ path: stubFile })); } }],
  });
  const css = (p) => pathToFileURL(path.join(ROOT, ...p)).href;
  const html = `<!doctype html><html${light ? ' data-px-mode="light"' : ''}><head><meta charset="utf-8">
<link rel="stylesheet" href="${css(['src', 'theme', 'px-tokens.css'])}">
<link rel="stylesheet" href="${css(['src', 'built-in', 'worksheet', 'worksheet.css'])}">
<style>html,body{margin:0;height:100%;background:var(--px-bg);color:var(--px-text);font-family:var(--px-font-ui);font-size:var(--px-text-base)}#host{position:absolute;inset:0;display:flex;flex-direction:column}</style></head>
<body><div id="host"></div>
<script type="module">
  import { createDashboardPane } from '${pathToFileURL(bundle).href}';
  try {
    window.__LOG__ = [];
    window.__PANE__ = createDashboardPane(document.getElementById('host'), {
      openItem: (id, title) => window.__LOG__.push('open ' + id + ' ' + title),
      startQuiz: (ids) => window.__LOG__.push('quiz ' + ids.length),
      configureQuiz: (p) => window.__LOG__.push('configure ' + JSON.stringify(p)),
      importWorkbook: () => window.__LOG__.push('import'),
    });
    window.__READY__ = true;
  } catch (err) { window.__ERROR__ = String(err && err.stack || err); }
</script></body></html>`;
  const page = path.join(tmp, 'dashboard.html');
  fs.writeFileSync(page, html);

  const win = new BrowserWindow({ show: false, width: 1360, height: 1500, webPreferences: { webSecurity: false, contextIsolation: false, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  win.webContents.setFrameRate(30);
  let lastFrame = null;
  win.webContents.on('paint', (_e, _dirty, image) => { lastFrame = image; });
  const consoleLines = [];
  win.webContents.on('console-message', (ev) => { const m = ev && ev.message !== undefined ? ev.message : String(ev); consoleLines.push(m.slice(0, 300)); });
  await win.loadFile(page);
  const deadline = Date.now() + 10000;
  let ready = false; let error = null;
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript('({ ready: !!window.__READY__, error: window.__ERROR__ || null })');
    if (state.error) { error = state.error; break; }
    if (state.ready) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (error) { console.error('mount failed:', error); app.exit(1); return; }
  if (!ready) { console.error('mount timed out'); app.exit(1); return; }
  await new Promise((r) => setTimeout(r, 1200));

  if (hover) {
    // Hover the Score chart two thirds along, and a paper bar, so the tooltip and crosshair show.
    const target = await win.webContents.executeJavaScript(`(() => {
      const svgs = document.querySelectorAll('.ws-dash__svghost svg');
      const svg = svgs[svgs.length - 1];
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      return { x: r.left + r.width * 0.66, y: r.top + r.height * 0.5 };
    })()`);
    if (target) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(target.x), y: Math.round(target.y) });
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  const diag = await win.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const txt = (s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim()).slice(0, 12);
    const pane = document.querySelector('.ws-dash');
    return {
      tiles: txt('.ws-dash__tilevalue'), tileLabels: txt('.ws-dash__tilelabel'),
      cards: txt('.ws-dash__cardtitle'), rows: q('.ws-dash__row'), paperRows: q('.ws-dash__paperrow'), svgs: q('.ws-dash__svghost svg'),
      seriesPaths: q('.ws-dash__series'), tip: (() => { const t = document.querySelector('.ws-dash__tip'); return t && !t.hidden ? t.textContent : '(hidden)'; })(),
      scrollHeight: pane ? pane.scrollHeight : -1, clientHeight: pane ? pane.clientHeight : -1, overflowX: pane ? pane.scrollWidth > pane.clientWidth : null,
      firstButtons: txt('.ws-dash__cardfoot .ws-btn'),
    };
  })()`);
  let image = await win.webContents.capturePage();
  if (image.isEmpty() && lastFrame) image = lastFrame;
  fs.writeFileSync(outPng, image.toPNG());
  console.log(`rendered -> ${outPng} (${image.getSize().width}x${image.getSize().height})`);
  console.log(JSON.stringify(diag));
  if (consoleLines.length) { console.log(`renderer console (${consoleLines.length}):`); for (const l of consoleLines.slice(0, 12)) console.log('  ' + l); }
  app.exit(0);
}).catch((err) => { console.error('probe error:', err && err.stack || err); app.exit(2); });
