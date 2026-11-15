// sheet-file-verify-probe.mjs — an independent check of "a sheet of one's own, kept as a file".
//
// Written by a reviewer who did not build the piece, from what the piece is
// said to do. Boots the built app hidden with a new profile and workspace,
// acts with real mouse and keys, and reads back from the engine and from the
// file on disk. Every phase runs on its own, so one that stops does not hide
// the rest.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/sheet-file-verify-probe.mjs [outDir]
//
// PARALLX_PROBE_REPO=<checkout> runs it against another checkout's build (the
// commit before the piece: every check of the piece must fail there).
// PARALLX_PROBE_FIXTURE=<a .sheet file> stands in where that build cannot make one.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const here = path.resolve(import.meta.dirname, '../..');
const repo = process.env.PARALLX_PROBE_REPO ? path.resolve(process.env.PARALLX_PROBE_REPO) : here;
const fixture = process.env.PARALLX_PROBE_FIXTURE || '';
await fs.mkdir(path.join(here, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(here, 'test-results', 'sheet-verify-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
const downloads = path.join(root, 'downloads');
for (const d of [path.join(appRoot, 'data/chromium-cache'), path.join(workspace, '.parallx'), shots, downloads]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
await fs.writeFile(path.join(workspace, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
await fs.writeFile(path.join(workspace, 'notes.txt'), 'plain notes\n');
const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;

const problems = [];
const notes = [];
const errors = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };
const note = (text) => { console.log(` note ${text}`); notes.push(text); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let app; let page;
/** Start the app. `asAPerson` starts it outside test mode: the window's close then goes the way it does for him (the app's own shutdown), and nothing of the workbench is exposed, so only mouse, keys and the page can be used. */
async function launch(asAPerson = false) {
  const launchEnv = { ...env }; if (asAPerson) delete launchEnv.PARALLX_TEST_MODE;
  app = await electron.launch({ args: ['.', '--mute-audio', '--no-sandbox', '--disable-gpu'], cwd: repo, env: launchEnv, timeout: 90000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('crash', () => console.log(`  !! the page crashed (${new Date().toISOString()})`));
  app.process().on('exit', (code, signal) => console.log(`  .. the app process ended: code ${code}, signal ${signal} (${new Date().toISOString()})`));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 900); });
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  if (!asAPerson) await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  // A download is saved where the probe can read it (a person would be asked, or find it in Downloads).
  await app.evaluate(({ session }, dir) => {
    globalThis.__dl = [];
    session.defaultSession.on('will-download', (_e, item) => {
      const f = `${dir}/${Date.now()}-${item.getFilename()}`;
      item.setSavePath(f);
      const rec = { name: item.getFilename(), file: f, state: 'started' };
      globalThis.__dl.push(rec);
      item.once('done', (_e2, st) => { rec.state = st; });
    });
  }, downloads);
}
/** Run a command by id. One that has not returned in 20 seconds (a dialog nobody can answer here) is given up on. */
const run = (id, ...args) => Promise.race([
  page.evaluate(({ id, args }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args), { id, args }),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`the command ${id} did not return in 20 seconds`)), 20000)),
]);
const runSafe = (id, ...args) => run(id, ...args).then((v) => ({ value: v }), (e) => ({ error: String(e?.message ?? e).slice(0, 200) }));
const wait = (ms) => page.waitForTimeout(ms);
const key = async (k) => { await page.keyboard.press(k); await wait(160); };
const type = async (t) => { await page.keyboard.type(t, { delay: 25 }); await wait(200); };
const scene = () => page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'IIntrospectionService' }).describeScene());
const flat = (d) => { const out = []; const walk = (n, p) => { out.push({ id: n.id, label: n.label, parent: p }); for (const c of n.children ?? []) walk(c, n.id); }; for (const s of d.surfaces) walk(s); return out; };
const messages = () => page.evaluate(() => { const svc = window.__parallx_workbench__._services.get({ id: 'INotificationService' }); const out = (svc?.history ?? []).map((n) => n.message); svc?.clearHistory?.(); return out; });
const tabs = () => page.evaluate(() => [...document.querySelectorAll('.ui-tab')].map((t) => (t.querySelector('.ui-tab-label')?.textContent ?? t.textContent ?? '').trim()));
const activeTab = () => page.evaluate(() => (document.querySelector('.ui-tab--active .ui-tab-label')?.textContent ?? '').trim());
const hasSheet = () => page.evaluate(() => !!document.querySelector('.ws-pane__sheet')?.__wsHost);
/** What the editor area shows: a live sheet, a text editor (its first characters), or a pane's words. */
const editorShows = () => page.evaluate(() => {
  const part = document.querySelector('[data-part-id="workbench.parts.editor"]');
  const visible = (e) => !!e && e.getClientRects().length > 0;
  const sheet = [...part.querySelectorAll('.ws-pane__sheet')].find(visible);
  const text = [...part.querySelectorAll('textarea.text-editor-textarea')].find(visible);
  return { sheet: !!sheet?.__wsHost, text: text ? text.value.slice(0, 60) : null, words: [...part.querySelectorAll('.ws-pane')].filter(visible).map((e) => (e.querySelector('canvas') ? '' : e.textContent ?? '')).join(' ').trim().slice(0, 240) };
});
const sheetUp = async (label) => {
  await page.waitForFunction((label) => {
    const el = document.querySelector('.ws-pane__sheet');
    const active = (document.querySelector('.ui-tab--active .ui-tab-label')?.textContent ?? '').trim();
    return !!el?.__wsHost?.getSnapshot() && !!el.querySelector('canvas') && (!label || active === label);
  }, label ?? null, { timeout: 30000 });
  await wait(2800);
};
const host = (fn, ...a) => page.evaluate(({ fn, a }) => document.querySelector('.ws-pane__sheet').__wsHost[fn](...a), { fn, a });
const cell = (r, c) => host('probeReadValue', r, c);
const active = async () => (await host('probeState')).activeCell;
const grid = () => page.evaluate(() => { const snap = document.querySelector('.ws-pane__sheet').__wsHost.getSnapshot(); const s = snap.sheets[snap.sheetOrder[0]]; return { rows: s.rowCount, columns: s.columnCount }; });
const cellPoint = (r, c) => page.evaluate(({ r, c }) => {
  const el = document.querySelector('.ws-pane__sheet'); const cv = [...el.querySelectorAll('canvas')].find((k) => k.id.startsWith('univer-sheet-main-canvas'));
  const b = cv.getBoundingClientRect(); const snap = el.__wsHost.getSnapshot(); const s = snap.sheets[snap.sheetOrder[0]];
  return { x: b.left + s.rowHeader.width + c * s.defaultColumnWidth + s.defaultColumnWidth / 2, y: b.top + s.columnHeader.height + r * s.defaultRowHeight + s.defaultRowHeight / 2 };
}, { r, c });
const clickCell = async (r, c) => { const p = await cellPoint(r, c); await page.mouse.click(p.x, p.y); await wait(200); };
const clickEl = async (selector, textIs) => {
  const box = await page.evaluate(({ selector, textIs }) => {
    const els = [...document.querySelectorAll(selector)].filter((e) => (textIs != null || e.getClientRects().length) && (textIs == null || (e.textContent ?? '').trim() === textIs));
    const el = els[els.length - 1]; if (!el) return null; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, { selector, textIs: textIs ?? null });
  if (!box) return false;
  await page.mouse.click(box.x, box.y); await wait(500); return true;
};
/** The Explorer in the sidebar; its icon is clicked only when the file tree is not showing (a click on the active icon hides the sidebar). */
const showExplorer = async () => { const up = () => page.evaluate(() => [...document.querySelectorAll('.explorer-tree')].some((e) => e.getClientRects().length)); if (!(await up())) { await clickEl('[data-px-id="activitybar.explorer-container"]'); await wait(900); } return up(); };
const clickTab = (label) => clickEl('.ui-tab .ui-tab-label', label);
const closeTab = async (label) => { if (!(await clickTab(label))) return false; await wait(300); if ((await activeTab()) !== label) { await clickTab(label); await wait(400); } if ((await activeTab()) !== label) return false; await run('workbench.action.closeActiveEditor'); await wait(700); return true; };
/** Back to one editor group: a phase that split the editor leaves two, and the helpers here read the first sheet and the first active tab they find. */
const oneGroup = async () => { for (let i = 0; i < 30; i++) { const groups = await page.evaluate(() => document.querySelectorAll('.ui-tab--active').length); if (groups <= 1) return; await run('workbench.action.focusSecondEditorGroup'); await wait(300); await run('workbench.action.closeActiveEditor'); await wait(600); } };
const closeSheetTabs = async () => { await oneGroup(); for (let i = 0; i < 20; i++) { const t = (await tabs()).find((x) => x.endsWith('.sheet')); if (!t) return; if (!(await closeTab(t))) return; } };
/** The rows of the menu now open, by label. */
const menuLabels = async () => { const menus = (await scene()).surfaces.filter((s) => s.id === 'contextMenu'); return (menus[menus.length - 1]?.children ?? []).map((r) => ({ id: r.id, label: r.label })); };
const pickMenuRow = async (label) => { const row = (await menuLabels()).find((r) => r.label === label); if (!row) return false; return clickEl(`[data-px-id="${row.id}"]`); };
const inputBoxOpen = () => page.evaluate(() => { const box = document.querySelector('[data-px-surface="inputBox"]'); return box ? { label: box.getAttribute('aria-label'), value: box.querySelector('input')?.value ?? null } : null; });
const sheetFiles = async () => (await fs.readdir(workspace)).filter((n) => n.endsWith('.sheet')).sort();
const stat = async (p) => { const s = await fs.stat(p); return { bytes: (await fs.readFile(p)).toString('base64'), mtime: s.mtimeMs }; };
const sameFile = (a, b) => a.bytes === b.bytes && a.mtime === b.mtime;
const fileText = (p) => fs.readFile(p, 'utf8').catch(() => '');
/** How long until the file holds `re`, in ms; -1 when it never did within `ms`. */
const untilFile = async (p, re, ms, t0 = Date.now()) => { while (Date.now() - t0 < ms) { if (re.test(await fileText(p))) return Date.now() - t0; await sleep(40); } return -1; };
/** How the sheet is painted: the app's mode, the engine's dark class, and the brightness (0 to 255) of an empty stretch of the grid in a capture of the window. */
const sheetLook = async () => {
  const dom = await page.evaluate(() => ({ mode: document.documentElement.getAttribute('data-px-mode') ?? 'dark', engineDark: document.documentElement.classList.contains('univer-dark') }));
  const p = await cellPoint(14, 6);
  const lum = await app.evaluate(async ({ BrowserWindow }, rect) => {
    const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage(rect);
    const d = img.toBitmap(); let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.0722 * d[i] + 0.7152 * d[i + 1] + 0.2126 * d[i + 2];
    return d.length ? Math.round(sum / (d.length / 4)) : null;
  }, { x: Math.round(p.x - 30), y: Math.round(p.y - 6), width: 60, height: 12 });
  return { ...dom, lum };
};
const setMode = async (mode) => { await run('settings.openAppearance'); await wait(900); const ok = await clickEl(`[data-px-id="appearance.mode.${mode}"]`); await wait(700); await key('Escape'); await wait(500); return ok; };
const setTool = (on) => page.evaluate(async (on) => { try { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx.worksheet', on); return true; } catch (e) { return String(e?.message ?? e); } }, on);
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) }).catch(() => {});
const only = (process.env.PARALLX_PROBE_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const phase = async (name, fn) => {
  if (only.length && !only.some((o) => name.startsWith(o))) return;
  console.log(`\n[${name}]`);
  if (!page || page.isClosed()) { console.log('  the app was not running at the start of this phase: started again'); problems.push(`${name}: the app had gone`); await app?.close().catch(() => {}); await launch(); }
  try { await fn(); const said = await messages().catch(() => []); if (said.length) console.log(`       the app said: ${JSON.stringify(said)}`); } catch (err) { console.log(`  phase stopped: ${String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ')}`); problems.push(`${name}: the phase stopped`); await shot(`stopped-${name.replace(/\W+/g, '-')}`); try { await page.keyboard.press('Escape'); } catch { /* no window */ } }
};
/** Make a sheet by the command; on a build without it, put the fixture there and open that. */
const makeSheet = async (name) => {
  const made = await runSafe('worksheet.newSheet', name);
  if (typeof made.value === 'string') return made.value;
  if (!fixture) throw new Error(`worksheet.newSheet did not make a file: ${JSON.stringify(made)}`);
  const target = path.join(workspace, `${name}.sheet`);
  await fs.copyFile(fixture, target);
  await run('file.openFile', target);
  return target;
};

const budget = path.join(workspace, 'Budget 2026.sheet');
/** The sheet the later phases read, made by hand when an earlier phase did not run. */
const ensureBudget = async () => {
  if (await fs.stat(budget).then(() => true, () => false)) return;
  await makeSheet('Budget 2026'); await sheetUp('Budget 2026.sheet');
  await clickCell(0, 0); await type('Rent'); await key('Tab'); await type('1850'); await key('Enter');
  await type('Food'); await key('Tab'); await type('612.4'); await key('Enter');
  await clickCell(2, 1); await type('=SUM(B1:B2)'); await key('Enter');
  await clickCell(0, 3); await key('Control+ArrowDown'); await key('ArrowDown'); await type('deep'); await key('Enter');
  await host('scrollToCell', 0, 0); await wait(3000);
};
let practice = null;

try {
  await launch();

  await phase('7 a practice sheet is as before', async () => {
    await run('worksheet.openScratch'); await sheetUp();
    practice = { ...(await grid()), look: await sheetLook() };
    check('a practice sheet is 150 rows by 40 columns', practice.rows === 150 && practice.columns === 40, practice);
    await clickCell(0, 2); await key('Control+ArrowDown'); await wait(400);
    const end = await active(); await key('ArrowDown'); await wait(300);
    const after = await grid();
    check('Ctrl+Down on a practice sheet ends at row 150 and the sheet does not grow', end === 'C150' && after.rows === 150 && after.columns === 40, { end, after, then: await active() });
    await shot('practice-sheet');
    await host('scrollToCell', 0, 0); await wait(300);
    await clickCell(3, 0); await type('Half practice');
    await clickTab('Welcome'); await wait(900); await clickTab('Scratch Sheet'); await sheetUp('Scratch Sheet');
    note(`for comparison, on a practice sheet an entry still being typed when the tab is left comes back as ${JSON.stringify(await cell(3, 0))}`);
  });

  await phase('1 New Sheet by command, named', async () => {
    await messages();
    const before = await sheetFiles();
    const made = await runSafe('worksheet.newSheet', 'Budget 2026');
    const box = await inputBoxOpen();
    check('worksheet.newSheet with a name returns the path of Name.sheet in the workspace folder', made.value === budget, made);
    check('and asks nothing on the way', typeof made.value === 'string' && box === null, { made: made.value ?? made.error, box });
    const text = await fileText(budget);
    check('the file is on disk, and is the only new one', text.length > 0 && JSON.stringify(await sheetFiles()) === JSON.stringify([...before, 'Budget 2026.sheet'].sort()), { text: text.slice(0, 80), files: await sheetFiles() });
    await sheetUp('Budget 2026.sheet');
    check('it opens in a tab under its name, as a live sheet', (await activeTab()) === 'Budget 2026.sheet' && (await editorShows()).sheet, { tab: await activeTab(), shows: await editorShows() });
  });

  await phase('3 the grid: 1,000 by 52, and it grows', async () => {
    if (!(await hasSheet()) || (await activeTab()) !== 'Budget 2026.sheet') { await makeSheet('Budget 2026'); await sheetUp('Budget 2026.sheet'); }
    const start = await grid();
    check('a sheet file starts at 1,000 rows by 52 columns', start.rows === 1000 && start.columns === 52, start);
    await clickCell(0, 3); await key('Control+ArrowDown'); await wait(500);
    const atEnd = await active(); const grown = await grid();
    await key('ArrowDown'); const past = await active();
    check('Ctrl+Down in an empty column stops at row 1000', atEnd === 'D1000', atEnd);
    check('the next Down arrow goes to row 1001, it does not wrap to the top', past === 'D1001', past);
    check('the sheet has more rows than it started with', grown.rows > 1000, grown);
    await type('deep'); await key('Enter');
    check('a value typed past the old last row is held', (await cell(1000, 3)) === 'deep', await cell(1000, 3));
    await key('Control+ArrowDown'); await wait(500);
    const second = await active(); await key('ArrowDown'); const pastSecond = await active(); const grownTwice = await grid();
    check('a second time: the new end is reached and passed the same way', second === `D${grown.rows}` && pastSecond === `D${grown.rows + 1}` && grownTwice.rows > grown.rows, { second, pastSecond, grownTwice });
    await host('scrollToCell', 0, 0); await wait(300);
    await clickCell(0, 3); await key('Control+ArrowRight'); await wait(500);
    const colEnd = await active(); await key('ArrowRight'); const colPast = await active(); const cols = await grid();
    check('Ctrl+Right in an empty row stops at column AZ, and the next Right arrow goes to BA', colEnd === 'AZ1' && colPast === 'BA1' && cols.columns > 52, { colEnd, colPast, cols });
    await host('scrollToCell', 0, 0); await wait(300);
  });

  await phase('4 it saves itself', async () => {
    const blank = await fileText(budget);
    if (/Rent|SUM\(B1:B2\)|"T0"|Leave0/.test(blank)) throw new Error('the file already holds the words this phase is about to type');
    await clickCell(0, 0); await type('Rent'); await key('Tab'); await type('1850'); await key('Enter');
    await type('Food'); await key('Tab'); await type('612.4'); await key('Enter');
    await clickCell(2, 1); await type('=SUM(B1:B2)');
    await page.keyboard.press('Enter'); const t0 = Date.now();
    const took = await untilFile(budget, /=SUM\(B1:B2\)/, 6000, t0);
    // Read until it is there, for two seconds at most: the first run of this probe read the cell 44 ms after Enter, before the engine had computed it, and failed with the right number.
    let sum; for (let i = 0; i < 20 && (sum = await cell(2, 1)) !== 2462.4; i++) await wait(100);
    check('a typed formula computes', sum === 2462.4, sum);
    check('a change is in the file within about 1.5 seconds (3 at most), nothing else done', took >= 0 && took <= 3000, { ms: took });
    console.log(`       the formula was in the file ${took} ms after Enter`);
    const times = [];
    for (const [i, pause] of [300, 800, 1300].entries()) {
      await wait(2200 + pause);
      await clickCell(20 + i, 5); await page.keyboard.type(`T${i}`, { delay: 20 });
      await page.keyboard.press('Enter'); const t = Date.now();
      times.push(await untilFile(budget, new RegExp(`"T${i}"`), 6000, t));
    }
    check('three more changes, each alone: every one is in the file within 2 seconds', times.every((ms) => ms >= 0 && ms <= 2000), times);
    console.log(`       ms from Enter to the file: ${times.join(', ')}`);
    const text = await fileText(budget);
    check('the file holds what was typed, and the value typed at row 1001', /Rent/.test(text) && /612\.4/.test(text) && /deep/.test(text), text.slice(0, 160));

    // Leaving the tab: three times, at different moments of the 1.5 s timer, the change is read at once.
    const left = [];
    for (const [i, pause] of [0, 500, 1000].entries()) {
      await wait(pause);
      await clickCell(4 + i, 0); await type(`Leave${i}`);
      await page.keyboard.press('Enter'); const t = Date.now();
      await clickTab('Welcome');
      left.push(await untilFile(budget, new RegExp(`Leave${i}`), 700, t));
      await clickTab('Budget 2026.sheet'); await sheetUp('Budget 2026.sheet');
    }
    check('a change made just before leaving the tab is in the file at once (3 of 3)', left.every((ms) => ms >= 0), left);
    check('back on the tab, the sheet is as it was', (await cell(0, 0)) === 'Rent' && (await cell(2, 1)) === 2462.4 && (await cell(6, 0)) === 'Leave2' && (await cell(1000, 3)) === 'deep', [await cell(0, 0), await cell(2, 1), await cell(6, 0), await cell(1000, 3)]);
    check('the file has one tab, not two', (await tabs()).filter((t) => t === 'Budget 2026.sheet').length === 1, await tabs());
    await shot('sheet-file-dark');
    const tipOf = async (label) => {
      const before = await page.evaluate(() => new Set([...document.body.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.getClientRects().length).map((e) => e.textContent.trim())).size);
      const b = await page.evaluate((label) => { const el = [...document.querySelectorAll('.ui-tab .ui-tab-label')].find((e) => e.textContent.trim() === label); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, label);
      await page.mouse.move(b.x - 3, b.y); await page.mouse.move(b.x, b.y); await wait(1500);
      const tip = await page.evaluate(() => [...document.body.querySelectorAll('[role="tooltip"], [class*="tooltip"], [class*="hover-widget"], [class*="px-tip"]')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()).filter(Boolean));
      await page.mouse.move(700, 500); await wait(400);
      return { tip, before };
    };
    await run('file.openFile', path.join(workspace, 'notes.txt')); await wait(1000);
    const textTip = await tipOf('notes.txt'); const sheetTip = await tipOf('Budget 2026.sheet');
    note(`hovering a tab shows: notes.txt ${JSON.stringify(textTip.tip)}; Budget 2026.sheet ${JSON.stringify(sheetTip.tip)}`);
    await closeTab('notes.txt'); await clickTab('Budget 2026.sheet'); await sheetUp('Budget 2026.sheet');

    // An entry still being typed when the tab is left.
    await clickCell(8, 0); await type('Half typed');
    await clickTab('Welcome'); await wait(900);
    const half = /Half typed/.test(await fileText(budget));
    await clickTab('Budget 2026.sheet'); await sheetUp('Budget 2026.sheet');
    const halfCell = await cell(8, 0);
    note(`an entry still being typed when the tab is left: in the file ${half}, on the sheet afterwards ${JSON.stringify(halfCell)}`);
    check('an entry still being typed when the tab is left is not lost', half || halfCell === 'Half typed', { inFile: half, onSheet: halfCell });

    // Closed and opened again.
    await closeTab('Budget 2026.sheet');
    check('closing the tab closes the sheet', !(await tabs()).includes('Budget 2026.sheet'), await tabs());
    await run('file.openFile', budget); await sheetUp('Budget 2026.sheet');
    check('closed and opened again, it is as it was', (await cell(0, 0)) === 'Rent' && (await cell(1, 1)) === 612.4 && (await cell(2, 1)) === 2462.4 && (await cell(1000, 3)) === 'deep', [await cell(0, 0), await cell(1, 1), await cell(2, 1), await cell(1000, 3)]);
  });

  await phase('4 merely opening writes nothing', async () => {
    await closeTab('Budget 2026.sheet'); await wait(1200);
    const before = await stat(budget);
    await run('file.openFile', budget); await sheetUp('Budget 2026.sheet'); await wait(4000);
    check('opened and left open 7 seconds: the file is byte for byte the same and was not written', sameFile(before, await stat(budget)), { sameBytes: before.bytes === (await stat(budget)).bytes, mtimeBefore: before.mtime, mtimeAfter: (await stat(budget)).mtime });
    await clickTab('Welcome'); await wait(1200);
    check('and after leaving the tab', sameFile(before, await stat(budget)), { sameBytes: before.bytes === (await stat(budget)).bytes });
    await clickTab('Budget 2026.sheet'); await sheetUp('Budget 2026.sheet');
    await closeTab('Budget 2026.sheet'); await wait(1200);
    check('and after opening it a second time and closing the tab', sameFile(before, await stat(budget)), { sameBytes: before.bytes === (await stat(budget)).bytes });
    // Looking around: a click and arrows, no entry.
    await run('file.openFile', budget); await sheetUp('Budget 2026.sheet');
    await clickCell(3, 4); await key('ArrowDown'); await key('ArrowRight'); await wait(2500);
    await clickTab('Welcome'); await wait(1200);
    note(`clicking a cell and moving with arrows, no entry: the file was ${sameFile(before, await stat(budget)) ? 'not written' : 'written again'}`);

    // Something else rewrites the file while its tab is open and untouched (a sync, a pull).
    await clickTab('Budget 2026.sheet'); await sheetUp('Budget 2026.sheet');
    const mine = await fs.readFile(budget);
    const theirs = Buffer.from(mine.toString('utf8').replace('Rent', 'Lease'));
    await fs.writeFile(budget, theirs); await wait(4000);
    const shown = await cell(0, 0);
    await clickTab('Welcome'); await wait(1200);
    const kept = (await fs.readFile(budget)).equals(theirs);
    await clickTab('Budget 2026.sheet'); await sheetUp('Budget 2026.sheet');
    note(`the file rewritten by another program while its tab is open and untouched: the open tab went on showing ${JSON.stringify(shown)}; after leaving the tab the other program's version was ${kept ? 'kept' : 'overwritten'}; shown again it reads ${JSON.stringify(await cell(0, 0))}`);
    await clickTab('Welcome'); await wait(600);
    await fs.writeFile(budget, mine); await wait(600);


    const untouched = await makeSheet('Untouched'); await sheetUp('Untouched.sheet');
    const made = await stat(untouched); await wait(4000);
    await clickTab('Welcome'); await wait(1200);
    check('a new sheet opened and left without an entry is not written', sameFile(made, await stat(untouched)), { text: (await fileText(untouched)).slice(0, 90) });
  });

  await phase('4 an entry made the moment the sheet appears', async () => {
    const quick = await makeSheet('Quick');
    // No settling wait: the grid is on screen, a person clicks and types.
    await page.waitForFunction(() => { const el = document.querySelector('.ws-pane__sheet'); return !!el?.__wsHost?.getSnapshot() && [...el.querySelectorAll('canvas')].some((k) => k.id.startsWith('univer-sheet-main-canvas') && k.getBoundingClientRect().width > 300) && (document.querySelector('.ui-tab--active .ui-tab-label')?.textContent ?? '').trim() === 'Quick.sheet'; }, null, { timeout: 30000 });
    const p = await cellPoint(0, 0); await page.mouse.click(p.x, p.y);
    await page.keyboard.type('Early', { delay: 15 }); await page.keyboard.press('Enter');
    await wait(600);
    const onSheet = await cell(0, 0);
    const took = await untilFile(quick, /Early/, 5000);
    check('the entry is on the sheet', onSheet === 'Early', onSheet);
    check('an entry made as soon as the sheet appears is in the file within 5 seconds', took >= 0, { ms: took, file: (await fileText(quick)).slice(0, 90) });
    await clickTab('Welcome'); await wait(1000);
    check('and it is in the file after leaving the tab', /Early/.test(await fileText(quick)), (await fileText(quick)).slice(0, 90));
    await clickTab('Quick.sheet'); await sheetUp('Quick.sheet');
    check('and on the sheet when the tab is shown again', (await cell(0, 0)) === 'Early', await cell(0, 0));
  });

  await phase('1 a second sheet of the same name, and two sheets side by side in tabs', async () => {
    const second = await runSafe('worksheet.newSheet', 'Budget 2026');
    check('a second sheet of the same name gets its own file', second.value === path.join(workspace, 'Budget 2026 2.sheet'), second);
    await sheetUp('Budget 2026 2.sheet');
    check('the second one is empty', (await cell(0, 0)) == null, await cell(0, 0));
    await clickCell(0, 0); await type('Second'); await page.keyboard.press('Enter');
    await run('file.openFile', budget); await sheetUp('Budget 2026.sheet');
    check('the first sheet shows its own cells', (await cell(0, 0)) === 'Rent', await cell(0, 0));
    await wait(1000);
    const one = await fileText(budget); const two = await fileText(second.value ?? '');
    check('each file holds its own sheet and not the other', /Rent/.test(one) && !/Second/.test(one) && /Second/.test(two) && !/Rent/.test(two), { one: one.slice(0, 60), two: two.slice(0, 120) });
    await clickTab('Budget 2026 2.sheet'); await sheetUp('Budget 2026 2.sheet');
    check('the second sheet shows its own cells', (await cell(0, 0)) === 'Second', await cell(0, 0));
  });

  await phase('1 New Sheet… in the menus, asking a name', async () => {
    // The Tools menu lists tools to open and nothing else (the Welcome page reads the same list as "Open <tool>"):
    // New Sheet… was there when this probe was written and read "Open New Sheet…" on Welcome; it was taken out
    // after the review of 2026-11-15, so the check is now that it is not there.
    await clickEl('[data-px-id="titlebar.menu.tools"]');
    const tools = (await menuLabels()).map((r) => r.label);
    check('the Tools menu lists tools only: Worksheets is there, New Sheet… is not', tools.includes('Worksheets') && !tools.includes('New Sheet…'), tools);
    await shot('menu-tools');
    await page.keyboard.press('Escape'); await wait(400);
    // The Worksheets sidebar's menu: the name typed makes the file.
    await clickEl('[data-px-id="activitybar.worksheet-container"]'); await wait(900);
    await clickEl('[data-px-id="sidebar.more"]');
    await pickMenuRow('New Sheet…'); await wait(600);
    const asked = await inputBoxOpen();
    check('choosing it asks a name', asked !== null && /name/i.test(asked.label ?? ''), asked);
    await shot('new-sheet-name');
    await page.keyboard.type('Via Tools', { delay: 20 }); await page.keyboard.press('Enter');
    await untilFile(path.join(workspace, 'Via Tools.sheet'), /./, 5000);
    await sheetUp('Via Tools.sheet').catch(() => {});
    check('the typed name makes Via Tools.sheet and opens it', (await sheetFiles()).includes('Via Tools.sheet') && (await activeTab()) === 'Via Tools.sheet' && (await editorShows()).sheet, { files: await sheetFiles(), tab: await activeTab() });

    // The Worksheets sidebar's menu; the name is cancelled.
    await clickEl('[data-px-id="sidebar.more"]');
    const side = (await menuLabels()).map((r) => r.label);
    check('the Worksheets sidebar menu has New Sheet… and Export Sheet to Excel', side.includes('New Sheet…') && side.includes('Export Sheet to Excel'), side);
    await shot('menu-sidebar');
    const filesBefore = await sheetFiles();
    await pickMenuRow('New Sheet…'); await wait(600);
    const askedSide = await inputBoxOpen();
    check('choosing it asks a name', askedSide !== null, askedSide);
    await page.keyboard.type('Never Made', { delay: 20 }); await page.keyboard.press('Escape'); await wait(1200);
    check('Escape at the name closes the question, makes no file and opens no tab', askedSide !== null && JSON.stringify(await sheetFiles()) === JSON.stringify(filesBefore) && (await inputBoxOpen()) === null && !(await tabs()).some((t) => /Never Made/.test(t)), { asked: askedSide, files: await sheetFiles(), tabs: await tabs() });

    // The Add menu on the Worksheets home; a name with characters a file cannot hold.
    await run('worksheet.open'); await wait(2000);
    await clickEl('[data-px-id="worksheet.home.addProblems"]');
    const add = (await menuLabels()).map((r) => r.label);
    check('the Add menu on the Worksheets home has New Sheet…', add.includes('New Sheet…'), add);
    await shot('menu-home-add');
    await pickMenuRow('New Sheet…'); await wait(600);
    check('choosing it asks a name', (await inputBoxOpen()) !== null, await inputBoxOpen());
    await page.keyboard.type('Q1/Q2: plan?', { delay: 20 }); await page.keyboard.press('Enter'); await wait(2500);
    const after = await sheetFiles();
    const inFolder = (await fs.readdir(workspace)).filter((n) => n !== '.parallx');
    check('a name with / : ? becomes one file in the workspace folder, no subfolder', after.includes('Q1 Q2 plan.sheet') && !inFolder.includes('Q1'), { after, inFolder });
    await sheetUp().catch(() => {});

    // The empty name, a name that already ends in .sheet, a name that climbs out of the folder.
    const empty = await runSafe('worksheet.newSheet', ''); await wait(1500);
    const dotted = await runSafe('worksheet.newSheet', 'Report.sheet'); await wait(1500);
    const climbing = await runSafe('worksheet.newSheet', '../../Outside'); await wait(1500);
    check('an empty name makes Untitled.sheet', empty.value === path.join(workspace, 'Untitled.sheet'), empty);
    check('a name ending in .sheet does not get the ending twice', dotted.value === path.join(workspace, 'Report.sheet'), dotted);
    const outside = await fs.readdir(path.dirname(workspace));
    check('a name with ../ stays inside the workspace folder', typeof climbing.value === 'string' && path.dirname(climbing.value) === workspace && !outside.some((n) => /Outside/.test(n)) && !(await fs.readdir(path.dirname(root))).some((n) => /^Outside/.test(n)), { climbing, outside });
  });

  await phase('2 a .sheet file opens as a sheet from the Explorer, Quick Open and file.openFile', async () => {
    await ensureBudget();
    await closeSheetTabs();
    if ((await tabs()).some((t) => t.endsWith('.sheet'))) throw new Error(`a sheet tab is still open before the three ways are tried: ${JSON.stringify(await tabs())}`);
    // Explorer.
    await showExplorer();
    let clicked = await clickEl('.explorer-tree .tree-node .tree-node-label', 'Budget 2026.sheet'); await wait(1500);
    if (clicked && (await activeTab()) !== 'Budget 2026.sheet') { const b = await page.evaluate(() => { const el = [...document.querySelectorAll('.explorer-tree .tree-node .tree-node-label')].find((e) => e.textContent.trim() === 'Budget 2026.sheet'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); await page.mouse.dblclick(b.x, b.y); note('one click in the Explorer did not open the file; a double click was used'); }
    await sheetUp('Budget 2026.sheet').catch(() => {});
    check('clicked in the Explorer, it opens as a live sheet with its cells', clicked && (await activeTab()) === 'Budget 2026.sheet' && (await editorShows()).sheet && (await cell(2, 1)) === 2462.4, { clicked, tab: await activeTab(), shows: await editorShows() });
    await shot('explorer-open');
    await closeTab('Budget 2026.sheet');
    // Quick Open, by keys.
    await clickTab('Welcome');
    await page.keyboard.press('Control+p');
    await page.waitForSelector('[data-px-id="quickAccess.input"]', { timeout: 5000 });
    await page.keyboard.type('Budget 2026.sheet', { delay: 20 }); await wait(900);
    await shot('quick-open');
    await page.keyboard.press('Enter');
    await sheetUp('Budget 2026.sheet').catch(() => {});
    check('picked in Quick Open (Ctrl+P), it opens as a live sheet with its cells', (await activeTab()) === 'Budget 2026.sheet' && (await editorShows()).sheet && (await cell(2, 1)) === 2462.4, { tab: await activeTab(), shows: await editorShows() });
    await closeTab('Budget 2026.sheet');
    // The command.
    await run('file.openFile', budget);
    await sheetUp('Budget 2026.sheet').catch(() => {});
    check('file.openFile <path> opens it as a live sheet with its cells', (await activeTab()) === 'Budget 2026.sheet' && (await editorShows()).sheet && (await cell(0, 0)) === 'Rent', { tab: await activeTab(), shows: await editorShows() });
    await run('file.openFile', budget); await wait(1200);
    check('file.openFile on a file already open shows its tab, it does not open a second', (await tabs()).filter((t) => t === 'Budget 2026.sheet').length === 1, await tabs());
    check('a text file still opens as text', await (async () => { await run('file.openFile', path.join(workspace, 'notes.txt')); await wait(1200); const s = await editorShows(); return !s.sheet && /plain notes/.test(s.text ?? ''); })(), await editorShows());
  });

  await phase('9 Export Sheet to Excel', async () => {
    await ensureBudget();
    await messages();
    await closeSheetTabs();
    await clickTab('Welcome'); await wait(600);
    const none = await runSafe('worksheet.exportSheet'); await wait(600);
    const noneSaid = await messages();
    check('with no sheet file on screen it exports nothing and says so', none.value === false && noneSaid.some((m) => /sheet/i.test(m)) && (await app.evaluate(() => globalThis.__dl.length)) === 0, { none, noneSaid });
    if (!(await sheetFiles()).includes('Untouched.sheet')) await makeSheet('Untouched'); else await run('file.openFile', path.join(workspace, 'Untouched.sheet'));
    await sheetUp('Untouched.sheet');
    const emptyOut = await runSafe('worksheet.exportSheet'); await wait(800);
    const emptySaid = await messages();
    check('an empty sheet exports nothing and says so', emptyOut.value === false && emptySaid.length > 0 && (await app.evaluate(() => globalThis.__dl.length)) === 0, { emptyOut, emptySaid });
    await run('file.openFile', budget); await sheetUp('Budget 2026.sheet');
    // From the sidebar's menu, as a person would.
    await clickEl('[data-px-id="activitybar.worksheet-container"]'); await wait(900);
    await clickEl('[data-px-id="sidebar.more"]');
    const picked = await pickMenuRow('Export Sheet to Excel');
    let dl = [];
    for (let i = 0; i < 40; i++) { dl = await app.evaluate(() => globalThis.__dl); if (dl.length && dl.every((d) => d.state !== 'started')) break; await sleep(150); }
    check('Export Sheet to Excel in the sidebar menu saves one .xlsx named after the sheet', picked && dl.length === 1 && dl[0].name === 'Budget 2026.xlsx' && dl[0].state === 'completed', { picked, dl });
    if (dl.length) {
      const wb = XLSX.readFile(dl[0].file); const ws = wb.Sheets[wb.SheetNames[0]];
      const got = { A1: ws.A1?.v, B1: ws.B1?.v, B2: ws.B2?.v, B3: ws.B3?.v, B3f: ws.B3?.f, D1001: ws.D1001?.v };
      check('the copy holds the sheet: values, the formula and its result, the cell at row 1001', got.A1 === 'Rent' && got.B1 === 1850 && got.B2 === 612.4 && got.B3 === 2462.4 && /SUM\(B1:B2\)/.test(got.B3f ?? '') && got.D1001 === 'deep', got);
    }
    const sheetBefore = await stat(budget); await wait(2500);
    check('exporting does not write the sheet file', sameFile(sheetBefore, await stat(budget)), null);
    await run('worksheet.openScratch'); await sheetUp('Scratch Sheet').catch(() => {}); await wait(800);
    await messages();
    const onPractice = await runSafe('worksheet.exportSheet'); await wait(600);
    note(`worksheet.exportSheet with a practice sheet on screen returns ${JSON.stringify(onPractice.value ?? onPractice.error)} and says ${JSON.stringify(await messages())}`);
  });

  await phase('6 it follows the app, light or dark', async () => {
    await ensureBudget();
    await closeSheetTabs();
    await run('file.openFile', budget); await sheetUp('Budget 2026.sheet');
    const dark = await sheetLook();
    check('in the dark app the sheet is painted dark', dark.mode === 'dark' && dark.engineDark && dark.lum !== null && dark.lum < 90, dark);
    console.log(`       brightness of the empty grid, 0 to 255: sheet file in the dark app ${dark.lum}; practice sheet in the dark app ${practice?.look.lum}`);
    if (practice) check('a practice sheet in the same dark app is painted light (its own setting), so the measure tells the two apart', practice.look.lum > 160, practice.look);
    const switched = await setMode('light');
    await wait(1200);
    const light = await sheetLook();
    check('the app switched to light while the sheet is open: the sheet turns light without being reopened', switched && light.mode === 'light' && !light.engineDark && light.lum > 160, light);
    await shot('sheet-file-light');
    console.log(`       in the light app ${light.lum}`);
    check('the cells are still there after the switch', (await cell(2, 1)) === 2462.4, await cell(2, 1));
    await closeTab('Budget 2026.sheet'); await run('file.openFile', budget); await sheetUp('Budget 2026.sheet');
    const lightFresh = await sheetLook();
    check('opened while the app is light, it is light', lightFresh.mode === 'light' && !lightFresh.engineDark && lightFresh.lum > 160, lightFresh);
    await setMode('dark'); await wait(1200);
    const back = await sheetLook();
    check('switched back to dark: the sheet is dark again', back.mode === 'dark' && back.engineDark && back.lum < 90, back);
    await wait(2500);
  });

  await phase('X more than cells: a second sheet tab and a bold cell', async () => {
    await closeSheetTabs();
    const file = await makeSheet('Two Tabs'); await sheetUp('Two Tabs.sheet');
    await clickCell(0, 0); await key('Control+b'); await type('Heavy'); await key('Enter');
    // The engine's own "add sheet" button, at the left of the sheet bar.
    const pane = await page.evaluate(() => { const b = document.querySelector('.ws-pane__sheet').getBoundingClientRect(); return { left: b.left, bottom: b.bottom }; });
    await page.mouse.click(pane.left + 35, pane.bottom - 18); await wait(1200);
    const order = await page.evaluate(() => document.querySelector('.ws-pane__sheet').__wsHost.getSnapshot().sheetOrder.length);
    check('the sheet bar\'s + adds a second sheet tab', order === 2, order);
    await clickCell(1, 1); await type('On the second'); await key('Enter');
    await wait(2600);
    await shot('two-sheet-tabs');
    await closeTab('Two Tabs.sheet'); await wait(800);
    await run('file.openFile', file); await sheetUp('Two Tabs.sheet');
    const back = await page.evaluate(() => {
      const snap = document.querySelector('.ws-pane__sheet').__wsHost.getSnapshot();
      const cellOf = (sheet, r, c) => snap.sheets[snap.sheetOrder[sheet]]?.cellData?.[r]?.[c];
      const a1 = cellOf(0, 0, 0); const style = typeof a1?.s === 'string' ? snap.styles?.[a1.s] : a1?.s;
      return { sheets: snap.sheetOrder.length, a1: a1?.v, bold: style?.bl, b2: cellOf(1, 1, 1)?.v };
    });
    check('closed and opened again: both sheet tabs, the bold cell and the second tab\'s entry are as they were', back.sheets === 2 && back.a1 === 'Heavy' && back.bold === 1 && back.b2 === 'On the second', back);
    await closeTab('Two Tabs.sheet');
  });

  await phase('X two sheet files side by side', async () => {
    await closeSheetTabs();
    const left = await makeSheet('Side Left'); await sheetUp('Side Left.sheet');
    await clickCell(0, 0); await type('left one'); await key('Enter'); await wait(2200);
    await run('workbench.action.splitEditor'); await wait(2500);
    const right = await makeSheet('Side Right'); await wait(4500);
    const panes = () => page.evaluate(() => [...document.querySelectorAll('.ws-pane__sheet')].filter((e) => e.getClientRects().length).map((e) => { const b = e.getBoundingClientRect(); const h = e.__wsHost; let a1 = null; let alive = false; try { a1 = h?.probeReadValue(0, 0) ?? null; alive = !!h?.getSnapshot(); } catch { /* engine gone */ } return { x: Math.round(b.left), w: Math.round(b.width), host: !!h, alive, a1, canvas: !!e.querySelector('canvas'), words: e.querySelector('canvas') ? '' : (e.textContent ?? '').slice(0, 80) }; }));
    const seen = await panes();
    await shot('side-by-side');
    console.log(`       panes on screen: ${JSON.stringify(seen)}; groups' active tabs: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.ui-tab--active .ui-tab-label')].map((e) => e.textContent.trim())))}`);
    check('two sheet files shown side by side are both live sheets', seen.length === 2 && seen.every((p) => p.host && p.alive && p.canvas), seen);
    // Type into each by its place on screen.
    for (const [i, word] of ['typed left', 'typed right'].entries()) {
      const p = seen[i]; if (!p) continue;
      await page.mouse.click(p.x + 46 + 44, [...await page.evaluate(() => [...document.querySelectorAll('.ws-pane__sheet')].filter((e) => e.getClientRects().length).map((e) => { const cv = [...e.querySelectorAll('canvas')].find((k) => k.id.startsWith('univer-sheet-main-canvas')); return cv ? cv.getBoundingClientRect().top + 20 + 24 * 2 + 12 : e.getBoundingClientRect().top + 150; }))][i]);
      await wait(300); await page.keyboard.type(word, { delay: 20 }); await page.keyboard.press('Enter'); await wait(400);
    }
    await wait(3000);
    const l = await fileText(left); const r = await fileText(right);
    check('each file holds what was typed into its own side, and nothing of the other', /left one/.test(l) && /typed left/.test(l) && !/typed right/.test(l) && /typed right/.test(r) && !/typed left/.test(r) && !/left one/.test(r), { left: l.slice(-220), right: r.slice(-220), panes: await panes() });
    await shot('side-by-side-typed');
    for (const t of ['Side Right.sheet', 'Side Left.sheet']) await closeTab(t);
  });

  await phase('5 a file that is not a sheet', async () => {
    await closeSheetTabs();
    const cases = {
      'Words.sheet': Buffer.from('this is not a workbook'),
      'Other Json.sheet': Buffer.from('{"rows":[[1,2],[3,4]]}'),
      'Newer.sheet': Buffer.from('{"format":"parallx-sheet","version":99,"workbook":null}'),
      'Damaged.sheet': Buffer.from('{"format":"parallx-sheet","version":1,"workbook":{"sheets":5}}'),
      'Binary.sheet': Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 37 + 11) % 256)),
    };
    const before = {};
    for (const [name, bytes] of Object.entries(cases)) { await fs.writeFile(path.join(workspace, name), bytes); before[name] = await stat(path.join(workspace, name)); }
    await wait(1200);
    for (const name of Object.keys(cases)) {
      await run('file.openFile', path.join(workspace, name)); await wait(3500);
      const shows = await editorShows();
      check(`${name}: refused in words, no grid`, !shows.sheet && /could not be opened/.test(shows.words) && shows.words.includes(name.replace('.sheet', '')), shows);
      console.log(`       it says: ${shows.words}`);
      if (name === 'Words.sheet') await shot('sheet-refused');
      // A person tries to type into it anyway, then leaves.
      await page.mouse.click(800, 450); await page.keyboard.type('x1'); await page.keyboard.press('Enter'); await wait(2200);
      await clickTab('Welcome'); await wait(900);
    }
    for (const name of Object.keys(cases)) { await closeTab(name); }
    await wait(1500);
    for (const name of Object.keys(cases)) check(`${name}: left untouched on disk (same bytes, never written)`, sameFile(before[name], await stat(path.join(workspace, name))), { sameBytes: before[name].bytes === (await stat(path.join(workspace, name))).bytes });

    // An empty file with the ending: said to be a new sheet. Opening it writes nothing.
    const empty = path.join(workspace, 'Empty.sheet'); await fs.writeFile(empty, ''); const emptyBefore = await stat(empty);
    await run('file.openFile', empty); await sheetUp('Empty.sheet').catch(() => {}); await wait(3000);
    const emptyShows = await editorShows();
    await clickTab('Welcome'); await wait(1200);
    note(`an empty 0-byte .sheet file opens as ${emptyShows.sheet ? 'an empty sheet' : JSON.stringify(emptyShows)}; after opening and leaving it was ${sameFile(emptyBefore, await stat(empty)) ? 'not written' : 'written'}`);
    if (emptyShows.sheet) check('an empty .sheet file, opened and left, is not written', sameFile(emptyBefore, await stat(empty)), (await fileText(empty)).slice(0, 80));

    // A file in the sheet format whose workbook names a sheet it does not hold.
    const hollow = path.join(workspace, 'Hollow.sheet'); await fs.writeFile(hollow, '{"format":"parallx-sheet","version":1,"workbook":{"id":"w","sheetOrder":["missing"],"sheets":{}}}'); const hollowBefore = await stat(hollow);
    const errorsBefore = errors.length;
    await run('file.openFile', hollow); await wait(5000);
    const hollowShows = await editorShows(); await shot('sheet-hollow');
    await clickTab('Welcome'); await wait(1200); await closeTab('Hollow.sheet'); await wait(800);
    note(`a sheet-format file whose workbook lists a sheet it does not hold shows ${JSON.stringify(hollowShows)}; page errors while it was open: ${errors.length - errorsBefore}; on disk it was ${sameFile(hollowBefore, await stat(hollow)) ? 'not written' : `written: ${(await fileText(hollow)).slice(0, 100)}`}`);
  });

  await phase('4 the app closed right after an entry, and opened again', async () => {
    await ensureBudget();
    await closeSheetTabs();
    await run('file.openFile', budget); await sheetUp('Budget 2026.sheet');
    await clickCell(10, 0); await type('Settled'); await key('Enter');
    await wait(2500);
    await app.close().catch(() => {});
    const text = await fileText(budget);
    check('after the app closes the file holds the work that had its 1.5 seconds', /Rent/.test(text) && /Settled/.test(text) && /deep/.test(text), text.slice(0, 120));

    // The window's own X, with the app started as he starts it (test mode skips the app's shutdown).
    const closes = [];
    for (const [i, pause] of [150, 600, 1100].entries()) {
      await launch(true);
      await wait(2500);
      const back = { tabs: await tabs(), active: await activeTab() };
      if (back.active !== 'Budget 2026.sheet') await clickTab('Budget 2026.sheet');
      await sheetUp('Budget 2026.sheet');
      const shown = await cell(0, 0);
      await clickCell(14 + i, 2); await page.keyboard.type(`Quit${i}`, { delay: 20 }); await page.keyboard.press('Enter');
      await wait(pause);
      const onSheet = await cell(14 + i, 2).catch(() => null);
      const exited = new Promise((r) => app.process().once('exit', () => r(true)));
      const x = await page.evaluate(() => { const el = document.querySelector('[data-px-id="workbench.action.closeWindow"]'); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      if (x) await page.mouse.click(x.x, x.y).catch(() => {});
      const ended = await Promise.race([exited, sleep(30000).then(() => false)]);
      await app.close().catch(() => {});
      closes.push({ secondsBeforeClose: pause / 1000, tabBroughtBack: back.tabs.includes('Budget 2026.sheet'), a1: shown, onSheet, closeButton: !!x, appEnded: ended, inFile: new RegExp(`Quit${i}`).test(await fileText(budget)) });
    }
    console.log(`       ${JSON.stringify(closes)}`);
    check('started as he starts it, the sheet tab comes back as a live sheet with its cells', closes.every((c) => c.tabBroughtBack && c.a1 === 'Rent'), closes);
    check('an entry made 0.15, 0.6 and 1.1 seconds before the window\'s X is clicked is in the file every time', closes.every((c) => c.closeButton && c.appEnded && c.onSheet === `Quit${closes.indexOf(c)}` && c.inFile), closes);

    const before = await stat(budget);
    await launch();
    await wait(3000);
    const restored = { tabs: await tabs(), active: await activeTab(), shows: await editorShows() };
    console.log(`       on opening the app again: ${JSON.stringify(restored)}`);
    if (restored.tabs.includes('Budget 2026.sheet')) {
      await clickTab('Budget 2026.sheet'); await wait(3500);
      const shows = await editorShows();
      check('the sheet tab the app brings back on start is a live sheet, not the file as text', shows.sheet && (await cell(0, 0)) === 'Rent', shows);
    } else note('the sheet tab is not brought back when the app starts again');
    await run('file.openFile', budget); await sheetUp('Budget 2026.sheet');
    check('after the app was closed and opened, the sheet is as it was', (await cell(0, 0)) === 'Rent' && (await cell(2, 1)) === 2462.4 && (await cell(10, 0)) === 'Settled' && (await cell(1000, 3)) === 'deep' && (await grid()).rows > 1000, [await cell(0, 0), await cell(2, 1), await cell(10, 0), await cell(1000, 3), await grid()]);
    await wait(3500); await clickTab('Welcome'); await wait(1200);
    check('opening it in the new session wrote nothing', sameFile(before, await stat(budget)), { sameBytes: before.bytes === (await stat(budget)).bytes });
    const practiceAgain = await (async () => { await run('worksheet.openScratch'); await sheetUp(); return grid(); })();
    check('a practice sheet opened after a sheet file is still 150 by 40', practiceAgain.rows === 150 && practiceAgain.columns === 40, practiceAgain);
  });

  await phase('8 with the Worksheets tool turned off', async () => {
    await ensureBudget();
    await run('file.openFile', budget); await sheetUp('Budget 2026.sheet');
    await clickCell(12, 0); await page.keyboard.type('Before off', { delay: 20 }); await page.keyboard.press('Enter'); await wait(250);
    const off = await setTool(false); await wait(2500);
    check('the tool turns off', off === true, off);
    const text = await fileText(budget);
    check('an entry made a quarter of a second before the tool was turned off is in the file', /Before off/.test(text), 'the entry is not in the file');
    check('the open sheet goes at once', !(await hasSheet()) && !(await tabs()).includes('Budget 2026.sheet'), { tabs: await tabs(), sheet: await hasSheet() });
    const before = await stat(budget);
    await run('file.openFile', budget); await wait(2500);
    const shows = await editorShows();
    check('file.openFile now opens the .sheet file as text', !shows.sheet && /^\{"format":"parallx-sheet"/.test(shows.text ?? ''), shows);
    await shot('tool-off-as-text');
    await closeTab('Budget 2026.sheet');
    await showExplorer();
    await clickEl('.explorer-tree .tree-node .tree-node-label', 'Budget 2026.sheet'); await wait(2500);
    const viaExplorer = { ...(await editorShows()), tab: await activeTab(), tabs: await tabs(), rows: await page.evaluate(() => [...document.querySelectorAll('.explorer-tree .tree-node .tree-node-label')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim())) };
    await shot('tool-off-explorer');
    check('and so does a click in the Explorer', !viaExplorer.sheet && viaExplorer.tab === 'Budget 2026.sheet' && /^\{"format":"parallx-sheet"/.test(viaExplorer.text ?? ''), viaExplorer);
    const cmds = { newSheet: await runSafe('worksheet.newSheet', 'While Off'), exportSheet: await runSafe('worksheet.exportSheet'), scratch: await runSafe('worksheet.openScratch') };
    await wait(1200);
    check('its commands are gone and make nothing', !!cmds.newSheet.error && !!cmds.exportSheet.error && !!cmds.scratch.error && !(await sheetFiles()).includes('While Off.sheet'), cmds);
    await clickEl('[data-px-id="titlebar.menu.tools"]');
    const tools = (await menuLabels()).map((r) => r.label); await key('Escape');
    const ids = flat(await scene()).map((n) => n.id);
    check('nothing of it is left in the Tools menu, the activity bar or the Welcome page', !tools.includes('New Sheet…') && !tools.includes('Worksheets') && !ids.some((id) => /worksheet/i.test(id)), { tools, ids: ids.filter((id) => /worksheet/i.test(id)) });
    await wait(2500);
    check('the file is not written while the tool is off', sameFile(before, await stat(budget)), null);

    // On again, no restart.
    const on = await setTool(true); await wait(2500);
    await run('file.openFile', budget); await wait(3000);
    const whileTextOpen = await editorShows();
    note(`turned on again with the file still open as text: file.openFile shows ${whileTextOpen.sheet ? 'the live sheet' : 'the text tab still'}`);
    await closeTab('Budget 2026.sheet');
    await run('file.openFile', budget); await sheetUp('Budget 2026.sheet').catch(() => {});
    check('turned on again, no restart: the file opens as a live sheet with its cells', on === true && (await editorShows()).sheet && (await cell(0, 0)) === 'Rent', await editorShows());

    // Off, and the app started with it off.
    await closeTab('Budget 2026.sheet');
    await setTool(false); await wait(1500);
    await run('file.openFile', budget); await wait(1500);
    await app.close().catch(() => {});
    const cold = await stat(budget);
    await launch(); await wait(3000);
    const started = { tabs: await tabs(), shows: await editorShows(), sheet: await hasSheet() };
    const engine = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /worksheet-univer/.test(n)));
    const styles = await page.evaluate(() => document.querySelectorAll('link[href*="worksheet-univer"], [class*="univer"]').length);
    check('started with the tool off: no sheet pane, and the spreadsheet engine is not loaded', !started.sheet && engine.length === 0 && styles === 0, { started, engine, styles });
    await run('file.openFile', budget); await wait(2500);
    const coldShows = await editorShows();
    check('started with the tool off: the .sheet file opens as text', !coldShows.sheet && /^\{"format":"parallx-sheet"/.test(coldShows.text ?? ''), coldShows);
    const coldCmd = await runSafe('worksheet.newSheet', 'Cold Off'); await wait(1000);
    const coldIds = flat(await scene()).map((n) => n.id).filter((id) => /worksheet/i.test(id));
    check('started with the tool off: no command, no file made, nothing of it on screen', !!coldCmd.error && !(await sheetFiles()).includes('Cold Off.sheet') && coldIds.length === 0, { coldCmd, coldIds });
    await wait(2000);
    check('started with the tool off: the file is not written', sameFile(cold, await stat(budget)), null);
    await closeTab('Budget 2026.sheet');
    await setTool(true); await wait(2500);
  });
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`);
  problems.push('the probe stopped');
  await shot('stopped');
} finally {
  await app?.close().catch(() => {});
}
console.log(`\n[probe] page errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);
console.log(`[probe] notes: ${notes.length}`);
for (const n of notes) console.log('  - ' + n);
console.log(`[probe] ${problems.length} problems${problems.length ? ':\n  ' + problems.join('\n  ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length ? 1 : 0;
