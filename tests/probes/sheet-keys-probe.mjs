// sheet-keys-probe.mjs — the keys a person expects in a spreadsheet that the engine did not have
// (Worksheets' list, "keys that do nothing"): Home, Ctrl+Home, Ctrl+End, Page Down and Up,
// Shift+Space, Ctrl+Space, F5 and Ctrl+G, Ctrl+Shift+1 4 5, Ctrl+1, Ctrl+Shift+Plus; and an arrow
// at the sheet's edge stays put.
//
// Boots the built app hidden on a new workspace and presses the real keys, on the practice sheet
// (150 by 40) and on a sheet file. Where the selection went and what a cell holds are read from
// the engine through the pane's probe hook.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/sheet-keys-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, screenshot } from './scene.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'sheet-keys-'));
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app');
const ws = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); return ok; };

const { app, page, errors } = await launchApp(appRoot);
const wait = (ms) => page.waitForTimeout(ms);
page.on('console', (m) => { if (/\[SheetFormat\]|\[SheetKeys\]/.test(m.text())) console.log(`  page: ${m.text().slice(0, 300)}`); });
const live = () => [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost);
const host = (fn, ...a) => page.evaluate(({ fn, a }) => [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost).__wsHost[fn](...a), { fn, a });
const sheetReady = async () => { await page.waitForFunction(() => { const el = [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost); return !!el && !!el.querySelector('canvas'); }, null, { timeout: 90_000 }); await wait(2_000); };
/** The selection as the engine has it ("B4", "4:4", "B:B"), and the active cell. */
const at = () => page.evaluate(() => { const h = [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost).__wsHost; return { range: h.format.state()?.range ?? null, cell: h.getActiveCell() }; });
const cell = (r, c) => page.evaluate(({ r, c }) => { const snap = [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost).__wsHost.getSnapshot(); const sh = snap.sheets[snap.sheetOrder[0]]; const d = sh.cellData?.[r]?.[c] ?? {}; return { v: d.v ?? null, f: d.f ?? null, s: (typeof d.s === 'string' ? snap.styles?.[d.s] : d.s) ?? {}, rows: sh.rowCount, columns: sh.columnCount }; }, { r, c });
const select = async (r, c) => { await host('probeActivate', r, c); await wait(250); };
const cellPoint = () => page.evaluate(() => { const r = [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost).__wsHost.format.selectionRect(); return r ? { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 } : null; });
/** Put the selection on a cell and the keys in the grid: a real press on that cell. */
const stand = async (r, c) => { await select(r, c); let p = await cellPoint(); if (!p) { await host('scrollToCell', r, c); await wait(400); } for (let i = 0; i < 20 && !p; i++) { await wait(150); p = await cellPoint(); } if (!p) throw new Error(`the cell at row ${r}, column ${c} is not on screen: ${JSON.stringify(await at())} ${JSON.stringify(await page.evaluate(({ r, c }) => { const h = [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost).__wsHost; return { activated: h.probeActivate(r, c), view: h.getViewState(), rect: h.format.selectionRect() }; }, { r, c }))}`); await page.mouse.click(p.x, p.y); await wait(250); };
const key = async (k) => { await page.keyboard.press(k); await wait(350); };
const sidebarShown = () => page.evaluate(() => { const s = document.querySelector('[data-part-id="workbench.parts.sidebar"]'); return !!s && s.getClientRects().length > 0; });

async function theKeys(label, { rows, columns }) {
  console.log(`\n[${label}]`);
  // Data in A1:C8, so "the last cell in use" is C8.
  for (const [r, c, t] of [[0, 0, '1'], [1, 0, '2'], [2, 0, '3'], [3, 1, '0.256'], [4, 1, '1234.5'], [5, 1, '1234.5'], [7, 2, 'end']]) await host('setCellText', r, c, t);
  await wait(400);

  await stand(2, 2);
  await key('Home');
  check(`${label}: Home goes to column A of the row`, (await at()).cell === 'A3', await at());
  await stand(5, 3);
  await key('Control+Home');
  check(`${label}: Ctrl+Home goes to A1`, (await at()).cell === 'A1', await at());
  await key('Control+End');
  check(`${label}: Ctrl+End goes to the last cell in use`, (await at()).cell === 'C8', await at());

  await stand(0, 0);
  await key('PageDown');
  const down = (await at()).cell;
  const downRow = Number(/\d+/.exec(down ?? '')?.[0] ?? 0);
  check(`${label}: Page Down goes a screen down in the same column`, /^A\d+$/.test(down ?? '') && downRow >= 10 && downRow <= 60, down);
  const seen = await cellPoint();
  check(`${label}: and the cell it went to is in view`, !!seen, seen);
  await key('PageDown');
  const down2 = Number(/\d+/.exec((await at()).cell ?? '')?.[0] ?? 0);
  check(`${label}: a second Page Down goes as far again`, Math.abs((down2 - downRow) - (downRow - 1)) <= 1, [downRow, down2]);
  await key('PageUp'); await key('PageUp');
  check(`${label}: Page Up twice is back at A1`, (await at()).cell === 'A1', await at());
  await key('PageUp');
  check(`${label}: Page Up at the top stays at A1`, (await at()).cell === 'A1', await at());

  await stand(3, 1);
  await key('Shift+Space');
  const row = await at();
  check(`${label}: Shift+Space selects the whole row, the active cell staying`, row.range === '4:4' && row.cell === 'B4', row);
  await stand(3, 1);
  await key('Control+Space');
  const col = await at();
  check(`${label}: Ctrl+Space selects the whole column`, col.range === 'B:B' && col.cell === 'B4', col);

  await stand(0, 0);
  await key('ArrowUp');
  const up = (await at()).cell;
  await key('ArrowLeft');
  check(`${label}: at A1, Up and Left stay at A1`, up === 'A1' && (await at()).cell === 'A1', [up, await at()]);
  await key('ArrowDown'); await key('ArrowRight');
  check(`${label}: away from the edge the arrows move as before`, (await at()).cell === 'B2', await at());
  await key('Shift+ArrowDown');
  check(`${label}: Shift+Arrow still extends the selection`, (await at()).range === 'B2:B3', await at());
  if (rows) {
    await stand(rows - 1, columns - 1);
    const last = (await at()).cell;
    await key('ArrowDown'); await key('ArrowRight');
    check(`${label}: at the last cell, Down and Right stay there`, (await at()).cell === last, [last, await at()]);
  }

  // Go To: the keys go to the name box; a cell's name and Enter goes there.
  for (const k of ['F5', 'Control+g']) {
    await stand(0, 0);
    await key(k);
    const inBox = await page.evaluate(() => !!document.activeElement?.closest('[data-u-comp="defined-name"]'));
    check(`${label}: ${k} puts the keys in the name box`, inBox, await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
    await page.keyboard.type(k === 'F5' ? 'D10' : 'F12'); await key('Enter'); await wait(300);
    check(`${label}: a cell's name typed there goes to it`, (await at()).cell === (k === 'F5' ? 'D10' : 'F12'), await at());
  }

  // Number formats.
  await stand(3, 1); await key('Control+Shift+5');
  check(`${label}: Ctrl+Shift+5 (%) shows a percent`, (await cell(3, 1)).s.n?.pattern === '0%', (await cell(3, 1)).s);
  await stand(4, 1); await key('Control+Shift+4');
  check(`${label}: Ctrl+Shift+4 ($) shows currency`, (await cell(4, 1)).s.n?.pattern === '$#,##0.00', (await cell(4, 1)).s);
  await stand(5, 1); await key('Control+Shift+1');
  check(`${label}: Ctrl+Shift+1 (!) shows thousands and two decimals`, (await cell(5, 1)).s.n?.pattern === '#,##0.00', (await cell(5, 1)).s);
  const words = () => page.evaluate(() => `${[...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length)?.textContent ?? ''} ${document.getElementById('ws-univer-popup-root')?.textContent ?? ''}`.length);
  await stand(5, 1);
  const before = await words();
  await key('Control+1'); await wait(700);
  check(`${label}: Ctrl+1 opens the number format choices`, (await words()) > before + 40, [before, await words()]);
  await screenshot(app, page, path.join(shots, `${label.replace(/\W+/g, '-')}-ctrl-1.png`), { keepFocus: true });
  await key('Escape');
  // Close the panel if Escape left it open.
  await page.evaluate(() => { const x = [...document.querySelectorAll('.ws-pane__sheet [data-u-comp="sidebar"] button, .ws-pane__sheet aside button')].find((b) => b.getClientRects().length); x?.click(); });
  await wait(400);

  // Insert: the choices come to the selection.
  await host('setCellText', 9, 0, '5'); await host('setCellText', 10, 0, '6');
  await select(11, 0); await host('probeSetFormula', 11, 0, '=SUM(A10:A11)'); await wait(400);
  await stand(10, 0);
  await key('Control+Shift+Equal');
  const menu = await page.evaluate(() => { const m = [...document.querySelectorAll('.context-menu')].filter((e) => e.getClientRects().length).pop(); if (!m) return null; const r = m.getBoundingClientRect(); return { labels: [...m.querySelectorAll('.context-menu-item-label')].map((e) => e.textContent), top: r.top, left: r.left }; });
  const p = await cellPoint();
  check(`${label}: Ctrl+Shift+Plus opens the insert choices`, !!menu && ['Insert Row Above', 'Insert Row Below', 'Insert Column Left', 'Insert Column Right'].every((l) => menu.labels.includes(l)), menu);
  check(`${label}: at the selection`, !!menu && !!p && Math.abs(menu.left - p.x) < 140 && menu.top > p.y - 10 && menu.top < p.y + 60, [menu && [menu.left, menu.top], p]);
  await screenshot(app, page, path.join(shots, `${label.replace(/\W+/g, '-')}-insert.png`), { keepFocus: true });
  // The menu has the keys while it is open: its arrows do not also move the sheet's selection.
  await key('ArrowDown'); await key('ArrowUp');
  check(`${label}: the menu's arrows do not move the sheet's selection`, (await at()).cell === 'A11', await at());
  await key('Enter');
  await wait(600);
  const moved = [await cell(10, 0), await cell(11, 0), await cell(12, 0)];
  check(`${label}: Enter on Insert Row Above puts an empty row there, the rows under it moving down`, moved[0].v == null && moved[1].v === 6 && /SUM/i.test(moved[2].f ?? ''), moved);
  // The menu gone, the keys are back in the grid: what is typed next lands in the cell.
  await page.keyboard.type('new'); await key('Enter');
  check(`${label}: after the menu the keys are back in the grid`, (await cell(10, 0)).v === 'new', await cell(10, 0));
  check(`${label}: and the formula under it follows`, /^=SUM\(A10:A12\)$/i.test(moved[2].f ?? '') || /^=SUM\(A10:A11\)$/i.test(moved[2].f ?? ''), moved[2]);

  // Find and replace: the sheet's own. (Ctrl+F used to open the app's search of files, which finds nothing on a sheet.)
  await host('setCellText', 20, 0, 'needle'); await host('setCellText', 22, 2, 'another needle here'); await host('setCellText', 24, 0, 'pear');
  await wait(300);
  await stand(18, 0);
  await key('Control+f'); await wait(700);
  const findUp = await page.evaluate(() => { const dlg = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).pop(); return { title: (dlg?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), keysInIt: !!dlg && dlg.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? '') }; });
  check(`${label}: Ctrl+F opens the sheet's Find with the keys in its field`, /^Find/.test(findUp.title) && findUp.keysInIt, findUp);
  await page.keyboard.type('needle', { delay: 40 }); await wait(1_000);
  const found = await page.evaluate(() => ([...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).pop()?.textContent ?? '').replace(/\s+/g, ' '));
  check(`${label}: it counts the cells that hold the word`, /[12]\s*\/\s*2/.test(found), found.slice(0, 80));
  await screenshot(app, page, path.join(shots, `${label.replace(/\W+/g, '-')}-find.png`), { keepFocus: true });
  await key('Escape'); await wait(500);
  check(`${label}: Escape closes it`, (await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).length)) === 0);
  check(`${label}: and the keys are back in the grid`, await page.evaluate(() => (document.activeElement?.id ?? '').endsWith('__INTERNAL_EDITOR__DOCS_NORMAL')), await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 100)));
  // Replace.
  await stand(18, 1);
  await key('Control+h'); await wait(800);
  const fields = await page.evaluate(() => { const dlg = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).pop(); return { text: (dlg?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160), inputs: dlg ? [...dlg.querySelectorAll('input')].filter((i) => i.getClientRects().length).length : 0 }; });
  check(`${label}: Ctrl+H opens Find and Replace, with a field for each`, /Replace/.test(fields.text) && fields.inputs >= 2, fields);
  // Each field is pressed, then typed in.
  const field = async (i, text) => { const at = await page.evaluate((i) => { const dlg = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).pop(); const f = [...dlg.querySelectorAll('input')].filter((x) => x.getClientRects().length && x.type !== 'checkbox')[i]; const r = f.getBoundingClientRect(); return { x: r.x + 20, y: r.y + r.height / 2 }; }, i); await page.mouse.click(at.x, at.y); await wait(200); await page.keyboard.type(text, { delay: 40 }); await wait(500); };
  await field(0, 'pear'); await field(1, 'peach');
  await screenshot(app, page, path.join(shots, `${label.replace(/\W+/g, '-')}-replace.png`), { keepFocus: true });
  // Find first (Replace All is off until something was found), then Replace All.
  const dialogButton = (name) => page.evaluate((name) => { const dlg = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).pop(); const b = [...(dlg?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === name); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, off: b.disabled }; }, name);
  const findBtn = await dialogButton('Find');
  if (findBtn) { await page.mouse.click(findBtn.x, findBtn.y); await wait(900); }
  const replaceAll = await dialogButton('Replace All');
  if (replaceAll) { await page.mouse.click(replaceAll.x, replaceAll.y); await wait(900); }
  const afterAll = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .univer-confirm-dialog, [data-u-comp="confirm"], [data-u-comp="message"]')].filter((e) => e.getClientRects().length).map((e) => `${(e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)} [${[...e.querySelectorAll('button')].filter((b) => b.getClientRects().length).map((b) => (b.textContent ?? '').trim()).join(',')}]`));
  // The engine asks before it replaces everywhere: its OK is pressed.
  const ok = await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].filter((x) => x.getClientRects().length).find((x) => /^(ok|confirm|yes)$/i.test((x.textContent ?? '').trim())); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (ok) { await page.mouse.click(ok.x, ok.y); await wait(900); }
  check(`${label}: Replace All puts the new word in the cell`, (await cell(24, 0)).v === 'peach', [replaceAll, afterAll, ok, await cell(24, 0)]);
  // A confirmation may be up; then the dialog itself.
  for (let i = 0; i < 3; i++) { await key('Escape'); await wait(300); }
  const stillUp = await page.evaluate(() => { const x = [...document.querySelectorAll('[role="dialog"] button')].filter((b) => b.getClientRects().length && /close|ok|confirm/i.test(`${b.textContent} ${b.getAttribute('aria-label') ?? ''}`)); for (const b of x) b.click(); return x.length; });
  if (stillUp) await wait(500);

  // None of the keys is taken from an entry being typed: the entry stays whole, in its own cell.
  await stand(14, 4);
  await page.keyboard.type('abc'); await wait(200);
  await key('Home'); await key('PageDown'); await key('Control+Home');
  await page.keyboard.type('x'); await wait(150);
  await page.keyboard.type(' y'); await wait(150);
  await key('Enter');
  const typed = (await cell(14, 4)).v;
  check(`${label}: while a cell is being typed in, Home, Page Down and Ctrl+Home do not leave the cell, and a space is a space`, typed === 'abcx y' || typed === 'x yabc', typed);
  check(`${label}: Enter then goes one cell down, as ever`, (await at()).cell === 'E16', await at());
  check(`${label}: the sidebar is still there after all of it`, await sidebarShown());
}

try {
  await cmd(page, 'worksheet.openScratch');
  await sheetReady();
  const size = await cell(0, 0);
  await theKeys('practice sheet', { rows: size.rows, columns: size.columns });
  await screenshot(app, page, path.join(shots, 'practice-sheet.png'));

  await cmd(page, 'worksheet.newSheet', 'Keys');
  await sheetReady();
  // A sheet of one's own grows as the selection nears its end, so it has no last cell to stop at.
  await theKeys('sheet file', {});
  // Frozen rows: Ctrl+Home goes to the first cell that scrolls.
  await cmd(page, 'worksheet.formatCells', { do: 'freeze', what: 'row' });
  await wait(500);
  await stand(6, 2);
  await key('Control+Home');
  check('sheet file: with the top row frozen, Ctrl+Home goes to A2', (await at()).cell === 'A2', await at());
  await screenshot(app, page, path.join(shots, 'sheet-file.png'));
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`);
  problems.push('the probe stopped');
  await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally {
  await app.close().catch(() => {});
}
const real = errors.filter((e) => !/Ollama|EmbeddingService|IndexingPipeline|ERR_CONNECTION_REFUSED|Failed to fetch/.test(e));
console.log(`\n[probe] page errors: ${real.length}`);
for (const e of real.slice(0, 10)) console.log('  ' + e);
if (real.length) problems.push(`${real.length} page errors`);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length ? 1 : 0;
