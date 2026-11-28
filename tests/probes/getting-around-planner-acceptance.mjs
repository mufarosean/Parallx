// getting-around-planner-acceptance.mjs — @acceptance for "Getting around",
// piece 7, Planner (docs/MASTER_LIST.md, "Getting around: one way to move in
// every tool", "The order of work" item 7; the places-and-things table's
// Planner row: places Today, Calendar, Tasks; no things; events and tasks
// open in a popover over a place, which has no tab of its own and leaves the
// place's tab, trail and address as they were).
//
// Written from the request before the build, by a verifier who is not the
// builder. The builder does not edit this file. Every line not marked [guard]
// failed on the app as it was when it was written (dev at 5555f0ca); the lines
// marked [guard] passed then and must keep passing.
//
// What it holds the piece to (the rules every tab follows: every screen has
// the kit's page header; after a move the keys land on the new page's title;
// nothing opens twice):
//   1. Calendar's title is the kit's page header (one visible .px-page-header,
//      its h1.px-page-header__title reading the month in view), and the keys
//      land on it after a move to Calendar. The tab and trail still say Calendar.
//   2. Calendar's toolbar keeps the keys: Previous, Next, Today by Enter, and
//      ArrowRight on the Month/Week/Day switch, move the calendar and leave the
//      keys on the control pressed (for the switch, on the option chosen).
//   3. New Task on the Tasks page opens one form (by keys and by mouse);
//      Escape gives the keys back to that button.
//   4. A form opened by command (planner.newTask, planner.newEvent, as the
//      palette runs them) opens once, as a popover over a place (one Planner
//      tab, named for the place), and after Escape the keys are on that place's
//      kit title. The one-form-over-the-place halves passed then and are
//      [guards]; so is Alt+Left after New Task from Calendar returning to Calendar.
//   5. [guards] An event pressed on Calendar and a task's date pressed in Tasks
//      open their Edit popover over the place (tab count, name and trail as
//      they were); Escape closes it and the keys come back to the task's date
//      button. 5b, the keys back after the event's popover (on its chip or the
//      Calendar's kit title), was meant as a guard but fails on the app as it
//      was (the keys fall to BODY), so it is a demand.
//   6. Ways in land on the right place, wherever the Planner tab was left:
//      the calendar-view widget → Calendar; an agenda-widget event → Calendar on
//      its day with its Edit Event popover; a tasks-summary task → Tasks with its
//      Edit Task popover; the tasks-summary open link → Tasks; in a page's Agenda
//      block, an event → Calendar on its day with its popover, a task → Tasks
//      with its popover; a reminder's "Open Planner" → Tasks with the task's popover.
//   7. An older build's Planner tab (planner/main, no place in its data, the
//      page it showed in Planner's workspace memento `planner.activeTab`) comes
//      back as one Planner tab on that page (seeded on "calendar").
//   8. [guards] Today, Calendar, Tasks, Tasks › Overdue by their column rows:
//      one Planner tab named for the place, with an icon, the trail from
//      "Planner", one column row marked current; Open in Its Own Tab on the
//      tab's menu; the Planner turned off leaves no Planner tab.
// "On its day" is read as: the event's own chip ([data-event-id]) drawn in the
// visible calendar, with the calendar first moved three months away from it.
// Not checked: light and dark (nothing here is a colour); the owner's model.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/getting-around-planner-acceptance.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, screenshot, setToolEnabled } from './scene.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-planner-acceptance');
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

const TOOL = 'parallx.planner';
let passed = 0; const failed = []; const guards = [];
const check = (name, ok, got, { guard = false } = {}) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${guard ? '[guard] ' : ''}${name}${ok ? '' : `: ${JSON.stringify(got)}`}`);
  if (guard) guards.push(name);
  if (ok) passed += 1; else failed.push(name);
};

let app; let page; let errors = [];
const wait = (ms) => page.waitForTimeout(ms);
const NAME = { today: 'Today', calendar: 'Calendar', tasks: 'Tasks' };
const PREV = '[data-px-id="planner.calendar.previous"]';
const NEXT = '[data-px-id="planner.calendar.next"]';
const TODAY_BTN = '[data-px-id="planner.calendar.today"]';
const VIEW = '[data-px-id="planner.calendar.view"]';

/**
 * What a person sees: the tabs, the trail under them, the visible Planner pane
 * (its place, its kit headers, the h1 it shows, the events drawn, the view
 * chosen), every dialog in the document (visible or not, so a stale one counts),
 * Planner's column mark, and where the keys are.
 */
const read = () => page.evaluate((TOOL) => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const tabs = [...document.querySelectorAll('.editor-group .ui-tab')].filter((t) => !t.classList.contains('ui-tab--leaving') && vis(t) && !t.closest('.editor-pane-container')).map((t) => {
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
      icon: !!c.querySelector('svg, img'),
    }))
    : [];
  const panes = group?.querySelector('.editor-pane-container');
  const pane = [...(panes?.querySelectorAll('.planner-pane') ?? [])].find(vis) ?? null;
  const headers = pane ? [...pane.querySelectorAll('.px-page-header')].filter(vis) : [];
  const kitTitles = headers.map((h) => h.querySelector('h1.px-page-header__title')).filter(vis).map((h) => (h.textContent ?? '').trim());
  const h1 = pane ? [...pane.querySelectorAll('h1')].find(vis) : null;
  const viewEl = pane?.querySelector('[data-px-id="planner.calendar.view"]');
  const chosen = viewEl ? [...viewEl.querySelectorAll('[data-value]')].find((b) => b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true' || b.classList.contains('ui-segmented-control__segment--active'))?.dataset.value ?? null : null;
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.isConnected).map((d) => ({
    label: d.getAttribute('aria-label'), vis: vis(d), inOverlay: !!d.closest('.planner-popover-overlay'),
    values: [...d.querySelectorAll('input, textarea')].map((i) => i.value),
  }));
  const rows = [...document.querySelectorAll('.planner-sidebar .planner-sidebar__row[data-key]')];
  const ae = document.activeElement;
  const pl = tabs.filter((t) => t.id.startsWith(`${TOOL}:`));
  return {
    count: tabs.length, labels: tabs.map((t) => t.label), active: act?.label ?? null, activeId: act?.id ?? null, activeIcon: act?.icon ?? false,
    planner: pl.map((t) => t.label), plannerIds: pl.map((t) => t.id), activeIsPlanner: !!act && act.id.startsWith(`${TOOL}:`),
    crumbs, place: pane?.dataset.tab ?? null,
    headers: headers.length, kitTitles, h1: h1 ? (h1.textContent ?? '').trim() : null, view: chosen,
    events: pane ? [...pane.querySelectorAll('[data-event-id]')].filter(vis).map((e) => e.dataset.eventId) : [],
    dialogs,
    current: rows.filter((r) => r.getAttribute('aria-current') === 'page').map((r) => r.dataset.key),
    focus: ae ? {
      tag: ae.tagName, cls: String(ae.className ?? ''), tabindex: ae.getAttribute('tabindex'), text: (ae.textContent ?? '').trim().slice(0, 40),
      inEditor: !!panes?.contains(ae), inPane: !!pane?.contains(ae),
      pxId: ae.getAttribute('data-px-id'), owner: ae.closest('[data-px-id]')?.getAttribute('data-px-id') ?? null,
      value: ae.getAttribute('data-value'), taskId: ae.closest('[data-task-id]')?.getAttribute('data-task-id') ?? null,
      eventId: ae.getAttribute('data-event-id'), dueBtn: ae.classList?.contains('planner-task__due') ?? false,
      chosen: ae.getAttribute('aria-checked') === 'true' || ae.classList?.contains('ui-segmented-control__segment--active'),
    } : null,
  };
}, TOOL);
/** The keys are on the visible Planner pane's kit title (h1.px-page-header__title, tabindex -1) in the active editor. */
const titleFocused = (s) => !!s.focus && s.focus.tag === 'H1' && /\bpx-page-header__title\b/.test(s.focus.cls) && s.focus.tabindex === '-1' && s.focus.inEditor && s.focus.inPane;
const short = (s) => ({ active: s.active, planner: s.planner, count: s.count, place: s.place, crumbs: s.crumbs.map((c) => c.label), headers: s.headers, kitTitles: s.kitTitles, h1: s.h1, view: s.view, dialogs: s.dialogs.map((d) => `${d.label}${d.vis ? '' : ' (hidden)'}${d.inOverlay ? '' : ' (no overlay)'}`), focus: s.focus && `${s.focus.tag}.${s.focus.cls.split(' ')[0]}${s.focus.pxId ? `[${s.focus.pxId}]` : ''} "${s.focus.text}"` });
const last = (s) => (s.crumbs.length ? s.crumbs[s.crumbs.length - 1].label : '');
/** On this place, in the one Planner tab: the tab named `label`, the trail from Planner ending on it, the pane showing `place`. */
const onPlace = (s, place, label = NAME[place]) => s.planner.length === 1 && s.activeIsPlanner && s.active === label && s.place === place && s.crumbs[0]?.label === 'Planner' && last(s) === label;
/** Exactly one form with this name in the whole document, visible, inside Planner's popover overlay. */
const oneForm = (s, label) => { const f = s.dialogs.filter((d) => d.label === label); return f.length === 1 && f[0].vis && f[0].inOverlay; };
/** That form shows this title in its fields. */
const formFor = (s, label, title) => oneForm(s, label) && s.dialogs.find((d) => d.label === label).values.includes(title);
const noForms = (s) => s.dialogs.filter((d) => d.inOverlay || /Task|Event/.test(d.label ?? '')).length === 0;

const centre = (sel, text = null) => page.evaluate(({ sel, text }) => {
  const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length && (text === null || (x.textContent ?? '').trim() === text));
  if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, { sel, text });
const rowSel = (key) => `.planner-sidebar .planner-sidebar__row[data-key="${key}"]`;
async function press(sel, opts = {}) {
  const at = await centre(sel, opts.text ?? null);
  if (!at) return false;
  await page.mouse.click(at.x, at.y, { button: opts.right ? 'right' : 'left' });
  await wait(opts.wait ?? 1_300);
  return true;
}
async function showPlannerColumn() {
  if (await centre(rowSel('today'))) return;
  await press('.activity-bar-item[data-icon-id="planner-container"]', { wait: 1_200 });
}
async function pressRow(key, opts = {}) {
  await showPlannerColumn();
  if (!(await press(rowSel(key), opts))) throw new Error(`no Planner row ${key} on screen`);
}
/** A visible control in the Planner pane focused (as Tab would reach it), then a key pressed. */
async function keyOn(sel, key, ms = 1_300) {
  const ok = await page.evaluate((sel) => {
    const e = [...document.querySelectorAll(`.planner-pane ${sel}`)].find((x) => x.getClientRects().length);
    if (!e) return false; e.focus(); return document.activeElement === e;
  }, sel);
  if (!ok) return false;
  await page.keyboard.press(key); await wait(ms);
  return true;
}
async function pressTab(label, opts = {}) {
  const at = await page.evaluate(({ label, id }) => {
    const t = [...document.querySelectorAll('.editor-group .ui-tab')].filter((x) => x.getClientRects().length && !x.closest('.editor-pane-container') && !x.classList.contains('ui-tab--leaving') && (id ? x.dataset.tabId === id : label === null ? x.classList.contains('ui-tab--active') : (x.querySelector('.ui-tab-label')?.textContent ?? '').trim() === label)).pop();
    if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
  }, { label, id: opts.id ?? null });
  if (!at) return false;
  await page.mouse.click(at.x, at.y, { button: opts.right ? 'right' : 'left' });
  await wait(opts.wait ?? 1_000);
  return true;
}
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.context-menu')].filter((m) => m.getClientRects().length).flatMap((m) => [...m.querySelectorAll('.context-menu-item')].map((r) => (r.querySelector('.context-menu-item-label')?.textContent ?? r.textContent ?? '').trim())));
async function closeAllEditors() {
  for (let i = 0; i < 30 && (await read()).count > 0; i++) { await cmd(page, 'workbench.action.closeActiveEditor'); await wait(250); }
  await wait(500);
}
/** Escape until no Planner popover is left (cleanup between checks, not a check). */
async function closePopovers() {
  for (let i = 0; i < 5; i++) {
    const open = await page.evaluate(() => document.querySelectorAll('.planner-popover-overlay').length);
    if (!open) return;
    await page.keyboard.press('Escape'); await wait(400);
  }
}
/** Waits for a condition in the page (no fixed sleep for slow work). */
const until = (fn, arg, ms = 15_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true, () => false);
/** A Planner chat tool run as the chat runs it; its new item's id. */
const runTool = (name, args) => page.evaluate(async ({ name, args }) => {
  const tools = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' });
  const t = tools.getTool(name); if (!t) return `no tool ${name}`;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const out = String((await t.handler(args, token))?.content ?? '');
  try { const j = JSON.parse(out); return j.task?.id ?? j.event?.id ?? j.page?.id ?? j.id ?? `no id: ${out.slice(0, 160)}`; } catch { return (/id: ([0-9a-z-]{20,})/i.exec(out) || [])[1] ?? `no id: ${out.slice(0, 160)}`; }
}, { name, args });
/** The month a calendar `offset` months from now is titled by (the user's locale). */
const monthLabel = (offset) => page.evaluate((o) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + o); return d.toLocaleString(undefined, { month: 'long', year: 'numeric' }); }, offset);
/** The Planner tab left on `key`, its calendar first moved three months back (so a way in must pick the day itself). */
async function leaveOn(key, { cursorAway = false } = {}) {
  await closePopovers();
  if (cursorAway) {
    await pressRow('calendar');
    await press(TODAY_BTN, { wait: 700 });
    for (let i = 0; i < 3; i++) await press(PREV, { wait: 700 });
  }
  await pressRow(key);
  const s = await read();
  return { place: s.place, active: s.active, h1: s.h1 };
}

async function launch() {
  ({ app, page, errors } = await launchApp(appRoot));
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await wait(1_500);
}

const ids = {};
const T = { task: 'Probe Task Today', event: 'Probe Event Today', soon: 'Probe Event Soon', remind: 'Probe Task Reminder' };
let wsPrefix = null;
try {
  await launch();

  // ── Seeds (not checks) ──
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  ids.task = await runTool('planner_captureTask', { title: T.task, dueAt: Date.now(), status: 'planned' });
  ids.event = await runTool('planner_captureEvent', { title: T.event, startAt: `${today}T14:00` });
  ids.soon = await runTool('planner_captureEvent', { title: T.soon, startAt: '+1d' });
  ids.agendaPage = await page.evaluate(async () => {
    const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' });
    return svc.executeCommand('canvas.newPageWithBlock', 'parallx.planner.agenda', { range: 'today', show: 'all' }, 'Probe Agenda');
  });
  await wait(1_500);
  for (const type of ['parallx.planner.calendar-view', 'parallx.planner.calendar-agenda', 'parallx.planner.tasks-summary']) {
    ids[type] = await page.evaluate(async (type) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand('dashboard.addWidgetWith', type), type);
    await wait(600);
  }
  console.log(`[seed] today ${today}; ${JSON.stringify(ids)}`);

  await closeAllEditors();
  await showPlannerColumn();

  // ── 8. Guards: the column rows ──
  for (const [key, place, label] of [['today', 'today', 'Today'], ['calendar', 'calendar', 'Calendar'], ['tasks', 'tasks', 'Tasks'], ['tasks.overdue', 'tasks', 'Overdue']]) {
    await pressRow(key);
    const s = await read();
    const trailOk = s.crumbs[0]?.label === 'Planner' && last(s) === label && (key !== 'tasks.overdue' || s.crumbs.map((c) => c.label).join(' › ') === 'Planner › Tasks › Overdue');
    check(`8 ${label} by its column row: one Planner tab named "${label}" with an icon, the trail from "Planner" ending on it, only its row marked current`, s.planner.length === 1 && s.active === label && s.activeIcon && s.place === place && trailOk && s.current.length === 1 && s.current[0] === key, { ...short(s), current: s.current }, { guard: true });
  }
  await pressRow('calendar');
  await pressTab(null, { right: true, wait: 600 });
  const tabMenu = await menuItems();
  await page.keyboard.press('Escape'); await wait(300);
  check('8 the Planner tab\'s menu still has "Open in Its Own Tab"', tabMenu.includes('Open in Its Own Tab'), tabMenu, { guard: true });

  // ── 1. Calendar's title is the kit's page header ──
  await pressRow('today');
  await pressRow('calendar', { wait: 1_600 });
  let s = await read();
  const m0 = await monthLabel(0);
  console.log(`[control] the month in view, as the calendar draws it now: "${s.h1}"; expected "${m0}"`);
  await screenshot(app, page, path.join(shots, '1-calendar.png'));
  check(`1a Calendar by its row: the visible Planner pane has exactly one visible .px-page-header, its h1.px-page-header__title reading "${m0}"`, s.place === 'calendar' && s.headers === 1 && s.kitTitles.length === 1 && s.kitTitles[0] === m0, short(s));
  check('1b after the move to Calendar the keys are on that kit title (tabindex -1, in the active editor)', s.place === 'calendar' && titleFocused(s) && s.focus.text === m0, short(s));
  check('1c the tab and trail still say "Calendar"', onPlace(s, 'calendar'), short(s), { guard: true });
  await press(NEXT);
  s = await read();
  const m1 = await monthLabel(1);
  check(`1d after the Next arrow (mouse) the kit title reads the next month, "${m1}"; the tab and trail still "Calendar"`, s.headers === 1 && s.kitTitles.length === 1 && s.kitTitles[0] === m1 && onPlace(s, 'calendar'), short(s));

  // ── 2. Calendar's toolbar keeps the keys ──
  // The month in view is read from the pane's title, whichever h1 draws it (the demand here is the keys).
  await press(TODAY_BTN, { wait: 800 });
  s = await read();
  const before2 = s.h1;
  let did = await keyOn(PREV, 'Enter');
  s = await read();
  const mPrev = await monthLabel(-1);
  check(`2a Previous by Enter: the calendar moves to "${mPrev}" and the keys stay on Previous`, did && s.h1 === mPrev && s.focus?.pxId === 'planner.calendar.previous' && s.focus.inPane, { did, before: before2, ...short(s) });
  did = await keyOn(NEXT, 'Enter');
  s = await read();
  check(`2b Next by Enter: the calendar moves back to "${m0}" and the keys stay on Next`, did && s.h1 === m0 && s.focus?.pxId === 'planner.calendar.next' && s.focus.inPane, { did, ...short(s) });
  await press(NEXT, { wait: 700 }); await press(NEXT, { wait: 700 });
  const away2 = (await read()).h1;
  did = await keyOn(TODAY_BTN, 'Enter');
  s = await read();
  check(`2c Today by Enter (from "${away2}"): the calendar returns to "${m0}" and the keys stay on Today`, did && away2 !== m0 && s.h1 === m0 && s.focus?.pxId === 'planner.calendar.today' && s.focus.inPane, { did, away2, ...short(s) });
  const v0 = (await read()).view;
  did = await keyOn(`${VIEW} [data-value="${v0}"]`, 'ArrowRight');
  s = await read();
  check(`2d ArrowRight on the Month/Week/Day switch (on "${v0}"): the view changes to the next option, and the keys are on that newly chosen option`, did && v0 === 'month' && s.view === 'week' && s.focus?.owner === 'planner.calendar.view' && s.focus.value === 'week' && s.focus.inPane, { did, v0, ...short(s), focusValue: s.focus?.value });
  await screenshot(app, page, path.join(shots, '2-week.png'), { keepFocus: true });
  // Back to Month for what follows (mouse; not a check).
  await press(`${VIEW} [data-value="month"]`, { wait: 900 });
  await press(TODAY_BTN, { wait: 700 });
  console.log(`[cleanup] calendar view back to ${(await read()).view}`);

  // ── 3. New Task on the Tasks page opens one form ──
  await closePopovers();
  await pressRow('tasks');
  did = await keyOn('[data-px-id="planner.newTask"]', 'Enter', 1_500);
  s = await read();
  await screenshot(app, page, path.join(shots, '3-new-task.png'), { keepFocus: true });
  check('3a the Tasks page\'s New Task button by Enter opens exactly one "New Task" form (one dialog in the document, in the popover overlay)', did && oneForm(s, 'New Task'), { did, ...short(s) });
  check('3b ... over Tasks: one Planner tab, still "Tasks"', did && onPlace(s, 'tasks'), short(s), { guard: true });
  await page.keyboard.press('Escape'); await wait(800);
  s = await read();
  check('3c Escape: no form is left, and the keys are back on the page\'s New Task button', noForms(s) && s.focus?.pxId === 'planner.newTask' && s.focus.inPane, short(s));
  await closePopovers();
  await press('.planner-pane [data-px-id="planner.newTask"]', { wait: 1_500 });
  s = await read();
  check('3d New Task by mouse opens exactly one "New Task" form', oneForm(s, 'New Task'), short(s));
  await closePopovers();

  // ── 4. A form opened by command ──
  const byCommand = async (from, id, overPlace, label) => {
    await closePopovers();
    if (from === null) await closeAllEditors(); else await pressRow(from);
    const n0 = (await read()).count;
    const ran = await cmd(page, id);
    await wait(1_600);
    const a = await read();
    const opened = oneForm(a, label) && onPlace(a, overPlace) && a.count === (from === null ? n0 + 1 : n0);
    await page.keyboard.press('Escape'); await wait(900);
    const b = await read();
    return { ran, opened, a, b, closedOn: noForms(b) && titleFocused(b) && b.place === overPlace };
  };
  let r = await byCommand('calendar', 'planner.newTask', 'tasks', 'New Task');
  check('4a planner.newTask from Calendar: exactly one New Task form, a popover over Tasks (one Planner tab named "Tasks", trail to Tasks, no new tab)', r.ran === true && r.opened, { ran: r.ran, ...short(r.a) }, { guard: true });
  check('4b ... after Escape the keys are on Tasks\' kit page title', r.closedOn, short(r.b));
  await page.keyboard.press('Alt+ArrowLeft'); await wait(1_500);
  s = await read();
  check('4c Alt+Left after New Task from Calendar (and Escape) returns to Calendar', onPlace(s, 'calendar'), short(s), { guard: true });
  r = await byCommand('today', 'planner.newTask', 'tasks', 'New Task');
  check('4d planner.newTask from Today: exactly one New Task form, a popover over Tasks in the one Planner tab', r.ran === true && r.opened, { ran: r.ran, ...short(r.a) }, { guard: true });
  check('4e ... after Escape the keys are on Tasks\' kit page title', r.closedOn, short(r.b));
  r = await byCommand(null, 'planner.newTask', 'tasks', 'New Task');
  check('4f planner.newTask with no Planner tab open: one Planner tab ("Tasks") and exactly one New Task form over it', r.ran === true && r.opened, { ran: r.ran, ...short(r.a) }, { guard: true });
  check('4g ... after Escape the keys are on Tasks\' kit page title', r.closedOn, short(r.b));
  await showPlannerColumn();
  r = await byCommand('tasks', 'planner.newEvent', 'today', 'New Event');
  check('4h planner.newEvent from Tasks: exactly one New Event form, a popover over Today (one Planner tab named "Today")', r.ran === true && r.opened, { ran: r.ran, ...short(r.a) }, { guard: true });
  check('4i ... after Escape the keys are on Today\'s kit page title', r.closedOn, short(r.b));
  r = await byCommand('calendar', 'planner.newEvent', 'calendar', 'New Event');
  await screenshot(app, page, path.join(shots, '4-after-new-event.png'), { keepFocus: true });
  check('4j planner.newEvent from Calendar: exactly one New Event form, a popover over Calendar (one Planner tab named "Calendar")', r.ran === true && r.opened, { ran: r.ran, ...short(r.a) }, { guard: true });
  check('4k ... after Escape the keys are on Calendar\'s kit page title', r.closedOn, short(r.b));

  // ── 5. Detail popovers stay popovers over the place (guards) ──
  await closePopovers();
  await pressRow('calendar');
  await press(TODAY_BTN, { wait: 900 });
  let s0 = await read();
  const chip = `.planner-pane [data-event-id="${ids.event}"]`;
  const chipPressed = await press(chip, { wait: 1_500 });
  s = await read();
  await screenshot(app, page, path.join(shots, '5-edit-event.png'), { keepFocus: true });
  check(`5a "${T.event}" pressed on Calendar opens its Edit Event popover; tab count, tab name and trail unchanged`, chipPressed && formFor(s, 'Edit Event', T.event) && s.count === s0.count && onPlace(s, 'calendar'), { chipPressed, before: short(s0), after: short(s) }, { guard: true });
  await page.keyboard.press('Escape'); await wait(900);
  s = await read();
  check('5b Escape closes it and the keys come back (on the event\'s chip, or on the Calendar\'s kit title)', noForms(s) && onPlace(s, 'calendar') && ((s.focus?.eventId === ids.event && s.focus.inPane) || titleFocused(s)), short(s));
  await closePopovers();
  await pressRow('tasks');
  s0 = await read();
  did = await keyOn(`.planner-task[data-task-id="${ids.task}"] .planner-task__due`, 'Enter', 1_500);
  s = await read();
  check(`5c "${T.task}"'s date in Tasks by Enter opens its Edit Task popover; tab count, name and trail unchanged`, did && formFor(s, 'Edit Task', T.task) && s.count === s0.count && onPlace(s, 'tasks'), { did, before: short(s0), after: short(s) }, { guard: true });
  await page.keyboard.press('Escape'); await wait(900);
  s = await read();
  check('5d Escape: the keys are back on that task\'s date button', noForms(s) && s.focus?.dueBtn && s.focus.taskId === ids.task && s.focus.inPane, short(s), { guard: true });

  // ── 6. Ways in land on the right place ──
  // The widgets drawn with today's data (refreshed through the dashboard, as its own refresh does).
  await cmd(page, 'dashboard.open'); await wait(1_500);
  await cmd(page, 'dashboard.refreshAll');
  const drawn = await until((t) => {
    const has = (sel, text) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length && (text === null || (e.textContent ?? '').includes(text)));
    return has('.pl-cal__surface', null) && has('.pl-ag__item', t.soon) && has('.pl-ts__row', t.task);
  }, T, 30_000);
  console.log(`[seed] the three Planner widgets drawn on the dashboard with the seeded items: ${drawn}`);
  await screenshot(app, page, path.join(shots, '6-dashboard.png'));
  const onDashboard = async () => { await cmd(page, 'dashboard.open'); await wait(1_200); };
  const way = async (label, leave, pressIt) => {
    const left = await leave();
    await onDashboard();
    const pressed = await pressIt();
    await wait(1_800);
    const after = await read();
    return { left, pressed, after };
  };
  let w = await way('cal-view', () => leaveOn('tasks'), () => press('.pl-cal__surface'));
  check('6a the Planner "calendar view" widget pressed (Planner left on Tasks) → Calendar', w.pressed && onPlace(w.after, 'calendar'), { left: w.left, pressed: w.pressed, after: short(w.after) });
  await closePopovers();
  w = await way('agenda', () => leaveOn('tasks', { cursorAway: true }), async () => {
    const at = await page.evaluate((title) => { const e = [...document.querySelectorAll('.pl-ag__item')].find((x) => x.getClientRects().length && (x.querySelector('.pl-ag__title')?.textContent ?? '').trim() === title); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, T.soon);
    if (!at) return false; await page.mouse.click(at.x, at.y); return true;
  });
  await screenshot(app, page, path.join(shots, '6b-agenda-way-in.png'), { keepFocus: true });
  check(`6b "${T.soon}" in the agenda widget pressed (Planner left on Tasks, its calendar three months back) → Calendar on that event's day (its chip drawn) with its Edit Event popover over it`, w.pressed && onPlace(w.after, 'calendar') && w.after.events.includes(ids.soon) && formFor(w.after, 'Edit Event', T.soon), { left: w.left, pressed: w.pressed, after: { ...short(w.after), eventShown: w.after.events.includes(ids.soon) } });
  await closePopovers();
  w = await way('ts-row', () => leaveOn('calendar'), async () => {
    const at = await page.evaluate((title) => { const e = [...document.querySelectorAll('.pl-ts__row')].find((x) => x.getClientRects().length && (x.querySelector('.pl-ts__row-title')?.textContent ?? '').trim() === title); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, T.task);
    if (!at) return false; await page.mouse.click(at.x, at.y); return true;
  });
  check(`6c "${T.task}" in the tasks-summary widget pressed (Planner left on Calendar) → Tasks with its Edit Task popover`, w.pressed && onPlace(w.after, 'tasks') && formFor(w.after, 'Edit Task', T.task), { left: w.left, pressed: w.pressed, after: short(w.after) });
  await closePopovers();
  w = await way('ts-link', () => leaveOn('calendar'), () => press('.pl-ts__openlink', { wait: 0 }));
  check('6d the tasks-summary widget\'s open link pressed (Planner left on Calendar) → Tasks', w.pressed && onPlace(w.after, 'tasks'), { left: w.left, pressed: w.pressed, after: short(w.after) });
  await closePopovers();
  const onAgendaPage = async () => { await cmd(page, 'canvas.openPage', ids.agendaPage); await wait(1_500); };
  const agendaName = async (title) => {
    const ok = await until((t) => [...document.querySelectorAll('.planner-agenda__name')].some((e) => e.getClientRects().length && (e.textContent ?? '').trim() === t), title, 15_000);
    if (!ok) return false;
    return press('.planner-agenda__name', { text: title, wait: 0 });
  };
  let left = await leaveOn('tasks', { cursorAway: true });
  await onAgendaPage();
  await screenshot(app, page, path.join(shots, '6e-agenda-block.png'));
  let pressed = await agendaName(T.event); await wait(1_800);
  s = await read();
  check(`6e in a page's Agenda block, "${T.event}" pressed (Planner left on Tasks, its calendar three months back) → Calendar on its day (its chip drawn) with its Edit Event popover`, pressed && onPlace(s, 'calendar') && s.events.includes(ids.event) && formFor(s, 'Edit Event', T.event), { left, pressed, after: { ...short(s), eventShown: s.events.includes(ids.event) } });
  await closePopovers();
  left = await leaveOn('calendar');
  await onAgendaPage();
  pressed = await agendaName(T.task); await wait(1_800);
  s = await read();
  check(`6f in the Agenda block, "${T.task}" pressed (Planner left on Calendar) → Tasks with its Edit Task popover`, pressed && onPlace(s, 'tasks') && formFor(s, 'Edit Task', T.task), { left, pressed, after: short(s) });
  await closePopovers();
  // The reminder: a task whose reminder time has passed; the scheduler shows it within its minute.
  left = await leaveOn('calendar');
  ids.remind = await runTool('planner_captureTask', { title: T.remind, dueAt: Date.now() + 3_600_000, status: 'planned', reminderAt: Date.now() - 60_000 });
  const toast = await until((t) => [...document.querySelectorAll('.parallx-notification')].some((n) => n.getClientRects().length && (n.textContent ?? '').includes(`Reminder: ${t}`)), T.remind, 100_000);
  let toastPressed = false;
  if (toast) {
    const at = await page.evaluate((t) => {
      const n = [...document.querySelectorAll('.parallx-notification')].find((x) => x.getClientRects().length && (x.textContent ?? '').includes(`Reminder: ${t}`));
      const b = [...(n?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === 'Open Planner');
      if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, T.remind);
    if (at) { await page.mouse.click(at.x, at.y); toastPressed = true; await wait(2_000); }
  }
  s = await read();
  check(`6g the reminder's "Open Planner" pressed on its message (Planner left on Calendar) → Tasks with "${T.remind}"'s Edit Task popover`, toastPressed && onPlace(s, 'tasks') && formFor(s, 'Edit Task', T.remind), { remindId: ids.remind, toast, toastPressed, left, after: short(s) });
  await closePopovers();

  // ── Ready the older build's tab: the state file as this run left it ──
  // Left on Today, so a Calendar that comes back can only come from the seeded memento.
  await pressRow('today');
  await closeAllEditors();
  await wait(1_000);
  await app.close(); app = null;
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); failed.push('the probe stopped');
  if (page) await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
  await app?.close().catch(() => {}); app = null;
}

// ── 7. An older build's Planner tab comes back on the page it showed ──
// Before piece 1 the Planner tab was saved as a tool editor of type `planner`, instance `main`, with no place
// in its data; the page it showed was Planner's workspace memento `planner.activeTab`.
const statePath = path.join(ws, '.parallx', 'workspace-state.json');
let seededOld = false;
try {
  const file = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const key = Object.keys(file).find((k) => k.startsWith(`tool-ws:${TOOL}:`) && k.endsWith('/planner.calendarView'));
  wsPrefix = key ? key.slice(0, -'/planner.calendarView'.length) : null;
  if (!wsPrefix) throw new Error(`no Planner workspace memento in the state file; keys: ${Object.keys(file).filter((k) => k.includes('planner')).join(', ')}`);
  file[`${wsPrefix}/planner.activeTab`] = JSON.stringify('calendar');
  file[`${wsPrefix}/planner.calendarView`] = JSON.stringify('month');
  const wb = JSON.parse(file.workbench);
  const groupId = wb.editors?.groups?.[0]?.id ?? 'editor-group-1';
  const inputId = `${TOOL}:planner:main`;
  wb.editors = {
    groups: [{ id: groupId, editors: [{
      typeId: 'planner', inputId, pinned: true,
      data: { inputId, instanceId: 'main', name: 'Planner', iconHtml: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/></svg>', ownerToolId: TOOL },
    }], activeEditorIndex: 0 }],
    activeGroupIndex: 0, activeGroupId: groupId,
  };
  file.workbench = JSON.stringify(wb);
  await fs.writeFile(statePath, JSON.stringify(file, null, 2));
  seededOld = true;
  const back = JSON.parse(await fs.readFile(statePath, 'utf8'));
  console.log(`[seed] the older build's Planner tab written into ${path.relative(root, statePath)}:`);
  console.log(`[seed]   editors ${JSON.stringify(JSON.parse(back.workbench).editors)}`);
  console.log(`[seed]   ${wsPrefix}/planner.activeTab = ${back[`${wsPrefix}/planner.activeTab`]}`);
} catch (e) { console.log(`[seed] the saved state could not be written: ${e?.message ?? e}`); }

try {
  await launch();
  await wait(1_500);
  let s = await read();
  console.log(`[restore] as it came back: ${JSON.stringify({ labels: s.labels, planner: s.planner, active: s.active, place: s.place })}`);
  if (s.plannerIds.length === 1 && !s.activeIsPlanner) { await pressTab(null, { id: s.plannerIds[0], wait: 1_800 }); s = await read(); }
  await screenshot(app, page, path.join(shots, '7-restored.png'));
  check('7a the older build\'s Planner tab (planner/main, its page "calendar") comes back as ONE Planner tab named "Calendar" showing Calendar (trail Planner › Calendar)', seededOld && onPlace(s, 'calendar') && s.crumbs.map((c) => c.label).join(' › ') === 'Planner › Calendar', short(s));

  // ── 8. Guard: the Planner turned off leaves no Planner tab ──
  await showPlannerColumn();
  await pressRow('tasks');
  const on = (await read()).planner.length;
  const off = await setToolEnabled(page, TOOL, false);
  await until((TOOL) => ![...document.querySelectorAll('.editor-group .ui-tab')].some((t) => (t.dataset.tabId ?? '').startsWith(`${TOOL}:`) && t.getClientRects().length), TOOL, 15_000);
  s = await read();
  check('8 the Planner turned off: no Planner tab is left', on === 1 && off === true && s.planner.length === 0, { on, off, labels: s.labels }, { guard: true });
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); failed.push('the probe stopped');
  if (page) await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app?.close().catch(() => {}); }

const real = errors.filter((e) => !/Ollama|EmbeddingService|ERR_CONNECTION_REFUSED/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] shots: ${shots}`);
console.log(`[probe] guards (passed on the app before the piece, must keep passing): ${guards.length}`);
const total = passed + failed.length;
console.log(`RESULT: ${passed}/${total} passed`);
process.exitCode = failed.length ? 1 : 0;
