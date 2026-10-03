// worksheet-formula-lexer-probe.mjs — a stray bracket must not break later formulas.
//
// Mufaro, 2026-10-03: during a long quiz a clicked reference stayed black,
// Enter gave #NAME? or #VALUE!, retyping failed the same way, and only a
// restart brought the number back. Cause: one parse of a formula holding a
// `[` or `]` left the engine's lexer bracket count wrong for good
// (formulaEngineGuards.ts). This probe opens a Scratch Sheet in the built app
// with a new profile and workspace, types like a person (insertText into the
// cell editor), puts a stray `[` into one formula and cancels it, then types
// fresh formulas and reads what they compute. Screenshots of the editor
// show whether references are coloured.
//   node scripts/build.mjs && xvfb-run -a node tests/probes/worksheet-formula-lexer-probe.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
const root = await fs.mkdtemp(path.join(repo, 'test-results', 'formula-lexer-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data/chromium-cache'), path.join(workspace, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
await fs.writeFile(path.join(workspace, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));

const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
const results = [];
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'warning' && /formula error|engine guards/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 900); });
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
  await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('worksheet.openScratch'));
  await page.waitForFunction(() => !!document.querySelector('.ws-pane__sheet')?.__wsHost, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  const host = (fn, ...a) => page.evaluate(({ fn, a }) => document.querySelector('.ws-pane__sheet').__wsHost[fn](...a), { fn, a });
  const insertText = (text) => app.evaluate(({ BrowserWindow }, t) => BrowserWindow.getAllWindows()[0].webContents.insertText(t), text);
  const state = await host('probeState');
  console.log('[probe] guards:', JSON.stringify(state.guards));

  await host('setCellText', 0, 0, '2');
  await host('setCellText', 0, 1, '3');
  await page.waitForTimeout(400);

  /** Type into a cell like a person, then press Enter (or Escape to cancel). */
  const type = async (row, col, text, { cancel = false, shot = '' } = {}) => {
    await host('probeActivate', row, col);
    await page.waitForTimeout(150);
    await host('probeStartEditing');
    await page.waitForTimeout(250);
    for (const ch of text) { await insertText(ch); await page.waitForTimeout(25); }
    await page.waitForTimeout(400);
    if (shot) await page.screenshot({ path: path.join(shots, shot), clip: { x: 0, y: 0, width: 1440, height: 420 } });
    await page.keyboard.press(cancel ? 'Escape' : 'Enter');
    await page.waitForTimeout(700);
  };
  const read = async (label, row, col, want) => {
    const got = await host('probeReadValue', row, col);
    results.push({ label, want, got, ok: got === want });
    console.log(`[probe] ${label}: ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  };

  await type(0, 2, '=A1*B1', { shot: 'before-editing.png' });
  await read('before the stray bracket: C1 =A1*B1', 0, 2, 6);
  await type(0, 3, '=A1[', { cancel: true });
  console.log('[probe] typed =A1[ in D1 and cancelled');
  await type(1, 2, '=A1*B1+1', { shot: 'after-editing.png' });
  await read('after: C2 =A1*B1+1', 1, 2, 7);
  await type(2, 2, '=SUM(A1:B1)');
  await read('after: C3 =SUM(A1:B1)', 2, 2, 5);
  await type(3, 2, '=ROUND(A1/B1,2)');
  await read('after: C4 =ROUND(A1/B1,2)', 3, 2, 0.67);
  // A sum range shorter than the range is stretched by SUMIF in place; the
  // stretch must stay inside that call, including in a full recalculation.
  await type(4, 2, '=SUMIF(A1:B1,">2",A1)');
  await read('SUMIF with a one-cell sum range: C5', 4, 2, 3);
  await type(5, 2, '=A1*10');
  await host('probeRecalculate');
  await page.waitForTimeout(1200);
  await read('after a full recalculation: C5', 4, 2, 3);
  await read('after a full recalculation: C6 =A1*10', 5, 2, 20);
  await page.screenshot({ path: path.join(shots, 'sheet.png') });
} finally {
  console.log(`[probe] shots: ${shots}`);
  console.log(`[probe] engine warnings and page errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
  console.log(`[probe] ${results.filter((r) => r.ok).length}/${results.length} formulas computed`);
  await app.close().catch(() => {});
}
