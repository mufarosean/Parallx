// Hidden-window probe for printing concept maps (canvas Export as PDF).
// Builds one page holding text and four maps (a small tree, a wide radial
// map, a wide top-down map and a map of rich boxes with math and lists),
// exports it through the real dialog and the real `pdfExport:render`
// pipeline, then checks the printed document: every map fits the paper
// width, sits on white with dark ink, keeps no editor chrome, and never
// splits across a page. Writes the PDF, the print HTML and one PNG per
// page (pdftoppm) for a look.
// Usage: xvfb-run -a node tests/probes/concept-map-print-probe.mjs <outDir>
// (run `npm run build` first; the native sqlite module must be built for
// Electron: npx electron-rebuild -f -w better-sqlite3)
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-concept-map-print'));

const SMALL = [
  'Reserving',
  '  Chain Ladder',
  '    Mack',
  '    Bootstrap',
  '  Bornhuetter',
  '    Prior',
  '  Cape Cod',
].join('\n');

const branches = ['Exposure', 'Frequency', 'Severity', 'Trend', 'Development', 'Credibility'];
const RADIAL = ['Ratemaking', ...branches.flatMap((b) => [
  `  ${b}`,
  `    ${b} data sources and their limits`,
  `    Adjusting ${b.toLowerCase()} for changes`,
  `    Testing the ${b.toLowerCase()} assumption`,
])].join('\n');

const TOPDOWN = ['Loss Reserving Methods', ...['Chain Ladder', 'Bornhuetter-Ferguson', 'Cape Cod', 'Benktander', 'Expected Loss Ratio'].flatMap((b) => [
  `  ${b}`,
  '    Assumptions',
  '    Strengths',
  '    Weaknesses',
])].join('\n');

const RICH = [
  'Mack Model',
  '  **Assumption 1**\\n$E[C_{i,k+1} \\mid C_{i,1..k}] = f_k C_{i,k}$',
  '  **Assumption 2**\\n- Accident years independent\\n- Columns uncorrelated',
  '  Variance\\n$$\\mathrm{Var}(C_{i,k+1}) = \\sigma_k^2 C_{i,k}$$',
  '    `sigma_k` estimated from link ratios',
].join('\n');

const MAPS = [
  { src: SMALL, dir: 'right', name: 'small tree' },
  { src: RADIAL, dir: 'radial', name: 'wide radial' },
  { src: TOPDOWN, dir: 'down', name: 'wide top-down' },
  { src: RICH, dir: 'right', name: 'rich boxes' },
];

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_HIDDEN_PROBE: '1', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  return env;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-cmp-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-cmp-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction');
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false } } }));

  const app = await electron.launch({ args: ['.', '--mute-audio'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = [];
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Ollama|11434/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });
  let fails = 0;
  const check = (ok, what) => { if (!ok) fails++; console.log(`[probe] ${ok ? 'PASS' : 'FAIL'} ${what}`); };
  const run = (id, ...args) => page.evaluate(async ({ id, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    try { return await svc.executeCommand(id, ...args); } catch (e) { return `failed: ${String(e).slice(0, 160)}`; }
  }, { id, args });

  const pdfPath = path.join(outDir, 'maps.pdf');
  const htmlPath = path.join(outDir, 'maps.print.html');
  try {
    await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);

    // Main process: the save dialog answers with our path, and every print
    // document the export window loads is kept.
    await app.evaluate(({ ipcMain, app: eApp }, { pdfPath }) => {
      ipcMain.removeHandler('dialog:saveFile');
      ipcMain.handle('dialog:saveFile', () => pdfPath);
      globalThis.__printHtmlFiles = [];
      eApp.on('browser-window-created', (_e, w) => {
        w.webContents.on('did-finish-load', () => {
          const url = w.webContents.getURL();
          if (!url.startsWith('file:') || !url.includes('parallx-pdf-export')) return;
          w.webContents.executeJavaScript('document.documentElement.outerHTML')
            .then((html) => globalThis.__printHtmlFiles.push(`<!DOCTYPE html>\n${html}`)).catch(() => {});
        });
      });
    }, { pdfPath });

    const pageId = await run('canvas.saveConceptMap', SMALL, 'right');
    check(typeof pageId === 'string', `a page with a map opens (${pageId})`);
    await page.waitForSelector('.canvas-conceptmap .parallx-mindmap__node', { timeout: 15_000 });

    // The rest of the page: text around four maps.
    const setOk = await page.evaluate((maps) => {
      const pm = document.querySelector('.ProseMirror');
      const editor = pm?.editor;
      if (!editor) return false;
      const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
      const content = [];
      maps.forEach((m, i) => {
        content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Map ${i + 1}: ${m.name}` }] });
        content.push(para('A sentence of notes before the map, so the map sits in a flow of ordinary text the way it does on a study page.'));
        content.push({ type: 'conceptMap', attrs: { src: m.src, dir: m.dir, overrides: {}, layoutVersion: 2 } });
        content.push(para('A sentence after the map.'));
      });
      editor.commands.setContent({ type: 'doc', content });
      return true;
    }, MAPS);
    check(setOk, 'the page takes four maps');
    await page.waitForFunction(() => document.querySelectorAll('.canvas-conceptmap svg').length === 4, null, { timeout: 15_000 });
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: path.join(outDir, '00-canvas.png') }).catch(() => {});
    const natural = await page.$$eval('.canvas-conceptmap svg', (svgs) => svgs.map((s) => ({ w: s.viewBox.baseVal.width, h: s.viewBox.baseVal.height })));
    console.log(`[probe] natural map sizes: ${natural.map((n) => `${n.w}x${n.h}`).join(', ')}`);

    await run('canvas.exportPdf');
    await page.waitForSelector('.canvas-pdf-dialog', { timeout: 10_000 });
    await page.locator('.canvas-pdf-dialog button', { hasText: 'Export PDF' }).click();
    for (let i = 0; i < 60; i++) {
      if (await fs.stat(pdfPath).then((s) => s.size > 0).catch(() => false)) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(500);
    check(await fs.stat(pdfPath).then((s) => s.size > 0).catch(() => false), `the PDF is written (${pdfPath})`);

    const files = await app.evaluate(() => globalThis.__printHtmlFiles);
    const last = files[files.length - 1];
    check(!!last, 'the print document was captured');
    await fs.writeFile(htmlPath, last ?? '');

    // Pages as pictures.
    const { stdout: info } = await exec('pdfinfo', [pdfPath]);
    const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
    console.log(`[probe] ${pages} page(s)`);
    await exec('pdftoppm', ['-r', '110', '-png', pdfPath, path.join(outDir, 'page')]);

    // The print document, laid out at the A4 print width with print media
    // in a hidden window: check the maps the way the printer sees them.
    const measure = (blocks) => blocks.map((b) => {
      const svg = b.querySelector('svg');
      const r = svg?.getBoundingClientRect();
      const box = svg?.querySelector('.parallx-mindmap__box');
      const text = svg?.querySelector('.parallx-mindmap__text, .parallx-mindmap__flabel');
      const edge = svg?.querySelector('.parallx-mindmap__edge');
      const content = document.querySelector('.print-content').getBoundingClientRect();
      return {
        dir: b.querySelector('.parallx-mindmap')?.getAttribute('data-mindmap-dir'),
        width: r ? Math.round(r.width) : 0,
        height: r ? Math.round(r.height) : 0,
        contentWidth: Math.round(content.width),
        overflow: r ? Math.round(r.right - content.right) : 0,
        scale: svg ? Math.round((r.width / svg.viewBox.baseVal.width) * 100) / 100 : 0,
        bg: getComputedStyle(b).backgroundColor,
        boxFill: box ? getComputedStyle(box).fill : '',
        ink: text ? (text.tagName === 'text' ? getComputedStyle(text).fill : getComputedStyle(text).color) : '',
        edge: edge ? getComputedStyle(edge).stroke : '',
        chrome: document.querySelectorAll('.canvas-conceptmap__tools, .canvas-conceptmap__keys, .canvas-conceptmap__add, .parallx-mindmap__board, .canvas-conceptmap button').length,
        breakInside: getComputedStyle(b).breakInside,
      };
    });
    const report = await app.evaluate(async ({ BrowserWindow }, { file, fn }) => {
      const w = new BrowserWindow({ show: false, useContentSize: true, width: 680, height: 1000, webPreferences: { sandbox: true, contextIsolation: true } });
      try {
        await w.loadURL(file);
        w.webContents.debugger.attach();
        await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
        return await w.webContents.executeJavaScript(`(${fn})([...document.querySelectorAll('.canvas-conceptmap-print, .canvas-conceptmap')])`);
      } finally { w.destroy(); }
    }, { file: pathToFileURL(htmlPath).href, fn: measure.toString() });
    check(report.length === MAPS.length, `all ${MAPS.length} maps are in the print document (${report.length})`);
    report.forEach((r, i) => {
      const name = MAPS[i]?.name ?? `map ${i + 1}`;
      console.log(`[probe] ${name}: ${JSON.stringify(r)}`);
      check(r.overflow <= 0, `${name}: the map fits the paper width (${r.width}px of ${r.contentWidth}px)`);
      check(/rgba?\(255, 255, 255|rgba\(0, 0, 0, 0\)/.test(r.bg), `${name}: the block prints on white, not the dark board (${r.bg})`);
      check(r.boxFill && r.boxFill !== 'rgb(0, 0, 0)', `${name}: boxes keep their paper colour (${r.boxFill})`);
      check(r.ink && r.ink !== r.boxFill, `${name}: ink differs from paper (${r.ink})`);
      check(r.edge && r.edge !== 'none' && r.edge !== 'rgb(0, 0, 0)', `${name}: connectors draw (${r.edge})`);
      check(r.chrome === 0, `${name}: no tools, keys hint, add button or dot board in print`);
      check(r.breakInside === 'avoid', `${name}: the map never splits across pages`);
      check(r.scale >= 0.55, `${name}: prints at ${r.scale} of real size, ${MAPS[i]?.dir} asked, ${r.dir} printed`);
    });
  } finally {
    console.log(errors.length ? `[probe] ${errors.length} renderer error(s):\n  ${errors.join('\n  ')}` : '[probe] no renderer errors');
    console.log(`[probe] ${fails === 0 ? 'ALL PASS' : `${fails} FAILED`}`);
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
