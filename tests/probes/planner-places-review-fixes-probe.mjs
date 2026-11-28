// planner-places-review-fixes-probe.mjs — drives review fix C2b of Planner's
// places (commit b55c8705, "an older build's saved page does not redirect a
// drawing a form was sent to").
//
// Before piece 1 a Planner tab carried no address; its page was kept in the
// Planner's workspace memento `planner.activeTab`. The first Planner drawing
// after the update goes to that page once, then the key is cleared. The bug:
// when that first drawing was New Event carried to Today (planner.newEvent
// with the Planner's last place not Calendar, here no Planner tab at all), the
// drawing was sent to the old page (Tasks), the form did not open, and it
// popped up unasked on a later visit to Today.
//
//   A. memento "tasks", no editor saved open, relaunch, planner.newEvent by the
//      command service: exactly one New Event form, over Today (one Planner tab
//      named Today); Escape; Calendar then Today by the column rows: no form
//      opens on that visit. The memento is gone from the state file afterwards.
//   B. [guard] memento "calendar", no editor saved open, relaunch, planner.open:
//      Calendar (the older page still comes back when nothing is carried).
//
// Helpers and seeding borrowed from getting-around-planner-acceptance.mjs (item 7).
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/planner-places-review-fixes-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, screenshot } from './scene.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-planner-review-fixes');
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

const TOOL = 'parallx.planner';
const statePath = path.join(ws, '.parallx', 'workspace-state.json');
let passed = 0; const failed = []; const guards = [];
const check = (name, ok, got, { guard = false } = {}) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${guard ? '[guard] ' : ''}${name}${ok ? '' : `: ${JSON.stringify(got)}`}`);
  if (guard) guards.push(name);
  if (ok) passed += 1; else failed.push(name);
};

let app; let page; let errors = []; const allErrors = [];
const wait = (ms) => page.waitForTimeout(ms);

/** What a person sees: the tabs, the trail, the visible Planner pane's place, every dialog in the document, where the keys are. */
const read = () => page.evaluate((TOOL) => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const tabs = [...document.querySelectorAll('.editor-group .ui-tab')].filter((t) => !t.classList.contains('ui-tab--leaving') && vis(t) && !t.closest('.editor-pane-container')).map((t) => ({
    id: t.dataset.tabId ?? '', label: (t.querySelector('.ui-tab-label')?.textContent ?? '').trim(), active: t.classList.contains('ui-tab--active'),
    group: t.closest('.editor-group')?.getAttribute('data-editor-group-id') ?? null,
  }));
  const act = tabs.find((t) => t.active) ?? null;
  const group = act ? document.querySelector(`.editor-group[data-editor-group-id="${act.group}"]`) : null;
  const ribbon = group?.querySelector('.editor-ribbon');
  const crumbs = ribbon && vis(ribbon) && !ribbon.classList.contains('hidden')
    ? [...ribbon.querySelectorAll('.parallx-breadcrumb-item')].filter(vis).map((c) => ((c.querySelector('.breadcrumb-label, [class*="label"]') ?? c).textContent ?? '').trim())
    : [];
  const panes = group?.querySelector('.editor-pane-container');
  const pane = [...(panes?.querySelectorAll('.planner-pane') ?? [])].find(vis) ?? null;
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.isConnected).map((d) => ({
    label: d.getAttribute('aria-label'), vis: vis(d), inOverlay: !!d.closest('.planner-popover-overlay'),
  }));
  const pl = tabs.filter((t) => t.id.startsWith(`${TOOL}:`));
  return {
    count: tabs.length, labels: tabs.map((t) => t.label), active: act?.label ?? null,
    planner: pl.map((t) => t.label), activeIsPlanner: !!act && act.id.startsWith(`${TOOL}:`),
    crumbs, place: pane?.dataset.tab ?? null, dialogs,
    overlays: document.querySelectorAll('.planner-popover-overlay').length,
  };
}, TOOL);
const short = (s) => ({ active: s.active, labels: s.labels, planner: s.planner, place: s.place, crumbs: s.crumbs, overlays: s.overlays, dialogs: s.dialogs.map((d) => `${d.label}${d.vis ? '' : ' (hidden)'}${d.inOverlay ? '' : ' (no overlay)'}`) });
const NAME = { today: 'Today', calendar: 'Calendar', tasks: 'Tasks' };
const onPlace = (s, place) => s.planner.length === 1 && s.activeIsPlanner && s.active === NAME[place] && s.place === place && s.crumbs[0] === 'Planner' && s.crumbs[s.crumbs.length - 1] === NAME[place];
const formsNamed = (s, label) => s.dialogs.filter((d) => d.label === label);
const oneForm = (s, label) => { const f = formsNamed(s, label); return f.length === 1 && f[0].vis && f[0].inOverlay; };
const noForms = (s) => s.overlays === 0 && s.dialogs.filter((d) => d.inOverlay || /Task|Event/.test(d.label ?? '')).length === 0;

const centre = (sel) => page.evaluate((sel) => {
  const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length);
  if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, sel);
const rowSel = (key) => `.planner-sidebar .planner-sidebar__row[data-key="${key}"]`;
async function press(sel, ms = 1_300) {
  const at = await centre(sel); if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms); return true;
}
async function showPlannerColumn() {
  if (await centre(rowSel('today'))) return;
  await press('.activity-bar-item[data-icon-id="planner-container"]', 1_200);
}
async function pressRow(key) {
  await showPlannerColumn();
  if (!(await press(rowSel(key), 1_500))) throw new Error(`no Planner row ${key} on screen`);
}
async function closeAllEditors() {
  for (let i = 0; i < 30 && (await read()).count > 0; i++) { await cmd(page, 'workbench.action.closeActiveEditor'); await wait(250); }
  await wait(500);
}
const until = (fn, arg, ms = 15_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true, () => false);
async function launch() {
  ({ app, page, errors } = await launchApp(appRoot));
  allErrors.push(errors);
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await wait(1_500);
}
/** Close every editor, then the app (the state file is written as it closes). */
async function closeClean() {
  await closeAllEditors();
  await wait(1_000);
  await app.close(); app = null;
}

/**
 * The older build's saved page: Planner's memento `planner.activeTab` = `older`,
 * and no editor saved open. Returns the key written, read back from disk.
 */
async function seedOlder(older) {
  const file = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const k = Object.keys(file).find((x) => x.startsWith(`tool-ws:${TOOL}:`) && x.includes('/planner.'));
  if (!k) throw new Error(`no Planner workspace memento in the state file; keys: ${Object.keys(file).join(', ')}`);
  const prefix = k.slice(0, k.lastIndexOf('/planner.'));
  file[`${prefix}/planner.activeTab`] = JSON.stringify(older);
  const wb = JSON.parse(file.workbench);
  const groupId = wb.editors?.groups?.[0]?.id ?? 'editor-group-1';
  wb.editors = { groups: [{ id: groupId, editors: [], activeEditorIndex: -1 }], activeGroupIndex: 0, activeGroupId: groupId };
  file.workbench = JSON.stringify(wb);
  await fs.writeFile(statePath, JSON.stringify(file, null, 2));
  const back = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const editors = (JSON.parse(back.workbench).editors?.groups ?? []).flatMap((g) => g.editors ?? []);
  console.log(`[seed] ${prefix}/planner.activeTab = ${back[`${prefix}/planner.activeTab`]}; editors saved open: ${editors.length}`);
  return { key: `${prefix}/planner.activeTab`, ok: back[`${prefix}/planner.activeTab`] === JSON.stringify(older) && editors.length === 0 };
}

let key = null;
try {
  // ── Ready a workspace whose Planner has its workspace memento (not a check) ──
  await launch();
  for (const k of ['calendar', 'tasks', 'today']) await pressRow(k);
  await closeClean();

  // ── A. memento "tasks", nothing open, New Event by command ──
  const a = await seedOlder('tasks'); key = a.key;
  await launch();
  let s = await read();
  check('A0 relaunched with no Planner tab open', a.ok && s.planner.length === 0, { seeded: a.ok, ...short(s) }, { guard: true });
  const ran = await cmd(page, 'planner.newEvent');
  await until(() => document.querySelectorAll('.planner-popover-overlay [role="dialog"]').length > 0, null, 8_000);
  await wait(1_000);
  s = await read();
  await screenshot(app, page, path.join(shots, 'A1-new-event-over-today.png'));
  check('A1 planner.newEvent (memento "tasks", no Planner tab): exactly one New Event form, a popover over Today (one Planner tab named "Today")',
    ran === true && oneForm(s, 'New Event') && onPlace(s, 'today'), { ran, ...short(s) });
  check('A2 the older page did not take that drawing: the pane is not on Tasks', s.place !== 'tasks' && !s.planner.includes('Tasks'), short(s));
  await page.keyboard.press('Escape'); await wait(800);
  s = await read();
  check('A3 Escape closes the form, Today stays', noForms(s) && onPlace(s, 'today'), short(s));
  await pressRow('calendar');
  s = await read();
  check('A4 Calendar by its column row: on Calendar, no form', onPlace(s, 'calendar') && noForms(s), short(s));
  await pressRow('today');
  await wait(800);
  s = await read();
  await screenshot(app, page, path.join(shots, 'A5-today-revisited.png'));
  check('A5 back to Today by its column row: no form pops up on that visit', onPlace(s, 'today') && noForms(s), short(s));
  await pressRow('tasks');
  s = await read();
  check('A6 Tasks by its column row: on Tasks, no form', onPlace(s, 'tasks') && noForms(s), short(s));
  await closeClean();
  const after = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const left = after[key];
  check('A7 the old key is cleared from the state file after that first drawing', left === undefined || left === null || left === 'null' || left === '""', { [key]: left });

  // ── B. [guard] memento "calendar", nothing carried, planner.open ──
  const b = await seedOlder('calendar');
  await launch();
  s = await read();
  const ranB = await cmd(page, 'planner.open');
  await wait(1_800);
  s = await read();
  await screenshot(app, page, path.join(shots, 'B1-open-older-calendar.png'));
  check('B1 planner.open (memento "calendar", no Planner tab): one Planner tab named "Calendar" showing Calendar, no form', b.ok && ranB === true && onPlace(s, 'calendar') && noForms(s), { seeded: b.ok, ranB, ...short(s) }, { guard: true });
  await closeClean();
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); failed.push('the probe stopped');
  if (page) await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app?.close().catch(() => {}); }

const real = allErrors.flat().filter((e) => !/Ollama|EmbeddingService|ERR_CONNECTION_REFUSED/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] shots: ${shots}`);
console.log(`[probe] guards: ${guards.length}`);
const total = passed + failed.length;
console.log(`RESULT: ${passed}/${total} passed`);
process.exitCode = failed.length ? 1 : 0;
