// sheet-file-probe.mjs — a sheet of one's own, kept as a file.
//
// Boots the built app hidden with a new profile and workspace and checks,
// with real keys on the real engine, that:
//   - New Sheet makes a `.sheet` file in the workspace and opens it as a sheet;
//   - it has no exam limits (every function the engine has, a bigger grid);
//   - the grid grows as the selection nears its end, so an arrow never wraps;
//   - what is typed is in the file on disk a moment later;
//   - it is there after another tab was shown, and after the app was closed;
//   - a file that is not a sheet is refused and left untouched;
//   - a practice sheet is still the exam tool's sheet (150 by 40, its functions).
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/sheet-file-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
await fs.mkdir(path.join(repo, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(repo, 'test-results', 'sheet-file-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data/chromium-cache'), path.join(workspace, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
await fs.writeFile(path.join(workspace, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;

const problems = [];
const errors = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };
// The app writes a path with forward slashes on every system; node joins with the system's own (a backslash on Windows).
const samePath = (a, b) => a.replace(/\\/g, '/') === b.replace(/\\/g, '/');

let app; let page;
async function launch() {
  app = await electron.launch({ args: ['.', '--mute-audio', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 900); });
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
}
const run = (id, ...args) => page.evaluate(({ id, args }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args), { id, args });
const sheetUp = async () => { await page.waitForFunction(() => !!document.querySelector('.ws-pane__sheet')?.__wsHost, null, { timeout: 60000 }); await page.waitForTimeout(2500); };
const host = (fn, ...a) => page.evaluate(({ fn, a }) => document.querySelector('.ws-pane__sheet').__wsHost[fn](...a), { fn, a });
const meta = () => page.evaluate(() => { const snap = document.querySelector('.ws-pane__sheet').__wsHost.getSnapshot(); const s = snap.sheets[snap.sheetOrder[0]]; return { rows: s.rowCount, columns: s.columnCount }; });
const wait = (ms) => page.waitForTimeout(ms);
const key = async (k) => { await page.keyboard.press(k); await wait(160); };
const type = async (t) => { await page.keyboard.type(t, { delay: 25 }); await wait(200); };
const clickCell = async (r, c) => {
  const g = await page.evaluate(() => { const el = document.querySelector('.ws-pane__sheet'); const cv = [...el.querySelectorAll('canvas')].find((k) => k.id.startsWith('univer-sheet-main-canvas')); const b = cv.getBoundingClientRect(); const snap = el.__wsHost.getSnapshot(); const s = snap.sheets[snap.sheetOrder[0]]; return { x: b.left, y: b.top, rh: s.rowHeader.width, ch: s.columnHeader.height, cw: s.defaultColumnWidth, rw: s.defaultRowHeight }; });
  await page.mouse.click(g.x + g.rh + c * g.cw + g.cw / 2, g.y + g.ch + r * g.rw + g.rw / 2); await wait(200);
};
const fileText = (p) => fs.readFile(p, 'utf8');

try {
  await launch();

  // A practice sheet first: the exam tool's sheet, as before.
  await run('worksheet.openScratch'); await sheetUp();
  const exam = { ...(await meta()), executors: (await host('probeState')).executors };
  check('a practice sheet is still 150 by 40', exam.rows === 150 && exam.columns === 40, exam);

  // New Sheet, named: a file in the workspace, opened as a sheet.
  const filePath = await run('worksheet.newSheet', 'Budget 2026');
  check('New Sheet returns the path of a .sheet file in the workspace', typeof filePath === 'string' && samePath(filePath, path.join(workspace, 'Budget 2026.sheet')), filePath);
  await page.waitForFunction(() => document.querySelector('.ws-pane__sheet')?.__wsHost?.getSnapshot()?.sheets && [...document.querySelectorAll('[role="tab"], .editor-tab')].some((t) => /Budget 2026/.test(t.textContent ?? '')), null, { timeout: 30000 }).catch(() => {});
  await sheetUp();
  const tabNames = () => page.evaluate(() => [...document.querySelectorAll('[role="tab"], .editor-tab')].map((t) => (t.textContent ?? '').trim()).filter((t) => /Budget/.test(t)));
  check('the file opens in a tab under its name', (await tabNames()).some((t) => /Budget 2026/.test(t)), await tabNames());
  const free = { ...(await meta()), executors: (await host('probeState')).executors };
  check('the sheet starts at 1,000 rows by 52 columns', free.rows === 1000 && free.columns === 52, free);
  // The engine today has no function outside the exam's list, so the counts are equal; fewer would mean one was taken away.
  check('the sheet has every function the engine has', free.executors >= exam.executors && free.executors > 400, { free: free.executors, exam: exam.executors });
  check('the file on disk is a sheet file', /"format":"parallx-sheet"/.test(await fileText(filePath)), (await fileText(filePath)).slice(0, 80));

  // Work in it with real keys.
  await clickCell(0, 0); await type('Rent'); await key('Tab'); await type('1850'); await key('Enter');
  await type('Food'); await key('Tab'); await type('612.4'); await key('Enter');
  await clickCell(2, 1); await type('=SUM(B1:B2)'); await key('Enter');
  await wait(500);
  check('a typed formula computes', (await host('probeReadValue', 2, 1)) === 2462.4, await host('probeReadValue', 2, 1));
  await wait(3500);
  { const t = await fileText(filePath); check('what was typed is in the file a moment later', /Rent/.test(t) && /=SUM\(B1:B2\)/.test(t), t.slice(0, 200)); }

  // The grid grows; an arrow at the old end does not wrap.
  await clickCell(0, 3); await key('Control+ArrowDown'); await wait(500);
  const atEnd = (await host('probeState')).activeCell;
  const grown = await meta();
  await key('ArrowDown');
  const past = (await host('probeState')).activeCell;
  check('Ctrl+Down in an empty column reaches row 1000, and the sheet grows', atEnd === 'D1000' && grown.rows > 1000, { atEnd, grown });
  check('an arrow past the old last row goes on, it does not wrap', past === 'D1001', past);
  await host('scrollToCell', 0, 0); await wait(300);
  await clickCell(0, 3); await key('Control+ArrowRight'); await wait(500);
  const colEnd = (await host('probeState')).activeCell; const grownCols = await meta();
  check('Ctrl+Right in an empty row reaches the last column, and the sheet grows', colEnd === 'AZ1' && grownCols.columns > 52, { colEnd, grownCols });
  await host('scrollToCell', 0, 0); await wait(300);
  // Undo takes back the last entry, not the growth of the grid.
  await clickCell(5, 0); await type('undo me'); await key('Enter'); await key('Control+z'); await wait(400);
  const afterUndo = await meta();
  check('Undo takes back the entry and leaves the grid as large', (await host('probeReadValue', 5, 0)) == null && afterUndo.rows === grown.rows, { value: await host('probeReadValue', 5, 0), afterUndo });
  await page.screenshot({ path: path.join(shots, 'sheet-file.png') });

  // Another tab shown, then back.
  await run('worksheet.open'); await wait(1500);
  await run('file.openFile', filePath); await sheetUp();
  check('the sheet is as it was after another tab was shown', (await host('probeReadValue', 0, 0)) === 'Rent' && (await host('probeReadValue', 2, 1)) === 2462.4, [await host('probeReadValue', 0, 0), await host('probeReadValue', 2, 1)]);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.editor-tab, [role="tab"]')].filter((t) => /Budget 2026/.test(t.textContent ?? '')).length);
  check('opening the file again shows its tab, it does not open a second', tabs === 1, tabs);

  // A second sheet with the same name gets its own file.
  const second = await run('worksheet.newSheet', 'Budget 2026'); await sheetUp();
  check('a second sheet of the same name gets its own file', typeof second === 'string' && samePath(second, path.join(workspace, 'Budget 2026 2.sheet')), second);
  await wait(800);

  // Closed and opened again.
  await app.close().catch(() => {});
  { const t = await fileText(filePath); check('after the app closes the file holds the work', /Rent/.test(t) && /612\.4/.test(t), t.slice(0, 160)); }
  const before = await fileText(filePath);
  const junk = path.join(workspace, 'Not a sheet.sheet');
  await fs.writeFile(junk, 'this is not a workbook');
  await launch();
  await run('file.openFile', filePath); await sheetUp();
  check('the sheet is as it was after the app was closed and opened', (await host('probeReadValue', 0, 0)) === 'Rent' && (await host('probeReadValue', 2, 1)) === 2462.4, [await host('probeReadValue', 0, 0), await host('probeReadValue', 2, 1)]);
  await wait(3500);
  check('merely opening the sheet does not rewrite its file', (await fileText(filePath)) === before, 'the file changed');

  // A file that is not a sheet: refused, untouched.
  await run('file.openFile', junk); await wait(4000);
  const refusal = await page.evaluate(() => [...document.querySelectorAll('.ws-pane')].map((e) => e.textContent).join(' '));
  check('a file that is not a sheet is refused in words', /could not be opened as a sheet/.test(refusal), refusal);
  await wait(2500);
  check('and it is left as it was on disk', (await fileText(junk)) === 'this is not a workbook', await fileText(junk));
  await page.screenshot({ path: path.join(shots, 'sheet-refused.png') });
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`);
  problems.push('the probe stopped');
  try { await page.screenshot({ path: path.join(shots, 'stopped.png') }); } catch { /* no window */ }
} finally {
  await app?.close().catch(() => {});
}
console.log(`\n[probe] page errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length ? 1 : 0;
