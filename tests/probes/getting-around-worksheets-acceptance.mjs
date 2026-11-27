// getting-around-worksheets-acceptance.mjs — @acceptance for "Getting around",
// piece 3, Worksheets onto the core's places point (docs/MASTER_LIST.md,
// "Getting around: one way to move in every tool", "The order of work" item 3;
// his picks 1A, 2A, 3A).
//
// Written from the request before the build, by a verifier who is not the
// builder. The builder does not edit this file. The checks for the new
// behaviour failed on the app as it was when it was written (dev at 88033b78);
// the ones marked [guard] test what is already true and must stay true.
// On that app 5 of 59 passed: the three [guard]s (T1, T5, X1), W2 Home (Worksheets
// Home never had a back link) and W5 New Quiz (no New Quiz row in the column, so
// no mark is right); each is part of the walk and must stay true.
//
// What it holds the piece to:
//   W. A walk down the Worksheets column, Home → Problem Bank → Study Dashboard →
//      Campaign → Quizzes → New Quiz, leaves exactly ONE Worksheets tab, named
//      for the place; no kit back link ("Worksheets ›", .px-page-header__back) on
//      the page; the trail in the bar under the tabs is "Worksheets › <place>";
//      the column marks the current row only (aria-current="page" + px-current);
//      the keys land on the page's kit title (h1.px-page-header__title, tabindex -1).
//      New Quiz is pressed in the column when the column has it, else on the
//      Quizzes page's header (an in-page move).
//   B. Alt+Left across Worksheets places returns to the previous place in the
//      same tab (same tab id), keys on its title.
//   F. A Problem Bank filter (the Noted chip) is carried in the place address,
//      parallx://place/worksheet/<place>?<params> (read from the trail's last
//      crumb, data-address); it survives Back and Forward; turned off, it leaves
//      the address; the address with it, clicked as a link in a page, opens the
//      bank in the one tab with the filter on.
//   T. Things keep tabs of their own: a problem's sheet, a quiz started from New
//      Quiz (tab named after the quiz), a quiz opened by worksheet.openQuiz, Home
//      card's and Worksheets Home's Resume; the place tab stays one.
//   C. The commands worksheet.open / bank / dashboard / quizzes / plan / practice /
//      importExcel each land in the one place tab, named for the place.
//   O. Open in Its Own Tab (the tab's menu) and Ctrl+click on a column row still
//      give a second tab on the place.
//   R. A Worksheets screen tab saved by the older build (editor typeId
//      'worksheet', instanceId 'bank', and one 'dashboard', written into the
//      workspace's saved state before launch) comes back as ONE place tab, not
//      lost, not doubled, showing a Worksheets place; and after the app is
//      closed and opened, the one place tab comes back at its place.
//   X. Turned off, Worksheets' tabs and column go; on again, its commands work.
// Screenshots of the place tab in dark and light are taken (shots/), not judged here.
// Not checked: Study's links into Worksheets and the chat's tools (no code in
// Study or the chat tools opens a Worksheets screen today; the Home card is
// the one cross-tool link, checked in T); Settings ("Worksheets Settings"),
// which the request does not list as a place; a paper as a parameter (the
// Noted filter stands for a parameter).
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/getting-around-worksheets-acceptance.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, launchApp, cmd, screenshot, toolList, setToolEnabled } from './scene.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-getting-around-worksheets');
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

let passed = 0; const failed = []; const guards = [];
const check = (name, ok, got, { guard = false } = {}) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${guard ? '[guard] ' : ''}${name}${ok ? '' : `: ${JSON.stringify(got)}`}`);
  if (guard) guards.push(name);
  if (ok) passed += 1; else failed.push(name);
};

const WS_TOOL = 'parallx.worksheet';
const PLACES = ['Home', 'Problem Bank', 'Study Dashboard', 'Quizzes', 'Campaign', 'Import Workbook', 'New Quiz'];
/** A place's address: parallx://place/worksheet/<place>?<params> (the tool segment "worksheet", or "worksheets"). */
const PLACE_ADDR = /^parallx:\/\/place\/worksheets?\/[^?/]+/i;

let app; let page; let errors = [];
const wait = (ms) => page.waitForTimeout(ms);

/** What a person sees: the tabs, the trail under them, the page, the Worksheets column, the focus. */
const read = () => page.evaluate(({ WS_TOOL }) => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const tabs = [...document.querySelectorAll('.editor-group .ui-tab')].filter((t) => !t.classList.contains('ui-tab--leaving') && vis(t)).map((t) => {
    const icon = t.querySelector('.ui-tab-icon');
    return {
      id: t.dataset.tabId ?? '', label: (t.querySelector('.ui-tab-label')?.textContent ?? '').trim(), active: t.classList.contains('ui-tab--active'),
      icon: !!icon && vis(icon) && !!icon.querySelector('svg, img'),
      group: t.closest('.editor-group')?.getAttribute('data-editor-group-id') ?? null,
    };
  });
  const act = tabs.find((t) => t.active) ?? null;
  const group = act ? document.querySelector(`.editor-group[data-editor-group-id="${act.group}"]`) : null;
  const ribbon = group?.querySelector('.editor-ribbon');
  const crumbs = ribbon && vis(ribbon) && !ribbon.classList.contains('hidden')
    ? [...ribbon.querySelectorAll('.parallx-breadcrumb-item')].filter(vis).map((c) => ({
      label: ((c.querySelector('.breadcrumb-label, [class*="label"]') ?? c).textContent ?? '').trim(),
      icon: !!c.querySelector('svg, img'), address: c.dataset.address ?? '',
    }))
    : [];
  const panes = group?.querySelector('.editor-pane-container');
  const wsPane = [...(panes?.querySelectorAll('.ws-pane') ?? [])].filter(vis).pop() ?? null;
  const title = [...(panes?.querySelectorAll('.px-page-header__title') ?? [])].find(vis);
  const back = [...(panes?.querySelectorAll('.px-page-header__back') ?? [])].find(vis);
  const view = document.querySelector('.view[data-view-id="view.worksheet"]') ?? document.querySelector('.ws-sidebar');
  const nameOf = (e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim();
  const marked = view ? [...view.querySelectorAll('[aria-current="page"]')].map((e) => ({ name: nameOf(e), pxCurrent: e.classList.contains('px-current') })) : null;
  const chip = [...(panes?.querySelectorAll('.px-chip, [role="button"][aria-pressed]') ?? [])].find((c) => vis(c) && ((c.querySelector('.px-chip__label') ?? c).textContent ?? '').trim().startsWith('Noted'));
  const ae = document.activeElement;
  const wsTabs = tabs.filter((t) => t.id.startsWith(`${WS_TOOL}:`));
  return {
    count: tabs.length, labels: tabs.map((t) => t.label), active: act?.label ?? null, activeId: act?.id ?? null, activeIcon: act?.icon ?? false,
    activeIsWs: !!act && act.id.startsWith(`${WS_TOOL}:`),
    ws: wsTabs.map((t) => t.label), wsIds: wsTabs.map((t) => t.id),
    crumbs, address: crumbs.length ? crumbs[crumbs.length - 1].address : '',
    wsPane: !!wsPane, title: title ? (title.textContent ?? '').trim() : null,
    back: back ? (back.textContent ?? '').trim() || '(a back link)' : null,
    column: !!view && vis(view), marked,
    noted: chip ? chip.getAttribute('aria-pressed') === 'true' : null,
    focus: ae ? { tag: ae.tagName, cls: String(ae.className ?? ''), tabindex: ae.getAttribute('tabindex'), text: (ae.textContent ?? '').trim().slice(0, 40), inEditor: !!panes?.contains(ae) } : null,
  };
}, { WS_TOOL });
const titleFocused = (s) => !!s.focus && s.focus.tag === 'H1' && /\bpx-page-header__title\b/.test(s.focus.cls) && s.focus.tabindex === '-1' && s.focus.inEditor;
const short = (s) => ({ active: s.active, activeId: s.activeId, ws: s.ws, crumbs: s.crumbs.map((c) => c.label), address: s.address, title: s.title });
const trailIs = (s, place) => s.crumbs.length >= 2 && s.crumbs[0].label === 'Worksheets' && s.crumbs[0].icon && s.crumbs[s.crumbs.length - 1].label === place;
/** On this place, in the one Worksheets tab. */
const onePlace = (s, place) => s.ws.length === 1 && s.activeIsWs && s.active === place;

const centre = (sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
async function showColumn() {
  const shown = await page.evaluate(() => { const v = document.querySelector('.view[data-view-id="view.worksheet"]') ?? document.querySelector('.ws-sidebar'); return !!v && v.getClientRects().length > 0; });
  if (shown) return;
  const at = await centre('.activity-bar-item[data-icon-id="worksheet-container"]');
  if (at) { await page.mouse.click(at.x, at.y); await wait(1_200); }
}
/** A control in the Worksheets column named exactly `label` (scrolled into view): its centre, or null. */
async function columnControl(label) {
  await showColumn();
  return page.evaluate((label) => {
    const view = document.querySelector('.view[data-view-id="view.worksheet"]') ?? document.querySelector('.ws-sidebar');
    if (!view) return null;
    const nameOf = (e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim();
    const e = [...view.querySelectorAll('button, a[href], [role="button"], [role="link"], [role="treeitem"], [role="menuitem"]')].find((x) => x.getClientRects().length && nameOf(x) === label);
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
}
async function pressColumn(label, { ctrl = false, right = false, ms = 1_600 } = {}) {
  const at = await columnControl(label);
  if (!at) return false;
  if (ctrl) await page.keyboard.down('Control');
  await page.mouse.click(at.x, at.y, { button: right ? 'right' : 'left' });
  if (ctrl) await page.keyboard.up('Control');
  await wait(ms);
  return true;
}
/** A visible button in the active editor whose text starts with `text`: pressed by the mouse. */
async function pressInPage(text, { ms = 1_600, sel = 'button, [role="button"]' } = {}) {
  const at = await page.evaluate(({ text, sel }) => {
    const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => t.getClientRects().length);
    const panes = act?.closest('.editor-group')?.querySelector('.editor-pane-container');
    const e = [...(panes?.querySelectorAll(sel) ?? [])].find((x) => x.getClientRects().length && (x.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(text));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { text, sel });
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
}
/** The tab with this label (the last, if several; the active one when label is null), by the mouse. */
async function pressTab(label, { right = false, ms = 1_200 } = {}) {
  const at = await page.evaluate((label) => {
    const t = [...document.querySelectorAll('.editor-group .ui-tab')].filter((x) => x.getClientRects().length && !x.classList.contains('ui-tab--leaving') && (label === null ? x.classList.contains('ui-tab--active') : (x.querySelector('.ui-tab-label')?.textContent ?? '').trim() === label)).pop();
    if (!t) return null; const l = (t.querySelector('.ui-tab-label') ?? t).getBoundingClientRect(); return { x: l.x + Math.min(20, l.width / 2), y: l.y + l.height / 2 };
  }, label);
  if (!at) return false;
  await page.mouse.click(at.x, at.y, { button: right ? 'right' : 'left' });
  await wait(ms);
  return true;
}
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.context-menu')].filter((m) => m.getClientRects().length).flatMap((m) => [...m.querySelectorAll('.context-menu-item')].map((r) => (r.querySelector('.context-menu-item-label')?.textContent ?? r.textContent ?? '').trim())));
async function pickMenuItem(text) {
  const at = await page.evaluate((text) => {
    const r = [...document.querySelectorAll('.context-menu .context-menu-item')].filter((x) => x.getClientRects().length).find((x) => (x.textContent ?? '').includes(text));
    if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, text);
  if (!at) { await page.keyboard.press('Escape'); await wait(300); return false; }
  await page.mouse.click(at.x, at.y); await wait(1_600);
  return true;
}
async function closeAllEditors() {
  for (let i = 0; i < 40 && (await read()).count > 0; i++) { await cmd(page, 'workbench.action.closeActiveEditor'); await wait(250); }
  await wait(500);
}
const key = async (k, ms = 1_700) => { await page.keyboard.press(k); await wait(ms); };
const runTool = (name, args) => page.evaluate(async ({ name, args }) => {
  const tools = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' });
  const t = tools.getTool(name); if (!t) return `no tool ${name}`;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const out = String((await t.handler(args, token))?.content ?? '');
  return (/id: ([0-9a-f-]{20,})/i.exec(out) || [])[1] ?? `no id: ${out.slice(0, 160)}`;
}, { name, args });
/** The column's mark: exactly one marked control, named `label`, with px-current; or, for a place with no control there, none. */
async function markRight(s, label) {
  const has = !!(await columnControl(label));
  const after = (await read()).marked ?? s.marked;
  const ok = has ? after.length === 1 && after[0].name === label && after[0].pxCurrent : after.length === 0;
  return { ok, has, marked: after };
}

async function launch() {
  ({ app, page, errors } = await launchApp(appRoot));
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await wait(2_000);
}

// ── Seeds: run 1 makes and migrates the database; then a synthetic bank; then the older build's saved tabs ──
await launch();
await cmd(page, 'worksheet.open'); await wait(2_000);
await app.close(); app = null;
const electronBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const seed = spawnSync(electronBin, [path.join(PROJECT_ROOT, 'tests', 'probes', 'worksheet-seed.cjs'), path.join(ws, '.parallx', 'data.db')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', shell: process.platform === 'win32' });
console.log(`[seed] ${(seed.stdout || '').trim()} ${(seed.stderr || '').trim()}`);
// The older build saved a Worksheets screen tab as a tool editor of type 'worksheet' with the screen as its instanceId
// (seen in a workspace-state.json written by dev at 88033b78 after worksheet.bank and worksheet.dashboard).
const statePath = path.join(ws, '.parallx', 'workspace-state.json');
let seededOld = false;
try {
  const file = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const wb = JSON.parse(file.workbench);
  const groupId = wb.editors?.groups?.[0]?.id ?? 'editor-group-1';
  const old = (instanceId, name) => ({
    typeId: 'worksheet', inputId: `${WS_TOOL}:worksheet:${instanceId}`, pinned: true,
    data: { inputId: `${WS_TOOL}:worksheet:${instanceId}`, instanceId, name, ownerToolId: WS_TOOL },
  });
  wb.editors = { groups: [{ id: groupId, editors: [old('bank', 'Problem Bank'), old('dashboard', 'Study Dashboard')], activeEditorIndex: 1 }], activeGroupIndex: 0, activeGroupId: groupId };
  file.workbench = JSON.stringify(wb);
  await fs.writeFile(statePath, JSON.stringify(file, null, 2));
  seededOld = true;
} catch (e) { console.log(`[seed] the saved state could not be written: ${e?.message ?? e}`); }
console.log(`[seed] older-build tabs (bank, dashboard) written into the saved state: ${seededOld}`);

try {
  await launch();

  // ── R. The older build's tabs come back as one place tab ──
  let s = await read();
  const r0 = s;
  const restoredLabel = r0.ws.length === 1 ? r0.ws[0] : null;
  check('R1 the older build\'s two saved Worksheets tabs (bank, dashboard) come back as ONE Worksheets tab, named for one of their places', seededOld && r0.ws.length === 1 && ['Problem Bank', 'Study Dashboard'].includes(restoredLabel), { seededOld, ws: r0.ws, wsIds: r0.wsIds });
  if (restoredLabel) await pressTab(restoredLabel, { ms: 1_800 });
  s = await read();
  check('R2 that tab shows a Worksheets place: trail "Worksheets › <its name>", the page\'s kit title is its name', !!restoredLabel && s.activeIsWs && trailIs(s, restoredLabel) && s.title === restoredLabel && PLACE_ADDR.test(s.address), short(s));

  await closeAllEditors();

  // ── W. The walk down the column ──
  const walk = [['Home'], ['Problem Bank'], ['Study Dashboard'], ['Campaign'], ['Quizzes'], ['New Quiz']];
  for (const [place] of walk) {
    let how = 'column';
    let pressed = await pressColumn(place, { ms: 1_800 });
    if (!pressed && place === 'New Quiz') { how = 'the Quizzes page header'; pressed = await pressInPage('New Quiz', { ms: 1_800 }); }
    s = await read();
    console.log(`[walk] ${place} pressed (${how}): ${pressed} → ${JSON.stringify(short(s))}`);
    check(`W1 ${place}: exactly one Worksheets tab, in front, named "${place}"`, pressed && onePlace(s, place), { pressed, how, ...short(s) });
    check(`W2 ${place}: no kit back link ("Worksheets ›") on the page`, pressed && s.wsPane && s.title !== null && s.back === null, { pressed, wsPane: s.wsPane, title: s.title, back: s.back });
    check(`W3 ${place}: the trail under the tabs is "Worksheets › ${place}", with Worksheets' icon`, pressed && trailIs(s, place), s.crumbs);
    check(`W4 ${place}: the keys are on the page's kit title (h1, tabindex -1, in the editor)`, pressed && titleFocused(s), s.focus);
    const m = await markRight(s, place);
    check(`W5 ${place}: the column marks the current place only (aria-current="page" + px-current${m.has ? `, on "${place}"` : ', none: no such row'})`, pressed && m.ok, m);
    if (place === 'Problem Bank') await screenshot(app, page, path.join(shots, 'w-bank-dark.png'));
  }

  // ── B. Back across places in the same tab ──
  s = await read();
  const bId = s.activeId;
  await key('Alt+ArrowLeft');
  let b1 = await read();
  check('B1 Alt+Left from New Quiz: Quizzes, in the same tab (same tab id), still one Worksheets tab', onePlace(b1, 'Quizzes') && b1.activeId === bId && b1.title === 'Quizzes', { before: bId, after: short(b1) });
  check('B2 after Back, the keys are on Quizzes\' page title', b1.active === 'Quizzes' && titleFocused(b1), b1.focus);
  await key('Alt+ArrowLeft');
  b1 = await read();
  check('B3 Alt+Left again: Campaign, in the same tab, trail "Worksheets › Campaign"', onePlace(b1, 'Campaign') && b1.activeId === bId && trailIs(b1, 'Campaign'), short(b1));
  const m = await markRight(b1, 'Campaign');
  check('B4 after Back the column\'s mark follows: only Campaign is marked', b1.active === 'Campaign' && m.ok && m.has, m);

  // ── F. A filter of the Problem Bank in the address ──
  await pressColumn('Problem Bank', { ms: 1_800 });
  const f0 = await read();
  if (f0.noted === true) { await pressInPage('Noted', { sel: '.px-chip, [aria-pressed]', ms: 1_000 }); }
  const fClear = await read();
  const pressedChip = await pressInPage('Noted', { sel: '.px-chip, [aria-pressed]', ms: 1_400 });
  const f1 = await read();
  const notedIn = (a) => /[?&][^=]*=[^&]*noted|[?&]noted\b/i.test(a);
  check('F1 the Noted chip pressed on the Problem Bank: the place address (trail\'s last crumb) is parallx://place/worksheet/<place>?… and now carries "noted"; it did not before', pressedChip && f1.noted === true && onePlace(f1, 'Problem Bank') && PLACE_ADDR.test(f1.address) && notedIn(f1.address) && PLACE_ADDR.test(fClear.address) && !notedIn(fClear.address), { pressedChip, before: fClear.address, after: f1.address, noted: f1.noted, ws: f1.ws });
  const notedAddress = f1.address;
  const fId = f1.activeId;
  await pressColumn('Study Dashboard', { ms: 1_800 });
  const f2a = await read();
  await key('Alt+ArrowLeft');
  let f2 = await read();
  check('F2 to Study Dashboard and Alt+Left: the Problem Bank in the same tab, Noted still on, "noted" still in the address', f2a.active === 'Study Dashboard' && onePlace(f2, 'Problem Bank') && f2.activeId === fId && f2.noted === true && notedIn(f2.address), { dash: short(f2a), after: { ...short(f2), noted: f2.noted } });
  await key('Alt+ArrowRight');
  const f3a = await read();
  await key('Alt+ArrowLeft');
  f2 = await read();
  check('F3 Alt+Right (Study Dashboard) then Alt+Left: the Problem Bank again with Noted on and in the address', onePlace(f3a, 'Study Dashboard') && onePlace(f2, 'Problem Bank') && f2.noted === true && notedIn(f2.address), { fwd: short(f3a), back: { ...short(f2), noted: f2.noted } });
  await pressInPage('Noted', { sel: '.px-chip, [aria-pressed]', ms: 1_400 });
  const f4 = await read();
  check('F4 Noted turned off on the page: "noted" leaves the address, still the Problem Bank in the one tab', onePlace(f4, 'Problem Bank') && f4.noted === false && PLACE_ADDR.test(f4.address) && !notedIn(f4.address), { ...short(f4), noted: f4.noted });
  // The address with the filter, as a link in a page.
  const linkPage = PLACE_ADDR.test(notedAddress)
    ? await runTool('canvas_create_page', { title: 'Probe Worksheet Links', markdown: `Go to [the noted problems](${notedAddress}) from here.` })
    : null;
  console.log(`[seed] a page with the link ${notedAddress || '(no address read)'}: ${linkPage}`);
  let f5 = null; let clicked = false;
  if (linkPage && !/^no /.test(linkPage)) {
    await cmd(page, 'canvas.openPage', linkPage); await wait(1_800);
    const at = await page.evaluate((href) => { const a = [...document.querySelectorAll('[data-px-surface="canvas"] a')].find((x) => x.getClientRects().length && x.getAttribute('href') === href); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, notedAddress);
    if (at) { clicked = true; await page.mouse.click(at.x, at.y); await wait(2_000); }
    f5 = await read();
  }
  check('F5 the address with the filter, clicked as a link in a page: the Problem Bank in the one Worksheets tab, Noted on', clicked && !!f5 && onePlace(f5, 'Problem Bank') && f5.noted === true, { clicked, after: f5 && { ...short(f5), noted: f5.noted } });
  if (f5?.noted) await pressInPage('Noted', { sel: '.px-chip, [aria-pressed]', ms: 1_000 });

  // ── T. Things keep tabs of their own ──
  await closeAllEditors();
  await pressColumn('Problem Bank', { ms: 1_800 });
  await pressInPage('Brosius', { sel: '.ws-list__group, [aria-expanded]', ms: 1_000 });
  const t0 = await read();
  const openedSheet = await pressInPage('RF Brosius - 1', { sel: '.ws-list__text, .ws-bankrow button', ms: 3_000 });
  let t1 = await read();
  check('T1 a problem opened from the Problem Bank opens a tab of its own, named "RF Brosius - 1"; the place tab stays, one, "Problem Bank"', openedSheet && t1.active === 'RF Brosius - 1' && t1.labels.filter((l) => l === 'RF Brosius - 1').length === 1 && t1.ws.filter((l) => PLACES.includes(l)).length === 1 && t1.ws.includes('Problem Bank'), { before: t0.ws, opened: openedSheet, after: short(t1) }, { guard: true });
  await closeAllEditors();
  await cmd(page, 'worksheet.open'); await wait(1_800);
  const resumedWs = await pressInPage('Resume', { sel: '.ws-home__todayacts .px-btn, button', ms: 4_000 });
  t1 = await read();
  check('T4 Worksheets Home\'s Resume: the open quiz "Day 8 Draw" in a tab of its own; one place tab remains', resumedWs && t1.active === 'Day 8 Draw' && t1.ws.filter((l) => PLACES.includes(l)).length === 1, { resumedWs, ...short(t1) });
  await closeAllEditors();
  await cmd(page, 'home.open'); await wait(2_000);
  const resumedHome = await pressInPage('Resume', { ms: 4_000 });
  t1 = await read();
  check('T5 the app Home\'s Worksheets card, Resume: "Day 8 Draw" in a tab of its own', resumedHome && t1.active === 'Day 8 Draw' && t1.labels.filter((l) => l === 'Day 8 Draw').length === 1, { resumedHome, ...short(t1) }, { guard: true });

  await closeAllEditors();
  await cmd(page, 'worksheet.open'); await wait(1_800);
  await cmd(page, 'worksheet.openQuiz', 'q-done'); await wait(3_000);
  t1 = await read();
  check('T3 worksheet.openQuiz on the finished quiz "Day 6 Draw": a tab named "Day 6 Draw" in front, beside one Worksheets place tab', t1.active === 'Day 6 Draw' && t1.ws.filter((l) => PLACES.includes(l)).length === 1, short(t1));
  await closeAllEditors();
  await pressColumn('Quizzes', { ms: 1_600 });
  let viaColumn = true;
  if (!(await pressColumn('New Quiz', { ms: 1_800 }))) { viaColumn = false; await pressInPage('New Quiz', { ms: 1_800 }); }
  const nameAt = await centre('.ws-builder input[maxlength="80"], input[aria-label="Quiz name"]');
  if (nameAt) { await page.mouse.click(nameAt.x, nameAt.y, { clickCount: 3 }); await page.keyboard.type('Probe Quiz', { delay: 20 }); await wait(300); }
  const started = await pressInPage('Start Quiz', { ms: 4_000 });
  t1 = await read();
  check('T2 a quiz started from New Quiz (named "Probe Quiz") opens a tab of its own named "Probe Quiz"; one place tab remains', !!nameAt && started && t1.active === 'Probe Quiz' && t1.ws.filter((l) => PLACES.includes(l)).length === 1, { viaColumn, name: !!nameAt, started, after: short(t1) });
  await screenshot(app, page, path.join(shots, 't-quiz.png'));
  // ── C. The commands land in the one place tab ──
  await closeAllEditors();
  const commands = [['worksheet.open', 'Home'], ['worksheet.bank', 'Problem Bank'], ['worksheet.dashboard', 'Study Dashboard'], ['worksheet.quizzes', 'Quizzes'], ['worksheet.plan', 'Campaign'], ['worksheet.practice', 'New Quiz'], ['worksheet.importExcel', 'Import Workbook'], ['worksheet.bank', 'Problem Bank']];
  let cId = null;
  for (const [id, place] of commands) {
    const ran = await cmd(page, id); await wait(1_800);
    s = await read();
    if (cId === null) cId = s.activeId;
    check(`C ${id}: lands in the one Worksheets tab (same tab), named "${place}", trail "Worksheets › ${place}"`, ran === true && onePlace(s, place) && s.activeId === cId && trailIs(s, place), { ran, ...short(s) });
  }
  await screenshot(app, page, path.join(shots, 'c-bank.png'));
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
  await wait(600);
  await screenshot(app, page, path.join(shots, 'c-bank-light.png'));
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'dark'));

  // ── O. Open in Its Own Tab and Ctrl+click ──
  await closeAllEditors();
  await pressColumn('Quizzes', { ms: 1_800 });
  const o0 = await read();
  const ctrl = await pressColumn('Quizzes', { ctrl: true, ms: 1_800 });
  let o1 = await read();
  check('O1 on Quizzes, Ctrl+click on Quizzes in the column: a second Worksheets tab, both named "Quizzes", the new one in front', onePlace(o0, 'Quizzes') && ctrl && o1.ws.length === 2 && o1.ws.every((l) => l === 'Quizzes') && o1.activeId !== o0.activeId, { before: short(o0), ctrl, after: short(o1) });
  await pressTab(null, { right: true, ms: 700 });
  const tabMenu = await menuItems();
  const picked = await pickMenuItem('Open in Its Own Tab');
  const o2 = await read();
  check('O2 the Worksheets tab\'s menu has "Open in Its Own Tab": one more tab on Quizzes', tabMenu.includes('Open in Its Own Tab') && picked && o2.ws.length === o1.ws.length + 1 && o2.ws.every((l) => l === 'Quizzes'), { tabMenu, after: short(o2) });

  // ── R. After the app is closed and opened ──
  await closeAllEditors();
  await pressColumn('Problem Bank', { ms: 1_600 });
  await pressColumn('Campaign', { ms: 1_800 });
  const r3a = await read();
  await wait(1_500);
  await app.close(); app = null;
  await launch();
  s = await read();
  const back1 = s.ws.length === 1 ? s.ws[0] : null;
  if (back1) await pressTab(back1, { ms: 1_800 });
  s = await read();
  check('R3 Problem Bank then Campaign in the one tab, the app closed and opened: one Worksheets tab comes back, "Campaign", trail "Worksheets › Campaign"', onePlace(r3a, 'Campaign') && onePlace(s, 'Campaign') && trailIs(s, 'Campaign') && s.title === 'Campaign', { before: short(r3a), after: short(s) });

  // ── X. Turned off and on ──
  const wsTool = (await toolList(page)).find((t) => t.id === WS_TOOL);
  const off = await setToolEnabled(page, WS_TOOL, false); await wait(2_000);
  const x0 = await read();
  check('X1 Worksheets turned off: no Worksheets tab and no Worksheets column remain', off === true && x0.ws.length === 0 && !x0.column, { tool: wsTool, off, ws: x0.ws, column: x0.column }, { guard: true });
  const on = await setToolEnabled(page, WS_TOOL, true); await wait(2_500);
  await cmd(page, 'worksheet.bank'); await wait(2_000);
  await cmd(page, 'worksheet.quizzes'); await wait(1_800);
  const x1 = await read();
  check('X2 turned on again, worksheet.bank then worksheet.quizzes: one Worksheets tab, "Quizzes", trail "Worksheets › Quizzes"', on === true && onePlace(x1, 'Quizzes') && trailIs(x1, 'Quizzes'), { on, ...short(x1) });
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); failed.push('the probe stopped');
  if (page) await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app?.close().catch(() => {}); }

const real = errors.filter((e) => !/Ollama|EmbeddingService|ERR_CONNECTION_REFUSED/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] shots: ${shots}`);
console.log(`[probe] guards (true before the piece, must stay true): ${guards.join(', ') || 'none'}`);
const total = passed + failed.length;
console.log(`RESULT: ${passed}/${total} passed`);
process.exitCode = failed.length ? 1 : 0;
