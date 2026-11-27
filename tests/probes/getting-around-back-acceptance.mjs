// getting-around-back-acceptance.mjs — @acceptance for "Getting around",
// piece 2, Back and Forward for the whole app (docs/MASTER_LIST.md, "Getting
// around: one way to move in every tool", "The order of work" item 2; his
// pick 3A).
//
// Written from the request before the build, by a verifier who is not the
// builder. The builder does not edit this file. Every check below failed on
// the app as it was when it was written (see the commit that added it).
//
// What it holds the piece to:
//   A. Two arrows at the start of the trail bar under the tabs (`.editor-ribbon`),
//      found by their accessible name: "Back to <step>" and "Forward to <step>",
//      disabled when there is nowhere to go.
//   B. One record of where he has been, across tools and tabs: a move to a place
//      (Planner's Today, Calendar, Tasks) is a step; opening a file or a canvas
//      page, or switching to another tab by clicking it, is a step.
//   C. Back returns to the previous step, Forward to the next, as a browser does:
//      Back twice goes two steps; Back then Forward returns exactly; a new move
//      after Back drops the forward steps; the same place twice is one step.
//   D. Reached by Alt+Left / Alt+Right, the mouse's side buttons (button 3 back,
//      button 4 forward), the arrows by mouse, and commands the command palette
//      lists (searched by "Back" / "Forward", not the Browser's), with their key.
//   E. Right-clicking or holding an arrow lists the last few steps; choosing one
//      jumps there.
//   F. After Back or Forward to a place, the keys land on its page title
//      (h1.px-page-header__title, tabindex -1, in the active editor).
//   G. A place whose tab was closed reopens in its tool's tab; a closed file or
//      canvas page reopens; a thing that cannot reopen (a deleted file) is skipped.
//   H. Settings (a dialog) and Chat (the right side) are not steps.
//   I. The Browser keeps Alt+Left for its own pages while its tab is in front
//      (its internal History page, offline), and the app's Back still leaves the Browser for the step before.
//   J. At the start Back is disabled and Alt+Left does nothing harmful; at the end
//      Forward is disabled and Alt+Right does nothing.
// I1 was meant as a guard (it should pass before the piece) but fails on the app
// as it was: the Browser binds "Alt+ArrowLeft", the keybinding service turns a
// key press into "alt+left" and the binding into "alt+arrowleft", so the two
// never meet (src/services/keybindingUtils.ts, normalizeKeybinding against
// keyFromEvent). Its command `browser.back` run directly does go back. The piece
// has to leave the Browser's Alt+Left working, so the check stays.
// Controls (logged, not counted) show the probe's input reached the app.
// Not checked: the record naming no tool (its file is not known before the
// build); the keybinding editor (the palette's key is read instead); a Browser
// page from the web (the cloud has no network; its internal pages are used).
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/getting-around-back-acceptance.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, screenshot, openFile, toolList, setToolEnabled } from './scene.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-getting-around-back');
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, 'notes.txt'), 'A file Back walks through.\n');
await fs.writeFile(path.join(ws, 'gone.txt'), 'A file that is deleted while closed.\n');
await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

let passed = 0; const failed = []; const guards = [];
const check = (name, ok, got, { guard = false } = {}) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${guard ? '[guard] ' : ''}${name}${ok ? '' : `: ${JSON.stringify(got)}`}`);
  if (guard) guards.push(name);
  if (ok) passed += 1; else failed.push(name);
};

let app; let page; let errors = []; let cdp = null;
const wait = (ms) => page.waitForTimeout(ms);

/** What a person sees: the tabs, the place or page shown, the Browser's address, the focus. */
const read = () => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const tabs = [...document.querySelectorAll('.editor-group .ui-tab')].filter((t) => !t.classList.contains('ui-tab--leaving') && vis(t)).map((t) => ({
    label: (t.querySelector('.ui-tab-label')?.textContent ?? '').trim(), active: t.classList.contains('ui-tab--active'),
    group: t.closest('.editor-group')?.getAttribute('data-editor-group-id') ?? null,
  }));
  const act = tabs.find((t) => t.active) ?? null;
  const group = act ? document.querySelector(`.editor-group[data-editor-group-id="${act.group}"]`) : null;
  const panes = group?.querySelector('.editor-pane-container');
  const planner = [...(panes?.querySelectorAll('.planner-pane') ?? [])].find(vis);
  const canvas = [...(panes?.querySelectorAll('[data-px-surface="canvas"]') ?? [])].find(vis);
  const addr = [...(panes?.querySelectorAll('.br-address') ?? [])].find(vis);
  const ae = document.activeElement;
  const dialog = [...document.querySelectorAll('[aria-modal="true"], [role="dialog"]')].some(vis);
  return {
    count: tabs.length, labels: tabs.map((t) => t.label), active: act?.label ?? null,
    place: planner?.dataset.tab ?? null,
    canvasPage: canvas ? (canvas.getAttribute('data-px-instance') || '').split(':').pop() : null,
    browser: addr ? addr.value : null, dialog,
    focus: ae ? { tag: ae.tagName, cls: String(ae.className ?? ''), tabindex: ae.getAttribute('tabindex'), text: (ae.textContent ?? '').trim().slice(0, 40), inEditor: !!panes?.contains(ae) } : null,
  };
});
const titleFocused = (s) => !!s.focus && s.focus.tag === 'H1' && /\bpx-page-header__title\b/.test(s.focus.cls) && s.focus.tabindex === '-1' && s.focus.inEditor;
const short = (s) => ({ active: s.active, place: s.place, page: s.canvasPage, count: s.count, labels: s.labels });
const atPlace = (s, place, label) => s.place === place && s.active === label;

/**
 * The two arrows, by accessible name, in the active group's chrome (not inside
 * the editor pane, where the Browser has its own Back, and not on the tabs).
 * Each: { name, disabled, x, y, inRibbon }, or null when there is none.
 */
const arrows = () => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => vis(t) && !t.classList.contains('ui-tab--leaving'));
  const scope = act?.closest('.editor-group') ?? document;
  const nameOf = (e) => {
    const lb = e.getAttribute('aria-labelledby');
    const t = lb ? lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '';
    return (e.getAttribute('aria-label') || t || e.getAttribute('title') || e.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const cands = [...scope.querySelectorAll('button, [role="button"]')].filter((e) => vis(e) && !e.closest('.editor-pane-container') && !e.closest('.ui-tab') && !e.closest('.command-palette'));
  const firstCrumb = [...(scope.querySelectorAll?.('.editor-ribbon .parallx-breadcrumb-item, .editor-ribbon .canvas-breadcrumb') ?? [])].find(vis);
  const crumbX = firstCrumb ? firstCrumb.getBoundingClientRect().x : null;
  const pick = (re) => {
    const e = cands.find((c) => re.test(nameOf(c)));
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { name: nameOf(e), disabled: e.disabled === true || e.getAttribute('aria-disabled') === 'true', x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, inRibbon: !!e.closest('.editor-ribbon'), crumbX };
  };
  return { back: pick(/^(go\s+)?back\b/i), fwd: pick(/^(go\s+)?forward\b/i) };
});
async function pressArrow(which, opts = {}) {
  const a = (await arrows())[which];
  if (!a) return false;
  await page.mouse.click(a.x, a.y, { button: opts.right ? 'right' : 'left' });
  await wait(opts.wait ?? 1_300);
  return true;
}

const centre = (sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
const rowSel = (key) => `.planner-sidebar .planner-sidebar__row[data-key="${key}"]`;
async function pressRow(key, opts = {}) {
  await showPlannerColumn();
  const at = await centre(rowSel(key));
  if (!at) throw new Error(`no Planner row ${key} on screen`);
  await page.mouse.click(at.x, at.y);
  await wait(opts.wait ?? 1_400);
}
async function showPlannerColumn() {
  if (await centre(rowSel('today'))) return;
  const at = await centre('.activity-bar-item[data-icon-id="planner-container"]');
  if (at) { await page.mouse.click(at.x, at.y); await wait(1_000); }
}
/** The tab with this label, by the mouse (left: switch to it; middle: close it). False when there is none. */
async function pressTab(label, { button = 'left', wait: ms = 1_200 } = {}) {
  const at = await page.evaluate((label) => {
    const t = [...document.querySelectorAll('.editor-group .ui-tab')].filter((x) => x.getClientRects().length && !x.classList.contains('ui-tab--leaving') && (x.querySelector('.ui-tab-label')?.textContent ?? '').trim() === label).pop();
    if (!t) return null; const l = (t.querySelector('.ui-tab-label') ?? t).getBoundingClientRect(); return { x: l.x + Math.min(20, l.width / 2), y: l.y + l.height / 2 };
  }, label);
  if (!at) return false;
  await page.mouse.click(at.x, at.y, { button });
  await wait(ms);
  return true;
}
async function closeAllEditors() {
  for (let i = 0; i < 30 && (await read()).count > 0; i++) { await cmd(page, 'workbench.action.closeActiveEditor'); await wait(250); }
  await wait(500);
}
const key = async (k, ms = 1_400) => { await page.keyboard.press(k); await wait(ms); };

/** Marks the popups already on screen, so `newPopupItems` sees only one that opened after. */
const markPopups = () => page.evaluate(() => { for (const m of document.querySelectorAll('.context-menu, [role="menu"], [role="listbox"]')) m.setAttribute('data-probe-old', '1'); });
const newPopupItems = () => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const menus = [...document.querySelectorAll('.context-menu, [role="menu"], [role="listbox"]')].filter((m) => vis(m) && !m.hasAttribute('data-probe-old') && !m.closest('.command-palette'));
  const rows = new Set();
  for (const m of menus) for (const r of m.querySelectorAll('.context-menu-item, [role="menuitem"], [role="option"], [role="menuitemradio"]')) if (vis(r) && ![...rows].some((x) => x.contains(r))) rows.add(r);
  return [...rows].map((r) => { const b = r.getBoundingClientRect(); return { text: (r.getAttribute('aria-label') || r.textContent || '').replace(/\s+/g, ' ').trim(), x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
});

/** The command palette searched by `q`: its rows as shown. Leaves the palette open. */
async function palette(q) {
  await page.keyboard.press('Control+Shift+P'); await wait(800);
  await page.keyboard.type(q, { delay: 30 }); await wait(900);
  return page.evaluate(() => [...document.querySelectorAll('.command-palette-item')].filter((e) => e.getClientRects().length).map((e) => { const b = e.getBoundingClientRect(); return { text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), x: b.x + b.width / 2, y: b.y + b.height / 2 }; }));
}
const appRow = (rows, word) => rows.find((r) => new RegExp(`\\b${word}\\b`, 'i').test(r.text) && !/Browser/i.test(r.text));

/** A mouse side button over the editor, through the browser's own input (button 3 back, 4 forward in the DOM). */
async function sideButton(which) {
  const at = await centre('.editor-group .editor-pane-container');
  if (!cdp || !at) return false;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: which, buttons: which === 'back' ? 8 : 16, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: which, buttons: 0, clickCount: 1 });
  await wait(1_400);
  return true;
}

const runTool = (name, args) => page.evaluate(async ({ name, args }) => {
  const tools = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' });
  const t = tools.getTool(name); if (!t) return `no tool ${name}`;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const out = String((await t.handler(args, token))?.content ?? '');
  return (/id: ([0-9a-f-]{20,})/i.exec(out) || [])[1] ?? `no id: ${out.slice(0, 160)}`;
}, { name, args });

try {
  ({ app, page, errors } = await launchApp(appRoot));
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await wait(1_500);
  try { cdp = await app.context().newCDPSession(page); } catch (e) { console.log(`[probe] no CDP session for the side buttons: ${e?.message ?? e}`); }

  const pageId = await runTool('canvas_create_page', { title: 'Probe Page', markdown: 'A page Back walks through.' });
  console.log(`[seed] canvas page ${pageId}`);
  await closeAllEditors();

  // ── J. At the start ──
  await pressRow('today');
  for (let i = 0; i < 20; i++) { const a = await arrows(); if (!a.back || a.back.disabled) break; await pressArrow('back'); }
  let a = await arrows();
  let before = await read();
  const errsBefore = errors.length;
  await key('Alt+ArrowLeft');
  let s = await read();
  check('J1 at the start of the record the Back arrow is shown and disabled, and Alt+Left changes nothing and throws nothing', !!a.back && a.back.disabled && s.active === before.active && s.place === before.place && s.count === before.count && errors.length === errsBefore, { arrows: a, before: short(before), after: short(s), newErrors: errors.slice(errsBefore) });

  // The walk: Today, Calendar, Tasks (one Planner tab), notes.txt (a file, by quick open), Probe Page (a canvas page).
  await pressRow('today'); await pressRow('calendar'); await pressRow('tasks');
  await openFile(page, 'notes.txt');
  await cmd(page, 'canvas.openPage', pageId); await wait(1_800);
  s = await read();
  console.log(`[walk] at ${JSON.stringify(short(s))}`);

  // ── A. The arrows ──
  a = await arrows();
  check('A1 on Probe Page the Back arrow sits in the trail bar under the tabs, at its start, enabled, named "Back to notes.txt"', !!a.back && a.back.inRibbon && !a.back.disabled && /Back to notes\.txt/.test(a.back.name) && (a.back.crumbX === null || a.back.left < a.back.crumbX), a);
  await screenshot(app, page, path.join(shots, 'a-arrows-on-page.png'));
  before = await read();
  await key('Alt+ArrowRight');
  s = await read();
  const aEnd = await arrows();
  check('J2 at the end of the record the Forward arrow is shown and disabled, and Alt+Right leaves Probe Page in front', !!aEnd.fwd && aEnd.fwd.disabled && s.canvasPage === pageId && s.active === before.active, { arrows: aEnd, after: short(s) });

  // ── C, D. Alt+Left twice goes two steps; keys on the title ──
  await key('Alt+ArrowLeft');
  s = await read();
  check('C1 Alt+Left from Probe Page brings notes.txt to the front', s.active === 'notes.txt', short(s));
  const countAtNotes = s.count;
  await key('Alt+ArrowLeft', 1_700);
  s = await read();
  check('C2 Alt+Left again (two steps, not back to Probe Page) shows Tasks in the Planner tab, no tab added', atPlace(s, 'tasks', 'Tasks') && s.count === countAtNotes, short(s));
  check('F1 after Back to Tasks the keys are on its page title (h1.px-page-header__title, tabindex -1, in the editor)', s.place === 'tasks' && titleFocused(s), { place: s.place, focus: s.focus });
  await key('Alt+ArrowLeft');
  s = await read();
  check('C3 Alt+Left a third time shows Calendar in the same Planner tab (a move between places is a step)', atPlace(s, 'calendar', 'Calendar') && s.count === countAtNotes, short(s));
  a = await arrows();
  check('A2 on Calendar the arrows are named for their steps: "Back to Today" and "Forward to Tasks", both enabled', !!a.back && !!a.fwd && /Back to Today/.test(a.back.name) && /Forward to Tasks/.test(a.fwd.name) && !a.back.disabled && !a.fwd.disabled, a);
  await screenshot(app, page, path.join(shots, 'a-arrows-on-calendar.png'));

  // ── Forward returns exactly ──
  await key('Alt+ArrowRight', 1_700);
  s = await read();
  check('C4 Alt+Right from Calendar shows Tasks again', atPlace(s, 'tasks', 'Tasks'), short(s));
  check('F2 after Forward to Tasks the keys are on its page title', s.place === 'tasks' && titleFocused(s), { place: s.place, focus: s.focus });
  const pb = await pressArrow('back');
  s = await read();
  const pf = pb && (await pressArrow('fwd'));
  const s2 = await read();
  check('D1 the Back arrow pressed by mouse goes to Calendar, the Forward arrow pressed by mouse back to Tasks', pb && pf && atPlace(s, 'calendar', 'Calendar') && atPlace(s2, 'tasks', 'Tasks'), { pressedBack: pb, afterBack: short(s), pressedFwd: pf, afterFwd: short(s2) });
  await key('Alt+ArrowRight'); const s3 = await read();
  await key('Alt+ArrowRight', 1_800); s = await read();
  check('C5 Alt+Right twice more returns exactly: notes.txt, then Probe Page', s3.active === 'notes.txt' && s.canvasPage === pageId && s.active === 'Probe Page', { first: short(s3), second: short(s) });

  // ── D. The mouse's side buttons ──
  await page.evaluate(() => { window.__probeSide = []; for (const t of ['mouseup', 'auxclick']) window.addEventListener(t, (e) => { if (e.button > 2) window.__probeSide.push(`${t}:${e.button}`); }, true); });
  const sb = await sideButton('back');
  s = await read();
  const sf = sb && (await sideButton('forward'));
  const t2 = await read();
  console.log(`[control] side-button events the page saw: ${JSON.stringify(await page.evaluate(() => window.__probeSide))}`);
  check('D2 the mouse\'s back button (button 3) over the editor goes back to notes.txt, its forward button (4) forward to Probe Page', sb && sf && s.active === 'notes.txt' && t2.canvasPage === pageId, { sent: sb && sf, afterBack: short(s), afterForward: short(t2) });

  // ── C. A new move drops the forward steps; the same place twice is one step ──
  await key('Alt+ArrowLeft'); await key('Alt+ArrowLeft', 1_700);
  const atTasks = await read();
  await pressRow('today');
  before = await read();
  a = await arrows();
  await key('Alt+ArrowRight');
  s = await read();
  check('C6 after Back to Tasks and a new move to Today, the forward steps are gone: Forward disabled, Alt+Right stays on Today', atPlace(atTasks, 'tasks', 'Tasks') && atPlace(before, 'today', 'Today') && !!a.fwd && a.fwd.disabled && atPlace(s, 'today', 'Today'), { atTasks: short(atTasks), arrows: a, after: short(s) });
  await pressRow('today');
  await key('Alt+ArrowLeft', 1_700);
  s = await read();
  check('C7 Today pressed a second time is not a second step: Alt+Left goes to Tasks', atPlace(s, 'tasks', 'Tasks'), short(s));
  await key('Alt+ArrowRight', 1_700);

  // ── H. Settings and Chat are not steps ──
  // Settings by the palette, the keys only (Ctrl+, does not reach it in the hidden app today).
  const setRows = await palette('Open Settings');
  if (setRows.length) await key('Enter', 1_500); else await key('Escape', 400);
  const settingsOpen = (await read()).dialog;
  console.log(`[control] Settings opened from the palette as a dialog: ${settingsOpen} (${setRows[0]?.text ?? 'no row'})`);
  await key('Escape', 900);
  await key('Alt+ArrowLeft', 1_700);
  s = await read();
  check('H1 Settings opened (palette, Open Settings) and closed by Escape, then Alt+Left: goes to Tasks, the step before Today, and no dialog is open', settingsOpen && atPlace(s, 'tasks', 'Tasks') && !s.dialog, { settingsOpen, after: short(s), dialog: s.dialog });
  await key('Alt+ArrowRight', 1_700);
  const atToday = await read();
  await key('Control+Shift+I', 1_500); await key('Control+Shift+I', 1_000);
  const ph = await pressArrow('back', { wait: 1_700 });
  s = await read();
  check('H2 Chat opened and closed (Ctrl+Shift+I twice), then the Back arrow: goes to Tasks, the step before Today', atPlace(atToday, 'today', 'Today') && ph && atPlace(s, 'tasks', 'Tasks'), { atToday: short(atToday), pressed: ph, after: short(s) });
  await pressArrow('fwd', { wait: 1_700 });

  // ── B. A tab clicked is a step ──
  const onToday = await read();
  const clickedNotes = await pressTab('notes.txt');
  const onNotes = await read();
  await key('Alt+ArrowLeft', 1_700);
  s = await read();
  check('B1 on Today, the notes.txt tab clicked, then Alt+Left: back on Today in the Planner tab', atPlace(onToday, 'today', 'Today') && clickedNotes && onNotes.active === 'notes.txt' && atPlace(s, 'today', 'Today'), { onToday: short(onToday), onNotes: short(onNotes), after: short(s) });
  await key('Alt+ArrowRight');

  // ── G. Closed tabs reopen; a thing that cannot is skipped ──
  const closedPlanner = await pressTab('Today', { button: 'middle' });
  const g0 = await read();
  console.log(`[control] the Planner tab closed by middle click: ${closedPlanner && !g0.labels.includes('Today') ? 'yes' : 'NO ' + JSON.stringify(short(g0))}, front: ${g0.active}`);
  await key('Alt+ArrowLeft', 1_900);
  s = await read();
  check('G1 the Planner tab closed (on notes.txt), then Alt+Left: a Planner tab is open again on Today, named "Today"', g0.active === 'notes.txt' && !g0.labels.includes('Today') && atPlace(s, 'today', 'Today'), { closed: short(g0), after: short(s) });
  check('F3 after Back reopened the place, the keys are on its page title', s.place === 'today' && titleFocused(s), { place: s.place, focus: s.focus });
  await key('Alt+ArrowRight');
  await cmd(page, 'canvas.openPage', pageId); await wait(1_500);
  await pressTab('Today', { wait: 1_500 });
  const g1 = await read();
  await pressTab('Probe Page', { button: 'middle' }); await pressTab('notes.txt', { button: 'middle' });
  const g2 = await read();
  await key('Alt+ArrowLeft', 2_000);
  s = await read();
  check('G2 notes.txt then Probe Page then Today, both closed, then Alt+Left: Probe Page reopens in front', atPlace(g1, 'today', 'Today') && !g2.labels.includes('Probe Page') && !g2.labels.includes('notes.txt') && s.canvasPage === pageId && s.active === 'Probe Page', { beforeClose: short(g1), afterClose: short(g2), after: short(s) });
  await key('Alt+ArrowLeft', 2_000);
  s = await read();
  check('G3 Alt+Left again: the closed notes.txt reopens in front', s.active === 'notes.txt', short(s));
  await openFile(page, 'gone.txt');
  const g3 = await read();
  await pressRow('calendar');
  await pressTab('gone.txt', { button: 'middle' });
  await fs.rm(path.join(ws, 'gone.txt'), { force: true }); await wait(800);
  await key('Alt+ArrowLeft', 2_000);
  s = await read();
  check('G4 notes.txt, gone.txt (then closed and deleted from disk), Calendar, then Alt+Left: gone.txt is skipped, notes.txt is in front', g3.active === 'gone.txt' && s.active === 'notes.txt' && !s.labels.includes('gone.txt'), { gone: short(g3), after: short(s) });

  // ── E. The arrows' list of steps ──
  await pressRow('calendar'); await pressRow('tasks'); await pressRow('today');
  await markPopups();
  const opened = await pressArrow('back', { right: true, wait: 800 });
  const list = await newPopupItems();
  await screenshot(app, page, path.join(shots, 'e-back-list.png'), { keepFocus: true });
  const pick = list.find((r) => /\bCalendar\b/.test(r.text));
  check('E1 the Back arrow right-clicked lists the last steps: Tasks and Calendar among them', opened && list.some((r) => /\bTasks\b/.test(r.text)) && !!pick, { opened, list: list.map((r) => r.text) });
  if (pick) { await page.mouse.click(pick.x, pick.y); await wait(1_700); } else await key('Escape', 400);
  s = await read();
  a = await arrows();
  check('E2 Calendar chosen in the list: Calendar is shown in the Planner tab, and Forward is now named "Forward to Tasks"', !!pick && atPlace(s, 'calendar', 'Calendar') && !!a.fwd && /Forward to Tasks/.test(a.fwd.name), { after: short(s), fwd: a.fwd });

  // ── D. The commands, in the palette ──
  const ctlRows = await palette('Open');
  await key('Escape', 400);
  console.log(`[control] the palette opens and lists commands ("Open"): ${ctlRows.length ? ctlRows[0].text : 'NO ROWS'}`);
  const backRows = await palette('Back');
  const backRow = appRow(backRows, 'Back');
  await screenshot(app, page, path.join(shots, 'd-palette-back.png'), { keepFocus: true });
  if (backRow) { await page.mouse.click(backRow.x, backRow.y); await wait(1_700); } else await key('Escape', 400);
  s = await read();
  check('D3 the command palette searched by "Back" lists the app\'s Back (not the Browser\'s) with its key Alt+Left; chosen, it goes from Calendar to notes.txt, the step before', !!backRow && /Alt/i.test(backRow.text) && s.active === 'notes.txt', { rows: backRows.map((r) => r.text).slice(0, 8), after: short(s) });
  const fwdRows = await palette('Forward');
  const fwdRow = appRow(fwdRows, 'Forward');
  if (fwdRow) { await page.mouse.click(fwdRow.x, fwdRow.y); await wait(1_700); } else await key('Escape', 400);
  s = await read();
  check('D4 the palette searched by "Forward" lists the app\'s Forward with its key Alt+Right; chosen, it goes to Calendar', !!fwdRow && /Alt/i.test(fwdRow.text) && atPlace(s, 'calendar', 'Calendar'), { rows: fwdRows.map((r) => r.text).slice(0, 8), after: short(s) });

  // ── E. Holding an arrow ──
  await pressRow('today');
  await markPopups();
  const ha = (await arrows()).back;
  let held = [];
  if (ha) { await page.mouse.move(ha.x, ha.y); await page.mouse.down(); await wait(1_000); held = await newPopupItems(); await screenshot(app, page, path.join(shots, 'e-held-list.png'), { keepFocus: true }); await page.mouse.up(); await wait(400); await key('Escape', 500); }
  check('E3 the Back arrow held down (a second) lists the last steps: Calendar among them', !!ha && held.some((r) => /\bCalendar\b/.test(r.text)), { arrow: ha, list: held.map((r) => r.text) });

  // ── I. The Browser keeps Alt+Left for its pages ──
  const browserOn = (await toolList(page)).find((t) => /browser/i.test(t.id));
  console.log(`[control] the Browser extension: ${JSON.stringify(browserOn ?? 'not found')}; turned on: ${browserOn && !browserOn.enabled ? await setToolEnabled(page, browserOn.id, true) : 'already'}`);
  await wait(2_000);
  await pressRow('tasks');
  await cmd(page, 'browser.newTab'); await wait(2_000);
  const b0 = await read();
  await cmd(page, 'browser.openHistory'); await wait(1_500);
  const b1 = await read();
  // A click in an empty corner of the Browser's page, as a person does before pressing a key there.
  const inPage = await page.evaluate(() => { const e = [...document.querySelectorAll('.br-pane')].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width - 30, y: b.y + b.height - 30 }; });
  if (inPage) { await page.mouse.click(inPage.x, inPage.y); await wait(300); }
  await key('Alt+ArrowLeft', 1_500);
  const b2 = await read();
  console.log(`[control] a Browser tab opened offline: ${b0.browser !== null ? 'yes' : 'NO'}; its History page: ${JSON.stringify(b1.browser)}`);
  check('I1 in a Browser tab on its History page, Alt+Left is the Browser\'s own Back: the Browser tab stays in front and its page goes back', b0.browser !== null && /history/i.test(b1.browser ?? '') && b2.active === b1.active && b2.browser !== null && !/history/i.test(b2.browser), { newTab: short(b0), history: { ...short(b1), url: b1.browser }, after: { ...short(b2), url: b2.browser } });
  await screenshot(app, page, path.join(shots, 'i-browser.png'));
  let how = 'arrow';
  if (!(await pressArrow('back', { wait: 1_700 }))) {
    how = 'palette';
    const rows = await palette('Back'); const r = appRow(rows, 'Back');
    if (r) { await page.mouse.click(r.x, r.y); await wait(1_700); } else { how = 'none'; await key('Escape', 400); }
  }
  s = await read();
  check('I2 with the Browser tab in front, the app\'s Back (its arrow, else its command) leaves the Browser for the step before: Tasks', b2.browser !== null && how !== 'none' && atPlace(s, 'tasks', 'Tasks'), { how, after: short(s) });
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); failed.push('the probe stopped');
  if (page) await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app?.close().catch(() => {}); }

const real = errors.filter((e) => !/Ollama|EmbeddingService|ERR_CONNECTION_REFUSED/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] shots: ${shots}`);
console.log(`[probe] guards (pass before the piece by design): ${guards.join(', ') || 'none'}`);
const total = passed + failed.length;
console.log(`RESULT: ${passed}/${total} passed`);
process.exitCode = failed.length ? 1 : 0;
