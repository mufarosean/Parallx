// sheet-toolbar-probe.mjs — the sheet's toolbar is the app's own (Worksheets' 2B), with a bar that
// comes to a finger's selection (2C); the engine's ribbon is gone.
//
// Boots the built app hidden on a new workspace, makes a sheet file, and works the toolbar with
// the real mouse, the real keys and a simulated finger. What each control did is read back from
// the engine's saved workbook (the pane's probe hook, `__wsHost.getSnapshot()`), not from the
// toolbar. Then the practice sheet (held to the exam's limits): the same toolbar, no Sort or Filter.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/sheet-toolbar-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, screenshot } from './scene.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'sheet-toolbar-'));
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app');
const ws = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); return ok; };

const { app, page, errors } = await launchApp(appRoot);
const wait = (ms) => page.waitForTimeout(ms);
const cdp = await page.context().newCDPSession(page);
const finger = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await wait(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(500); };

/** The live sheet's host, by its probe hook. */
const host = (fn, ...a) => page.evaluate(({ fn, a }) => [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost).__wsHost[fn](...a), { fn, a });
const sheetReady = async () => { await page.waitForFunction(() => { const el = [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost); return !!el && !!el.querySelector('canvas'); }, null, { timeout: 90_000 }); await wait(2_000); };
/** One cell as the engine saved it: value, formula, style; and the sheet's merges, freeze and filter. */
const cell = (r, c) => page.evaluate(({ r, c }) => {
  const snap = [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost).__wsHost.getSnapshot();
  const sh = snap.sheets[snap.sheetOrder[0]];
  const d = sh.cellData?.[r]?.[c] ?? {};
  const s = (typeof d.s === 'string' ? snap.styles?.[d.s] : d.s) ?? {};
  return { v: d.v ?? null, f: d.f ?? null, s, merges: sh.mergeData ?? [], freeze: sh.freeze ?? null };
}, { r, c });
const column = async (c, from, to) => { const out = []; for (let r = from; r <= to; r++) out.push((await cell(r, c)).v); return out; };
const select = async (r, c) => { await host('probeActivate', r, c); await wait(250); };
/** Where a cell is on screen: from the toolbar's own bridge, so a press lands on it. */
const cellPoint = () => page.evaluate(() => { const r = [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost).__wsHost.format.selectionRect(); return r ? { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 } : null; });
const gridFocus = async () => { const p = await cellPoint(); await page.mouse.click(p.x, p.y); await wait(250); };

/** The toolbar as drawn: every control's name, in order, with what it says of itself. */
const bar = (sel = '.ws-toolbar') => page.evaluate((sel) => {
  const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const controls = [...el.querySelectorAll('button')].map((b) => { const q = b.getBoundingClientRect(); return { name: b.title || b.getAttribute('data-parallx-title') || b.getAttribute('aria-label') || '', said: b.getAttribute('aria-label') || b.querySelector('.px-btn__label')?.textContent || '', text: b.querySelector('.px-btn__label')?.textContent ?? '', pressed: b.getAttribute('aria-pressed'), disabled: b.disabled, menu: b.getAttribute('aria-haspopup') === 'menu', icon: !!b.querySelector('svg'), w: Math.round(q.width), h: Math.round(q.height), tab: b.tabIndex }; });
  return { role: el.getAttribute('role'), label: el.getAttribute('aria-label'), top: r.top, bottom: r.bottom, left: r.left, right: r.right, bg: getComputedStyle(el).backgroundColor, controls, hidden: el.hidden };
}, sel);
const button = (title, sel = '.ws-toolbar') => page.evaluate(({ title, sel }) => { const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length); const b = [...(el?.querySelectorAll('button') ?? [])].find((x) => (x.title || x.getAttribute('data-parallx-title')) === title); if (!b) return null; b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled, text: b.querySelector('.px-btn__label')?.textContent ?? '' }; }, { title, sel });
const press = async (title, sel) => { const b = await button(title, sel); if (!b) throw new Error(`no toolbar control named ${title}`); await page.mouse.click(b.x, b.y); await wait(450); };
const menu = () => page.evaluate(() => { const m = [...document.querySelectorAll('.context-menu')].filter((e) => e.getClientRects().length).pop(); return m ? [...m.querySelectorAll(':scope > .context-menu-item, :scope > * > .context-menu-item')].map((i) => ({ label: i.querySelector('.context-menu-item-label')?.textContent ?? '', icon: !!i.querySelector('.context-menu-item-icon svg'), checked: i.getAttribute('aria-checked') })) : null; });
const pick = async (label) => { const at = await page.evaluate((label) => { const m = [...document.querySelectorAll('.context-menu')].filter((e) => e.getClientRects().length).pop(); const i = [...(m?.querySelectorAll('.context-menu-item') ?? [])].find((x) => x.querySelector('.context-menu-item-label')?.textContent === label); if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, label); if (!at) throw new Error(`no menu entry ${label}`); await page.mouse.click(at.x, at.y); await wait(500); };
const fromMenu = async (buttonTitle, entry) => { await press(buttonTitle); await pick(entry); };

try {
  // ── A sheet of one's own ──
  await cmd(page, 'worksheet.newSheet', 'Budget');
  await sheetReady();
  const b0 = await bar();
  const ribbon = await page.evaluate(() => [...document.querySelectorAll('[data-u-comp="ribbon-toolbar"], [data-u-comp="ribbon-header-menu"], .univer-toolbar')].filter((e) => e.getClientRects().length).length);
  check('the engine\'s ribbon is not drawn', ribbon === 0, ribbon);
  check('the sheet has a toolbar a screen reader hears as one, named', b0?.role === 'toolbar' && b0.label === 'Sheet toolbar', b0 && [b0.role, b0.label]);
  const names = b0.controls.map((c) => c.name);
  const want = ['Undo', 'Redo', 'Number Format', 'Percent', 'Bold', 'Italic', 'Underline', 'Text Colour', 'Fill Colour', 'Borders', 'Alignment', 'Wrap Text', 'Merge Cells', 'Insert a Function', 'Sort', 'Filter', 'Freeze Rows and Columns', 'Ask About the Selected Cells in Chat', 'More Actions'];
  check('its controls, in the drawing\'s order: number format, text marks, colour, borders, alignment, then Sum, Sort, Filter, Freeze, Ask and More', JSON.stringify(names) === JSON.stringify(want), names);
  check('every control has a name a screen reader says, an icon, and is a Tab stop', b0.controls.every((c) => c.said && c.icon && c.tab === 0), b0.controls.filter((c) => !c.said || !c.icon || c.tab !== 0));
  check('the number format\'s button says what it is and the format the cell has', b0.controls.find((c) => c.name === 'Number Format')?.said === 'Number Format, General', b0.controls.find((c) => c.name === 'Number Format'));
  check('every control is at least 24 px each way', b0.controls.every((c) => c.w >= 24 && c.h >= 24), b0.controls.map((c) => [c.name, c.w, c.h]).filter((c) => c[1] < 24 || c[2] < 24));
  const sheetTop = await page.evaluate(() => [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length).getBoundingClientRect().top);
  check('the toolbar is one row directly over the sheet', b0.bottom <= sheetTop + 1 && b0.bottom - b0.top <= 40, [b0.top, b0.bottom, sheetTop]);
  check('the formula bar is still there', await page.evaluate(() => !![...document.querySelectorAll('[data-u-comp="formula-bar"]')].find((e) => e.getClientRects().length)));
  check('Undo and Redo are off on a sheet nothing was done to', b0.controls[0].disabled && b0.controls[1].disabled, b0.controls.slice(0, 2));

  // Data: a heading row and four rows, in B2:D6.
  const rows = [['Item', 'Cost', 'Share'], ['Rent', '1850', '0.5'], ['Food', '612.4', '0.25'], ['Power', '95', '0.1'], ['Books', '240', '0.15']];
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < 3; c++) await host('setCellText', r + 1, c + 1, rows[r][c]);
  await wait(400);

  // ── Text marks: mouse, then keys ──
  await select(1, 1);
  await press('Bold');
  check('Bold, pressed with the mouse, makes the cell bold (read from the saved workbook)', (await cell(1, 1)).s.bl === 1, (await cell(1, 1)).s);
  check('and the button says it is on', (await button('Bold')).pressed === 'true', await button('Bold'));
  // The press was with the mouse: the keys are back in the grid, so typing goes on in the cell.
  await select(16, 5);
  await press('Italic');
  await page.keyboard.type('Zed'); await page.keyboard.press('Enter'); await wait(400);
  const zed = await cell(16, 5);
  check('after a press with the mouse the keys are back in the grid: what is typed lands in the cell, italic', zed.v === 'Zed' && zed.s.it === 1, zed);
  await fromMenu('Fill Colour', 'Green');
  await page.keyboard.type('Go'); await page.keyboard.press('Enter'); await wait(400);
  check('and after a choice from a menu', (await cell(17, 5)).v === 'Go', await cell(17, 5));
  await select(2, 1);
  await wait(200);
  check('on a cell that is not bold the button is off', (await button('Bold')).pressed === 'false', await button('Bold'));
  await select(1, 1);
  // Keys: Tab order reaches the toolbar's buttons; here focus is put on Bold and the arrows walk the row.
  await page.evaluate(() => [...document.querySelectorAll('.ws-toolbar button')].find((b) => (b.title || b.getAttribute('data-parallx-title')) === 'Bold').focus());
  await page.keyboard.press('ArrowRight'); await wait(120);
  check('Arrow Right moves from Bold to Italic', await page.evaluate(() => document.activeElement?.dataset.pxId) === 'worksheet.toolbar.italic', await page.evaluate(() => document.activeElement?.dataset.pxId));
  const ring = await page.evaluate(() => { const c = getComputedStyle(document.activeElement); return `${c.outlineStyle} ${c.outlineWidth} ${c.boxShadow}`; });
  check('the focused control shows a ring', !/^none 0px none$/.test(ring), ring);
  await page.keyboard.press('Enter'); await wait(450);
  check('Enter on Italic makes the cell italic', (await cell(1, 1)).s.it === 1, (await cell(1, 1)).s);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space'); await wait(450);
  check('Space on Underline underlines it', (await cell(1, 1)).s.ul?.s === 1, (await cell(1, 1)).s);
  await page.keyboard.press('Home'); await wait(100);
  check('Home goes to the row\'s first control that is on', (await page.evaluate(() => document.activeElement?.dataset.pxId)) === 'worksheet.toolbar.undo', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
  check('Undo is on once something was done', !(await button('Undo')).disabled);

  // ── The keys: Ctrl+B, Ctrl+I and Ctrl+U are the sheet's while the keys are in it ──
  // (Ctrl+B is also the app's Toggle Left Area. It used to do both here: bold the cell and hide the sidebar.)
  const sidebarShown = () => page.evaluate(() => { const s = document.querySelector('[data-part-id="workbench.parts.sidebar"]'); return !!s && s.getClientRects().length > 0 && s.getBoundingClientRect().width > 50; });
  await select(14, 1);
  await host('setCellText', 14, 1, 'Keys');
  await gridFocus();
  await page.keyboard.press('Control+b'); await wait(400);
  await page.keyboard.press('Control+i'); await wait(400);
  await page.keyboard.press('Control+u'); await wait(400);
  const keyed = (await cell(14, 1)).s;
  check('Ctrl+B, Ctrl+I and Ctrl+U in a cell make it bold, italic and underlined', keyed.bl === 1 && keyed.it === 1 && keyed.ul?.s === 1, keyed);
  check('and the sidebar is still there', await sidebarShown());
  check('the toolbar shows all three on', (await button('Bold')).pressed === 'true' && (await button('Italic')).pressed === 'true' && (await button('Underline')).pressed === 'true');

  // ── Number format ──
  await select(2, 3);
  await press('Number Format');
  const numMenu = await menu();
  check('Number Format opens a menu of formats, General ticked', !!numMenu && ['General', 'Number', 'Percent', 'Currency', 'Date', 'Text'].every((l) => numMenu.some((i) => i.label === l)) && numMenu.find((i) => i.label === 'General')?.checked === 'true', numMenu);
  await screenshot(app, page, path.join(shots, 'menu-number.png'), { keepFocus: true });
  await pick('Percent');
  check('Percent from the menu sets the cell\'s number format', (await cell(2, 3)).s.n?.pattern === '0.00%', (await cell(2, 3)).s);
  check('and the button is named for it', (await button('Number Format')).text === 'Percent', await button('Number Format'));
  await select(3, 3);
  await press('Percent');
  check('the Percent button sets a percent format', /%/.test((await cell(3, 3)).s.n?.pattern ?? ''), (await cell(3, 3)).s);

  // ── Colour, borders, alignment, wrap ──
  await select(1, 2);
  await press('Fill Colour');
  const fillMenu = await menu();
  check('Fill Colour offers named colours, each shown as itself', !!fillMenu && fillMenu.filter((i) => i.icon).length >= 8 && fillMenu.some((i) => i.label === 'No Fill'), fillMenu);
  await screenshot(app, page, path.join(shots, 'menu-fill.png'), { keepFocus: true });
  await pick('Yellow');
  check('Yellow fills the cell', /fcf3bf/i.test((await cell(1, 2)).s.bg?.rgb ?? ''), (await cell(1, 2)).s.bg);
  await fromMenu('Text Colour', 'Red');
  check('Red colours its text', /c0392b/i.test((await cell(1, 2)).s.cl?.rgb ?? ''), (await cell(1, 2)).s.cl);
  await fromMenu('Fill Colour', 'No Fill');
  check('No Fill takes the fill away', !(await cell(1, 2)).s.bg?.rgb, (await cell(1, 2)).s.bg);
  await fromMenu('Borders', 'All Borders');
  const bd = (await cell(1, 2)).s.bd ?? {};
  check('All Borders draws the cell\'s four sides', ['t', 'b', 'l', 'r'].every((k) => bd[k]), bd);
  await fromMenu('Borders', 'No Borders');
  const bd2 = (await cell(1, 2)).s.bd ?? {};
  check('No Borders takes them away', ['t', 'b', 'l', 'r'].every((k) => !bd2[k]), bd2);
  await fromMenu('Alignment', 'Align Center');
  check('Align Center centres it', (await cell(1, 2)).s.ht === 2, (await cell(1, 2)).s);
  await press('Wrap Text');
  check('Wrap Text wraps it, and the button is on', (await cell(1, 2)).s.tb === 3 && (await button('Wrap Text')).pressed === 'true', (await cell(1, 2)).s);
  await press('Wrap Text');
  check('pressed again, it is off', (await cell(1, 2)).s.tb !== 3 && (await button('Wrap Text')).pressed === 'false', (await cell(1, 2)).s);

  // ── Merge: two cells selected with the keys ──
  await select(8, 1);
  await gridFocus();
  await page.keyboard.down('Shift'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift'); await wait(300);
  await press('Merge Cells');
  const merged = (await cell(8, 1)).merges;
  check('Merge Cells merges the selected cells', merged.some((m) => m.startRow === 8 && m.endRow === 8 && m.startColumn === 1 && m.endColumn === 2), merged);
  check('the button is on in a merged cell', (await button('Merge Cells')).pressed === 'true');
  await press('Merge Cells');
  check('pressed again, they are apart', (await cell(8, 1)).merges.length === 0, (await cell(8, 1)).merges);

  // ── Sort: a cell in the Cost column; the heading stays ──
  await select(3, 2);
  await fromMenu('Sort', 'Sort Smallest to Largest');
  const costs = await column(2, 1, 5);
  const items = await column(1, 1, 5);
  check('Sort Smallest to Largest sorts the block by that column, the heading row staying on top', JSON.stringify(costs) === JSON.stringify(['Cost', 95, 240, 612.4, 1850]) && JSON.stringify(items) === JSON.stringify(['Item', 'Power', 'Books', 'Food', 'Rent']), [costs, items]);
  await fromMenu('Sort', 'Sort Largest to Smallest');
  check('Sort Largest to Smallest turns it over', JSON.stringify(await column(2, 1, 5)) === JSON.stringify(['Cost', 1850, 612.4, 240, 95]), await column(2, 1, 5));

  // ── Sum ──
  await select(6, 2);
  await press('Insert a Function');
  const sumMenu = await menu();
  check('the Sum button lists Sum, Average, Count, Largest, Smallest and All Functions…', !!sumMenu && ['Sum', 'Average', 'Count', 'Largest', 'Smallest', 'All Functions…'].every((l) => sumMenu.some((i) => i.label === l)), sumMenu);
  await pick('Sum');
  await wait(400);
  if (!(await cell(6, 2)).f) { await page.keyboard.press('Enter'); await wait(500); }
  const sum = await cell(6, 2);
  check('Sum under a column of numbers writes the sum of that column', /^=SUM\(C3:C6\)$/i.test(sum.f ?? '') && Math.abs(Number(sum.v) - 2797.4) < 0.01, sum);

  // ── Filter ──
  await select(2, 1);
  await press('Filter');
  const f1 = await page.evaluate(() => [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost).__wsHost.format.state().filter);
  check('Filter puts a filter on the block, and the button is on', f1 === true && (await button('Filter')).pressed === 'true', f1);
  await screenshot(app, page, path.join(shots, 'sheet-filter.png'));
  await press('Filter');
  check('pressed again, the filter is off', (await page.evaluate(() => [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length && e.__wsHost).__wsHost.format.state().filter)) === false && (await button('Filter')).pressed === 'false');

  // ── Freeze ──
  await fromMenu('Freeze Rows and Columns', 'Freeze Top Row');
  check('Freeze Top Row freezes one row', (await cell(0, 0)).freeze?.ySplit === 1, (await cell(0, 0)).freeze);
  await press('Freeze Rows and Columns');
  check('the menu ticks what is frozen', (await menu())?.find((i) => i.label === 'Freeze Top Row')?.checked === 'true', await menu());
  await pick('Unfreeze');
  check('Unfreeze lets it go', !((await cell(0, 0)).freeze?.ySplit > 0), (await cell(0, 0)).freeze);

  // ── More: what the row does not show ──
  await select(4, 1);
  await press('More Actions');
  const more = await menu();
  const moreWant = ['Font', 'Size', 'Strikethrough', 'Currency', 'Vertical Alignment', 'Rotation', 'Long Text', 'Merge', 'Format Painter', 'Clear Formatting', 'Clear Contents and Formatting', 'Text to Number', 'Insert Image…', 'Insert Image in a Cell…', 'Protect Cells…'];
  check('More holds what the row does not show: font, size, strikethrough, vertical alignment, rotation, long text, the merges, format painter, the clears, text to number, images, protection', !!more && moreWant.every((l) => more.some((i) => i.label === l)), more?.map((i) => i.label));
  await screenshot(app, page, path.join(shots, 'menu-more.png'), { keepFocus: true });
  await pick('Strikethrough');
  check('Strikethrough from More strikes the cell', (await cell(4, 1)).s.st?.s === 1, (await cell(4, 1)).s);

  // ── Undo ──
  await press('Undo');
  check('Undo takes the last act back', (await cell(4, 1)).s.st?.s !== 1, (await cell(4, 1)).s);
  check('and Redo is on', !(await button('Redo')).disabled);
  await press('Redo');
  check('Redo does it again', (await cell(4, 1)).s.st?.s === 1, (await cell(4, 1)).s);

  // ── What the engine's ribbon had and the row does not: each is in a menu, and does its work ──
  /** Open a toolbar menu, go into a submenu by hovering its row, and press an entry of it. */
  const fromSub = async (buttonTitle, parent, entry) => {
    await press(buttonTitle);
    const at = await page.evaluate((parent) => { const m = [...document.querySelectorAll('.context-menu')].filter((e) => e.getClientRects().length).pop(); const i = [...m.querySelectorAll('.context-menu-item')].find((x) => x.querySelector('.context-menu-item-label')?.textContent === parent); const r = i.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, parent);
    await page.mouse.move(at.x - 4, at.y); await page.mouse.move(at.x, at.y); await wait(500);
    if ((await page.evaluate(() => [...document.querySelectorAll('.context-menu')].filter((e) => e.getClientRects().length).length)) < 2) { await page.mouse.click(at.x, at.y); await wait(400); }
    await pick(entry);
  };
  await select(10, 1);
  await host('setCellText', 10, 1, 'Wide words that run on');
  await fromSub('More Actions', 'Long Text', 'Clip');
  check('Long Text, Clip cuts it at the cell\'s edge', (await cell(10, 1)).s.tb === 2, (await cell(10, 1)).s);
  await fromSub('More Actions', 'Size', 'Larger');
  const fs1 = (await cell(10, 1)).s.fs;
  check('Size, Larger makes the text larger', fs1 > 11, fs1);
  await fromSub('More Actions', 'Size', '18');
  check('Size, 18 sets it', (await cell(10, 1)).s.fs === 18, (await cell(10, 1)).s);
  await fromSub('More Actions', 'Font', 'Georgia');
  check('Font, Georgia sets the face', (await cell(10, 1)).s.ff === 'Georgia', (await cell(10, 1)).s);
  await fromSub('More Actions', 'Vertical Alignment', 'Top');
  check('Vertical Alignment, Top', (await cell(10, 1)).s.vt === 1, (await cell(10, 1)).s);
  await fromSub('More Actions', 'Rotation', 'Tilt Up');
  check('Rotation, Tilt Up turns the text', (await cell(10, 1)).s.tr?.a === -45, (await cell(10, 1)).s.tr);
  await fromSub('Borders', 'Line', 'Medium');
  await fromSub('Borders', 'Line Colour', 'Red');
  await fromMenu('Borders', 'Outside Borders');
  const ob = (await cell(10, 1)).s.bd ?? {};
  check('a border drawn after choosing Medium and Red is medium and red', ob.t?.s === 8 && /c0392b/i.test(ob.t?.cl?.rgb ?? ''), ob);
  await press('More Actions'); await pick('Clear Formatting');
  const cf = await cell(10, 1);
  check('Clear Formatting takes the format away and keeps the words', cf.v === 'Wide words that run on' && !cf.s.ff && !cf.s.bd?.t && !cf.s.tr?.a, cf);
  await press('More Actions'); await pick('Clear Contents and Formatting');
  check('Clear Contents and Formatting empties the cell', (await cell(10, 1)).v == null, await cell(10, 1));
  // Merge across each row: a block two by two becomes two merged rows.
  await select(12, 1);
  await gridFocus();
  await page.keyboard.down('Shift'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift'); await wait(300);
  await fromSub('More Actions', 'Merge', 'Merge Across Each Row');
  const across = (await cell(12, 1)).merges;
  check('Merge, Across Each Row merges each row of the selection on its own', across.length === 2 && across.every((m) => m.startRow === m.endRow && m.startColumn === 1 && m.endColumn === 2), across);
  await fromSub('More Actions', 'Merge', 'Unmerge');
  check('Merge, Unmerge takes them apart', (await cell(12, 1)).merges.length === 0, (await cell(12, 1)).merges);
  await press('Sort');
  const sortMenu = await menu();
  check('the Sort menu lists Custom Sort…, Clear Filter Conditions and Reapply Filter', !!sortMenu && ['Custom Sort…', 'Clear Filter Conditions', 'Reapply Filter'].every((l) => sortMenu.some((i) => i.label === l)), sortMenu);
  await page.keyboard.press('Escape'); await wait(300);

  // ── The bottom line: sum, average and count of the selection ──
  await select(2, 2);
  await gridFocus();
  await page.keyboard.down('Shift'); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift'); await wait(800);
  const foot = await page.evaluate(() => { const pane = [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length); return (pane.innerText || '').replace(/\s+/g, ' '); });
  check('the bottom line shows the sum, average and count of what is selected', /Sum:?\s*2,?797\.4/i.test(foot) && /Average/i.test(foot) && /Count/i.test(foot), foot.slice(-220));
  await screenshot(app, page, path.join(shots, 'sheet-toolbar.png'));

  // ── Ask: the selection goes to the chat, nothing sent ──
  await press('Ask About the Selected Cells in Chat');
  await wait(1_500);
  // The chat shows what is attached as a chip over its input.
  const chat = await page.evaluate(() => ({ chips: [...document.querySelectorAll('.parallx-chat-context-chip--selection')].filter((e) => e.getClientRects().length).map((e) => `${e.textContent.replace(/\s+/g, ' ').trim()} | ${e.title || e.getAttribute('data-parallx-title') || e.getAttribute('aria-label') || ''}`), sent: [...document.querySelectorAll('.parallx-chat-message')].filter((e) => e.getClientRects().length).length }));
  check('Ask attaches the selected cells to the chat, said as the range of the sheet', chat.chips.length === 1 && /C3:C6/.test(chat.chips[0]) && /Budget/.test(chat.chips[0]), chat);
  check('and sends nothing', chat.sent === 0, chat.sent);
  await screenshot(app, page, path.join(shots, 'ask.png'));
  // With the chat open the pane is narrow: the toolbar goes on to a second line, and nothing is cut off.
  const narrow = await bar();
  const paneBox = await page.evaluate(() => { const r = [...document.querySelectorAll('.ws-pane')].find((e) => e.getClientRects().length).getBoundingClientRect(); return { left: r.left, right: r.right }; });
  const cut = await page.evaluate(() => { const t = [...document.querySelectorAll('.ws-toolbar')].find((e) => e.getClientRects().length); const box = t.getBoundingClientRect(); return [...t.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1; }).length; });
  check('in a narrow pane every control is still on the toolbar, none cut off', narrow.controls.length === want.length && cut === 0 && narrow.right <= paneBox.right + 1, [narrow.controls.length, cut, narrow.right, paneBox]);
  await cmd(page, 'workbench.action.toggleAuxiliaryBar');
  await wait(800);

  // ── A finger: a bar comes to the selection ──
  check('with a mouse there is no bar at the selection', !(await bar('.ws-touchbar')), await bar('.ws-touchbar'));
  await select(3, 1);
  const p = await cellPoint();
  await finger(p.x, p.y);
  await wait(600);
  const tb = await bar('.ws-touchbar');
  check('a finger on a cell brings a bar to the selection', !!tb && tb.role === 'toolbar' && tb.label === 'Selection toolbar', tb && [tb.role, tb.label]);
  const tnames = tb?.controls.map((c) => c.name) ?? [];
  check('it holds number format, Bold, Italic, Fill, Sum, Sort, Filter, Ask and More', JSON.stringify(tnames) === JSON.stringify(['Number Format', 'Bold', 'Italic', 'Fill Colour', 'Insert a Function', 'Sort', 'Filter', 'Ask About the Selected Cells in Chat', 'More Actions']), tnames);
  check('each of its controls is at least 32 px each way, a finger\'s size', !!tb && tb.controls.every((c) => c.w >= 32 && c.h >= 32), tb?.controls.map((c) => [c.name, c.w, c.h]));
  const sheetBox = await page.evaluate(() => { const r = [...document.querySelectorAll('.ws-pane__sheet')].find((e) => e.getClientRects().length).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
  check('it sits on the sheet, clear of the cell it came to', !!tb && tb.top >= sheetBox.top && tb.bottom <= sheetBox.bottom && tb.left >= sheetBox.left && tb.right <= sheetBox.right && (tb.bottom <= p.y - 8 || tb.top >= p.y + 8), tb && [tb.top, tb.bottom, p.y]);
  await screenshot(app, page, path.join(shots, 'touch-bar.png'));
  const tbBold = await button('Bold', '.ws-touchbar');
  await finger(tbBold.x, tbBold.y);
  check('a finger on its Bold makes the cell bold', (await cell(3, 1)).s.bl === 1, (await cell(3, 1)).s);
  await select(5, 1);
  await gridFocus();
  await wait(400);
  check('back on the mouse, the bar goes', !(await bar('.ws-touchbar')), await bar('.ws-touchbar'));

  // ── The file kept it ──
  await cmd(page, 'workbench.action.closeActiveEditor');
  await wait(1_500);
  const saved = JSON.parse(await fs.readFile(path.join(ws, 'Budget.sheet'), 'utf8'));
  const savedSheet = saved.workbook.sheets[saved.workbook.sheetOrder[0]];
  const savedStyle = (r, c) => { const d = savedSheet.cellData?.[r]?.[c] ?? {}; return (typeof d.s === 'string' ? saved.workbook.styles?.[d.s] : d.s) ?? {}; };
  check('closed, the file on disk holds the formats and the sorted rows', savedStyle(1, 1).bl === 1 && savedSheet.cellData[2][2].v === 1850 && /SUM/i.test(savedSheet.cellData[6][2].f ?? ''), [savedStyle(1, 1), savedSheet.cellData[2]?.[2], savedSheet.cellData[6]?.[2]]);

  // ── A page has the same three keys ──
  await cmd(page, 'canvas.newPage');
  await page.waitForSelector('.ProseMirror', { timeout: 30_000 });
  await wait(1_200);
  const pm = await page.evaluate(() => { const e = [...document.querySelectorAll('.ProseMirror')].find((x) => x.getClientRects().length); const r = e.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 20 }; });
  await page.mouse.click(pm.x, pm.y); await wait(300);
  await page.keyboard.type('plain ');
  await page.keyboard.press('Control+b'); await wait(300);
  await page.keyboard.type('heavy');
  await wait(400);
  const pageHtml = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror')].find((x) => x.getClientRects().length).innerHTML);
  check('in a page Ctrl+B makes what is typed next bold', /plain <strong>heavy<\/strong>/.test(pageHtml), pageHtml.slice(0, 160));
  check('and the sidebar is still there', await sidebarShown());
  await cmd(page, 'workbench.action.closeActiveEditor');
  await wait(800);

  // ── The practice sheet: the same toolbar, held to the exam's limits ──
  await cmd(page, 'worksheet.openScratch');
  await sheetReady();
  const sb = await bar();
  const sNames = sb?.controls.map((c) => c.name) ?? [];
  check('the practice sheet has the same toolbar, without Sort and Filter (the exam tool has neither)', JSON.stringify(sNames) === JSON.stringify(want.filter((n) => n !== 'Sort' && n !== 'Filter')), sNames);
  check('and no ribbon of the engine\'s', (await page.evaluate(() => [...document.querySelectorAll('[data-u-comp="ribbon-toolbar"], [data-u-comp="ribbon-header-menu"], .univer-toolbar')].filter((e) => e.getClientRects().length).length)) === 0);
  await host('setCellText', 1, 1, 'Exam');
  await select(1, 1);
  await press('Bold');
  check('Bold works on it', (await cell(1, 1)).s.bl === 1, (await cell(1, 1)).s);
  await screenshot(app, page, path.join(shots, 'practice-sheet.png'));

  // Light mode: the toolbar follows the app.
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
  await wait(1_200);
  const lb = await bar();
  const lum = (rgb) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb ?? ''); return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : -1; };
  check('in light mode the toolbar is light with the app', lum(lb?.bg) > 0.8 && lum(sb?.bg) < 0.3, [sb?.bg, lb?.bg]);
  await screenshot(app, page, path.join(shots, 'practice-sheet-light.png'));
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
