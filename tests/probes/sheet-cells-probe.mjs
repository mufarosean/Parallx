// sheet-cells-probe.mjs — how cells behave in the sheet, against what a person
// expects from a spreadsheet (Excel's own behaviour is the reference).
//
// Boots the built app hidden with a new profile and workspace, opens the
// Scratch Sheet and works it with real input: the mouse on the canvas, keys
// through the window, the system clipboard. After every act it reads the
// engine (active cell, selection, what the cell holds) and records what
// happened beside what Excel does. It judges nothing as a failure of the
// probe: each line is `same`, `differs` or `missing`, and the count of the
// last two is the report.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/sheet-cells-probe.mjs [outDir] [--only=move,enter,...]
//
// Writes results.json and screenshots into outDir (default test-results/sheet-cells-*).
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
const argDir = process.argv.slice(2).find((a) => !a.startsWith('--'));
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
await fs.mkdir(path.join(repo, 'test-results'), { recursive: true });
const root = argDir ? path.resolve(argDir) : await fs.mkdtemp(path.join(repo, 'test-results', 'sheet-cells-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data/chromium-cache'), path.join(workspace, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
await fs.writeFile(path.join(workspace, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));

const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
delete env.ELECTRON_RUN_AS_NODE;

const results = [];
const pageErrors = [];
let group = '';
/** One line of the report. verdict: same | differs | missing | note. */
const record = (name, excel, got, verdict, detail = '') => {
  results.push({ group, name, excel, got: typeof got === 'string' ? got : JSON.stringify(got), verdict, detail });
  const mark = verdict === 'same' ? '  ok ' : verdict === 'note' ? ' note' : verdict === 'missing' ? ' MISS' : ' DIFF';
  console.log(`${mark} [${group}] ${name}: ${typeof got === 'string' ? got : JSON.stringify(got)}${verdict === 'same' ? '' : `  (Excel: ${excel})`}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Record a check whose answer is an exact value. */
const expect = (name, excel, got, want, detail = '') => record(name, excel, got, same(got, want) ? 'same' : 'differs', detail);

let app; let page;
let G = { x: 0, y: 0, rowHeader: 46, colHeader: 20, colW: 88, rowH: 24 };

async function launch() {
  app = await electron.launch({ args: ['.', '--mute-audio', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(`[${group}] after "${results.at(-1)?.name ?? 'start'}": ${String(e).slice(0, 300)}`));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 900); });
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60000 });
}
const run = (id, ...args) => page.evaluate(({ id, args }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args), { id, args });
const host = (fn, ...a) => page.evaluate(({ fn, a }) => document.querySelector('.ws-pane__sheet').__wsHost[fn](...a), { fn, a });
const wait = (ms) => page.waitForTimeout(ms);

/** A new, empty sheet: the Scratch Sheet lives in memory, so a new window has none. */
async function fresh(name) {
  group = name;
  if (app) await app.close().catch(() => {});
  await launch();
  await run('worksheet.openScratch');
  await page.waitForFunction(() => !!document.querySelector('.ws-pane__sheet')?.__wsHost, null, { timeout: 60000 });
  await wait(2500);
  const geo = await page.evaluate(() => {
    const el = document.querySelector('.ws-pane__sheet');
    const c = [...el.querySelectorAll('canvas')].find((k) => k.id.startsWith('univer-sheet-main-canvas'));
    const r = c.getBoundingClientRect();
    const snap = el.__wsHost.getSnapshot();
    const s = snap.sheets[snap.sheetOrder[0]];
    return { x: r.left, y: r.top, w: r.width, h: r.height, rowHeader: s.rowHeader.width, colHeader: s.columnHeader.height, colW: s.defaultColumnWidth, rowH: s.defaultRowHeight };
  });
  G = geo;
}
const X = (c) => G.x + G.rowHeader + c * G.colW + G.colW / 2;
const Y = (r) => G.y + G.colHeader + r * G.rowH + G.rowH / 2;
const click = async (r, c, opts = {}) => { await page.mouse.click(X(c), Y(r), opts); await wait(180); };
const dbl = async (r, c) => { await page.mouse.dblclick(X(c), Y(r)); await wait(300); };
const drag = async (r1, c1, r2, c2) => {
  await page.mouse.move(X(c1), Y(r1)); await page.mouse.down(); await wait(60);
  await page.mouse.move(X(c2), Y(r2), { steps: 8 }); await wait(60); await page.mouse.up(); await wait(200);
};
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await wait(140); } };
const type = async (text) => { await page.keyboard.type(text, { delay: 25 }); await wait(200); };
const st = () => host('probeState');
/** The view back at A1, so the next click lands on the cell it names. */
const top = async () => { await host('scrollToCell', 0, 0); await wait(350); };
const active = async () => (await st()).activeCell;
const range = async () => (await st()).activeRange;
const editing = async () => (await st()).editorVisible === true;
const seed = async (cells) => { for (const [r, c, v] of cells) { if (typeof v === 'string' && v.startsWith('=')) await host('probeSetFormula', r, c, v); else await host('setCellText', r, c, String(v)); } await wait(350); };
/** What a cell holds: value, formula, the number format and the font marks on it. */
const cell = (r, c, sheetIndex = 0) => page.evaluate(({ r, c, sheetIndex }) => {
  const snap = document.querySelector('.ws-pane__sheet').__wsHost.getSnapshot();
  const sheet = snap.sheets[snap.sheetOrder[sheetIndex]];
  const d = sheet?.cellData?.[r]?.[c];
  if (!d) return null;
  const style = typeof d.s === 'string' ? snap.styles?.[d.s] : d.s;
  const out = {};
  if (d.v !== undefined && d.v !== null && d.v !== '') out.v = d.v;
  if (d.f) out.f = d.f;
  if (d.p) out.rich = (d.p.body?.dataStream ?? '').replace(/\r\n$/, '');
  if (style?.n?.pattern) out.fmt = style.n.pattern;
  if (style?.bl) out.bold = 1;
  if (style?.it) out.italic = 1;
  if (style?.ul?.s) out.underline = 1;
  return Object.keys(out).length ? out : null;
}, { r, c, sheetIndex });
const val = async (r, c) => { const d = await cell(r, c); return d ? (d.v ?? d.rich ?? null) : null; };
const computed = (r, c) => host('probeReadValue', r, c);
const sheetMeta = () => page.evaluate(() => {
  const snap = document.querySelector('.ws-pane__sheet').__wsHost.getSnapshot();
  return { order: snap.sheetOrder.map((id) => snap.sheets[id].name), sheets: snap.sheetOrder.map((id) => { const s = snap.sheets[id]; return { rowCount: s.rowCount, columnCount: s.columnCount, zoom: s.zoomRatio, freeze: s.freeze, columnData: s.columnData, rowData: s.rowData }; }) };
});
const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText());
const setClipboard = (t) => app.evaluate(({ clipboard }, text) => clipboard.writeText(text), t);
const shot = (name) => page.screenshot({ path: path.join(shots, name) });
const want = (g) => only.length === 0 || only.includes(g);

try {
  // ── Moving and selecting ──────────────────────────────────────────────────
  if (want('move')) {
    await fresh('Moving and selecting');
    await seed([[0, 0, 1], [1, 0, 2], [2, 0, 3], [3, 0, 4], [4, 0, 5], [7, 0, 9], [0, 2, 'x'], [1, 2, 'y'], [2, 2, 'z']]);
    await click(1, 1);
    expect('A click selects the cell', 'B2 selected', await active(), 'B2');
    await key('ArrowRight'); const a1 = await active(); await key('ArrowDown'); const a2 = await active(); await key('ArrowLeft'); const a3 = await active(); await key('ArrowUp'); const a4 = await active();
    expect('Arrow keys move one cell', 'C2, C3, B3, B2', [a1, a2, a3, a4], ['C2', 'C3', 'B3', 'B2']);
    await key('Tab'); const t1 = await active(); await key('Shift+Tab'); const t2 = await active();
    expect('Tab moves right, Shift+Tab left', 'C2, B2', [t1, t2], ['C2', 'B2']);
    await key('Enter'); const e1 = await active(); await key('Shift+Enter'); const e2 = await active();
    expect('Enter moves down, Shift+Enter up', 'B3, B2', [e1, e2], ['B3', 'B2']);
    await click(0, 0);
    await key('Control+ArrowDown'); const c1 = await active(); await key('Control+ArrowDown'); const c2 = await active(); await key('Control+ArrowDown'); const c3 = await active();
    expect('Ctrl+Down jumps to the edge of the data, then the next data, then the last row', 'A5, A8, the last row', [c1, c2, c3], ['A5', 'A8', 'A150'], 'The scratch sheet ends at row 150; Excel ends at 1,048,576.');
    await key('Control+Home');
    expect('Ctrl+Home goes to A1', 'A1', await active(), 'A1');
    await top(); await click(1, 1);
    await key('Control+End');
    expect('Ctrl+End goes to the last used cell', 'C8', await active(), 'C8');
    await top(); await click(2, 2); await key('Home');
    expect('Home goes to column A of the row', 'A3', await active(), 'A3');
    await top(); await click(0, 0); await key('PageDown'); const pd = await active(); await key('PageUp'); const pu = await active();
    record('Page Down and Page Up move a screen', 'about a screen down, then back to A1', [pd, pu], /^A\d+$/.test(pd ?? '') && pd !== 'A1' && pu === 'A1' ? 'same' : 'differs');
    await top(); await click(0, 0); await key('Shift+ArrowDown', 2);
    expect('Shift+Arrow extends the selection', 'A1:A3', await range(), 'A1:A3');
    await click(0, 0); await key('Control+Shift+ArrowDown');
    expect('Ctrl+Shift+Down extends to the edge of the data', 'A1:A5', await range(), 'A1:A5');
    await top(); await click(1, 0); await key('Control+a'); const all1 = await range(); await key('Control+a'); const all2 = await range();
    record('Ctrl+A inside data selects the data, again the whole sheet', 'A1:A5, then the whole sheet', [all1, all2], all1 === 'A1:A5' && /^(1:150|A1:AN150)$/.test(all2 ?? '') ? 'same' : 'differs', 'Excel selects the current region first when the active cell is inside data.');
    await top(); await click(3, 1); await key('Shift+Space'); const rowSel = await range(); await top(); await click(3, 1); await key('Control+Space'); const colSel = await range();
    record('Shift+Space selects the row, Ctrl+Space the column', 'row 4, column B', [rowSel, colSel], /^(4:4|A4:AN4)$/.test(rowSel ?? '') && /^(B:B|B1:B150)$/.test(colSel ?? '') ? 'same' : 'differs');
    await top(); await click(0, 0); await page.keyboard.down('Shift'); await click(2, 2); await page.keyboard.up('Shift');
    expect('Shift+click extends the selection to the clicked cell', 'A1:C3', await range(), 'A1:C3');
    await top(); await drag(0, 0, 3, 1);
    expect('Dragging selects a block', 'A1:B4', await range(), 'A1:B4');
    await top(); await click(0, 0); await page.keyboard.down('Control'); await click(1, 2); await page.keyboard.up('Control'); await wait(300); await shot('move-ctrl-click.png');
    { const stats = await page.evaluate(() => (document.querySelector('.ws-pane')?.textContent ?? '').match(/Count:\s*\d+/)?.[0] ?? '');
      record('Ctrl+click adds a second selection', 'A1 and C2 both selected', stats || 'no count shown', /Count:\s*2/.test(stats) ? 'same' : 'differs', 'Read from the count in the status bar.'); }
    await type('7'); await key('Control+Enter'); await wait(300);
    record('Ctrl+Enter fills every selected area, not only the last', 'A1 and C2 both 7', [await val(0, 0), await val(1, 2)], same([await val(0, 0), await val(1, 2)], [7, 7]) ? 'same' : 'differs');
    await top(); await page.mouse.click(G.x + G.rowHeader + G.colW * 1.5, G.y + G.colHeader / 2); await wait(200);
    record('A click on a column letter selects the column', 'column B', await range(), /^(B:B|B1:B150)$/.test((await range()) ?? '') ? 'same' : 'differs');
    await page.mouse.click(G.x + G.rowHeader / 2, Y(2)); await wait(200);
    record('A click on a row number selects the row', 'row 3', await range(), /^(3:3|A3:AN3)$/.test((await range()) ?? '') ? 'same' : 'differs');
    await page.mouse.click(G.x + G.rowHeader / 2, G.y + G.colHeader / 2); await wait(200);
    record('A click on the corner selects everything', 'the whole sheet', await range(), /^(1:150|A1:AN150)$/.test((await range()) ?? '') ? 'same' : 'differs');
    await top(); await click(1, 1); await click(0, 0); await key('ArrowUp'); const up = await active();
    await top(); await click(1, 1); await click(0, 0); await key('ArrowLeft'); const left = await active();
    expect('At the edge an arrow stays put', 'A1, A1', [up, left], ['A1', 'A1']);
    // The Name Box: type a cell name, Enter.
    await page.mouse.click(G.x + 30, G.y - 14); await wait(200);
    await key('Control+a'); await type('D10'); await key('Enter'); await wait(300);
    expect('Typing a cell name in the Name Box goes there', 'D10', await active(), 'D10');
    await top(); await click(0, 0); await key('F5'); await wait(400);
    // Go To here is the name box: F5 puts the keys in it, and a cell's name and Enter goes there. No dialog.
    const goTo = await page.evaluate(() => (document.querySelector('[role="dialog"]') ? 'a dialog opened' : document.activeElement?.closest('[data-u-comp="defined-name"]') ? 'the name box took the keys' : ''));
    let went = '';
    if (goTo === 'the name box took the keys') { await page.keyboard.type('G7'); await key('Enter'); await wait(300); went = await active(); }
    record('F5 or Ctrl+G opens Go To', 'a Go To dialog', goTo ? `${goTo}${went ? `; G7 typed there went to ${went}` : ''}` : 'nothing', goTo === 'a dialog opened' || went === 'G7' ? 'same' : goTo ? 'differs' : 'missing', 'Excel asks in a dialog; here the name box is the place to type a cell to go to.');
    await key('Escape');
    await top(); await click(0, 4); await key('Control+ArrowDown'); await key('ArrowDown'); const endRow = await active();
    await top(); await click(0, 4); await key('Control+ArrowRight'); await key('ArrowRight'); const endCol = await active();
    record('How far the sheet goes', 'row 1,048,576 and column XFD', [endRow, endCol], 'note', 'Every sheet here, the Scratch Sheet included, is 150 rows by 40 columns: the exam tool\'s size.');
  }

  // ── Entering ──────────────────────────────────────────────────────────────
  if (want('enter')) {
    await fresh('Entering and editing');
    await click(1, 1); await type('hello'); await key('Enter');
    expect('Typing on a selected cell starts an entry; Enter keeps it and moves down', 'B2 = hello, B3 selected', [await val(1, 1), await active()], ['hello', 'B3']);
    await type('12.5'); await key('Enter');
    expect('A typed number is a number', '12.5', await val(2, 1), 12.5);
    await type('5%'); await key('Enter');
    { const d = await cell(3, 1); record('5% is kept as 0.05 shown as a percent', '0.05 with format 0%', d, d?.v === 0.05 && /%/.test(d?.fmt ?? '') ? 'same' : 'differs'); }
    await type('$1,234.50'); await key('Enter');
    { const d = await cell(4, 1); record('$1,234.50 is kept as 1234.5 shown as currency', '1234.5 with a currency format', d, d?.v === 1234.5 && /\$/.test(d?.fmt ?? '') ? 'same' : 'differs'); }
    await type('1,000'); await key('Enter');
    { const d = await cell(5, 1); record('1,000 is the number 1000', '1000 with a thousands format', d, d?.v === 1000 ? 'same' : 'differs'); }
    await type('007'); await key('Enter');
    expect('007 becomes the number 7', '7', await val(6, 1), 7);
    await type("'007"); await key('Enter');
    { const d = await cell(7, 1); record("'007 stays text, the apostrophe hidden", 'the text 007', d, d?.v === '007' ? 'same' : 'differs'); }
    await type('3/4/2026'); await key('Enter');
    { const d = await cell(8, 1); record('3/4/2026 becomes a date', 'the date 4 March 2026 (serial 46085) with a date format', d, d?.v === 46085 ? 'same' : 'differs'); }
    await type('TRUE'); await key('Enter');
    { const d = await cell(9, 1); record('TRUE becomes the logical value', 'TRUE (a boolean)', d, d?.v === 1 || d?.v === true || d?.v === 'TRUE' ? (d?.v === 'TRUE' ? 'differs' : 'same') : 'differs'); }
    await type('1e3'); await key('Enter');
    { const d = await cell(10, 1); record('1e3 is the number 1000', '1000 in scientific format', d, d?.v === 1000 ? 'same' : 'differs'); }
    await click(1, 3); await type('abc'); await key('Escape');
    expect('Escape drops the entry', 'D2 empty, still selected', [await val(1, 3), await active()], [null, 'D2']);
    await click(12, 1); await type('a'); await key('Tab'); await type('b'); await key('Tab'); await type('c'); await key('Enter');
    expect('After a run of Tabs, Enter returns to the column where the run began', 'B13 a, C13 b, D13 c, then B14', [await val(12, 1), await val(12, 2), await val(12, 3), await active()], ['a', 'b', 'c', 'B14']);
    await click(1, 1); await type('x'); await key('Enter');
    expect('Typing over a cell replaces what it held', 'x', await val(1, 1), 'x');
    await click(1, 1); await key('F2'); const f2open = await editing(); await type('y'); await key('Enter');
    expect('F2 edits in the cell with the caret at the end', 'editor open, then xy', [f2open, await val(1, 1)], [true, 'xy']);
    await click(1, 1); await key('F2'); await key('ArrowLeft'); await type('z'); await key('Enter');
    expect('While editing with F2 the arrows move the caret', 'xzy', await val(1, 1), 'xzy');
    await dbl(1, 1); const dblOpen = await editing(); await key('Escape');
    expect('A double-click opens the cell for editing', 'editor open', dblOpen, true);
    await click(1, 1); await key('Delete');
    expect('Delete clears the cell', 'empty', await val(1, 1), null);
    await click(12, 2); await key('Backspace'); const bsOpen = await editing(); await type('q'); await key('Enter');
    expect('Backspace clears the cell and starts editing', 'editor open, then q', [bsOpen, await val(12, 2)], [true, 'q']);
    await drag(1, 4, 2, 5); await type('1'); await key('Enter'); await type('2'); await key('Enter'); await type('3'); await key('Enter'); await type('4'); await key('Enter');
    expect('Enter inside a selected block walks the block, column by column', 'E2 1, E3 2, F2 3, F3 4, back at E2', [await val(1, 4), await val(2, 4), await val(1, 5), await val(2, 5), await active()], [1, 2, 3, 4, 'E2']);
    await drag(1, 7, 3, 7); await type('k'); await key('Control+Enter');
    expect('Ctrl+Enter puts the entry in every selected cell', 'H2, H3, H4 = k', [await val(1, 7), await val(2, 7), await val(3, 7)], ['k', 'k', 'k']);
    await click(1, 9); await type('a'); await key('Alt+Enter'); await type('b'); await key('Enter');
    { const v = await val(1, 9); record('Alt+Enter starts a new line inside the cell', 'two lines: a, b', v, typeof v === 'string' && /a\r?\n?b/.test(v) && v.length > 2 ? 'same' : 'differs'); }
    await click(4, 9); await type('p'); await click(7, 10);
    expect('A click on another cell keeps the entry', 'J5 = p, K8 selected', [await val(4, 9), await active()], ['p', 'K8']);
    await click(6, 9); await type('m'); await key('ArrowRight');
    expect('While typing a new entry an arrow keeps it and moves', 'J7 = m, K7 selected', [await val(6, 9), await active()], ['m', 'K7']);
    await seed([[15, 1, 'apple'], [16, 1, 'avocado']]);
    await click(17, 1); await type('ap'); await wait(300); await shot('enter-autocomplete.png'); await key('Enter');
    expect('Typing the start of a word already in the column offers the rest', 'apple', await val(17, 1), 'apple');
    await click(20, 1); await type('some text longer than one cell is wide'); await key('Enter'); await shot('enter-overflow.png');
    record('Text longer than the cell runs over the empty cells beside it', 'runs over', 'see enter-overflow.png', 'note');
  }

  // ── Formulas ──────────────────────────────────────────────────────────────
  if (want('formula')) {
    await fresh('Formulas');
    await seed([[0, 0, 2], [0, 1, 3], [1, 0, 10], [2, 0, 20]]);
    await click(0, 2); await type('=A1+B1'); await key('Enter');
    expect('A typed formula computes', 'C1 = 5', [(await cell(0, 2))?.f, await computed(0, 2)], ['=A1+B1', 5]);
    await click(1, 2); await type('=a1*b1'); await key('Enter');
    expect('References typed in lower case are made upper case', '=A1*B1, 6', [(await cell(1, 2))?.f, await computed(1, 2)], ['=A1*B1', 6]);
    await click(2, 2); await type('='); await click(0, 0); await type('+'); await click(0, 1); await shot('formula-point-mouse.png'); await key('Enter');
    expect('After =, a click on a cell writes its reference', '=A1+B1, 5', [(await cell(2, 2))?.f, await computed(2, 2)], ['=A1+B1', 5]);
    await click(0, 3); await type('='); await key('ArrowLeft'); await key('Enter');
    expect('After =, an arrow key points at the neighbouring cell', '=C1', (await cell(0, 3))?.f ?? null, '=C1');
    await click(4, 2); await type('=SUM('); await drag(0, 0, 2, 0); await type(')'); await key('Enter');
    expect('Dragging over cells while typing a formula writes the range', '=SUM(A1:A3), 32', [(await cell(4, 2))?.f, await computed(4, 2)], ['=SUM(A1:A3)', 32]);
    await click(5, 2); await type('=SUM(A1:A3'); await key('Enter'); await wait(400);
    { const dlg = await page.evaluate(() => !!document.querySelector('[role="dialog"], .univer-confirm-modal')); if (dlg) await key('Enter');
      expect('A missing closing bracket is added', '=SUM(A1:A3), 32', [(await cell(5, 2))?.f, await computed(5, 2)], ['=SUM(A1:A3)', 32], dlg ? 'A dialog came up first.' : ''); }
    await click(6, 2); await type('=A1'); await key('F4'); await key('Enter');
    expect('F4 makes the reference absolute', '=$A$1', (await cell(6, 2))?.f ?? null, '=$A$1');
    await click(7, 2); await type('=A1'); await key('F4', 2); await key('Enter');
    expect('F4 again fixes the row only', '=A$1', (await cell(7, 2))?.f ?? null, '=A$1');
    await click(8, 2); await type('=SUM'); await wait(400); await shot('formula-autocomplete.png');
    const list = await page.evaluate(() => [...document.querySelectorAll('#ws-univer-popup-root li, #ws-univer-popup-root [role="option"], body > div li')].map((e) => e.textContent?.trim().slice(0, 30)).filter(Boolean).slice(0, 8));
    await key('Tab'); await type('A1:A3)'); await key('Enter');
    expect('Typing a function name offers a list; Tab takes the lit one', '=SUM(A1:A3), 32', [(await cell(8, 2))?.f, await computed(8, 2)], ['=SUM(A1:A3)', 32], `Offered: ${list.join(', ')}`);
    await click(0, 0); await type('4'); await key('Enter'); await wait(400);
    expect('Changing a cell recalculates what depends on it', 'C1 = 7', await computed(0, 2), 7);
    await click(9, 2); await type('=1/0'); await key('Enter');
    expect('Dividing by zero shows the error', '#DIV/0!', await computed(9, 2), '#DIV/0!');
    await click(10, 2); await type('=C11+1'); await key('Enter'); await wait(500);
    { const dlg = await page.evaluate(() => (document.querySelector('[role="dialog"], [role="alertdialog"]')?.textContent ?? '').slice(0, 80)); if (dlg) await key('Escape');
      record('A formula that refers to itself is refused or warned about', 'a circular reference warning, the cell shows 0', { value: await computed(10, 2), dialog: dlg || 'none' }, dlg ? 'same' : 'differs'); }
    await click(11, 2); await type('=A1&"x"'); await key('Enter');
    expect('& joins text', '4x', await computed(11, 2), '4x');
    await click(12, 2); await type('=10%*200'); await key('Enter');
    expect('A percent inside a formula is a number', '20', await computed(12, 2), 20);
    await click(13, 2); await type('=A1+'); await key('Enter'); await wait(500);
    { const dlg = await page.evaluate(() => (document.querySelector('[role="dialog"], [role="alertdialog"]')?.textContent ?? '').slice(0, 80)); const open = await editing();
      record('An unfinished formula is not accepted silently', 'a message; the editor stays open', { dialog: dlg || 'none', editorStillOpen: open, cell: await cell(13, 2) }, dlg || open ? 'same' : 'differs');
      await key('Escape'); await key('Escape'); }
    // Functions a general sheet is expected to have.
    const fns = [['XLOOKUP', '=XLOOKUP(10,A2:A3,A2:A3)', 10], ['VLOOKUP', '=VLOOKUP(10,A2:B3,1,FALSE)', 10], ['INDEX and MATCH', '=INDEX(A2:A3,MATCH(20,A2:A3,0))', 20], ['SUMIFS', '=SUMIFS(A2:A3,A2:A3,">5")', 30], ['IFS', '=IFS(A2>5,"big",TRUE,"small")', 'big'], ['IFERROR', '=IFERROR(1/0,"none")', 'none'], ['TEXTJOIN', '=TEXTJOIN("-",TRUE,A2:A3)', '10-20'], ['TEXT', '=TEXT(0.5,"0%")', '50%'], ['TODAY', '=TODAY()>40000', true], ['LET', '=LET(n,A2,n*2)', 20], ['UNIQUE', '=UNIQUE(A2:A3)', 10], ['FILTER', '=FILTER(A2:A3,A2:A3>15)', 20], ['SORT', '=SORT(A2:A3,1,-1)', 20], ['SEQUENCE', '=SEQUENCE(3)', 1], ['LAMBDA', '=LAMBDA(x,x+1)(1)', 2]];
    const fnOut = [];
    for (let i = 0; i < fns.length; i++) { await host('probeSetFormula', 30, 12 + i, fns[i][1]); }
    await wait(1500);
    for (let i = 0; i < fns.length; i++) { const got = await computed(30, 12 + i); const ok = got === fns[i][2] || (fns[i][2] === true && (got === 1 || got === true || got === 'TRUE')); fnOut.push(`${fns[i][0]} ${ok ? 'works' : `gives ${JSON.stringify(got)}`}`); }
    const broken = fnOut.filter((s) => !s.endsWith('works'));
    record('The functions a person reaches for are there', 'all of them', fnOut.join('; '), broken.length ? 'missing' : 'same', 'The sheet removes every function the exam tool lacks, for every sheet, the Scratch Sheet included.');
    await host('probeSetFormula', 0, 8, '=TRANSPOSE(A1:A3)'); await wait(900);
    expect('A formula that returns several cells spills into its neighbours', 'I1 4, J1 10, K1 20', [await computed(0, 8), await computed(0, 9), await computed(0, 10)], [4, 10, 20]);
    // The formula bar.
    await click(0, 2); await page.mouse.click(G.x + 245, G.y - 14); await wait(400);
    const barFocus = await page.evaluate(() => document.activeElement?.id ?? '');
    await type('+1'); await shot('formula-bar-typed.png'); await key('Enter');
    expect('The formula bar edits the cell', '=A1+B1+1, 8', [(await cell(0, 2))?.f, await computed(0, 2)], ['=A1+B1+1', 8], `After the click the keyboard is in "${barFocus}". Typed four ways in the hidden app (keys and inserted text, a click at the end of the text and far right, a double-click): the text was lost each time. Worth one try by hand.`);
    // A second sheet and a reference across sheets.
    const before = (await sheetMeta()).order.length;
    await page.mouse.click(G.x + 34, G.y + G.h + 19); await wait(700);
    const meta = await sheetMeta();
    record('The + beside the tabs adds a sheet', 'a second sheet', meta.order, meta.order.length === before + 1 ? 'same' : 'differs');
    if (meta.order.length > 1) {
      await click(0, 0); await type(`=${meta.order[0]}!A1*2`); await key('Enter'); await wait(500);
      const v = await page.evaluate(() => { const h = document.querySelector('.ws-pane__sheet').__wsHost; return h.probeReadValue(0, 0); });
      expect('A formula can read another sheet', '8', v, 8);
    }
  }

  // ── Copy, paste, fill, undo ───────────────────────────────────────────────
  if (want('clip')) {
    await fresh('Copy, paste, fill and undo');
    await seed([[0, 0, 1], [1, 0, 2], [2, 0, 3], [0, 1, '=A1*2']]);
    await click(0, 1); await key('Control+c'); await click(1, 1); await key('Control+v'); await wait(500);
    expect('A copied formula pasted a row down points a row down', '=A2*2, 4', [(await cell(1, 1))?.f, await computed(1, 1)], ['=A2*2', 4]);
    await click(0, 1); await key('Control+c'); await drag(1, 1, 2, 1); await key('Control+v'); await wait(500);
    expect('One copied cell pasted on a block fills the block', 'B2 4, B3 6', [await computed(1, 1), await computed(2, 1)], [4, 6]);
    await key('Escape');
    await click(2, 0); await key('Control+x'); await click(2, 3); await key('Control+v'); await wait(500);
    expect('Cut and paste moves the cell, and formulas that read it follow', 'A3 empty, D3 3, B3 =D3*2', [await val(2, 0), await val(2, 3), (await cell(2, 1))?.f], [null, 3, '=D3*2']);
    await setClipboard('10\t20\n30\t40'); await click(0, 5); await key('Control+v'); await wait(600);
    expect('Text copied from another program lands as cells', 'F1 10, G1 20, F2 30, G2 40', [await val(0, 5), await val(0, 6), await val(1, 5), await val(1, 6)], [10, 20, 30, 40]);
    await drag(0, 0, 1, 1); await key('Control+c'); await wait(400);
    { const t = (await clipboardText()).replace(/\r/g, ''); record('Copied cells can be pasted into another program', 'tab-separated text: 1, 2 / 2, 4', t, t.trim() === '1\t2\n2\t4' ? 'same' : 'differs'); }
    await key('Escape');
    await click(0, 1); await key('Control+c'); await click(0, 7); await key('Control+Shift+v'); await wait(500);
    { const d = await cell(0, 7); record('Ctrl+Shift+V pastes the value without the formula', 'H1 = 2, no formula', d, d?.v === 2 && !d?.f ? 'same' : 'differs'); }
    await key('Escape');
    await seed([[0, 9, 5]]);
    await drag(0, 9, 2, 9); await key('Control+d'); await wait(400);
    expect('Ctrl+D fills down', 'J2 5, J3 5', [await val(1, 9), await val(2, 9)], [5, 5]);
    await key('Control+z'); await wait(400);
    expect('Ctrl+Z undoes the fill', 'J2 empty', await val(1, 9), null);
    await key('Control+y'); await wait(400);
    expect('Ctrl+Y redoes it', 'J2 5', await val(1, 9), 5);
    await drag(0, 9, 0, 11); await key('Control+r'); await wait(400);
    expect('Ctrl+R fills right', 'K1 5, L1 5', [await val(0, 10), await val(0, 11)], [5, 5]);
    // The fill handle: 1, 2 dragged down continues the series.
    await seed([[5, 0, 1], [6, 0, 2]]);
    await drag(5, 0, 6, 0);
    const hx = G.x + G.rowHeader + G.colW; const hy = G.y + G.colHeader + 7 * G.rowH;
    await page.mouse.move(hx - 1, hy - 1); await wait(250); await shot('clip-fill-handle-hover.png');
    await page.mouse.down(); await wait(80); await page.mouse.move(hx - 1, hy + 3 * G.rowH - 4, { steps: 10 }); await wait(80); await page.mouse.up(); await wait(600);
    expect('Dragging the fill handle continues a series', 'A8 3, A9 4, A10 5', [await val(7, 0), await val(8, 0), await val(9, 0)], [3, 4, 5]);
    // Double-click on the handle fills as far as the column beside it.
    await seed([[12, 3, 1], [13, 3, 2], [14, 3, 3], [15, 3, 4], [12, 4, '=D13*2']]);
    await click(12, 4);
    await page.mouse.dblclick(G.x + G.rowHeader + 5 * G.colW - 1, G.y + G.colHeader + 13 * G.rowH - 1); await wait(700);
    expect('A double-click on the fill handle fills down beside the data', 'E14 4, E15 6, E16 8', [await computed(13, 4), await computed(14, 4), await computed(15, 4)], [4, 6, 8]);
    await click(18, 7); await type('u'); await key('Enter'); await key('Control+z'); await wait(300); const u1 = await val(18, 7); await key('Control+y'); await wait(300); const u2 = await val(18, 7);
    expect('Ctrl+Z undoes an entry, Ctrl+Y redoes it', 'empty, then u', [u1, u2], [null, 'u']);
    // Moving cells by dragging the selection's border.
    await seed([[20, 0, 'move me']]);
    await click(20, 0);
    await page.mouse.move(X(0), G.y + G.colHeader + 21 * G.rowH); await wait(250); await page.mouse.down(); await wait(100); await page.mouse.move(X(2), Y(22), { steps: 12 }); await wait(80); await page.mouse.up(); await wait(500);
    record('Dragging a selection by its border moves the cells', 'A21 empty, C23 holds it', [await val(20, 0), await val(22, 2)], same([await val(20, 0), await val(22, 2)], [null, 'move me']) ? 'same' : 'differs');
  }

  // ── Formatting keys ───────────────────────────────────────────────────────
  if (want('format')) {
    await fresh('Formatting');
    await seed([[0, 0, 0.256], [1, 0, 1234.5], [2, 0, 'text'], [3, 0, 0.123456789]]);
    await click(2, 0); await key('Control+b'); await key('Control+i'); await key('Control+u'); await wait(300);
    { const d = await cell(2, 0); record('Ctrl+B, Ctrl+I, Ctrl+U mark the cell', 'bold, italic, underlined', d, d?.bold && d?.italic && d?.underline ? 'same' : 'differs'); }
    await key('Control+b'); await wait(200);
    { const d = await cell(2, 0); record('Ctrl+B again takes bold off', 'not bold', d, !d?.bold ? 'same' : 'differs'); }
    await click(0, 0); await key('Control+Shift+5'); await wait(300);
    { const d = await cell(0, 0); record('Ctrl+Shift+% shows a percent', 'format 0%', d, /%/.test(d?.fmt ?? '') ? 'same' : 'missing'); }
    await click(1, 0); await key('Control+Shift+4'); await wait(300);
    { const d = await cell(1, 0); record('Ctrl+Shift+$ shows currency', 'a currency format', d, /\$/.test(d?.fmt ?? '') ? 'same' : 'missing'); }
    await click(1, 0); await key('Control+Shift+1'); await wait(300);
    { const d = await cell(1, 0); record('Ctrl+Shift+! shows thousands and two decimals', '#,##0.00', d, /#,##0\.00/.test(d?.fmt ?? '') ? 'same' : 'missing'); }
    const sheetText = () => page.evaluate(() => `${document.querySelector('.ws-pane__sheet')?.textContent ?? ''} ${document.getElementById('ws-univer-popup-root')?.textContent ?? ''} ${[...document.querySelectorAll('[role="dialog"]')].map((d) => d.textContent).join(' ')}`.length);
    await click(1, 0); const textBefore = await sheetText(); await key('Control+1'); await wait(600); const textAfter = await sheetText();
    record('Ctrl+1 opens the cell format choices', 'the Format Cells dialog', textAfter > textBefore + 20 ? 'a panel opened' : 'nothing', textAfter > textBefore + 20 ? 'same' : 'missing', 'Judged by new words appearing in the sheet, its popups or a dialog.');
    await key('Escape');
    await shot('format-decimals.png');
    record('A long decimal is shown short and kept whole', 'General shows up to about ten digits', 'see format-decimals.png (the app shows four decimals by its own setting)', 'note');
    // What the toolbar offers. It is the app's own row now (panes/sheetToolbar.ts; the engine's ribbon
    // is switched off): the names of its controls, then the entries of each of its menus, opened by
    // the command its button runs.
    const controlNames = () => page.evaluate(() => [...document.querySelectorAll('.ws-toolbar button')].filter((b) => b.getClientRects().length).map((b) => b.title || b.getAttribute('data-parallx-title') || b.getAttribute('aria-label') || ''));
    const offered = { controls: await controlNames() };
    for (const name of ['number', 'textColor', 'fill', 'borders', 'align', 'sum', 'sort', 'freeze', 'more']) {
      const opened = await run('worksheet.showSheetMenu', name).catch(() => false);
      await wait(350);
      if (!opened) continue;
      offered[name] = await page.evaluate(() => [...document.querySelectorAll('.context-menu .context-menu-item-label')].map((e) => (e.textContent ?? '').trim()).filter(Boolean));
      if (name === 'more') await shot('format-toolbar-more.png');
      await key('Escape'); await wait(200);
    }
    record('What the toolbar offers, control by control and menu by menu', 'n/a', JSON.stringify(offered), 'note', `Controls: ${offered.controls.join(', ')}`);
    const all = Object.values(offered).flat().join(' ').toLowerCase();
    for (const [name, re] of [['Sort', /sort/], ['Filter', /filter/], ['Find and replace', /find|replace/], ['Conditional formatting', /conditional/], ['Data validation (dropdown lists)', /validation/], ['Freeze rows or columns', /freeze/], ['Tables', /table/], ['Charts', /chart/], ['Comments or notes', /note|comment/], ['Links', /link/], ['Merge cells', /merge/], ['Wrap text', /wrap/], ['Number formats', /number format|currency|percent/], ['Borders', /border/], ['Images', /image/]]) {
      record(`${name} in the toolbar`, 'present', re.test(all) ? 'present' : 'absent', re.test(all) ? 'same' : 'missing');
    }
  }

  // ── Rows, columns, sheets, the app around the sheet ───────────────────────
  if (want('struct')) {
    await fresh('Rows, columns, sheets');
    await seed([[0, 0, 'a much longer piece of text than fits'], [1, 0, 2], [2, 0, 3], [3, 0, '=SUM(A2:A3)'], [0, 2, 'needle']]);
    const bx = G.x + G.rowHeader + G.colW; const by = G.y + G.colHeader / 2;
    await page.mouse.move(bx, by); await wait(200); await page.mouse.down(); await wait(80); await page.mouse.move(bx + 40, by, { steps: 6 }); await wait(80); await page.mouse.up(); await wait(400);
    { const w = (await sheetMeta()).sheets[0].columnData?.[0]?.w; record('Dragging the line between column letters resizes the column', 'column A 40 wider (128)', w ?? 'unchanged', w && Math.abs(w - 128) <= 3 ? 'same' : 'differs'); }
    const w0 = (await sheetMeta()).sheets[0].columnData?.[0]?.w ?? 88;
    await page.mouse.dblclick(G.x + G.rowHeader + w0, by); await wait(500);
    { const w = (await sheetMeta()).sheets[0].columnData?.[0]?.w; record('A double-click on that line fits the column to its text', 'wider than before, as wide as the text', { before: w0, after: w ?? 'unchanged' }, w && w > w0 + 20 ? 'same' : 'differs'); }
    const wA = (await sheetMeta()).sheets[0].columnData?.[0]?.w ?? 88;
    // The right-click menu on a cell.
    const cx = G.x + G.rowHeader + wA + G.colW / 2;
    await page.mouse.click(cx, Y(5), { button: 'right' }); await wait(700);
    const readMenu = () => page.evaluate(() => { const out = []; const seen = new Set(); for (const pop of document.querySelectorAll('.univer-popup, [data-radix-popper-content-wrapper]')) { const pr = pop.getBoundingClientRect(); if (pr.width < 40 || pr.height < 40 || pr.bottom <= 0 || pr.right <= 0 || getComputedStyle(pop).visibility === 'hidden' || getComputedStyle(pop).opacity === '0') continue; for (const el of pop.querySelectorAll('*')) { if (el.children.length) continue; const t = (el.textContent ?? '').trim().replace(/\s+/g, ' '); const r = el.getBoundingClientRect(); if (!t || t.length > 50 || r.width === 0 || seen.has(t)) continue; seen.add(t); out.push({ t, x: r.left + r.width / 2, y: r.top + r.height / 2 }); } } return out; });
    const menu = (await readMenu()).map((m) => m.t);
    await shot('struct-context-menu.png');
    record('The right-click menu on a cell', 'cut, copy, paste, insert, delete, clear, format, sort, filter', menu.join(' | '), 'note');
    await key('Escape');
    // Insert a row above row 2 through the row header's menu, and see the formula follow.
    await page.mouse.click(G.x + G.rowHeader / 2, Y(1), { button: 'right' }); await wait(700);
    const rowMenu = await readMenu();
    await shot('struct-row-menu.png');
    // "Insert [1] rows above" is one row of the menu with a number box in it: press its first word.
    const ins = await page.evaluate(() => { let best = null; for (const pop of document.querySelectorAll('.univer-popup, [data-radix-popper-content-wrapper]')) for (const el of pop.querySelectorAll('*')) { const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim(); const r = el.getBoundingClientRect(); if (/^Insert.{0,6}rows? above$/i.test(t) && r.width > 0 && (!best || r.width * r.height < best.a)) best = { a: r.width * r.height, x: r.left + 34, y: r.top + r.height / 2 }; } return best; });
    if (ins) { await page.mouse.click(ins.x, ins.y); await wait(700); }
    else await key('Escape');
    { const f = (await cell(4, 0))?.f; const rc = (await sheetMeta()).sheets[0].rowCount;
      record('Insert Row Above moves the rows down and the formulas follow', 'the sum is now in A5 as =SUM(A3:A4)', { formula: f ?? null, rowCount: rc }, f === '=SUM(A3:A4)' ? 'same' : ins ? 'differs' : 'note', ins ? '' : 'The probe did not find Insert Rows Above in the menu.');
      record('The sheet grows when a row is inserted', 'n/a (Excel has a fixed 1,048,576 rows)', `rows: ${rc}`, 'note'); }
    // Keys for rows and columns.
    await click(6, 3); await key('Control+Shift+Equal'); await wait(500);
    { const dlg = await page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"], [role="menu"], .context-menu')].filter((e) => e.getClientRects().length && (e.textContent ?? '').trim()).pop(); return d ? [...d.querySelectorAll('.context-menu-item-label')].map((e) => e.textContent).join(' | ').slice(0, 90) || (d.textContent ?? '').slice(0, 60) : ''; }); record('Ctrl+Shift+Plus inserts cells, rows or columns', 'an Insert choice', dlg || 'nothing', dlg ? 'same' : 'missing'); await key('Escape'); }
    // Sheet tabs: rename by double-click.
    await page.mouse.dblclick(G.x + 126, G.y + G.h + 19); await wait(400); await key('Control+a'); await type('Budget'); await key('Enter'); await wait(400);
    record('A double-click on a sheet tab renames it', 'Budget', (await sheetMeta()).order, (await sheetMeta()).order[0] === 'Budget' ? 'same' : 'differs');
    // Zoom.
    await click(8, 3); await key('Control+Equal'); await wait(400);
    { const z = (await sheetMeta()).sheets[0].zoom; record('Ctrl+Plus zooms the cells', 'larger cells', z, z > 1 ? 'same' : 'differs'); }
    await key('Control+0'); await wait(300);
    // Find on a sheet is the sheet's own (the engine's part, switched on): Ctrl+F opens it with the keys in its
    // field, and it counts and marks the cells that hold the word. The selection itself does not move.
    await click(8, 3); await key('Control+f'); await wait(900); await type('needle'); await wait(1100); await shot('struct-find.png');
    const find = await page.evaluate(() => { const input = document.activeElement; const dlg = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).pop(); return { inFindField: !!input?.closest?.('[data-u-comp="search-input"]') || (!!dlg && dlg.contains(input)), text: (dlg?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) }; });
    record('Ctrl+F finds a word in the sheet', 'the cell with "needle" is found and selected', find, find.inFindField && /(^|\D)1\s*\/\s*1(\D|$)|1 of 1|1 result|1 match/i.test(find.text) ? 'same' : 'differs', 'The match is counted and marked on the sheet; the selection stays where it was until the cell is pressed.');
    await key('Escape'); await wait(400);
    await key('Escape');
    // A sum of the selection, somewhere on screen.
    await drag(2, 0, 3, 0); await wait(400);
    const stats = await page.evaluate(() => { const t = document.querySelector('.ws-pane')?.textContent ?? ''; return /sum\s*[:=]?\s*\d/i.test(t) || /average/i.test(t); });
    record('Selecting numbers shows their sum, average and count', 'in the status bar', stats ? 'shown' : 'not shown', stats ? 'same' : 'missing', 'Switched off in the engine host for the exam surface.');
    // The work survives a tab switch; it does not survive the window.
    await run('worksheet.open'); await wait(1200); await run('worksheet.openScratch');
    await page.waitForFunction(() => !!document.querySelector('.ws-pane__sheet')?.__wsHost, null, { timeout: 60000 }); await wait(2500);
    expect('The sheet is as it was after another tab was shown', 'kept', await val(0, 2), 'needle');
    await app.close().catch(() => {}); app = null;
    await launch(); await run('worksheet.openScratch');
    await page.waitForFunction(() => !!document.querySelector('.ws-pane__sheet')?.__wsHost, null, { timeout: 60000 }); await wait(2500);
    { const v = await val(0, 2); record('The sheet is as it was after the app was closed and opened', 'kept (a workbook is a saved file)', v ?? 'empty', v === 'needle' ? 'same' : 'missing', 'The Scratch Sheet is kept in memory only. There is no saved sheet that is not a problem.'); }
  }

  // ── A finger ──────────────────────────────────────────────────────────────
  if (want('touch')) {
    await fresh('Touch');
    await seed([[0, 0, 1], [1, 0, 2]]);
    const cdp = await page.context().newCDPSession(page);
    const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await wait(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(250); };
    await tap(X(2), Y(3));
    expect('A tap selects the cell', 'C4', await active(), 'C4');
    await tap(X(1), Y(1)); await wait(60); await tap(X(1), Y(1)); await wait(300);
    expect('A double tap opens the cell for editing', 'editor open', await editing(), true);
    await key('Escape');
    const before = (await st()).scroll;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: X(3), y: Y(15), id: 1 }] }); await wait(40);
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: X(3), y: Y(15) - i * 30, id: 1 }] }); await wait(30); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(500);
    const after = await st();
    record('A finger dragged up scrolls the sheet', 'the sheet scrolls; the selection stays', { scrollBefore: before, scrollAfter: after.scroll, selection: after.activeRange }, (after.scroll?.startRow ?? 0) > (before?.startRow ?? 0) ? 'same' : 'differs');
  }
} catch (err) {
  console.log(`[probe] stopped in "${group}": ${err?.stack ?? err}`);
  results.push({ group, name: 'The probe stopped here', excel: '', got: String(err).slice(0, 300), verdict: 'note', detail: '' });
  try { await shot('stopped.png'); } catch { /* no window */ }
} finally {
  await app?.close().catch(() => {});
}

await fs.writeFile(path.join(root, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results, pageErrors }, null, 1));
const count = (v) => results.filter((r) => r.verdict === v).length;
console.log(`\n[probe] ${results.length} checks: ${count('same')} same as Excel, ${count('differs')} differ, ${count('missing')} missing, ${count('note')} notes`);
console.log(`[probe] page errors: ${pageErrors.length}`);
for (const e of pageErrors.slice(0, 10)) console.log('  ' + e);
console.log(`[probe] results: ${path.join(root, 'results.json')}`);
