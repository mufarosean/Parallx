// sheet-file-fixes-probe.mjs — what the fixes after the sheet-file review are said to have brought, tried in the real app.
//
// Written by a verifier who did not build the piece or its fixes, from the
// statements of what a person should see. Boots the built app hidden with a
// new profile and workspace, acts with real mouse and keys (the Explorer's own
// rename, delete, cut, paste and drag; real Ctrl+Z; real menus), and reads
// back from the engine, the screen and the files on disk. Each phase runs on
// its own, so one that stops does not hide the rest.
//
//   xvfb-run -a node tests/probes/sheet-file-fixes-probe.mjs [outDir]
//
// PARALLX_PROBE_ONLY=<phase number, ...> runs only those phases.
// Internal calls, and why: `worksheet.newSheet <name>`, `file.openFile <path>`,
// `worksheet.openScratch` and `workbench.action.splitEditor` because the
// statements under test name them; `worksheet.open` and `worksheet.bank` to
// reach a screen; `workbench.action.closeActiveEditor` only to tidy between
// cases (a tab under test is closed by its own × with the mouse); the
// notification history to read what the app said; the sheet pane's probe hook
// (`__wsHost`) to read cells. Everything else is mouse and keys.
//
// What it cannot do: run against the build before the fixes (none is at hand
// and this run was not allowed to build), so where it can a check is paired
// with its opposite (the practice sheet against a sheet file, a control case).
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const repo = path.resolve(import.meta.dirname, '../..');
await fs.mkdir(path.join(repo, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(repo, 'test-results', 'sheet-fixes-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data/chromium-cache'), path.join(workspace, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
await fs.writeFile(path.join(workspace, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
// The files of the regression sweep are in the folder before the app starts, as a person's files are.
const REG = (n) => path.join(workspace, 'Reg', n);
await fs.mkdir(path.join(workspace, 'Reg'), { recursive: true });
await fs.writeFile(REG('paper.pdf'), tinyPdf('Pdf words here'));
await fs.writeFile(REG('pic.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR42mP8z8Dwn4EIwDiqEF8hAN0wCAHk3n0KAAAAAElFTkSuQmCC', 'base64'));
await fs.writeFile(REG('readme.md'), '# Heading here\n\nmarkdown body words\n');
await fs.writeFile(REG('notes.txt'), 'plain text words\n');
await fs.writeFile(REG('.gitignore'), 'node_modules/\nignored-words\n');
await fs.writeFile(REG('Makefile'), 'all:\n\techo makefile-words\n');
{ const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Amount'], ['Xlsxrent', 1850]]), 'Data'); XLSX.writeFile(wb, REG('book.xlsx')); }
const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;

const problems = [];
const explorerMisses = [];
const notes = [];
const errors = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); return ok; };
const note = (text) => { console.log(` note ${text}`); notes.push(text); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Helpers that live in the page: every one reads what is on screen, by editor group, left to right. */
const pageLib = () => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const groups = () => [...document.querySelectorAll('.editor-group')].filter(vis).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left || a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const sheetIn = (g) => [...g.querySelectorAll('.ws-pane__sheet')].find((e) => vis(e) && e.__wsHost) ?? null;
  const alive = (el) => { try { return !!el?.__wsHost?.getSnapshot() && !!el.querySelector('canvas'); } catch { return false; } };
  const sheetEl = (gi) => { const gs = groups(); if (gi != null) return gs[gi] ? sheetIn(gs[gi]) : null; for (const g of gs) { const el = sheetIn(g); if (el && alive(el)) return el; } return null; };
  const describe = (g) => {
    const sheet = sheetIn(g);
    const words = [...g.querySelectorAll('.ws-pane')].filter(vis).filter((e) => !e.querySelector('canvas')).map((e) => (e.innerText ?? '').trim()).join(' ').replace(/\s+/g, ' ').slice(0, 260);
    const ta = [...g.querySelectorAll('textarea.text-editor-textarea')].find(vis);
    const cm = [...g.querySelectorAll('.cm-content')].find(vis);
    const pane = [...g.querySelectorAll('.editor-pane')].find(vis);
    const b = g.getBoundingClientRect();
    return {
      x: Math.round(b.left), focused: g.classList.contains('editor-group--active'),
      tabs: [...g.querySelectorAll('.ui-tab')].map((t) => (t.querySelector('.ui-tab-label')?.textContent ?? '').trim()),
      active: (g.querySelector('.ui-tab--active .ui-tab-label')?.textContent ?? '').trim(),
      activeId: g.querySelector('.ui-tab--active')?.getAttribute('data-tab-id') ?? '',
      dirty: [...g.querySelectorAll('.ui-tab')].filter((t) => { const d = t.querySelector('.ui-tab-dirty'); return d && vis(d); }).map((t) => (t.querySelector('.ui-tab-label')?.textContent ?? '').trim()),
      live: alive(sheet), words,
      text: ta ? ta.value : (cm ? cm.innerText : null),
      pane: pane ? pane.className.replace('editor-pane', '').replace('fill-container', '').trim() : (g.querySelector('.ws-pane') ? 'ws-pane' : null),
    };
  };
  window.__fx = { vis, groups, sheetEl, describe, alive };
};

let app; let page; let stepName = 'start';
async function launch() {
  app = await electron.launch({ args: ['.', '--mute-audio', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => { const line = `${String(e).slice(0, 200)} @ ${String(e?.stack ?? '').split('\n').slice(1, 4).map((l) => l.trim().replace(/\(?file:\/\/\S*\/dist\//, '(dist/')).join(' < ')}`; errors.push(line); console.log(`  !! page error (${stepName}): ${line}`); });
  page.on('crash', () => console.log('  !! the page crashed'));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 900); });
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
  await page.evaluate(pageLib);
  await page.waitForTimeout(1500);
}
const run = (id, ...args) => Promise.race([
  page.evaluate(({ id, args }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args), { id, args }),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`the command ${id} did not return in 20 seconds`)), 20000)),
]);
const runSafe = (id, ...args) => run(id, ...args).then((v) => ({ value: v }), (e) => ({ error: String(e?.message ?? e).slice(0, 200) }));
const wait = (ms) => page.waitForTimeout(ms);
const key = async (k) => { await page.keyboard.press(k); await wait(160); };
const type = async (t, delay = 25) => { await page.keyboard.type(t, { delay }); await wait(200); };
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), timeout: 15000 }).catch(() => {});
const messages = () => page.evaluate(() => { const svc = window.__parallx_workbench__._services.get({ id: 'INotificationService' }); const out = (svc?.history ?? []).map((n) => n.message); svc?.clearHistory?.(); return out; });
/** The editor groups on screen, left to right: tabs, the shown tab, whether it is a live sheet, its words or text. */
const groups = () => page.evaluate(() => window.__fx.groups().map((g) => window.__fx.describe(g)));
const group = async (gi = 0) => (await groups())[gi] ?? null;
const allTabs = async () => (await groups()).flatMap((g) => g.tabs);
const liveCount = async () => (await groups()).filter((g) => g.live).length;
const hostCall = (fn, a = [], gi = null) => page.evaluate(({ fn, a, gi }) => { const el = window.__fx.sheetEl(gi); if (!el) throw new Error('no live sheet on screen'); return el.__wsHost[fn](...a); }, { fn, a, gi });
const cell = (r, c, gi = null) => hostCall('probeReadValue', [r, c], gi).catch((e) => `!! ${String(e.message).split('\n')[0]}`);
const snapCell = (r, c, gi = null) => page.evaluate(({ r, c, gi }) => { const el = window.__fx.sheetEl(gi); const snap = el.__wsHost.getSnapshot(); const s = snap.sheets[snap.sheetOrder[0]]; return s.cellData?.[r]?.[c] ?? null; }, { r, c, gi });
const gridSize = (gi = null) => page.evaluate(({ gi }) => { const snap = window.__fx.sheetEl(gi).__wsHost.getSnapshot(); const s = snap.sheets[snap.sheetOrder[0]]; return { rows: s.rowCount, columns: s.columnCount }; }, { gi });
const activeCell = async (gi = null) => (await hostCall('probeState', [], gi)).activeCell;
const sheetUp = async (label, gi = null) => {
  await page.waitForFunction(({ label, gi }) => {
    const gs = window.__fx.groups().map((g, i) => ({ g, i })).filter((x) => gi == null || x.i === gi);
    return gs.some(({ g }) => { const el = [...g.querySelectorAll('.ws-pane__sheet')].find((e) => window.__fx.vis(e) && e.__wsHost); return window.__fx.alive(el) && (!label || (g.querySelector('.ui-tab--active .ui-tab-label')?.textContent ?? '').trim() === label); });
  }, { label: label ?? null, gi }, { timeout: 30000 });
  await wait(2700);
};
const cellPoint = (r, c, gi = null) => page.evaluate(({ r, c, gi }) => {
  const el = window.__fx.sheetEl(gi); const cv = [...el.querySelectorAll('canvas')].find((k) => k.id.startsWith('univer-sheet-main-canvas'));
  const b = cv.getBoundingClientRect(); const snap = el.__wsHost.getSnapshot(); const s = snap.sheets[snap.sheetOrder[0]];
  return { x: b.left + s.rowHeader.width + c * s.defaultColumnWidth + s.defaultColumnWidth / 2, y: b.top + s.columnHeader.height + r * s.defaultRowHeight + s.defaultRowHeight / 2 };
}, { r, c, gi });
const clickCell = async (r, c, gi = null) => { const p = await cellPoint(r, c, gi); await page.mouse.click(p.x, p.y); await wait(200); };
/** Click a cell, type, Enter: an entry as a person makes one. */
const enter = async (r, c, text, gi = null) => { await clickCell(r, c, gi); await page.keyboard.type(text, { delay: 22 }); await page.keyboard.press('Enter'); await wait(260); };
const pointOf = (selector, textIs, gi = null) => page.evaluate(({ selector, textIs, gi }) => {
  const scope = gi == null ? document : window.__fx.groups()[gi]; if (!scope) return null;
  const els = [...scope.querySelectorAll(selector)].filter((e) => e.getClientRects().length && (textIs == null || (e.textContent ?? '').trim() === textIs));
  const el = els[els.length - 1]; if (!el) return null; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
}, { selector, textIs: textIs ?? null, gi });
const clickEl = async (selector, textIs, gi = null, opts = {}) => { const p = await pointOf(selector, textIs, gi); if (!p) return false; await page.mouse.click(p.x, p.y, opts); await wait(450); return true; };
const clickTab = (label, gi = null) => clickEl('.ui-tab .ui-tab-label', label, gi);
/** Close a tab by its own × with the mouse. */
const closeTabX = async (label, gi = null) => {
  const p = await page.evaluate(({ label, gi }) => {
    const gs = window.__fx.groups(); const scope = gi == null ? gs : [gs[gi]];
    for (const g of scope) { const t = [...(g?.querySelectorAll('.ui-tab') ?? [])].find((x) => (x.querySelector('.ui-tab-label')?.textContent ?? '').trim() === label); if (t) { t.scrollIntoView({ inline: 'nearest' }); const tb = t.getBoundingClientRect(); const xb = t.querySelector('.ui-tab-close').getBoundingClientRect(); return { tab: { x: tb.left + tb.width / 2, y: tb.top + tb.height / 2 }, x: { x: xb.left + xb.width / 2, y: xb.top + xb.height / 2 }, shown: xb.width > 0 }; } }
    return null;
  }, { label, gi });
  if (!p) return false;
  await page.mouse.move(p.tab.x, p.tab.y); await wait(150);
  const again = await page.evaluate(({ label, gi }) => { const gs = window.__fx.groups(); const scope = gi == null ? gs : [gs[gi]]; for (const g of scope) { const t = [...(g?.querySelectorAll('.ui-tab') ?? [])].find((x) => (x.querySelector('.ui-tab-label')?.textContent ?? '').trim() === label); if (t) { const xb = t.querySelector('.ui-tab-close').getBoundingClientRect(); return { x: xb.left + xb.width / 2, y: xb.top + xb.height / 2 }; } } return null; }, { label, gi });
  await page.mouse.click(again.x, again.y); await wait(600); return true;
};
/** Back to a plain start: one group, no file tabs, no prompt left on screen. Uses the close command (not what is under test). */
const reset = async () => {
  for (let i = 0; i < 6; i++) { const b = await pointOf('.parallx-notification--prompt .parallx-notification-close'); if (!b) break; await page.mouse.click(b.x, b.y); await wait(300); }
  await page.keyboard.press('Escape').catch(() => {});
  for (let i = 0; i < 40; i++) {
    const gs = await groups();
    const gi = gs.findIndex((g) => g.tabs.some((t) => t !== 'Welcome' && t !== 'Dashboard'));
    if (gi < 0 && gs.length <= 1) break;
    const g = gs[gi < 0 ? gs.length - 1 : gi];
    const label = g.tabs.find((t) => t !== 'Welcome' && t !== 'Dashboard') ?? g.tabs[0];
    if (!label) break;
    await clickTab(label, gi < 0 ? gs.length - 1 : gi); await wait(200);
    await run('workbench.action.closeActiveEditor').catch(() => {}); await wait(350);
  }
  await messages().catch(() => {});
};

// ── the Explorer, by mouse and keys ──
const showExplorer = async () => { const up = () => page.evaluate(() => [...document.querySelectorAll('.explorer-tree')].some((e) => e.getClientRects().length)); if (!(await up())) { await clickEl('[data-px-id="activitybar.explorer-container"]'); await wait(900); } return up(); };
const relOf = (uri) => { try { return decodeURIComponent(uri); } catch { return uri; } };
/** Rows of the file tree now showing, as paths under the workspace folder. */
const explorerRows = () => page.evaluate((ws) => [...document.querySelectorAll('.explorer-tree .tree-node')].filter((e) => e.getClientRects().length).map((e) => { let u = e.getAttribute('data-uri') ?? ''; try { u = decodeURIComponent(u); } catch { /* as is */ } const at = u.indexOf(ws); return at >= 0 ? u.slice(at + ws.length + 1) : u; }).filter(Boolean), workspace.replace(/\\/g, '/'));
const nodePoint = (rel) => page.evaluate(({ rel, ws }) => {
  const row = [...document.querySelectorAll('.explorer-tree .tree-node')].filter((e) => e.getClientRects().length).find((e) => { let u = e.getAttribute('data-uri') ?? ''; try { u = decodeURIComponent(u); } catch { /* as is */ } return u.endsWith(`${ws}/${rel}`); });
  if (!row) return null; row.scrollIntoView({ block: 'nearest' }); const b = (row.querySelector('.tree-node-label') ?? row).getBoundingClientRect(); return { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2 };
}, { rel, ws: workspace.replace(/\\/g, '/') });
const waitNode = async (rel, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const p = await nodePoint(rel); if (p) return p; await sleep(200); } return null; };
const clickNode = async (rel, opts = {}) => { await showExplorer(); const p = await waitNode(rel); if (!p) return false; await page.mouse.click(p.x, p.y, opts); await wait(500); return true; };
const menuLabels = async () => page.evaluate(() => { const d = window.__parallx_workbench__._services.get({ id: 'IIntrospectionService' }).describeScene(); const menus = d.surfaces.filter((s) => s.id === 'contextMenu'); return (menus[menus.length - 1]?.children ?? []).map((r) => ({ id: r.id, label: r.label })); });
const pickMenuRow = async (label) => { const row = (await menuLabels()).find((r) => r.label === label); if (!row) return false; return clickEl(`[data-px-id="${row.id}"]`); };
/** The Explorer's rename, typed: right-click > Rename (or select and F2), the new name, Enter. */
const renameInExplorer = async (rel, newName, how = 'menu') => {
  if (how === 'fast') {
    // The same right-click > Rename, without the pauses: as quick as a hand that knows the way.
    const p = await nodePoint(rel); if (!p) return 'no row';
    await page.mouse.click(p.x, p.y, { button: 'right' });
    let row = null; for (let i = 0; i < 30 && !row; i++) { row = await pointOf('[data-px-id="contextMenu.explorer.rename"]'); if (!row) await sleep(30); }
    if (!row) return 'no Rename in the menu';
    await page.mouse.click(row.x, row.y);
    try { await page.waitForSelector('.tree-inline-input', { timeout: 4000 }); } catch { return 'no name box'; }
    await page.keyboard.press('Control+a'); await page.keyboard.type(newName); await page.keyboard.press('Enter');
    return 'done';
  }
  // The Explorer's menu fails when the file tree redraws under it, which it does about 3 s after anything is written in the
  // folder (phase 13 checks and reports that). So the menu is opened once the tree is quiet, and a miss is said and tried once more.
  const once = async () => {
    if (!(await clickNode(rel, { button: 'right' }))) return 'no row'; if (!(await pickMenuRow('Rename'))) return 'no Rename in the menu';
    try { await page.waitForSelector('.tree-inline-input', { timeout: 3000 }); } catch { return 'no name box'; }
    await page.keyboard.press('Control+a'); await page.keyboard.type(newName, { delay: 15 }); await page.keyboard.press('Enter');
    return 'done';
  };
  await wait(4500);
  let did = await once();
  if (did !== 'done') { explorerMisses.push(`Rename of ${rel}: ${did}`); console.log(`       !! the Explorer's Rename did nothing the first time (${did}); tried again after 5 s`); await page.keyboard.press('Escape'); await wait(5000); did = await once(); }
  return did;
};
const prompts = () => page.evaluate(() => [...document.querySelectorAll('.parallx-notification')].filter((e) => e.getClientRects().length).map((e) => ({ words: (e.querySelector('.parallx-notification-message')?.textContent ?? '').trim(), buttons: [...e.querySelectorAll('.parallx-notification-action-btn')].map((b) => b.textContent.trim()), asks: e.classList.contains('parallx-notification--prompt') })));
const waitPrompt = async (re, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const p = (await prompts()).find((x) => re.test(x.words)); if (p) return p; await sleep(150); } return null; };
const clickPromptButton = (label) => clickEl('.parallx-notification .parallx-notification-action-btn', label);
/** The Explorer's delete: right-click > Delete (or select and the Delete key), then the dialog's Move to Trash. */
const deleteInExplorer = async (rel, how = 'menu', answer = 'Move to Trash') => {
  const once = async () => {
    if (!(await clickNode(rel, { button: 'right' }))) return { step: 'no row' }; if (!(await pickMenuRow('Delete'))) return { step: 'no Delete in the menu' };
    const asked = await waitPrompt(/delete/i, 3000);
    if (!asked) return { step: 'no dialog' };
    const clicked = await clickPromptButton(answer);
    return { step: clicked ? 'done' : `no ${answer} button`, asked };
  };
  if (how !== 'now') await wait(4500);
  let did = await once();
  if (did.step !== 'done' && how !== 'now') { explorerMisses.push(`Delete of ${rel}: ${did.step}`); console.log(`       !! the Explorer's Delete did nothing the first time (${did.step}); tried again after 5 s`); await page.keyboard.press('Escape'); await wait(5000); did = await once(); }
  return did;
};

// ── files ──
const ls = async (dir = workspace) => (await fs.readdir(dir)).filter((n) => n !== '.parallx' && n !== 'Reg').sort();
const exists = (p) => fs.stat(p).then(() => true, () => false);
const fileText = (p) => fs.readFile(p, 'utf8').catch(() => '');
const untilFile = async (p, re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await fileText(p))) return Date.now() - t0; await sleep(50); } return -1; };
const at = (...parts) => path.join(workspace, ...parts);
/** Watch a path for `ms`: true when it existed at any moment. */
const cameBack = async (p, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await exists(p)) return Date.now() - t0; await sleep(100); } return -1; };
/** After a delete was confirmed: when the path went (ms, -1 never), and when it was there again after that (ms, -1 never), watched for `ms`. */
const goneAndBack = async (p, ms) => { const t0 = Date.now(); let gone = -1; let back = -1; while (Date.now() - t0 < ms) { const there = await exists(p); if (gone < 0 && !there) gone = Date.now() - t0; else if (gone >= 0 && there && back < 0) back = Date.now() - t0; await sleep(60); } return { goneAfterMs: gone, backAfterMs: back, thereAtEnd: await exists(p) }; };
const stat = async (p) => { const s = await fs.stat(p); return { bytes: (await fs.readFile(p)).toString('base64'), mtime: s.mtimeMs }; };
const sameFile = (a, b) => a.bytes === b.bytes && a.mtime === b.mtime;
function tinyPdf(words) {
  const stream = `BT /F1 18 Tf 30 100 Td (${words}) Tj ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const only = (process.env.PARALLX_PROBE_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const phase = async (name, fn) => {
  if (only.length && !only.includes(name.split(' ')[0])) return;
  console.log(`\n[${name}]`); stepName = name;
  if (!page || page.isClosed()) { console.log('  the app was not running at the start of this phase: started again'); problems.push(`${name}: the app had gone`); await app?.close().catch(() => {}); await launch(); }
  const errorsBefore = errors.length;
  try { await reset(); await fn(); const said = await messages().catch(() => []); if (said.length) console.log(`       the app said: ${JSON.stringify(said)}`); }
  catch (err) { console.log(`  phase stopped: ${String(err?.stack ?? err).split('\n').slice(0, 3).join(' | ')}`); problems.push(`${name}: the phase stopped`); await shot(`stopped-${name.replace(/\W+/g, '-').slice(0, 40)}`); try { await page.keyboard.press('Escape'); } catch { /* no window */ } }
  if (errors.length > errorsBefore) console.log(`       page errors in this phase: ${JSON.stringify(errors.slice(errorsBefore, errorsBefore + 4))}`);
};
/** Make a sheet file by the command the statements name, and wait for its live tab. */
const newSheet = async (name) => { const made = await run('worksheet.newSheet', name); await sheetUp(`${path.basename(String(made))}`); return made; };

try {
  await launch();

  // ───────────────────────── 1 ─────────────────────────
  await phase('1 names outside plain English', async () => {
    const names = ['Café', 'Budget — 2026', '家計簿', 'Sam’s list'];
    for (const [i, name] of names.entries()) {
      const file = `${name}.sheet`; const word = `entry${i}x`;
      const before = await ls();
      const made = await runSafe('worksheet.newSheet', name);
      await sheetUp(file).catch(() => {});
      const added = (await ls()).filter((n) => !before.includes(n));
      check(`"${name}": worksheet.newSheet makes exactly "${file}" on disk, and no other file`, added.length === 1 && added[0] === file && made.value === at(file), { made, added, bytes: added.map((n) => Buffer.from(n).toString('hex')) });
      const g = await group(0);
      check(`"${name}": the tab shows "${file}" and is a live sheet`, g?.active === file && g.live, g);
      await enter(0, 0, word).catch((e) => console.log(`       could not type: ${e.message.split('\n')[0]}`));
      const took = await untilFile(at(file), new RegExp(word), 5000);
      const others = []; for (const n of await ls()) if (n !== file && n.endsWith('.sheet') && (await fileText(at(n))).includes(word)) others.push(n);
      check(`"${name}": an entry typed into it is in that file, and in no other`, took >= 0 && others.length === 0, { ms: took, others, files: await ls() });
      await closeTabX(file); await wait(900);
      check(`"${name}": its tab closes`, !(await allTabs()).includes(file), await allTabs());
      const clicked = await clickNode(file);
      await sheetUp(file).catch(() => {});
      const g2 = await group(0);
      check(`"${name}": clicked in the Explorer it opens again as a live sheet with the entry`, clicked && g2?.active === file && g2.live && (await cell(0, 0)) === word, { clicked, rows: await explorerRows(), g2, a1: await cell(0, 0) });
      if (i === 2) await shot('name-kanji');
      await closeTabX(file); await wait(600);
    }
    check('after the four, the folder holds those four sheet files and nothing else', JSON.stringify(await ls()) === JSON.stringify(names.map((n) => `${n}.sheet`).sort()), await ls());
    // Quick Open, typed with the accent.
    await page.keyboard.press('Control+p');
    await page.waitForSelector('[data-px-id="quickAccess.input"]', { timeout: 5000 });
    await page.keyboard.type('Café', { delay: 30 }); await wait(900); await page.keyboard.press('Enter');
    await sheetUp('Café.sheet').catch(() => {});
    check('Quick Open (Ctrl+P), "Café" typed: the sheet opens with its entry', (await group(0))?.active === 'Café.sheet' && (await cell(0, 0)) === 'entry0x', { g: await group(0) });
    await closeTabX('Café.sheet');

    // A text file with an en dash in its name.
    await fs.writeFile(at('Notes – draft.md'), 'dash notes body\n');
    await fs.writeFile(at('Notes - draft.md'), 'HYPHEN TWIN: the wrong file\n');
    const before = await ls();
    await runSafe('file.openFile', at('Notes – draft.md')); await wait(1800);
    const g = await group(0);
    check('file.openFile on "Notes – draft.md" opens that file\'s text under that name', g?.active === 'Notes – draft.md' && /dash notes body/.test(g.text ?? ''), g);
    check('and makes no new file', JSON.stringify(await ls()) === JSON.stringify(before), { before, after: await ls() });
    await closeTabX('Notes – draft.md'); await wait(400);
    await clickNode('Notes – draft.md'); await wait(1500);
    const g3 = await group(0);
    check('the same file clicked in the Explorer shows its text', g3?.active === 'Notes – draft.md' && /dash notes body/.test(g3.text ?? ''), g3);
    // A name with a space, a #, a % and a + (characters a path-as-text form trips on).
    for (const name of ['100% plan #2 + more', 'a?b=c&d']) {
      const made = await runSafe('worksheet.newSheet', name); await wait(3500);
      const g4 = await group(0);
      note(`worksheet.newSheet ${JSON.stringify(name)} made ${JSON.stringify(typeof made.value === 'string' ? path.basename(made.value) : made)}; the tab reads ${JSON.stringify(g4?.active)}, live sheet ${g4?.live}`);
      if (typeof made.value === 'string') {
        await enter(0, 0, 'odd-name-entry').catch(() => {});
        const took = await untilFile(made.value, /odd-name-entry/, 5000);
        check(`a name with ${name.replace(/[a-z0-9 ]/gi, '').split('').join(' ')}: the entry typed is in the file the command returned`, took >= 0 && g4?.live === true, { made, took, files: await ls() });
      }
    }
  });

  // ───────────────────────── 2 ─────────────────────────
  await phase('2 Explorer rename', async () => {
    const budget = await newSheet('Budget');
    await enter(0, 0, 'rent1'); await wait(3200);
    check('before: Budget.sheet is open, live, and its file holds the first entry', (await group(0))?.active === 'Budget.sheet' && /rent1/.test(await fileText(budget)), await group(0));
    const how = await renameInExplorer('Budget.sheet', 'Costs.sheet', 'menu');
    await wait(1200); await sheetUp('Costs.sheet').catch(() => {});
    const g = await group(0);
    await shot('rename-sheet');
    check('renamed in the Explorer (right-click, Rename, typed): the tab now reads Costs.sheet and no tab reads Budget.sheet', how === 'done' && g?.active === 'Costs.sheet' && !(await allTabs()).includes('Budget.sheet'), { how, g, rows: await explorerRows() });
    check('it is a live sheet with the entry', g?.live && (await cell(0, 0)) === 'rent1', { live: g?.live, a1: await cell(0, 0) });
    await enter(1, 0, 'rent2'); await wait(3000);
    const costs = await fileText(at('Costs.sheet'));
    check('a further entry and 3 seconds: Costs.sheet holds both entries', /rent1/.test(costs) && /rent2/.test(costs), costs.slice(0, 200));
    check('and Budget.sheet does not exist', !(await exists(budget)), await ls());

    // Twice in a row.
    const how2 = await renameInExplorer('Costs.sheet', 'Costs 2027.sheet', 'menu');
    await wait(1200); await sheetUp('Costs 2027.sheet').catch(() => {});
    await enter(2, 0, 'rent3').catch(() => {}); await wait(3000);
    const c27 = await fileText(at('Costs 2027.sheet'));
    check('renamed a second time: the tab follows, a third entry lands in the new file, the two old names do not exist', how2 === 'done' && (await group(0))?.active === 'Costs 2027.sheet' && /rent1/.test(c27) && /rent2/.test(c27) && /rent3/.test(c27) && !(await exists(at('Costs.sheet'))) && !(await exists(budget)), { how2, g: await group(0), files: await ls() });

    // An entry made, and the rename started at once (inside the 1.5 s the sheet takes to save).
    await enter(3, 0, 'quick4');
    const t0 = Date.now();
    const how3 = await renameInExplorer('Costs 2027.sheet', 'Fast.sheet', 'fast');
    const tookRename = Date.now() - t0;
    await wait(3500); await sheetUp('Fast.sheet').catch(() => {});
    const fast = await fileText(at('Fast.sheet'));
    console.log(`       the rename was confirmed ${tookRename} ms after the entry's Enter; files now: ${JSON.stringify(await ls())}`);
    check('an entry made just before the rename: the old name is not brought back', how3 === 'done' && !(await exists(at('Costs 2027.sheet'))), { files: await ls(), old: (await fileText(at('Costs 2027.sheet'))).slice(-160) });
    check('an entry made just before the rename: it is in the renamed file and on the sheet', /quick4/.test(fast) && (await cell(3, 0)) === 'quick4', { inFile: /quick4/.test(fast), onSheet: await cell(3, 0), inOld: /quick4/.test(await fileText(at('Costs 2027.sheet'))) });
    await fs.rm(at('Costs 2027.sheet'), { force: true }); await wait(2500);

    // An entry still being typed (no Enter), then the rename.
    if ((await group(0))?.live) {
      await clickCell(4, 0); await page.keyboard.type('half5', { delay: 22 });
      const how4 = await renameInExplorer('Fast.sheet', 'Half.sheet', 'menu');
      await wait(3500); await sheetUp('Half.sheet').catch(() => {});
      const half = await fileText(at('Half.sheet'));
      check('an entry still being typed when the file is renamed: the old name is not brought back', how4 === 'done' && !(await exists(at('Fast.sheet'))), { how4, files: await ls() });
      check('an entry still being typed when the file is renamed: it is not lost', /half5/.test(half) && (await cell(4, 0)) === 'half5', { inNewFile: /half5/.test(half), onSheet: await cell(4, 0), inOldFile: /half5/.test(await fileText(at('Fast.sheet'))) });
      await fs.rm(at('Fast.sheet'), { force: true }); await wait(2500);
    }

    // Renamed while another tab is the one shown.
    const cur = (await ls()).includes('Half.sheet') ? 'Half.sheet' : 'Fast.sheet';
    await clickTab('Welcome'); await wait(900);
    const how5 = await renameInExplorer(cur, 'Hidden.sheet', 'menu'); await wait(2500);
    const g5 = await group(0);
    note(`renamed while its tab was not the shown one: tabs ${JSON.stringify(g5?.tabs)}, shown ${JSON.stringify(g5?.active)}, files ${JSON.stringify(await ls())} (${how5})`);
    check('renamed while its tab was not shown: a tab reads the new name, none reads the old', (await allTabs()).includes('Hidden.sheet') && !(await allTabs()).includes(cur), await allTabs());
    await clickTab('Hidden.sheet'); await sheetUp('Hidden.sheet').catch(() => {});
    await enter(6, 0, 'rent7').catch(() => {}); await wait(3000);
    check('shown again it is live, and an entry lands in the new name only', (await group(0))?.live && /rent7/.test(await fileText(at('Hidden.sheet'))) && !(await exists(at(cur))), { g: await group(0), files: await ls() });
    await closeTabX('Hidden.sheet');

    // A text file with no unsaved changes.
    await fs.writeFile(at('plain.txt'), 'plain words\n'); await wait(2000);
    await run('file.openFile', at('plain.txt')); await wait(1500);
    const g6a = await group(0);
    const how6 = await renameInExplorer('plain.txt', 'plain2.txt', 'menu'); await wait(2500);
    const g6 = await group(0);
    await shot('rename-clean-text');
    console.log(`       before: shown ${JSON.stringify(g6a?.active)} unsaved ${JSON.stringify(g6a?.dirty)}; after the rename (${how6}): tabs ${JSON.stringify(g6?.tabs)}, shown ${JSON.stringify(g6?.active)}, text ${JSON.stringify((g6?.text ?? '').slice(0, 40))}; files ${JSON.stringify((await ls()).filter((n) => n.startsWith('plain')))}`);
    check('a text file with no unsaved changes, renamed: the file is renamed on disk', how6 === 'done' && (await exists(at('plain2.txt'))) && !(await exists(at('plain.txt'))), await ls());
    check('its tab reads plain2.txt with its text, and no tab reads plain.txt', g6?.active === 'plain2.txt' && /plain words/.test(g6.text ?? '') && !(await allTabs()).includes('plain.txt'), { tabs: g6?.tabs, shown: g6?.active, id: g6?.activeId });
    // A person goes on working in the tab that is shown, and saves.
    await clickEl('textarea.text-editor-textarea'); await page.keyboard.press('Control+End'); await page.keyboard.type('added after rename', { delay: 15 }); await wait(400);
    const g6b = await group(0);
    await page.keyboard.press('Control+s'); await wait(2500);
    const g6c = await group(0);
    console.log(`       typed into the shown tab (${JSON.stringify(g6b?.active)}, which then reads ${JSON.stringify(g6b?.text)}, unsaved ${JSON.stringify(g6b?.dirty)}) and Ctrl+S: files ${JSON.stringify((await ls()).filter((n) => n.startsWith('plain')))}; plain.txt holds ${JSON.stringify(await fileText(at('plain.txt')))}; plain2.txt holds ${JSON.stringify(await fileText(at('plain2.txt')))}; unsaved after ${JSON.stringify(g6c?.dirty)}; said ${JSON.stringify(await messages())}`);
    check('typed into and saved (Ctrl+S): plain2.txt holds it and plain.txt does not exist', /added after rename/.test(await fileText(at('plain2.txt'))) && !(await exists(at('plain.txt'))), { plain: await fileText(at('plain.txt')), plain2: await fileText(at('plain2.txt')) });
    for (const t of ['plain2.txt', 'plain.txt']) if ((await allTabs()).includes(t)) { await clickTab(t); await run('workbench.action.closeActiveEditor'); await wait(400); }
    // The same text-file case, the file opened as a person does it: clicked in the Explorer.
    await fs.writeFile(at('clicked.txt'), 'clicked words\n'); await wait(2500);
    await clickNode('clicked.txt'); await wait(1500);
    const g6k0 = await group(0);
    const how6k = await renameInExplorer('clicked.txt', 'clicked2.txt', 'menu'); await wait(2500);
    const g6k = await group(0);
    check('a text file opened by a click in the Explorer, then renamed there: its tab reads the new name', how6k === 'done' && g6k0?.active === 'clicked.txt' && g6k?.active === 'clicked2.txt' && !(await allTabs()).includes('clicked.txt'), { before: g6k0?.active, tabs: g6k?.tabs, shown: g6k?.active, files: (await ls()).filter((n) => n.startsWith('clicked')) });
    for (const t of ['clicked2.txt', 'clicked.txt']) if ((await allTabs()).includes(t)) { await clickTab(t); await run('workbench.action.closeActiveEditor'); await wait(400); }
    // The same for a text file inside a folder, and for a PDF (a viewer, never unsaved).
    await fs.mkdir(at('Docs'), { recursive: true }); await fs.writeFile(at('Docs', 'inner.txt'), 'inner words\n'); await fs.writeFile(at('Docs', 'doc.pdf'), tinyPdf('Doc words')); await wait(2000);
    await clickNode('Docs'); await wait(900);
    await run('file.openFile', at('Docs', 'inner.txt')); await wait(1500);
    const how6d = await renameInExplorer('Docs/inner.txt', 'inner2.txt', 'menu'); await wait(2500);
    const g6d = await group(0);
    check('a text file inside a folder, renamed: its tab reads the new name', how6d === 'done' && g6d?.active === 'inner2.txt' && !(await allTabs()).includes('inner.txt'), { tabs: g6d?.tabs, shown: g6d?.active, files: await ls(at('Docs')) });
    for (const t of ['inner2.txt', 'inner.txt']) if ((await allTabs()).includes(t)) { await clickTab(t); await run('workbench.action.closeActiveEditor'); await wait(400); }
    await run('file.openFile', at('Docs', 'doc.pdf')); await wait(3000);
    const how6e = await renameInExplorer('Docs/doc.pdf', 'doc2.pdf', 'menu'); await wait(3500);
    const g6e = await group(0);
    check('a PDF, renamed: its tab reads the new name and still shows the PDF', how6e === 'done' && g6e?.active === 'doc2.pdf' && /pdf/.test(g6e.pane ?? '') && !(await allTabs()).includes('doc.pdf'), { tabs: g6e?.tabs, shown: g6e?.active, pane: g6e?.pane, files: await ls(at('Docs')) });
    for (const t of ['doc2.pdf', 'doc.pdf']) if ((await allTabs()).includes(t)) { await clickTab(t); await run('workbench.action.closeActiveEditor'); await wait(400); }

    // A text file WITH unsaved changes: reported as seen.
    await fs.writeFile(at('dirty.txt'), 'saved words\n'); await wait(2000);
    await run('file.openFile', at('dirty.txt')); await wait(1500);
    await clickEl('textarea.text-editor-textarea'); await page.keyboard.press('Control+End'); await page.keyboard.type('UNSAVED', { delay: 15 }); await wait(500);
    const gd0 = await group(0);
    const how7 = await renameInExplorer('dirty.txt', 'dirty2.txt', 'menu'); await wait(2500);
    const gd1 = await group(0);
    await shot('rename-dirty-text');
    note(`a text file with unsaved changes, renamed in the Explorer (${how7}): before, shown ${JSON.stringify(gd0?.active)} marked unsaved ${JSON.stringify(gd0?.dirty)}; after, tabs ${JSON.stringify(gd1?.tabs)}, shown ${JSON.stringify(gd1?.active)}, marked unsaved ${JSON.stringify(gd1?.dirty)}, text ${JSON.stringify((gd1?.text ?? '').slice(0, 60))}; files ${JSON.stringify((await ls()).filter((n) => n.startsWith('dirty')))}; said ${JSON.stringify(await messages())}`);
    if (gd1?.tabs.includes('dirty.txt')) { await clickTab('dirty.txt'); await clickEl('textarea.text-editor-textarea'); }
    await page.keyboard.press('Control+s'); await wait(1800);
    const gd2 = await group(0);
    note(`then Ctrl+S in that tab: files ${JSON.stringify((await ls()).filter((n) => n.startsWith('dirty')))}; dirty.txt holds ${JSON.stringify(await fileText(at('dirty.txt')))}; dirty2.txt holds ${JSON.stringify(await fileText(at('dirty2.txt')))}; tabs ${JSON.stringify(gd2?.tabs)} marked unsaved ${JSON.stringify(gd2?.dirty)}; said ${JSON.stringify(await messages())}`);
  });

  // ───────────────────────── 3 ─────────────────────────
  await phase('3 Explorer delete', async () => {
    const file = await newSheet('Trash');
    await enter(0, 0, 'bin1'); await wait(3200);
    // Cancel first: nothing changes.
    const cancelled = await deleteInExplorer('Trash.sheet', 'menu', 'Cancel'); await wait(1200);
    check('Delete, then Cancel in the dialog: the file and its live tab stay', cancelled.step === 'done' && (await exists(file)) && (await group(0))?.active === 'Trash.sheet' && (await group(0))?.live, { cancelled, g: await group(0) });
    const res = await deleteInExplorer('Trash.sheet', 'menu');
    const w1 = await goneAndBack(file, 5500);
    await shot('delete-after');
    console.log(`       the dialog said: ${JSON.stringify(res.asked)}; the file: ${JSON.stringify(w1)}`);
    check('deleted in the Explorer (right-click, Delete, Move to Trash): its tab closes', res.step === 'done' && !(await allTabs()).includes('Trash.sheet'), { res, tabs: await allTabs() });
    check('the file goes and does not come back within 5 seconds', w1.goneAfterMs >= 0 && w1.backAfterMs === -1 && !w1.thereAtEnd, { w1, files: await ls() });
    check('no sheet is left on screen', (await liveCount()) === 0, await groups());

    // An entry made, and deleted at once (inside the save delay).
    const file2 = await newSheet('Trash Two');
    await enter(0, 0, 'bin2');
    const res2 = await deleteInExplorer('Trash Two.sheet', 'now');
    const w2 = await goneAndBack(file2, 5500);
    check('an entry made just before the delete: the tab closes, the file goes and does not come back within 5 seconds', res2.step === 'done' && !(await allTabs()).includes('Trash Two.sheet') && w2.goneAfterMs >= 0 && w2.backAfterMs === -1 && !w2.thereAtEnd, { res2: res2.step, w2, files: await ls(), holdsTheEntry: /bin2/.test(await fileText(file2)) });
    await fs.rm(file2, { force: true }); await wait(2000);

    // An entry still being typed, then deleted.
    await reset();
    const file3 = await newSheet('Trash Three');
    await clickCell(0, 0); await page.keyboard.type('bin3', { delay: 22 });
    const res3 = await deleteInExplorer('Trash Three.sheet', 'menu');
    const w3 = await goneAndBack(file3, 5500);
    check('an entry still being typed when the file is deleted: the tab closes, the file goes and does not come back within 5 seconds', res3.step === 'done' && !(await allTabs()).includes('Trash Three.sheet') && w3.goneAfterMs >= 0 && w3.backAfterMs === -1 && !w3.thereAtEnd, { res3: res3.step, w3, files: await ls(), holdsTheEntry: /bin3/.test(await fileText(file3)) });
    await fs.rm(file3, { force: true }); await wait(2000);

    // A text file open with no unsaved changes, deleted.
    await reset();
    await fs.writeFile(at('gone.txt'), 'text to delete\n'); await wait(2000);
    await run('file.openFile', at('gone.txt')); await wait(1500);
    const res5 = await deleteInExplorer('gone.txt', 'menu'); await wait(2000);
    const g5 = await group(0);
    check('a text file with no unsaved changes, deleted in the Explorer: its tab closes', res5.step === 'done' && !(await exists(at('gone.txt'))) && !(await allTabs()).includes('gone.txt'), { res5: res5.step, tabs: g5?.tabs, shown: g5?.active, text: (g5?.text ?? '').slice(0, 30), there: await exists(at('gone.txt')) });
    if ((await allTabs()).includes('gone.txt')) { await clickTab('gone.txt'); await run('workbench.action.closeActiveEditor'); await wait(400); }

    // Keys: a row clicked in the Explorer, then F2 or Delete. A text file that is open and shown first (what the Explorer does), then a sheet.
    await fs.writeFile(at('keys.txt'), 'keys words\n'); await wait(2000);
    await run('file.openFile', at('keys.txt')); await wait(1200);
    await clickEl('textarea.text-editor-textarea'); await wait(300);
    await clickNode('keys.txt'); await wait(1200); await page.keyboard.press('F2'); await wait(600);
    const textF2 = await page.evaluate(() => !!document.querySelector('.tree-inline-input'));
    await page.keyboard.press('Escape'); await wait(400);
    await clickNode('keys.txt'); await wait(1200); await page.keyboard.press('Delete'); await wait(600);
    const textDel = await waitPrompt(/delete/i, 1500);
    if (textDel) await clickPromptButton('Cancel');
    const textKept = (await group(0))?.text;
    check('control, a text file open and shown: its row clicked in the Explorer, F2 gives the name box, Delete gives the delete dialog, the text is untouched', textF2 && !!textDel && /keys words/.test(textKept ?? ''), { textF2, textDel, textKept });
    await reset();
    const fileK = await newSheet('Keys');
    await enter(0, 0, 'keep'); await wait(3200);
    await clickCell(0, 0);
    await clickNode('Keys.sheet'); await wait(1200); await page.keyboard.press('F2'); await wait(700);
    const sheetF2 = { nameBox: await page.evaluate(() => !!document.querySelector('.tree-inline-input')), cellBeingEdited: (await hostCall('probeState').catch(() => null))?.editorVisible ?? null };
    await shot('keys-f2-on-sheet');
    await page.keyboard.press('Escape'); await wait(500);
    check('an open sheet: its row clicked in the Explorer, then F2: the name box appears (as it does for a text file)', sheetF2.nameBox === true, sheetF2);
    await clickCell(0, 0); await clickNode('Keys.sheet'); await wait(1200); await page.keyboard.press('Delete'); await wait(1200);
    const asked = await waitPrompt(/delete/i, 1500);
    const a1 = await cell(0, 0);
    if (asked) await clickPromptButton('Cancel');
    await wait(3000);
    const keptInFile = /keep/.test(await fileText(fileK));
    check('an open sheet: its row clicked in the Explorer, then Delete: the delete dialog appears', !!asked, { askedToDelete: !!asked });
    check('and the sheet\'s selected cell is not what gets deleted (A1 held "keep")', a1 === 'keep' && keptInFile, { a1, fileStillHoldsKeep: keptInFile });
    // The same on a sheet that was not open: the click opens it.
    await reset();
    await clickNode('Keys.sheet'); await sheetUp('Keys.sheet').catch(() => {}); await page.keyboard.press('F2'); await wait(700);
    const closedF2 = { nameBox: await page.evaluate(() => !!document.querySelector('.tree-inline-input')), cellBeingEdited: (await hostCall('probeState').catch(() => null))?.editorVisible ?? null };
    await page.keyboard.press('Escape'); await wait(500);
    note(`a sheet that was not open, its row clicked in the Explorer (it opens), then F2: ${JSON.stringify(closedF2)}`);
    await reset();

    // A folder holding an open sheet, deleted.
    await reset();
    await fs.mkdir(at('Old Year'), { recursive: true });
    await fs.copyFile(at('Trash Four.sheet').replace('Trash Four', 'seed'), at('Old Year', 'Inside.sheet')).catch(async () => { const made = await run('worksheet.newSheet', 'seed'); await sheetUp('seed.sheet'); await enter(0, 0, 'seeded'); await wait(2600); await closeTabX('seed.sheet'); await wait(600); await fs.copyFile(made, at('Old Year', 'Inside.sheet')); });
    await wait(2000); await run('file.openFile', at('Old Year', 'Inside.sheet')); await sheetUp('Inside.sheet').catch(() => {});
    await enter(1, 0, 'inside2').catch(() => {}); await wait(3200);
    const res4 = await deleteInExplorer('Old Year', 'menu');
    const back4 = await cameBack(at('Old Year'), 5000);
    check('a folder holding an open sheet, deleted: the sheet\'s tab closes and the folder does not come back', res4.step === 'done' && !(await allTabs()).includes('Inside.sheet') && back4 === -1, { res4, tabs: await allTabs(), cameBackAfterMs: back4, files: await ls() });
    await fs.rm(at('Old Year'), { recursive: true, force: true });
  });

  // ───────────────────────── 4 ─────────────────────────
  await phase('4 Explorer move', async () => {
    await fs.mkdir(at('Sub'), { recursive: true }); await fs.mkdir(at('Sub2'), { recursive: true }); await wait(2000);
    const file = await newSheet('Mover');
    await enter(0, 0, 'm1'); await wait(3200);
    // Cut and paste by the Explorer's own menu.
    await wait(4500);
    const cut = (await clickNode('Mover.sheet', { button: 'right' })) && (await pickMenuRow('Cut'));
    const onFolder = await clickNode('Sub', { button: 'right' });
    const menu = (await menuLabels()).map((r) => r.label);
    const pasted = onFolder && (await pickMenuRow('Paste'));
    await wait(2500); await sheetUp('Mover.sheet').catch(() => {});
    const g = await group(0);
    await shot('move-cut-paste');
    check('cut and pasted into a subfolder: the file is in the subfolder and no longer in the first folder', !!cut && !!pasted && (await exists(at('Sub', 'Mover.sheet'))) && !(await exists(file)), { cut, pasted, menu, top: await ls(), sub: await ls(at('Sub')) });
    check('its tab follows to the new path, a live sheet with the entry', g?.active === 'Mover.sheet' && g.live && /\/sub\/mover\.sheet$/i.test(relOf(g.activeId)) && (await cell(0, 0)) === 'm1', { g, a1: await cell(0, 0) });
    await enter(1, 0, 'm2').catch(() => {}); await wait(3000);
    const moved = await fileText(at('Sub', 'Mover.sheet'));
    check('a further entry is saved there, and the old place stays empty', /m1/.test(moved) && /m2/.test(moved) && !(await exists(file)), { moved: moved.slice(-160), top: await ls() });
    check('there is one Mover.sheet tab, not two', (await allTabs()).filter((t) => t === 'Mover.sheet').length === 1, await allTabs());

    // A file that is not open, dragged onto a folder: is the page error below the Explorer's own, or the open sheet's?
    await fs.writeFile(at('loose.txt'), 'loose\n'); await wait(2500);
    { const f = await waitNode('loose.txt'); const t = await waitNode('Sub2'); const n = errors.length;
      if (f && t) { await page.mouse.move(f.x, f.y); await page.mouse.down(); await wait(150); for (let i = 1; i <= 8; i++) { await page.mouse.move(f.x + ((t.x - f.x) * i) / 8, f.y + ((t.y - f.y) * i) / 8); await wait(60); } await page.mouse.move(t.x + 2, t.y + 1); await wait(200); await page.mouse.up(); await wait(2500); }
      note(`a file that is not open, dragged onto a folder: moved ${await exists(at('Sub2', 'loose.txt'))}, page errors ${errors.length - n}, Explorer rows ${JSON.stringify(await explorerRows())}`); }
    // Dragged with the mouse onto another folder.
    const errorsBeforeDrag = errors.length;
    const from = await waitNode('Sub/Mover.sheet'); const to = await waitNode('Sub2');
    let dragged = false;
    if (from && to) {
      await page.mouse.move(from.x, from.y); await page.mouse.down(); await wait(150);
      for (let i = 1; i <= 8; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8); await wait(60); }
      await page.mouse.move(to.x + 2, to.y + 1); await wait(200); await page.mouse.up(); await wait(2500);
      dragged = await exists(at('Sub2', 'Mover.sheet'));
    }
    if (!dragged) note(`dragging the file onto a folder with the mouse did not move it here (rows ${JSON.stringify(await explorerRows())}): the drag is not checked`);
    else {
      await sheetUp('Mover.sheet').catch(() => {});
      const gd = await group(0);
      check('dragged onto another folder: the tab follows, a live sheet with both entries', gd?.active === 'Mover.sheet' && gd.live && /\/sub2\/mover\.sheet$/i.test(relOf(gd.activeId)) && (await cell(1, 0)) === 'm2', { gd, a2: await cell(1, 0) });
      await enter(2, 0, 'm3').catch(() => {}); await wait(3000);
      check('and saves there: the new place holds the third entry, the place before it is gone', /m3/.test(await fileText(at('Sub2', 'Mover.sheet'))) && !(await exists(at('Sub', 'Mover.sheet'))), { sub: await ls(at('Sub')), sub2: await ls(at('Sub2')) });
      await shot('move-drag');
      check('dragging the open sheet onto a folder raises no page error', errors.length === errorsBeforeDrag, errors.slice(errorsBeforeDrag));
      note(`after the drag the Explorer rows are ${JSON.stringify(await explorerRows())}`);
    }
    // The folder that holds the open sheet is renamed.
    const holder = dragged ? 'Sub2' : 'Sub';
    const how = await renameInExplorer(holder, 'Archive', 'menu'); await wait(2500); await sheetUp('Mover.sheet').catch(() => {});
    const gf = await group(0);
    await enter(4, 0, 'm5').catch(() => {}); await wait(3000);
    check('the folder holding the open sheet is renamed: the tab follows and the next entry is saved under the new folder, the old folder is not brought back', how === 'done' && gf?.live && /\/archive\/mover\.sheet$/i.test(relOf(gf.activeId)) && /m5/.test(await fileText(at('Archive', 'Mover.sheet'))) && !(await exists(at(holder))), { how, gf, top: await ls() });
  });

  // ───────────────────────── 5 ─────────────────────────
  await phase('5 gone by another program', async () => {
    const WORDS = /no longer where it was/;
    // (a) renamed from outside, then an entry; Save a Copy.
    const file = await newSheet('Gone');
    await enter(0, 0, 'one'); await wait(2600);
    check('before: the file holds the first entry', /one/.test(await fileText(file)), null);
    await fs.rename(file, at('Elsewhere.sheet'));
    await enter(1, 0, 'two');
    const told = await waitPrompt(WORDS, 6000);
    await wait(1200);
    await shot('gone-told');
    check('renamed by another program, then an entry: the old file is not brought back', !(await exists(file)), await ls());
    check('the person is told the file is no longer where it was, and offered Save a Copy', !!told && told.buttons.includes('Save a Copy'), { told, onScreen: await prompts(), said: await messages() });
    console.log(`       on screen: ${JSON.stringify(told)}`);
    const before = await ls();
    const clicked = await clickPromptButton('Save a Copy'); await wait(3500);
    const added = (await ls()).filter((n) => !before.includes(n));
    const copyText = added.length ? await fileText(at(added[0])) : '';
    check('Save a Copy makes one new .sheet beside the old place, holding both entries', clicked && added.length === 1 && added[0].endsWith('.sheet') && /one/.test(copyText) && /two/.test(copyText), { clicked, added, files: await ls(), copy: copyText.slice(-200) });
    const gs = await groups();
    console.log(`       the copy is ${JSON.stringify(added)}; tabs now ${JSON.stringify(gs.map((g) => ({ tabs: g.tabs, shown: g.active, live: g.live, id: relOf(g.activeId).split('/').pop() })))}`);
    check('and opens it: the shown tab is the copy, a live sheet with both entries', added.length === 1 && gs[0]?.active === added[0] && gs[0].live && (await cell(0, 0)) === 'one' && (await cell(1, 0)) === 'two', { gs, a1: await cell(0, 0), a2: await cell(1, 0) });
    // Is the tab the person is left in one that saves?
    await enter(2, 0, 'three').catch(() => {}); await wait(3500);
    const holders = []; for (const n of await ls()) if (n.endsWith('.sheet') && /three/.test(await fileText(at(n)))) holders.push(n);
    check('an entry typed after Save a Copy is saved to the copy', added.length === 1 && holders.length === 1 && holders[0] === added[0], { holders, files: await ls(), onScreen: await prompts(), said: await messages() });
    check('the file the other program made is as it left it (first entry only)', /one/.test(await fileText(at('Elsewhere.sheet'))) && !/two/.test(await fileText(at('Elsewhere.sheet'))), (await fileText(at('Elsewhere.sheet'))).slice(-120));
    note(`after Save a Copy the tabs are ${JSON.stringify(await allTabs())} (the copy was named ${JSON.stringify(added[0])}, the gone file was Gone.sheet)`);

    // (b) the other button.
    await reset();
    const file2 = await newSheet('Gone Two');
    await enter(0, 0, 'uno'); await wait(2600);
    await fs.rename(file2, at('Elsewhere Two.sheet'));
    await enter(1, 0, 'dos');
    const told2 = await waitPrompt(WORDS, 6000); await wait(800);
    const clicked2 = await clickPromptButton('Discard Changes'); await wait(1500);
    const g = await group(0);
    await messages();
    check('the other button is there (Discard Changes)', !!told2 && told2.buttons.includes('Discard Changes') && clicked2, told2);
    note(`after Discard Changes: tabs ${JSON.stringify(g?.tabs)}, shown ${JSON.stringify(g?.active)}, a live sheet ${g?.live}, A1 ${JSON.stringify(await cell(0, 0))}, A2 ${JSON.stringify(await cell(1, 0))}; words on the pane ${JSON.stringify(g?.words)}; prompts on screen ${JSON.stringify(await prompts())}`);
    await enter(2, 0, 'tres').catch(() => {}); await wait(4500);
    const holding = []; for (const n of await ls()) if (n.endsWith('.sheet') && /tres/.test(await fileText(at(n)))) holding.push(n);
    const after = { prompts: await prompts(), said: await messages(), a3: await cell(2, 0), oldFileBack: await exists(file2), filesHoldingTheEntry: holding, tabs: await allTabs() };
    await shot('gone-discarded');
    note(`then a further entry in that tab and 4.5 seconds: ${JSON.stringify(after)}`);
    check('after Discard Changes the tab is not a dead end: it closes, or says again that it cannot save, or does not take a further entry', !after.tabs.includes('Gone Two.sheet') || after.prompts.some((p) => WORDS.test(p.words)) || after.said.some((m) => WORDS.test(m)) || after.a3 !== 'tres', after);
    // Leaving and closing it.
    await clickTab('Welcome'); await wait(900);
    if ((await allTabs()).includes('Gone Two.sheet')) { await clickTab('Gone Two.sheet'); await wait(3500); const gb = await group(0); await shot('gone-discarded-shown-again'); note(`that tab left and shown again: ${JSON.stringify({ live: gb?.live, words: gb?.words, a1: gb?.live ? await cell(0, 0) : null })}; Gone Two.sheet exists ${await exists(file2)}; said ${JSON.stringify(await messages())}`); await closeTabX('Gone Two.sheet'); await wait(800); }
    check('through all of it the old file was never brought back', !(await exists(file2)), await ls());

    // (c) renamed from outside, an entry, and the tab left at once (before the 1.5 s save).
    await reset();
    const file3 = await newSheet('Gone Three');
    await enter(0, 0, 'one'); await wait(2600);
    await fs.rename(file3, at('Elsewhere Three.sheet'));
    await enter(1, 0, 'two'); await clickTab('Welcome');
    const back3 = await cameBack(file3, 4000);
    const said3 = [...(await prompts()).map((p) => p.words), ...(await messages())];
    check('renamed by another program, an entry, and the tab left at once: the old file is not brought back', back3 === -1, { cameBackAfterMs: back3, theFileThatCameBackHolds: { one: /"one"/.test(await fileText(file3)), two: /"two"/.test(await fileText(file3)) }, theRenamedFileHoldsTwo: /"two"/.test(await fileText(at('Elsewhere Three.sheet'))), files: await ls() });
    check('and the person is told', said3.some((m) => WORDS.test(m)), said3);
    await fs.rm(file3, { force: true });

    // (d) the same, and the tab closed at once by its ×.
    await reset();
    const file4 = await newSheet('Gone Four');
    await enter(0, 0, 'one'); await wait(2600);
    await fs.rename(file4, at('Elsewhere Four.sheet'));
    await enter(1, 0, 'two'); await closeTabX('Gone Four.sheet');
    const back4 = await cameBack(file4, 4000);
    const said4 = [...(await prompts()).map((p) => p.words), ...(await messages())];
    check('renamed by another program, an entry, and the tab closed at once: the old file is not brought back', back4 === -1, { cameBackAfterMs: back4, theFileThatCameBackHolds: { one: /"one"/.test(await fileText(file4)), two: /"two"/.test(await fileText(file4)) }, files: await ls() });
    note(`in that case the person was told: ${JSON.stringify(said4)}`);
    await fs.rm(file4, { force: true });

    // (e) deleted from outside (not renamed), then an entry.
    await reset();
    const file5 = await newSheet('Gone Five');
    await enter(0, 0, 'one'); await wait(2600);
    await fs.rm(file5);
    await enter(1, 0, 'two');
    const told5 = await waitPrompt(WORDS, 6000); await wait(600);
    check('deleted by another program, then an entry: not brought back, and the person is told', !(await exists(file5)) && !!told5, { told5, files: await ls() });
    const before5 = await ls();
    await clickPromptButton('Save a Copy'); await wait(3500);
    const added5 = (await ls()).filter((n) => !before5.includes(n));
    const g5 = await group(0);
    await enter(2, 0, 'three').catch(() => {}); await wait(3500);
    check('Save a Copy there: a new file holds both entries, and the tab left on screen saves a further entry to it', added5.length === 1 && /one/.test(await fileText(at(added5[0]))) && /two/.test(await fileText(at(added5[0]))) && /three/.test(await fileText(at(added5[0]))), { added5, g5, holds: added5.length ? (await fileText(at(added5[0]))).slice(-200) : null, onScreen: await prompts() });
  });

  // ───────────────────────── 6 ─────────────────────────
  await phase('6 the same file twice', async () => {
    const WAITS = /open in another tab group/;
    const state = async () => (await groups()).map((g) => ({ shown: g.active, live: g.live, waits: WAITS.test(g.words), words: g.live ? '' : g.words.slice(0, 90) }));
    const sheetGroups = async (label) => (await groups()).map((g, i) => ({ ...g, i })).filter((g) => g.active === label);
    /** Exactly one of the groups showing the file is live, and every other says it waits. */
    const oneLive = async (label) => { const gs = await sheetGroups(label); return gs.length > 0 && gs.filter((g) => g.live).length === 1 && gs.filter((g) => !g.live).every((g) => WAITS.test(g.words)); };
    const liveIndex = async (label) => (await sheetGroups(label)).find((g) => g.live)?.i ?? -1;
    const waitIndex = async (label) => (await sheetGroups(label)).find((g) => !g.live)?.i ?? -1;

    const file = await newSheet('Twin');
    await enter(0, 0, 'one'); await wait(2600);
    await run('workbench.action.splitEditor'); await wait(3500);
    let st = await state();
    await shot('split-same-file');
    console.log(`       after Split Editor: ${JSON.stringify(st)}`);
    check('after Split Editor two panes show Twin.sheet and only one is a live sheet', st.filter((s) => s.shown === 'Twin.sheet').length === 2 && st.filter((s) => s.live).length === 1, st);
    check('the other says in words that the sheet is open in another tab group', st.some((s) => !s.live && s.waits), st);
    let li = await liveIndex('Twin.sheet');
    await enter(1, 0, 'two', li); await wait(2600);
    check('an entry typed in the live one is on the sheet and in the file', (await cell(1, 0, li)) === 'two' && /one/.test(await fileText(file)) && /two/.test(await fileText(file)), { a2: await cell(1, 0, li), file: (await fileText(file)).slice(-160) });
    // A person clicks and types in the waiting pane.
    const wi = await waitIndex('Twin.sheet');
    const wp = await page.evaluate((wi) => { const b = window.__fx.groups()[wi].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 + 60 }; }, wi);
    await page.mouse.click(wp.x, wp.y); await page.keyboard.type('lost?', { delay: 20 }); await page.keyboard.press('Enter'); await wait(2500);
    check('typing into the waiting pane changes nothing: still one live sheet, the file as it was', (await oneLive('Twin.sheet')) && !/lost\?/.test(await fileText(file)) && /two/.test(await fileText(file)), { st: await state() });

    // Close the live one (its tab's ×): the waiting pane becomes the sheet.
    li = await liveIndex('Twin.sheet');
    await closeTabX('Twin.sheet', li); await wait(4500);
    st = await state();
    console.log(`       after the live one was closed: ${JSON.stringify(st)}`);
    const nowLive = await liveIndex('Twin.sheet');
    check('the live one closed: the waiting pane becomes the sheet, with the entries', st.filter((s) => s.shown === 'Twin.sheet').length === 1 && nowLive >= 0 && (await cell(0, 0, nowLive)) === 'one' && (await cell(1, 0, nowLive)) === 'two', { st, a1: await cell(0, 0), a2: await cell(1, 0) });
    await enter(2, 0, 'three', nowLive).catch(() => {}); await wait(2600);
    check('and an entry typed there is saved', /three/.test(await fileText(file)), (await fileText(file)).slice(-160));

    // The reverse: split again, close the waiting one first.
    await reset(); await run('file.openFile', file); await sheetUp('Twin.sheet');
    await run('workbench.action.splitEditor'); await wait(3500);
    const wi2 = await waitIndex('Twin.sheet');
    check('split again: one live, one waiting', (await oneLive('Twin.sheet')) && wi2 >= 0, await state());
    await closeTabX('Twin.sheet', wi2); await wait(2500);
    st = await state();
    const li2 = await liveIndex('Twin.sheet');
    check('the waiting one closed first: the live one is still live with the entries', st.filter((s) => s.shown === 'Twin.sheet').length === 1 && li2 >= 0 && (await cell(2, 0, li2)) === 'three', { st, a3: await cell(2, 0) });
    await enter(3, 0, 'four', li2).catch(() => {}); await wait(2600);
    check('and still saves', /four/.test(await fileText(file)), (await fileText(file)).slice(-160));

    // Split twice: three panes.
    await reset(); await run('file.openFile', file); await sheetUp('Twin.sheet');
    await run('workbench.action.splitEditor'); await wait(3000);
    await run('workbench.action.splitEditor'); await wait(3500);
    st = await state();
    await shot('split-twice');
    console.log(`       split twice: ${JSON.stringify(st)}`);
    check('split twice: three panes show the file, exactly one is live, the other two say they wait', st.filter((s) => s.shown === 'Twin.sheet').length === 3 && st.filter((s) => s.live).length === 1 && st.filter((s) => s.waits).length === 2, st);
    await closeTabX('Twin.sheet', await liveIndex('Twin.sheet')); await wait(4500);
    st = await state();
    check('the live one of three closed: exactly one of the two left becomes live, the other still waits', st.filter((s) => s.shown === 'Twin.sheet').length === 2 && st.filter((s) => s.live).length === 1 && st.filter((s) => s.waits).length === 1, st);
    await enter(4, 0, 'five', await liveIndex('Twin.sheet')).catch(() => {}); await wait(2600);
    await closeTabX('Twin.sheet', await liveIndex('Twin.sheet')); await wait(4500);
    st = await state();
    const last = await liveIndex('Twin.sheet');
    check('and again: the last pane becomes the sheet, with every entry so far', st.filter((s) => s.shown === 'Twin.sheet').length === 1 && last >= 0 && (await cell(0, 0, last)) === 'one' && (await cell(3, 0, last)) === 'four' && (await cell(4, 0, last)) === 'five', { st, a: [await cell(0, 0), await cell(3, 0), await cell(4, 0)] });

    // Switch tabs within the live group and back.
    await reset(); await run('file.openFile', file); await sheetUp('Twin.sheet');
    await run('workbench.action.splitEditor'); await wait(3500);
    const liveG = await liveIndex('Twin.sheet');
    await enter(5, 0, 'six', liveG); // not yet saved when the tab is left
    await clickTab('Welcome', liveG); await wait(4000);
    st = await state();
    console.log(`       the live group switched to another tab: ${JSON.stringify(st)}`);
    const took = await liveIndex('Twin.sheet');
    check('the live group switched to another tab: the waiting pane becomes the sheet and shows the entry made a moment before', took >= 0 && (await cell(5, 0, took)) === 'six', { st, a6: took >= 0 ? await cell(5, 0, took) : null });
    check('that entry is in the file', /six/.test(await fileText(file)), (await fileText(file)).slice(-160));
    await enter(6, 0, 'seven', took).catch(() => {});
    await clickTab('Twin.sheet', liveG); await wait(4000);
    st = await state();
    console.log(`       switched back: ${JSON.stringify(st)}`);
    check('switched back: both panes show the file, exactly one is live and the other says it waits', (await oneLive('Twin.sheet')) && st.filter((s) => s.shown === 'Twin.sheet').length === 2, st);
    check('the entries are all on the live sheet and in the file', (await cell(5, 0, await liveIndex('Twin.sheet'))) === 'six' && (await cell(6, 0, await liveIndex('Twin.sheet'))) === 'seven' && /seven/.test(await fileText(file)), { a6: await cell(5, 0, await liveIndex('Twin.sheet')), a7: await cell(6, 0, await liveIndex('Twin.sheet')), inFile: /seven/.test(await fileText(file)) });
    // Back and forth five times, an entry each time.
    const lost = [];
    for (let i = 0; i < 5; i++) {
      const l = await liveIndex('Twin.sheet'); if (l < 0) { lost.push(`round ${i}: no live pane ${JSON.stringify(await state())}`); break; }
      await enter(10 + i, 1, `r${i}`, l);
      await clickTab('Welcome', l); await wait(1800);
      const s1 = await state(); if (s1.filter((s) => s.live).length !== 1) lost.push(`round ${i} away: ${JSON.stringify(s1)}`);
      await clickTab('Twin.sheet', l); await wait(1800);
      const s2 = await state(); if (s2.filter((s) => s.live).length !== 1) lost.push(`round ${i} back: ${JSON.stringify(s2)}`);
    }
    await wait(2600);
    const lf = await liveIndex('Twin.sheet');
    const kept = []; for (let i = 0; i < 5; i++) kept.push(lf >= 0 ? await cell(10 + i, 1, lf) : null);
    const inFile = [0, 1, 2, 3, 4].map((i) => new RegExp(`"r${i}"`).test('')); const text = await fileText(file); for (let i = 0; i < 5; i++) inFile[i] = text.includes(`"r${i}"`);
    check('five times away and back with an entry each time: always exactly one live pane', lost.length === 0, lost);
    check('and none of the five entries is lost (on the sheet and in the file)', kept.every((v, i) => v === `r${i}`) && inFile.every(Boolean), { kept, inFile });

    // An entry still being typed in the live pane when it is closed.
    await reset(); await run('file.openFile', file); await sheetUp('Twin.sheet');
    await run('workbench.action.splitEditor'); await wait(3500);
    const l3 = await liveIndex('Twin.sheet');
    await clickCell(20, 0, l3); await page.keyboard.type('halfway', { delay: 20 });
    await closeTabX('Twin.sheet', l3); await wait(4500);
    const l4 = await liveIndex('Twin.sheet');
    check('an entry still being typed when the live pane is closed: the pane that takes over shows it, and the file holds it', l4 >= 0 && (await cell(20, 0, l4)) === 'halfway' && /halfway/.test(await fileText(file)), { st: await state(), a21: l4 >= 0 ? await cell(20, 0, l4) : null, inFile: /halfway/.test(await fileText(file)) });

    // Closed and opened again quickly.
    await reset(); await run('file.openFile', file); await sheetUp('Twin.sheet');
    await enter(21, 0, 'beforeclose');
    for (let i = 0; i < 3; i++) { await closeTabX('Twin.sheet'); await run('file.openFile', file); }
    await sheetUp('Twin.sheet').catch(() => {});
    st = await state();
    check('closed and opened again three times, quickly: one live sheet, with the entry made just before', st.filter((s) => s.live).length === 1 && (await cell(21, 0)) === 'beforeclose' && (await cell(0, 0)) === 'one', { st, a22: await cell(21, 0) });
    await run('workbench.action.splitEditor'); await page.waitForTimeout(150); await closeTabX('Twin.sheet', 0); await wait(4500);
    st = await state();
    check('split and the first pane closed at once: the pane left is live, not left waiting for nobody', st.filter((s) => s.shown === 'Twin.sheet').length === 1 && st.filter((s) => s.live).length === 1, st);

    // Renamed in the Explorer while it is shown twice.
    await reset(); await run('file.openFile', file); await sheetUp('Twin.sheet');
    await run('workbench.action.splitEditor'); await wait(3500);
    const how = await renameInExplorer('Twin.sheet', 'Twin Renamed.sheet', 'menu'); await wait(5000);
    st = await state();
    await shot('split-renamed');
    console.log(`       renamed while shown twice (${how}): ${JSON.stringify(st)}; tabs ${JSON.stringify(await allTabs())}`);
    const shown = st.filter((s) => s.shown === 'Twin Renamed.sheet');
    check('renamed in the Explorer while shown in two panes: no tab keeps the old name, and of the panes showing the new name exactly one is live', !(await allTabs()).includes('Twin.sheet') && shown.length >= 1 && shown.filter((s) => s.live).length === 1 && shown.filter((s) => !s.live).every((s) => s.waits), { st, tabs: await allTabs() });
    const lr = await liveIndex('Twin Renamed.sheet');
    if (lr >= 0) { await enter(22, 0, 'afterrename', lr); await wait(3000); }
    check('an entry after that lands in the new name, and the old name is not brought back', /afterrename/.test(await fileText(at('Twin Renamed.sheet'))) && !(await exists(file)), { files: await ls() });
  });

  // ───────────────────────── 7 ─────────────────────────
  await phase('7 undo after growth', async () => {
    await newSheet('Undo');
    const start = await gridSize();
    await enter(0, 0, 'top'); await wait(300);
    await clickCell(0, 3); await key('Control+ArrowDown'); await wait(600);
    const atEnd = await activeCell(); const grown = await gridSize();
    check('Ctrl+Down in an empty column goes to row 1000 and the grid grows past 1,000 rows', start.rows === 1000 && atEnd === 'D1000' && grown.rows > 1000, { start, atEnd, grown });
    await type('word'); await key('Enter'); await wait(500);
    check('the word typed there is on the sheet', (await cell(999, 3)) === 'word', await cell(999, 3));
    await key('Control+z'); await wait(700);
    const afterUndo = { d1000: await cell(999, 3), grid: await gridSize(), a1: await cell(0, 0) };
    check('Ctrl+Z once: the word is gone', afterUndo.d1000 == null || afterUndo.d1000 === '', afterUndo);
    check('and the grid has not shrunk', afterUndo.grid.rows === grown.rows && afterUndo.grid.columns === grown.columns, afterUndo);
    check('and nothing else was undone (the entry in A1 is still there)', afterUndo.a1 === 'top', afterUndo);
    await key('Control+y'); await wait(700);
    const afterRedo = { d1000: await cell(999, 3), grid: await gridSize() };
    check('Ctrl+Y: the word is back, the grid the same size', afterRedo.d1000 === 'word' && afterRedo.grid.rows === grown.rows, afterRedo);
    // Further: undo twice more must take the word, then A1, never the rows.
    await key('Control+z'); await key('Control+z'); await wait(700);
    const twice = { d1000: await cell(999, 3), a1: await cell(0, 0), grid: await gridSize() };
    check('Ctrl+Z twice more: the word and then the first entry go, the grid still has not shrunk', (twice.d1000 == null || twice.d1000 === '') && (twice.a1 == null || twice.a1 === '') && twice.grid.rows === grown.rows, twice);
    await key('Control+z'); await key('Control+z'); await key('Control+z'); await wait(600);
    check('more Ctrl+Z with nothing left to undo: the grid still has not shrunk', (await gridSize()).rows === grown.rows, await gridSize());
    await key('Control+y'); await key('Control+y'); await wait(700);
    check('Ctrl+Y twice: both entries are back', (await cell(0, 0)) === 'top' && (await cell(999, 3)) === 'word', [await cell(0, 0), await cell(999, 3)]);
    // The same for columns.
    await hostCall('scrollToCell', [0, 0]); await wait(300);
    await clickCell(2, 0); await key('Control+ArrowRight'); await wait(600);
    const colEnd = await activeCell(); const wide = await gridSize();
    await type('far'); await key('Enter'); await wait(400);
    await key('Control+z'); await wait(700);
    const colUndo = { az3: await cell(2, 51), grid: await gridSize() };
    check('the same with columns (Ctrl+Right to AZ, a word, Ctrl+Z once): the word is gone and the grid has not shrunk', colEnd === 'AZ3' && wide.columns > 52 && (colUndo.az3 == null || colUndo.az3 === '') && colUndo.grid.columns === wide.columns, { colEnd, wide, colUndo });
    await wait(2600);
    await closeTabX('Undo.sheet'); await wait(800);
    await run('file.openFile', at('Undo.sheet')); await sheetUp('Undo.sheet');
    check('closed and opened again: the grown size and the entries are as left', (await gridSize()).rows === grown.rows && (await cell(999, 3)) === 'word' && (await cell(0, 0)) === 'top', { grid: await gridSize(), d1000: await cell(999, 3) });
  });

  // ───────────────────────── 8 ─────────────────────────
  const REMOVED = [
    ['=REGEXEXTRACT("abc","b")', 'b'], ['=NUMBERVALUE("12")', 12], ['=ISBETWEEN(2,1,3)', true], ['=ISEMAIL("a@b.co")', true], ['=VALUETOTEXT(5)', '5'], ['=CELL("row",A1)', 1], ['=FLATTEN(A1:B2)', 1],
  ];
  const KEPT = [
    ['=SUM(1,2)', 3], ['=1+2', 3], ['=3*4', 12], ['=9/3', 3], ['=9-3', 6], ['=2^3', 8], ['="a"&"b"', 'ab'], ['=IF(2>1,"y","n")', 'y'], ['=VLOOKUP(2,A1:B3,2,FALSE)', 20], ['=NPV(0.05,100,200)', 276.64], ['=ROUND(2.345,2)', 2.35], ['=AVERAGE(1,2,3)', 2], ['=SUM(A1:A3)*$B$1', 60], ['=LET(x,1,x)', 1],
    // Further: the other operators and reference forms a person uses.
    ['=-A2+5', 3], ['=50%*4', 2], ['=A1<>A2', true], ['=A1<=A2', true], ['=SUM(A1:A2,B1:B2)', 33], ['=SUM(A:A)', 6], ['=B3-B2', 10], ['=(1+2)*3', 9], ['=MAX(A1:B3)', 30], ['=COUNT(A1:B3)', 6],
  ];
  const same = (got, want) => (want === '5' ? got === '5' || got === 5 : typeof want === 'number' ? typeof got === 'number' && Math.abs(got - want) < 0.006 : typeof want === 'boolean' ? got === want || got === (want ? 1 : 0) || String(got).toUpperCase() === String(want).toUpperCase() : got === want);
  const isName = (got) => got === '#NAME?';
  /** Type the data and every formula, as a person would; returns what each formula cell reads. */
  const typeFormulas = async () => {
    await hostCall('scrollToCell', [0, 0]); await wait(300);
    const data = [[1, 10], [2, 20], [3, 30]];
    await clickCell(0, 0);
    for (const row of data) { await page.keyboard.type(String(row[0]), { delay: 20 }); await page.keyboard.press('Tab'); await page.keyboard.type(String(row[1]), { delay: 20 }); await page.keyboard.press('Enter'); await wait(150); }
    // Kept formulas down column D from row 1, removed ones down column F; FLATTEN last (it spills).
    await clickCell(0, 3);
    for (const [f] of KEPT) { await page.keyboard.type(f, { delay: 12 }); await page.keyboard.press('Enter'); await wait(140); }
    await hostCall('scrollToCell', [0, 0]); await wait(300);
    await clickCell(0, 5);
    for (const [f] of REMOVED) { await page.keyboard.type(f, { delay: 12 }); await page.keyboard.press('Enter'); await wait(140); }
    await wait(1500);
    const out = { kept: [], removed: [] };
    for (const [i, [f, want]] of KEPT.entries()) out.kept.push({ f, want, got: await cell(i, 3), typed: (await snapCell(i, 3))?.f ?? null });
    for (const [i, [f, want]] of REMOVED.entries()) out.removed.push({ f, want, got: await cell(i, 5), typed: (await snapCell(i, 5))?.f ?? null });
    await hostCall('scrollToCell', [0, 0]); await wait(300);
    return out;
  };
  /** The function names on screen (short text in capitals), e.g. the rows of the list that drops under a formula being typed. */
  const fnNames = () => page.evaluate(() => { const seen = new Set(); for (const e of document.querySelectorAll('body *')) { if (!e.getClientRects().length) continue; const t = (e.textContent ?? '').trim(); if (/^[A-Z][A-Z0-9_.]{2,}$/.test(t) && e.querySelectorAll('*').length <= 2) seen.add(t); } return [...seen]; });
  /** What is offered while a formula is typed in a cell: for each start, the function names listed under it. */
  const offered = async (label) => {
    const out = {};
    for (const start of ['=SU', '=REG', '=NUMB', '=ISB', '=ISE', '=VALUET', '=FLA', '=CEL', '=LE']) {
      stepName = `8 typing ${start} on the ${label}`;
      const before = await fnNames();
      await clickCell(12, 8); await page.keyboard.type(start, { delay: 80 }); await wait(1300);
      if (start === '=REG') await shot(`autocomplete-${label}`);
      if (start === '=SU') await shot(`autocomplete-su-${label}`);
      out[start] = (await fnNames()).filter((n) => !before.includes(n) && n.startsWith(start.slice(1)));
      await page.keyboard.press('Escape'); await wait(250); await page.keyboard.press('Escape'); await wait(350);
    }
    // The fx button in the formula bar.
    stepName = `8 the fx button on the ${label}`;
    await clickCell(13, 8);
    const fx = await page.evaluate(() => { const g = window.__fx.sheetEl(null); const b = [...g.querySelectorAll('[aria-label="Insert function"]')].find((e) => e.getClientRects().length); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    let fxDid = null;
    if (fx) {
      const before = await fnNames();
      await page.mouse.click(fx.x, fx.y); await wait(1500);
      await shot(`fx-button-${label}`);
      const st = await hostCall('probeState').catch(() => null);
      fxDid = { cellBeingEdited: st?.editorVisible ?? null, namesListed: (await fnNames()).filter((n) => !before.includes(n)).slice(0, 12) };
      await page.keyboard.press('Escape'); await wait(250); await page.keyboard.press('Escape'); await wait(350);
    }
    const ribbon = await ribbonLists(label);
    stepName = '8';
    return { whileTyping: out, fx: fxDid, ribbon };
  };
  /** Every formula cell as it reads now. */
  const readFormulas = async (gi = null) => { const out = []; for (const [i, [f]] of KEPT.entries()) out.push({ f, got: await cell(i, 3, gi) }); for (const [i, [f]] of REMOVED.entries()) out.push({ f, got: await cell(i, 5, gi) }); return out; };
  /** Brightness (0 to 255) of an empty stretch of a pane's grid, from a capture of the window. */
  const gridLum = async (gi = null) => {
    const p = await cellPoint(14, 2, gi);
    return app.evaluate(async ({ BrowserWindow }, rect) => { const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage(rect); const d = img.toBitmap(); let sum = 0; for (let i = 0; i < d.length; i += 4) sum += 0.0722 * d[i] + 0.7152 * d[i + 1] + 0.2126 * d[i + 2]; return d.length ? Math.round(sum / (d.length / 4)) : null; }, { x: Math.round(p.x - 25), y: Math.round(p.y - 5), width: 50, height: 10 });
  };
  /** The function names a drop-down of the Formulas ribbon lists. */
  const ribbonLists = async (label) => {
    const out = {};
    const btn = (name) => page.evaluate((name) => { const g = window.__fx.sheetEl(null); const b = [...g.querySelectorAll('*')].filter((e) => e.getClientRects().length && (e.textContent ?? '').trim() === name).pop(); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, name);
    const tab = await btn('Formulas'); if (!tab) return null;
    stepName = `8 the Formulas ribbon on the ${label}`;
    await page.mouse.click(tab.x, tab.y); await wait(900);
    for (const name of ['Logical', 'Text', 'Lookup & Reference']) {
      const b = await btn(name); if (!b) { out[name] = 'no such drop-down'; continue; }
      const before = await fnNames();
      await page.mouse.click(b.x, b.y); await wait(900);
      const listed = (await fnNames()).filter((n) => !before.includes(n));
      if (name === 'Text') await shot(`formulas-ribbon-text-${label}`);
      out[name] = { listed: listed.length, removedOnesListed: listed.filter((n) => ['REGEXEXTRACT', 'REGEXMATCH', 'REGEXREPLACE', 'NUMBERVALUE', 'VALUETOTEXT', 'FLATTEN', 'LET', 'ISBETWEEN', 'ISEMAIL', 'CELL'].includes(n)), has: listed.filter((n) => ['IF', 'LEFT', 'VLOOKUP'].includes(n)) };
      await page.keyboard.press('Escape'); await wait(400);
    }
    const start = await btn('Start'); if (start) { await page.mouse.click(start.x, start.y); await wait(500); }
    stepName = '8';
    return out;
  };
  let onPractice = null; let onFile = null;
  await phase('8 the practice sheet and the exam\'s function list', async () => {
    await run('worksheet.openScratch'); await sheetUp('Scratch Sheet');
    onPractice = await typeFormulas();
    await shot('practice-formulas');
    for (const r of onPractice.removed) check(`practice sheet: ${r.f} answers #NAME?`, isName(r.got) && r.typed === r.f, r);
    for (const r of onPractice.kept) check(`practice sheet: ${r.f} computes ${JSON.stringify(r.want)}`, same(r.got, r.want) && r.typed === r.f, r);
    const practiceOffers = await offered('practice');
    console.log(`       practice sheet: listed while typing ${JSON.stringify(practiceOffers.whileTyping)}; the fx button ${JSON.stringify(practiceOffers.fx)}; the Formulas ribbon ${JSON.stringify(practiceOffers.ribbon)}`);
    const practiceRead = await readFormulas();
    const practiceLumAlone = await gridLum();

    await newSheet('Formulas');
    onFile = await typeFormulas();
    await shot('file-formulas');
    for (const r of onFile.removed) check(`sheet file: ${r.f} computes ${JSON.stringify(r.want)}`, same(r.got, r.want) && r.typed === r.f, r);
    for (const r of onFile.kept) check(`sheet file: ${r.f} computes ${JSON.stringify(r.want)}`, same(r.got, r.want) && r.typed === r.f, r);
    { await hostCall('scrollToCell', [0, 0]); await wait(300); await clickCell(22, 1); await page.keyboard.type('=SUM(B1:B3)*100', { delay: 15 }); await page.keyboard.press('Enter'); const t0 = Date.now(); let ms = -1; while (Date.now() - t0 < 4000) { if ((await cell(22, 1)) === 6000) { ms = Date.now() - t0; break; } await sleep(15); }
      note(`a formula typed on a sheet file reads its result ${ms} ms after Enter (first read that returned it)`); }
    const fileOffers = await offered('file');
    console.log(`       sheet file: listed while typing ${JSON.stringify(fileOffers.whileTyping)}; the fx button ${JSON.stringify(fileOffers.fx)}; the Formulas ribbon ${JSON.stringify(fileOffers.ribbon)}`);
    const fileRead = await readFormulas();
    const GONE = { '=REG': /^REGEX/, '=NUMB': /^NUMBERVALUE$/, '=ISB': /^ISBETWEEN$/, '=ISE': /^ISEMAIL$/, '=VALUET': /^VALUETOTEXT$/, '=FLA': /^FLATTEN$/, '=CEL': /^CELL$/ };
    check('the reading can see a list: typing =SU on the practice sheet lists SUM', practiceOffers.whileTyping['=SU'].includes('SUM'), practiceOffers.whileTyping['=SU']);
    for (const [start, re] of Object.entries(GONE)) check(`practice sheet: typing ${start} offers no removed function`, !practiceOffers.whileTyping[start].some((n) => re.test(n)), practiceOffers.whileTyping[start]);
    for (const [start, re] of Object.entries(GONE)) check(`sheet file: typing ${start} does offer it (so the reading above can fail)`, fileOffers.whileTyping[start].some((n) => re.test(n)), fileOffers.whileTyping[start]);
    note(`typing =LE: the practice sheet lists ${JSON.stringify(practiceOffers.whileTyping['=LE'])}, the sheet file lists ${JSON.stringify(fileOffers.whileTyping['=LE'])}`);
    note(`the fx (insert function) button: on the practice sheet ${JSON.stringify(practiceOffers.fx)}; on the sheet file ${JSON.stringify(fileOffers.fx)}`);
    if (practiceOffers.ribbon && fileOffers.ribbon) {
      const still = Object.entries(practiceOffers.ribbon).flatMap(([k, v]) => (v.removedOnesListed ?? []).map((n) => `${k}: ${n}`));
      check('practice sheet: the Formulas ribbon\'s drop-downs (Logical, Text, Lookup & Reference) list no removed function', still.length === 0 && Object.values(practiceOffers.ribbon).some((v) => v.listed > 0), practiceOffers.ribbon);
      check('sheet file: the same drop-downs do list them (so the reading above can fail)', Object.values(fileOffers.ribbon).some((v) => (v.removedOnesListed ?? []).length > 0), fileOffers.ribbon);
    } else note(`the Formulas ribbon could not be read: practice ${JSON.stringify(practiceOffers.ribbon)}, file ${JSON.stringify(fileOffers.ribbon)}`);

    // The order the two were opened in must not matter: the practice sheet again, after a sheet file has been live.
    await clickTab('Scratch Sheet'); await sheetUp('Scratch Sheet');
    await clickCell(20, 0); await type('=NUMBERVALUE("7")'); await key('Enter'); await type('=SUM(4,5)'); await key('Enter'); await wait(1000);
    check('the practice sheet shown again after a sheet file was live: NUMBERVALUE still answers #NAME?, SUM still computes', isName(await cell(20, 0)) && (await cell(21, 0)) === 9, [await cell(20, 0), await cell(21, 0)]);
    const practiceLumAgain = await gridLum();
    check('the practice sheet shown again after a sheet file was shown in the same group: painted as before (light)', Math.abs(practiceLumAgain - practiceLumAlone) < 40, { before: practiceLumAlone, now: practiceLumAgain });
    { const again = await readFormulas(); const changed = again.map((r, i) => ({ f: r.f, was: practiceRead[i].got, now: r.got })).filter((r, i) => i !== 19 && JSON.stringify(r.was) !== JSON.stringify(r.now));
      check('the practice sheet shown again: every formula typed before reads as it did (=SUM(A:A) aside, a cell in column A was added)', changed.length === 0, changed); }
    await clickTab('Formulas.sheet'); await sheetUp('Formulas.sheet');
    await clickCell(20, 0); await type('=NUMBERVALUE("7")'); await key('Enter'); await wait(1000);
    check('and the sheet file shown again after the practice sheet still computes NUMBERVALUE', (await cell(20, 0)) === 7, await cell(20, 0));
    { const again = await readFormulas(); const changed = again.map((r, i) => ({ f: r.f, was: fileRead[i].got, now: r.got })).filter((r, i) => i !== 19 && JSON.stringify(r.was) !== JSON.stringify(r.now));
      await shot('file-formulas-shown-again');
      check('the sheet file shown again (read back from its file): every formula typed before reads as it did (=SUM(A:A) aside)', changed.length === 0, changed); }
    // Closed and opened again.
    await wait(2000); await closeTabX('Formulas.sheet'); await wait(900); await run('file.openFile', at('Formulas.sheet')); await sheetUp('Formulas.sheet');
    { const again = await readFormulas(); const changed = again.map((r, i) => ({ f: r.f, was: fileRead[i].got, now: r.got })).filter((r, i) => i !== 19 && JSON.stringify(r.was) !== JSON.stringify(r.now));
      check('the sheet file closed and opened again: every formula reads as it did when typed', changed.length === 0, changed); }
    // Both on screen at once.
    await run('workbench.action.splitEditor'); await wait(2500);
    await clickTab('Scratch Sheet', 0); await wait(4500);
    const both = await groups();
    const pi = both.findIndex((g) => g.active === 'Scratch Sheet' && g.live); const fi = both.findIndex((g) => g.active === 'Formulas.sheet' && g.live);
    if (pi >= 0 && fi >= 0) {
      await shot('practice-and-file-before-typing');
      { const again = await readFormulas(fi); const changed = again.map((r, i) => ({ f: r.f, was: fileRead[i].got, now: r.got })).filter((r, i) => i !== 19 && JSON.stringify(r.was) !== JSON.stringify(r.now));
        check('the practice sheet and a sheet file side by side: every formula on the sheet file reads as it did when typed', changed.length === 0, changed); }
      { const again = await readFormulas(pi); const changed = again.map((r, i) => ({ f: r.f, was: practiceRead[i].got, now: r.got })).filter((r, i) => i !== 19 && JSON.stringify(r.was) !== JSON.stringify(r.now));
        check('side by side: every formula on the practice sheet reads as it did when typed', changed.length === 0, changed); }
      const lumBeside = await gridLum(pi); const fileLum = await gridLum(fi);
      check('side by side: the practice sheet is painted as it is alone (light, its own setting), not as the sheet file beside it', Math.abs(lumBeside - practiceLumAlone) < 40, { practiceAlone: practiceLumAlone, practiceBesideTheFile: lumBeside, theSheetFile: fileLum });
      await enter(24, 0, 'word left', pi); await wait(500); await enter(24, 0, 'word right', fi); await wait(500);
      await enter(25, 0, '=ISEMAIL("a@b.co")', pi); await wait(700); await enter(25, 0, '=ISEMAIL("a@b.co")', fi); await wait(1500);
      await shot('practice-and-file');
      const typedOf = async (r, gi) => { const c = await snapCell(r, 0, gi); return c?.f ?? c?.v ?? null; };
      const got = { practiceWord: await cell(24, 0, pi), fileWord: await cell(24, 0, fi), practice: await cell(25, 0, pi), practiceHolds: await typedOf(25, pi), file: await cell(25, 0, fi), fileHolds: await typedOf(25, fi) };
      check('side by side: a word typed into each lands in each', got.practiceWord === 'word left' && got.fileWord === 'word right', got);
      check('side by side: =ISEMAIL("a@b.co") typed into each is #NAME? on the practice sheet and computes on the sheet file', isName(got.practice) && same(got.file, true), got);
      // Again, slower, and simpler formulas, into the sheet file only.
      await clickCell(27, 0, fi); await page.keyboard.type('=LEN("abcd")', { delay: 90 }); await page.keyboard.press('Enter'); await wait(700);
      await clickCell(28, 0, fi); await page.keyboard.type('=SUM(1,2)', { delay: 90 }); await page.keyboard.press('Enter'); await wait(1200);
      const slow = { len: await cell(27, 0, fi), lenHolds: await typedOf(27, fi), sum: await cell(28, 0, fi), sumHolds: await typedOf(28, fi) };
      check('side by side: formulas typed slowly into the sheet file (=LEN("abcd"), =SUM(1,2)) compute 4 and 3', slow.len === 4 && slow.sum === 3, slow);
      // The sheet file closed: the practice sheet alone again.
      await wait(1500); await closeTabX('Formulas.sheet', fi); await wait(3500);
      const lumAfter = await gridLum().catch(() => null);
      note(`brightness of the practice sheet's empty grid (0 to 255): alone ${practiceLumAlone}; beside a sheet file ${lumBeside} (the sheet file ${fileLum}); after that sheet file was closed ${lumAfter}`);
    } else note(`the practice sheet and the sheet file could not both be shown live side by side: ${JSON.stringify(both.map((g) => ({ shown: g.active, live: g.live, words: g.words.slice(0, 80) })))}`);
    // Two sheet files side by side: a formula typed into each.
    await reset();
    await newSheet('Pair Left'); await run('workbench.action.splitEditor'); await wait(2500); await newSheet('Pair Right'); await wait(1500);
    const pair = await groups();
    const li = pair.findIndex((g) => g.active === 'Pair Left.sheet' && g.live); const ri = pair.findIndex((g) => g.active === 'Pair Right.sheet' && g.live);
    if (li >= 0 && ri >= 0) {
      await enter(0, 0, '=SUM(1,2)', li); await wait(700); await enter(0, 0, '=SUM(3,4)', ri); await wait(700); await enter(1, 0, '=10*2', li); await wait(700); await enter(1, 0, '=10*3', ri); await wait(700); await enter(2, 0, '=ISEMAIL("a@b.co")', li); await wait(700); await enter(2, 0, '=ISEMAIL("a@b.co")', ri); await wait(1500);
      const typedOf = async (r, gi) => { const c = await snapCell(r, 0, gi); return c?.f ?? c?.v ?? null; };
      const got = { left: [await cell(0, 0, li), await cell(1, 0, li), await cell(2, 0, li)], right: [await cell(0, 0, ri), await cell(1, 0, ri), await cell(2, 0, ri)], leftHolds: [await typedOf(0, li), await typedOf(1, li), await typedOf(2, li)], rightHolds: [await typedOf(0, ri), await typedOf(1, ri), await typedOf(2, ri)] };
      await shot('two-files-formulas');
      check('two sheet files side by side: formulas typed into each, in turn, compute in each (3, 20, TRUE left; 7, 30, TRUE right)', got.left[0] === 3 && got.left[1] === 20 && same(got.left[2], true) && got.right[0] === 7 && got.right[1] === 30 && same(got.right[2], true), got);
    } else note(`two sheet files could not both be shown live side by side: ${JSON.stringify(pair.map((g) => ({ shown: g.active, live: g.live })))}`);
  });

  // ───────────────────────── 9 ─────────────────────────
  await phase('9 menus', async () => {
    const EXPORT = 'Export Sheet to Excel';
    const sidebarMenu = async (shotName = null) => {
      if (!(await page.evaluate(() => !!document.querySelector('[data-px-id="sidebar.more"]')?.getClientRects().length && /Worksheets/.test(document.querySelector('[data-part-id="workbench.parts.sidebar"]')?.textContent ?? '')))) { await clickEl('[data-px-id="activitybar.worksheet-container"]'); await wait(900); }
      const head = await page.evaluate(() => (document.querySelector('[data-part-id="workbench.parts.sidebar"]')?.innerText ?? '').split('\n')[0]);
      await clickEl('[data-px-id="sidebar.more"]'); await wait(300);
      const labels = (await menuLabels()).map((r) => r.label);
      const onScreen = await page.evaluate(() => [...document.querySelectorAll('[data-px-surface="contextMenu"] [role="menuitem"], .context-menu [role="menuitem"], .context-menu-item')].filter((e) => e.getClientRects().length).map((e) => (e.textContent ?? '').trim()));
      if (shotName) await shot(shotName);
      await page.keyboard.press('Escape'); await wait(300);
      return { head, labels, onScreen };
    };
    await clickEl('[data-px-id="activitybar.worksheet-container"]'); await wait(900);
    await run('worksheet.open'); await wait(2200);
    const home = await sidebarMenu('menu-home-only');
    check('with only Worksheets Home open: the sidebar\'s More Actions has New Sheet… and no Export Sheet to Excel', home.head === 'Worksheets' && home.labels.includes('New Sheet…') && !home.labels.includes(EXPORT), { home, shown: (await group(0))?.active });
    await run('worksheet.openScratch'); await sheetUp('Scratch Sheet');
    const scratch = await sidebarMenu();
    check('with the Scratch Sheet shown: no Export Sheet to Excel', scratch.labels.includes('New Sheet…') && !scratch.labels.includes(EXPORT), scratch);
    const file = await newSheet('Menu');
    const withSheet = await sidebarMenu('menu-with-sheet');
    check('with a .sheet shown: Export Sheet to Excel is there', withSheet.labels.includes(EXPORT), withSheet);
    await clickTab('Scratch Sheet'); await sheetUp('Scratch Sheet');
    const hidden = await sidebarMenu();
    check('the .sheet tab still open but the Scratch Sheet shown instead: not there', !hidden.labels.includes(EXPORT), hidden);
    await clickTab('Menu.sheet'); await sheetUp('Menu.sheet');
    check('the .sheet shown again: there', (await sidebarMenu()).labels.includes(EXPORT), null);
    await closeTabX('Menu.sheet'); await wait(1200);
    const closed = await sidebarMenu();
    check('after that tab is closed: gone again', !closed.labels.includes(EXPORT) && !(await allTabs()).includes('Menu.sheet'), { closed, tabs: await allTabs() });
    // A .sheet that is refused, and a .sheet shown only as a waiting pane, are not a sheet on screen.
    await fs.writeFile(at('Refused.sheet'), 'not a workbook');
    await run('file.openFile', at('Refused.sheet')); await wait(3000);
    const refused = await sidebarMenu();
    check('with a .sheet that could not be opened shown: not there', !refused.labels.includes(EXPORT), { refused, g: await group(0) });
    await closeTabX('Refused.sheet');
    // Two sheet files side by side, one closed.
    await run('file.openFile', file); await sheetUp('Menu.sheet');
    await run('workbench.action.splitEditor'); await wait(2500);
    await newSheet('Menu Two'); await wait(1500);
    const two = await groups();
    await closeTabX('Menu Two.sheet'); await wait(2500);
    const oneLeft = await sidebarMenu();
    check('two sheet files side by side, then one closed: still there for the one left', two.filter((g) => g.live).length === 2 && oneLeft.labels.includes(EXPORT), { two: two.map((g) => ({ shown: g.active, live: g.live })), oneLeft, now: (await groups()).map((g) => ({ shown: g.active, live: g.live })) });
    await reset();
    check('everything closed: gone', !(await sidebarMenu()).labels.includes(EXPORT), null);

    // The Welcome page.
    await clickTab('Welcome'); await wait(1200);
    const welcome = await page.evaluate(() => { const g = window.__fx.groups()[0]; const pane = g.querySelector('.editor-pane-container'); return { text: (pane?.innerText ?? '').replace(/\n+/g, ' | ').slice(0, 900), rows: [...(pane?.querySelectorAll('button, a, [role="button"], li') ?? [])].filter((e) => e.getClientRects().length).map((e) => (e.textContent ?? '').trim()).filter(Boolean) }; });
    await shot('welcome');
    console.log(`       the Welcome page reads: ${welcome.text}`);
    check('the Welcome page has a Start list with an entry for Worksheets, and no "Open New Sheet…"', /Start/.test(welcome.text) && welcome.rows.some((r) => /Worksheets/.test(r)) && !/New Sheet/.test(welcome.text), welcome);

    // The command palette.
    const before = await ls();
    await page.keyboard.press('Control+Shift+p'); await wait(800);
    await page.keyboard.type('New Sheet', { delay: 30 }); await wait(900);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.command-palette-item')].filter((e) => e.getClientRects().length).map((e) => (e.textContent ?? '').trim()));
    await shot('palette-new-sheet');
    check('the command palette (Ctrl+Shift+P, "New Sheet" typed) finds New Sheet…', rows.some((r) => /New Sheet…/.test(r)), rows);
    const row = await pointOf('.command-palette-item'); const first = rows.findIndex((r) => /New Sheet…/.test(r));
    if (first === 0) await page.keyboard.press('Enter'); else if (row) await clickEl('.command-palette-item', rows[first]);
    await wait(900);
    const asked = await page.evaluate(() => { const box = document.querySelector('[data-px-surface="inputBox"]'); return box ? { label: box.getAttribute('aria-label'), value: box.querySelector('input')?.value ?? null } : null; });
    await shot('palette-asks-name');
    check('choosing it asks a name', asked !== null && /name/i.test(asked.label ?? ''), asked);
    await page.keyboard.type('From Palette', { delay: 20 }); await page.keyboard.press('Enter');
    await sheetUp('From Palette.sheet').catch(() => {});
    const added = (await ls()).filter((n) => !before.includes(n));
    check('the typed name makes From Palette.sheet and opens it live', added.length === 1 && added[0] === 'From Palette.sheet' && (await group(0))?.active === 'From Palette.sheet' && (await group(0))?.live, { added, g: await group(0) });
    await closeTabX('From Palette.sheet'); await wait(800);
    await page.keyboard.press('Control+p'); await page.waitForSelector('[data-px-id="quickAccess.input"]', { timeout: 5000 });
    await page.keyboard.type('From Palette', { delay: 25 }); await wait(1000);
    const qo = await page.evaluate(() => [...document.querySelectorAll('[id^="quick-access-item-"]')].filter((e) => e.getClientRects().length).map((e) => (e.textContent ?? '').trim().slice(0, 50)).slice(0, 3));
    await page.keyboard.press('Enter'); await wait(3500);
    note(`Quick Open (Ctrl+P) for the sheet just made by New Sheet…: rows offered ${JSON.stringify(qo)}; shown after Enter ${JSON.stringify((await group(0))?.active)}, live ${(await group(0))?.live}`);
    await page.keyboard.press('Escape'); await wait(300);
    // The Tools menu, for the record.
    await clickEl('[data-px-id="titlebar.menu.tools"]');
    const tools = (await menuLabels()).map((r) => r.label); await page.keyboard.press('Escape'); await wait(300);
    note(`the Tools menu lists: ${JSON.stringify(tools)}`);
  });

  // ───────────────────────── 10 ─────────────────────────
  await phase('10 a damaged file', async () => {
    const good = { id: 's1', name: 'Sheet1', cellData: { 0: { 0: { v: 'kept' } } } };
    const cases = {
      'Hollow.sheet': { format: 'parallx-sheet', version: 1, workbook: { id: 'w', sheetOrder: ['missing'], sheets: {} } },
      'Half Hollow.sheet': { format: 'parallx-sheet', version: 1, workbook: { id: 'w', sheetOrder: ['s1', 'ghost'], sheets: { s1: good } } },
      'No Order.sheet': { format: 'parallx-sheet', version: 1, workbook: { id: 'w', sheetOrder: [], sheets: { s1: good } } },
      'Null Sheet.sheet': { format: 'parallx-sheet', version: 1, workbook: { id: 'w', sheetOrder: ['s1'], sheets: { s1: null } } },
      'Text Sheet.sheet': { format: 'parallx-sheet', version: 1, workbook: { id: 'w', sheetOrder: ['s1'], sheets: { s1: 'a string' } } },
    };
    const control = { format: 'parallx-sheet', version: 1, workbook: { id: 'w', sheetOrder: ['s1'], sheets: { s1: good } } };
    const before = {};
    for (const [name, body] of Object.entries({ ...cases, 'Whole.sheet': control })) { await fs.writeFile(at(name), JSON.stringify(body)); before[name] = await stat(at(name)); }
    await wait(1100);
    for (const name of Object.keys(cases)) {
      const n = errors.length;
      await run('file.openFile', at(name)); await wait(4000);
      const g = await group(0);
      if (name === 'Half Hollow.sheet') await shot('damaged-half-hollow');
      console.log(`       ${name} shows: ${JSON.stringify({ shown: g?.active, live: g?.live, words: g?.words })}`);
      check(`${name}: refused in words (it names the file and says the workbook is damaged), no grid`, g?.active === name && !g.live && /could not be opened/.test(g.words) && /damaged/.test(g.words) && g.words.includes(name.replace('.sheet', '')), g);
      check(`${name}: no page errors`, errors.length === n, errors.slice(n, n + 3));
      // A person clicks into it and types, leaves, comes back, closes.
      await page.mouse.click(800, 450); await page.keyboard.type('x1', { delay: 20 }); await page.keyboard.press('Enter'); await wait(2200);
      await clickTab('Welcome'); await wait(800); await clickTab(name); await wait(1500); await closeTabX(name); await wait(900);
      check(`${name}: not written (same bytes, same time)`, sameFile(before[name], await stat(at(name))), { same: before[name].bytes === (await stat(at(name))).bytes });
    }
    // The control: the same shape with nothing missing opens, so the refusals above are about the missing sheet.
    await run('file.openFile', at('Whole.sheet')); await sheetUp('Whole.sheet').catch(() => {});
    check('the same file with nothing missing opens as a live sheet with its cell (so the refusal is about the missing sheet)', (await group(0))?.live && (await cell(0, 0)) === 'kept', { g: await group(0), a1: await cell(0, 0) });
  });

  // ───────────────────────── 11 ─────────────────────────
  await phase('11 regression sweep', async () => {
    const R = REG;
    await wait(800);
    /** What the shown editor is: its pane's class and the marks of its kind. */
    const shown = () => page.evaluate(() => {
      const g = window.__fx.groups().find((x) => x.classList.contains('editor-group--active')) ?? window.__fx.groups()[0];
      const d = window.__fx.describe(g); const pane = [...g.querySelectorAll('.editor-pane')].find(window.__fx.vis) ?? g.querySelector('.editor-pane-container');
      const img = pane?.querySelector('img');
      return { tab: d.active, pane: d.pane, text: d.text == null ? null : d.text.slice(0, 80), live: d.live, canvases: pane?.querySelectorAll('canvas').length ?? 0, img: img ? { w: img.naturalWidth, h: img.naturalHeight } : null, words: (pane?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160), editable: !!pane?.querySelector('textarea:not([readonly]), [contenteditable="true"], input:not([type="search"]):not([readonly])') };
    });
    const expected = {
      'paper.pdf': (s) => /pdf/i.test(s.pane ?? '') && !s.live && s.text == null && (s.canvases > 0 || /Pdf words here/.test(s.words)),
      'pic.png': (s) => /image/i.test(s.pane ?? '') && s.img?.w === 8,
      'readme.md': (s) => /code-editor/.test(s.pane ?? '') && /markdown body words/.test(s.text ?? ''),
      'notes.txt': (s) => /text-editor/.test(s.pane ?? '') && /plain text words/.test(s.text ?? ''),
      '.gitignore': (s) => /text-editor|code-editor/.test(s.pane ?? '') && /ignored-words/.test(s.text ?? '') && !s.live,
      'Makefile': (s) => /text-editor|code-editor/.test(s.pane ?? '') && /makefile-words/.test(s.text ?? '') && !s.live,
      'book.xlsx': (s) => /excel/.test(s.pane ?? '') && /Xlsxrent/.test(s.words) && !s.live,
    };
    await showExplorer();
    if (!(await nodePoint('Reg/notes.txt'))) { await clickNode('Reg'); await wait(900); }
    for (const [name, ok] of Object.entries(expected)) {
      const clicked = await clickNode(`Reg/${name}`); await wait(name.endsWith('.pdf') ? 4000 : 1800);
      const s = await shown();
      if (/pdf|png|xlsx/.test(name)) await shot(`reg-explorer-${name.replace(/\W/g, '-')}`);
      check(`${name} clicked in the Explorer opens in its usual editor (${s.pane})`, clicked && s.tab === name && ok(s), { clicked, s });
      if (name === 'book.xlsx') note(`the .xlsx viewer: ${JSON.stringify({ pane: s.pane, editable: s.editable, words: s.words.slice(0, 100) })}`);
      await run('workbench.action.closeActiveEditor'); await wait(400);
    }
    for (const [name, ok] of Object.entries(expected)) {
      await page.keyboard.press('Control+p');
      await page.waitForSelector('[data-px-id="quickAccess.input"]', { timeout: 5000 });
      await page.keyboard.type(name, { delay: 25 }); await wait(1000);
      const offered = await page.evaluate(() => [...document.querySelectorAll('[id^="quick-access-item-"]')].filter((e) => e.getClientRects().length).map((e) => (e.textContent ?? '').trim().slice(0, 60)).slice(0, 4));
      await page.keyboard.press('Enter'); await wait(name.endsWith('.pdf') ? 4000 : 1800);
      const s = await shown();
      check(`${name} picked in Quick Open (Ctrl+P) opens in its usual editor`, s.tab === name && ok(s), { offered, s });
      await page.keyboard.press('Escape'); await wait(200);
      if (s.tab === name) { await run('workbench.action.closeActiveEditor'); await wait(400); }
    }
    // The xlsx viewer is read-only: typing into it changes nothing on disk.
    const xBefore = await stat(R('book.xlsx'));
    await run('file.openFile', R('book.xlsx')); await wait(2000);
    await page.mouse.click(700, 400); await page.keyboard.type('zzz', { delay: 20 }); await page.keyboard.press('Enter'); await wait(2500);
    const xs = await shown();
    check('the .xlsx viewer: typing into it changes nothing shown and the file is not written', /Xlsxrent/.test(xs.words) && !/zzz/.test(xs.words) && sameFile(xBefore, await stat(R('book.xlsx'))), xs);
    await run('workbench.action.closeActiveEditor'); await wait(400);

    // Split Editor on a text file: two working editors.
    await run('file.openFile', R('notes.txt')); await wait(1500);
    await run('workbench.action.splitEditor'); await wait(2500);
    let gs = await groups();
    await shot('reg-split-text');
    check('Split Editor on a text file: two panes, each a text editor showing the file', gs.length === 2 && gs.every((g) => g.active === 'notes.txt' && /plain text words/.test(g.text ?? '')), gs.map((g) => ({ shown: g.active, pane: g.pane, text: (g.text ?? '').slice(0, 40), words: g.words })));
    const areas = await page.evaluate(() => window.__fx.groups().map((g) => { const t = [...g.querySelectorAll('textarea.text-editor-textarea')].find(window.__fx.vis); if (!t) return null; const b = t.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }));
    if (areas[0] && areas[1]) {
      await page.mouse.click(areas[0].x, areas[0].y); await page.keyboard.press('Control+End'); await page.keyboard.type('LEFT-TYPED ', { delay: 15 }); await wait(700);
      gs = await groups();
      const afterLeft = gs.map((g) => /LEFT-TYPED/.test(g.text ?? ''));
      await page.mouse.click(areas[1].x, areas[1].y); await page.keyboard.press('Control+End'); await page.keyboard.type('RIGHT-TYPED ', { delay: 15 }); await wait(700);
      gs = await groups();
      const afterRight = gs.map((g) => ({ left: /LEFT-TYPED/.test(g.text ?? ''), right: /RIGHT-TYPED/.test(g.text ?? '') }));
      await page.keyboard.press('Control+s'); await wait(1500);
      const saved = await fileText(R('notes.txt'));
      note(`split text editors: typed in the left one, the panes holding it ${JSON.stringify(afterLeft)}; then typed in the right one ${JSON.stringify(afterRight)}; after Ctrl+S the file holds ${JSON.stringify(saved)}`);
      check('each of the two takes typing (the left shows what was typed left, the right what was typed right)', afterLeft[0] === true && afterRight[1].right === true, { afterLeft, afterRight });
      check('Ctrl+S saves what was typed', /RIGHT-TYPED/.test(saved), saved);
    } else check('both panes of the split text file have a text area to type in', false, areas);
  });

  // ───────────────────────── 13 ─────────────────────────
  await phase('13 the Explorer\'s menu while a sheet saves itself', async () => {
    // Found while writing this probe: not on the list. A sheet file writes itself about 1.5 s after an entry.
    const box = () => page.evaluate(() => { const i = document.querySelector('.tree-inline-input'); return !!i && i.isConnected && i.getClientRects().length > 0; });
    await fs.writeFile(at('other.txt'), 'other\n'); await wait(2500);
    const file = await newSheet('Saver'); await enter(0, 0, 'x'); await wait(9000);
    // Control: nothing written for 9 s; the menu left open 3.5 s, then Rename.
    await clickNode('other.txt', { button: 'right' }); await wait(3500); await pickMenuRow('Rename'); await wait(800);
    const control = await box();
    await page.keyboard.press('Escape'); await wait(600);
    check('control: the Explorer\'s menu opened on a file, left open 3.5 seconds with nothing saved meanwhile, then Rename: the name box appears', control, control);
    // An entry in the sheet, the menu opened at once, Rename chosen after the sheet has saved itself.
    const results = [];
    for (const [i, after] of [300, 1500, 2500, 2500, 4000].entries()) {
      await enter(1 + i, 0, `y${i}`);
      const t0 = Date.now();
      await clickNode('other.txt', { button: 'right' });
      const saved = await untilFile(file, new RegExp(`"y${i}"`), 5000); await wait(after);
      const open = Date.now() - t0;
      const menuStill = (await menuLabels()).map((r) => r.label).includes('Rename') && !!(await pointOf('[data-px-id="contextMenu.explorer.rename"]'));
      const picked = await pickMenuRow('Rename'); await wait(800);
      const got = await box();
      const inDom = await page.evaluate(() => document.querySelectorAll('.tree-inline-input').length);
      if (!got) await shot(`menu-while-saving-${i}`);
      await page.keyboard.press('Escape'); await wait(7000);
      results.push({ renameChosenMsAfterTheSave: after, menuOpenForMs: open, sheetSavedMsAfterRightClick: saved, menuStillOnScreen: menuStill, renameClicked: picked, nameBox: got, nameBoxesInThePage: inDom });
    }
    for (const r of results) console.log(`       ${JSON.stringify(r)}`);
    check('an entry typed in a sheet, the Explorer\'s menu opened on another file at once, Rename chosen after the sheet saved itself: the name box appears (5 tries, 0.3 to 4 s after the save)', results.every((r) => r.nameBox), results.filter((r) => !r.nameBox));
    // And without any sheet: another program writes a new file while the menu is open.
    await wait(7000);
    await clickNode('other.txt', { button: 'right' }); await fs.writeFile(at('while-menu-open.txt'), 'x\n'); await wait(3000);
    const picked2 = await pickMenuRow('Rename'); await wait(800);
    const box2 = await box(); await page.keyboard.press('Escape'); await wait(1200);
    note(`the same with no sheet involved (another program writes a new file while the Explorer's menu is open, Rename chosen 3 s later): Rename clicked ${picked2}, the name box appeared ${box2}`);
    await fs.writeFile(at('made-after.txt'), 'after\n'); await wait(3000);
    const made = await runSafe('worksheet.newSheet', 'Made After'); await wait(4000);
    const rows = await explorerRows();
    check('and the Explorer still lists files made afterwards (one by another program, one by New Sheet)', rows.includes('made-after.txt') && rows.includes('Made After.sheet'), { rows, onDisk: await ls(), made });
    if (!rows.includes('made-after.txt')) {
      // Does anything a person would try bring it back?
      await clickEl('[data-px-id="activitybar.worksheet-container"]'); await wait(800); await clickEl('[data-px-id="activitybar.explorer-container"]'); await wait(1200);
      const afterSwitch = await explorerRows();
      const refresh = await runSafe('explorer.refresh'); await wait(1500);
      note(`the Explorer after that: rows ${JSON.stringify(rows)}; after switching the sidebar to Worksheets and back ${JSON.stringify(afterSwitch)}; after the command explorer.refresh (${JSON.stringify(refresh.error ?? 'ran')}) ${JSON.stringify(await explorerRows())}; on disk ${JSON.stringify(await ls())}`);
    }
  });

  // ───────────────────────── 15 ─────────────────────────
  await phase('15 two sheet files side by side: what is typed into each', async () => {
    // Found while writing this probe: not on the list. One sheet alone first (the control), then two side by side.
    const ENTRIES = ['plain word', '=SUM(1,2)', 'say "hi" twice', '=LEN("abcd")', 'a@b.co', '=ISEMAIL("a@b.co")', '=IF(1>0,"y","n")'];
    const WANT = ['plain word', 3, 'say "hi" twice', 4, 'a@b.co', true, 'y'];
    const typeAll = async (gi) => { for (const [i, e] of ENTRIES.entries()) { await clickCell(i, 0, gi); await page.keyboard.type(e, { delay: 35 }); await page.keyboard.press('Enter'); await wait(500); } await wait(1200); const out = []; for (let i = 0; i < ENTRIES.length; i++) { const c = await snapCell(i, 0, gi); out.push({ typed: ENTRIES[i], holds: c?.f ?? c?.v ?? null, reads: await cell(i, 0, gi) }); } return out; };
    const wrong = (rows) => rows.filter((r, i) => !(r.holds === r.typed || (!String(r.typed).startsWith('=') && r.reads === r.typed)) || !same(r.reads, WANT[i]));
    await newSheet('Solo');
    const solo = await typeAll(null);
    check('control, one sheet file alone: seven entries (words, quotes, formulas with quoted text) each land as typed', wrong(solo).length === 0, wrong(solo));
    await reset();
    await newSheet('Duo Left'); await run('workbench.action.splitEditor'); await wait(2500); await newSheet('Duo Right'); await wait(1500);
    const gs = await groups();
    const li = gs.findIndex((g) => g.active === 'Duo Left.sheet' && g.live); const ri = gs.findIndex((g) => g.active === 'Duo Right.sheet' && g.live);
    if (li < 0 || ri < 0) { note(`two sheet files could not both be shown live: ${JSON.stringify(gs.map((g) => ({ shown: g.active, live: g.live })))}`); return; }
    const right = await typeAll(ri);
    await shot('two-files-right-typed');
    const left = await typeAll(li);
    await shot('two-files-both-typed');
    check('two sheet files side by side: the same seven entries typed into the right-hand one each land as typed', wrong(right).length === 0, wrong(right));
    check('and typed into the left-hand one', wrong(left).length === 0, wrong(left));
    await wait(2500);
    note(`two sheet files side by side, the right-hand one's cells: ${JSON.stringify(right.map((r) => r.holds))}; the left-hand one's: ${JSON.stringify(left.map((r) => r.holds))}`);
  });

  // ───────────────────────── 14 ─────────────────────────
  await phase('14 the new words in the light app', async () => {
    const setMode = async (mode) => { await run('settings.openAppearance'); await wait(900); const ok = await clickEl(`[data-px-id="appearance.mode.${mode}"]`); await wait(700); await page.keyboard.press('Escape'); await wait(500); return ok; };
    /** Contrast of an element's text against the first opaque background behind it (WCAG ratio). */
    const contrastOf = (selector) => page.evaluate((selector) => {
      const el = [...document.querySelectorAll(selector)].filter((e) => e.getClientRects().length).pop(); if (!el) return null;
      const rgb = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
      const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      let bg = null; for (let n = el; n && !bg; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.a > 0.95) bg = c; }
      bg = bg ?? { r: 255, g: 255, b: 255 };
      const fg = rgb(getComputedStyle(el).color); const a = lum(fg); const b = lum(bg);
      return { text: (el.textContent ?? '').trim().slice(0, 60), ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10 };
    }, selector);
    const looks = {};
    for (const mode of ['light', 'dark']) {
      await reset();
      const switched = await setMode(mode); await wait(800);
      const name = `Words ${mode}`;
      const file = await newSheet(name); await enter(0, 0, 'one'); await wait(2600);
      await run('workbench.action.splitEditor'); await wait(3500);
      await shot(`waiting-pane-${mode}`);
      const waitingWords = await page.evaluate(() => { const p = [...document.querySelectorAll('.ws-pane')].filter((e) => e.getClientRects().length && !e.querySelector('canvas')).pop(); return p ? [...p.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent ?? '').trim()).map((e) => { e.setAttribute('data-fx-word', '1'); return (e.textContent ?? '').trim(); }) : []; });
      const waitingContrast = await contrastOf('[data-fx-word="1"]');
      await fs.rename(file, at(`Away ${mode}.sheet`));
      const li = (await groups()).findIndex((g) => g.live);
      await enter(1, 0, 'two', li);
      const told = await waitPrompt(/no longer where it was/, 6000); await wait(700);
      await shot(`gone-prompt-${mode}`);
      const promptContrast = await contrastOf('.parallx-notification--prompt .parallx-notification-message');
      const buttons = await page.evaluate(() => [...document.querySelectorAll('.parallx-notification--prompt .parallx-notification-action-btn')].map((b) => ({ label: b.textContent.trim(), danger: b.classList.contains('parallx-notification-action-btn--danger'), background: getComputedStyle(b).backgroundColor, focused: document.activeElement === b })));
      // Keys: Tab moves between the two buttons and stays inside; Escape.
      const walk = []; for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); await wait(150); walk.push(await page.evaluate(() => (document.activeElement?.textContent ?? '').trim().slice(0, 20) || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName)); }
      await page.keyboard.press('Escape'); await wait(800);
      const afterEscape = { promptStillUp: (await prompts()).some((p) => /no longer where it was/.test(p.words)), files: (await ls()).filter((n) => n.includes(mode)) };
      looks[mode] = { switched, waitingWords, waitingContrast, told: !!told, promptContrast, buttons, tabWalk: walk, afterEscape };
      console.log(`       ${mode}: ${JSON.stringify(looks[mode])}`);
      check(`${mode} app: the waiting pane's words and the "no longer where it was" words are readable (contrast at least 4.5 to 1)`, switched && (waitingContrast?.ratio ?? 0) >= 4.5 && (promptContrast?.ratio ?? 0) >= 4.5, { waitingContrast, promptContrast });
      check(`${mode} app: by keyboard, Tab stays on the dialog's controls`, walk.every((w) => ['Save a Copy', 'Discard Changes', 'Dismiss notification'].includes(w)), walk);
    }
    note(`the dialog's buttons: ${JSON.stringify(looks.dark?.buttons)}; Escape on it: ${JSON.stringify(looks.dark?.afterEscape)}`);
    await reset();
  });

  // ───────────────────────── 12 ─────────────────────────
  await phase('12 closed and opened again; a practice problem', async () => {
    // A sheet with a non-English name left open with an entry, the app closed and started again.
    const made = await run('worksheet.newSheet', 'Résumé 履歴'); await sheetUp('Résumé 履歴.sheet');
    await enter(0, 0, 'kept-over-restart'); await wait(2600);
    // Worksheets opened once so its tables exist for the seed.
    await run('worksheet.open'); await wait(2500);
    await clickTab('Résumé 履歴.sheet'); await sheetUp('Résumé 履歴.sheet');
    await app.close().catch(() => {});
    const dbPath = at('.parallx', 'data.db');
    let seeded = false;
    if (await exists(dbPath)) {
      const electronBin = path.join(repo, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
      const seed = spawnSync(electronBin, [path.join(repo, 'tests/probes/worksheet-seed.cjs'), dbPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', shell: process.platform === 'win32' });
      seeded = seed.status === 0;
      console.log(`       seed (tests/probes/worksheet-seed.cjs, the synthetic problem bank other probes use): ${(seed.stdout || '').trim().slice(0, 200)} ${(seed.stderr || '').trim().slice(0, 200)}`);
    } else note(`no workspace database at ${dbPath}: a practice problem cannot be seeded`);
    await launch(); await wait(3000);
    const back = await groups();
    console.log(`       on starting again: ${JSON.stringify(back.map((g) => ({ tabs: g.tabs, shown: g.active, live: g.live, words: g.words.slice(0, 80), text: (g.text ?? '').slice(0, 40) })))}`);
    if ((await allTabs()).includes('Résumé 履歴.sheet')) {
      await clickTab('Résumé 履歴.sheet'); await sheetUp('Résumé 履歴.sheet').catch(() => {});
      check('a sheet with a non-English name, brought back when the app starts again, is a live sheet with its entry', (await group(0))?.live && (await cell(0, 0)) === 'kept-over-restart', { g: await group(0), a1: await cell(0, 0) });
    } else {
      note('the sheet tab is not brought back when the app starts again in this run (test mode)');
      await run('file.openFile', made); await sheetUp('Résumé 履歴.sheet').catch(() => {});
      check('a sheet with a non-English name opens after the app was closed and started again, with its entry', (await group(0))?.live && (await cell(0, 0)) === 'kept-over-restart', { g: await group(0), a1: await cell(0, 0) });
    }
    check('the folder has that one file under that name, no twin under another spelling', (await ls()).filter((n) => /sum|履歴/i.test(n)).length === 1, (await ls()).filter((n) => /sum|履歴/i.test(n)));
    await reset();

    if (!seeded) { note('a practice problem was not opened: the seed did not run'); return; }
    await run('worksheet.bank'); await wait(2500);
    await clickEl('[data-part-id="workbench.parts.editor"] *', 'Brosius'); await wait(1200);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.ws-bankrow')].filter((e) => e.getClientRects().length).length);
    await shot('bank');
    if (!rows) { note(`the problem bank shows no rows after the seed: ${JSON.stringify((await group(0))?.words)}`); return; }
    const first = await page.evaluate(() => { const r = [...document.querySelectorAll('.ws-bankrow')].find((e) => e.getClientRects().length); const b = r.getBoundingClientRect(); return { x: b.left + 160, y: b.top + b.height / 2, text: (r.innerText ?? '').replace(/\s+/g, ' ').slice(0, 80) }; });
    await page.mouse.click(first.x, first.y); await wait(1500);
    if (!(await liveCount())) { await page.mouse.dblclick(first.x, first.y); await wait(1500); }
    if (!(await liveCount())) { const btn = await pointOf('.px-btn--primary'); if (btn) { await page.mouse.click(btn.x, btn.y); await wait(1500); } }
    await sheetUp().catch(() => {});
    const g = await group(0);
    await shot('practice-problem');
    console.log(`       a seeded problem (${first.text}) opened as: ${JSON.stringify({ shown: g?.active, live: g?.live, words: g?.words.slice(0, 120) })}`);
    if (!g?.live) { note('a practice problem did not open as a live sheet by clicking its row in the Problem Bank'); return; }
    const given = await page.evaluate(() => { const snap = window.__fx.sheetEl(null).__wsHost.getSnapshot(); const s = snap.sheets[snap.sheetOrder[0]]; return { rows: s.rowCount, columns: s.columnCount, c6: s.cellData?.[5]?.[2]?.v, c7: s.cellData?.[6]?.[2]?.v, a1: s.cellData?.[0]?.[0]?.v }; });
    check('the practice problem shows its given cells', typeof given.c6 === 'number' && typeof given.c7 === 'number', given);
    await enter(10, 5, '=SUM(C6:C7)'); await type('=C7/C6'); await key('Enter'); await type('=NUMBERVALUE("12")'); await key('Enter'); await type('=LET(x,1,x)'); await key('Enter'); await wait(1200);
    const got = { sum: await cell(10, 5), ratio: await cell(11, 5), removed: await cell(12, 5), letv: await cell(13, 5) };
    check('on the practice problem a SUM over its given cells and a division compute', got.sum === given.c6 + given.c7 && typeof got.ratio === 'number' && Math.abs(got.ratio - given.c7 / given.c6) < 0.001, { got, given });
    check('on the practice problem NUMBERVALUE answers #NAME? (the exam\'s list is applied there too)', isName(got.removed), got);
    note(`on the practice problem =LET(x,1,x) reads ${JSON.stringify(got.letv)}`);
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
if (explorerMisses.length) console.log(`[probe] the Explorer's menu did nothing the first time, ${explorerMisses.length} times: ${explorerMisses.join('; ')}`);
console.log(`[probe] notes: ${notes.length}`);
for (const n of notes) console.log('  - ' + n);
console.log(`[probe] ${problems.length} problems${problems.length ? ':\n  ' + problems.join('\n  ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length ? 1 : 0;
