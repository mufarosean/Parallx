// getting-around-study-acceptance.mjs — @acceptance for "Getting around",
// piece 5, Study (ext/study) onto the core's places point
// (docs/MASTER_LIST.md, "Getting around: one way to move in every tool",
// "The order of work" item 5; his picks 1A, 2A, 3A and the places-and-things
// table, whose Study row reads: places = Home, a subject, its Progress, its
// Plan, a unit, Weak Spots; things = a session).
//
// Written from the request before the build, by a verifier who is not the
// builder. The builder does not edit this file. The checks for the new
// behaviour failed on the app as it was when it was written (dev at ff7a4df0);
// the ones marked [guard] test what is already true and must stay true.
// On that app 11 of 78 passed: the seven [guard]s (R1, C study.studyMarked, L2,
// T1, T2, N1, X1) and W2 for Progress, the Plan, Mack and Clark (those screens
// already had the kit's title and no back link); each is part of the walk and
// must stay true. Seen there too: pressing the restored session tab drew a
// second "Study · Probe Drill" tab (R4 counts names after each restored tab is
// pressed, so that must not happen on the new build either).
//
// What it holds the piece to:
//   R. Tabs the older build saved (editor type `study`, instance ids home,
//      progress-<subject>, unit-<subject>-<row>, plan-<plan>, new-plan-<subject>,
//      new-subject and session-<id>, written into the workspace's saved state
//      before launch, the unit's tab the one showing) come back: the places as
//      ONE Study place tab, showing the unit that was showing; nothing doubled;
//      the session as a tab of its own.
//   W. A walk down Study's column (Home, the subject, its Progress, its Plan,
//      two units, Weak Spots, Marked) leaves exactly ONE Study tab, named for
//      the row (the tab's name is the trail's last crumb), with the tool's icon;
//      the page has the kit's title and no kit back link; the trail in the bar
//      under the tabs starts at Study (with its icon) and names the subject (and
//      the unit) where they apply, `Study › Seeded Subject › Mack`; the keys land
//      on the kit title (h1.px-page-header__title, tabindex -1); the column marks
//      the row with the shared mark (aria-current="page" + px-current) and only
//      it. Each has its own address parallx://place/study/<place>?…; the unit's
//      carries its subject's id and its row id, Progress its subject's id, the
//      Plan its plan's id.
//   A. The same row pressed twice in a row: still one tab, same tab. After a
//      switch to another tab, a column row brings the one Study tab forward.
//   B. Alt+Left / Alt+Right walk between Study places in the one tab.
//   C. The manifest's commands (study.open, study.openHome, study.openProgress,
//      study.openUnit, study.openPlan) land in the one place tab; study.weakSpots
//      on Weak Spots there (or a session of its own); study.studyMarked on
//      Marked (or a session of its own) [guard].
//   D. The other screens of the tool, whatever the builder calls them (New
//      Plan, New Session setup, New Subject, Learn through the chat's
//      study_session tool, the app Home's Study card "Start Session"): from Home
//      in the one tab, each run twice: nothing opens twice, and there is still
//      exactly one Study place tab.
//   L. Links in a page: the unit's address opens the unit in the one tab; the
//      deep link parallx://study/session/<id> (read from the chat's study_results
//      tool) opens the session in a tab of its own; parallx://study/concept/<id>
//      opens Study without doubling anything.
//   T. A session is a thing [guard]: its column row opens a tab of its own,
//      named after itself, and the tab that was in front stays; its Results →
//      Review Answers → Back to Results stay inside that one tab.
//   O. Ctrl+click on a column row, and the tab menu's Open in Its Own Tab, give
//      a second tab on the place.
//   S. After the app is closed and opened, the one place tab comes back at its
//      place.
//   N. Nothing a tool other than Study owns changes [guard]: Worksheets' Problem
//      Bank keeps its place tab and trail.
//   X. Turned off, Study's tabs, column and commands go; on again, its commands
//      land in one place tab.
// Screenshots (shots/) of the unit place, dark and light, and of Weak Spots,
// Marked and the subject place, are taken for a person to look at, not judged here.
// Read as the builder's choice, not checked: which place ids and parameter
// names are used; whether New Plan, New Session setup, New Subject and Learn are
// places or things (only that nothing opens twice and the place tab stays one);
// whether study.weakSpots and study.studyMarked land on their place or start a
// session. Not checked: the dashboard's Weak Spots widget (adding a widget to a
// dashboard was not driven); links from Worksheets and Flashcards into Study
// (none exist at ff7a4df0: no code in src/built-in/worksheet or ext/flashcards
// opens Study); the chat tools study_weak_spots and study_session's session
// modes (they need a model).
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/getting-around-study-acceptance.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, launchApp, cmd, screenshot, toolList, setToolEnabled } from './scene.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-getting-around-study');
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }
// A notes file, Study's material for Learn, a weak concept and the concept link.
await fs.writeFile(path.join(ws, 'Probe Notes.md'), '# Probe Notes\n\n## Chain Ladder\n\nThe chain ladder method projects losses by development factors.\n\n## Mack\n\nMack gives the standard error of the chain ladder reserve.\n');

let passed = 0; const failed = []; const guards = [];
const check = (name, ok, got, { guard = false } = {}) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${guard ? '[guard] ' : ''}${name}${ok ? '' : `: ${JSON.stringify(got)}`}`);
  if (guard) guards.push(name);
  if (ok) passed += 1; else failed.push(name);
};

const manifest = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'ext', 'study', 'parallx-manifest.json'), 'utf8'));
const TOOL = manifest.id; // parallx-community.study: the prefix of every Study tab's id
const OLD_TYPE = 'study';
/** A place's address: parallx://place/study/<place>?<params>. */
const PLACE_ADDR = /^parallx:\/\/place\/study\/[^?/]+/i;
const SUBJECT = 'Seeded Subject'; const PLAN = 'Seeded Plan'; const SESSION = 'Probe Drill';
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const nodeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

// SQL on Study's own database, with the app closed (better-sqlite3 under Electron's node).
const sqlScript = path.join(root, 'sql.cjs');
await fs.writeFile(sqlScript, `
const Database = require(${JSON.stringify(path.join(PROJECT_ROOT, 'node_modules', 'better-sqlite3'))});
const db = new Database(process.argv[2]);
const out = [];
for (const s of JSON.parse(process.argv[3])) { const st = db.prepare(s.sql); out.push(st.reader ? st.all(...(s.args || [])) : st.run(...(s.args || [])).changes); }
db.close();
console.log(JSON.stringify(out));
`);
async function studyDbPath() {
  const dir = path.join(ws, '.parallx', 'extensions');
  const names = await fs.readdir(dir).catch(() => []);
  for (const n of [TOOL, 'study', ...names.filter((x) => /study/i.test(x))]) {
    const p = path.join(dir, n, 'data.db');
    try { await fs.access(p); return p; } catch { /* next */ }
  }
  return null;
}
function sql(dbPath, statements) {
  const r = spawnSync(ELECTRON, [sqlScript, dbPath, JSON.stringify(statements)], { env: nodeEnv, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`sql: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
}

let app; let page; let errors = [];
const wait = (ms) => page.waitForTimeout(ms);
const COLUMN = '.view[data-view-id="study.materials"]';

/** What a person sees: the tabs, the trail under them, the page, Study's column, the focus. */
const read = () => page.evaluate(({ TOOL, COLUMN }) => {
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
      icon: !!c.querySelector('svg, img'), address: c.dataset.address ?? '',
    }))
    : [];
  const panes = group?.querySelector('.editor-pane-container');
  const title = [...(panes?.querySelectorAll('.px-page-header__title') ?? [])].find(vis);
  const back = [...(panes?.querySelectorAll('.px-page-header__back') ?? [])].find(vis);
  const view = document.querySelector(COLUMN);
  const nameOf = (e) => ((e.querySelector('.px-btn__label')?.textContent) || e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim();
  const marked = view ? [...view.querySelectorAll('[aria-current="page"]')].map((e) => ({ name: nameOf(e), pxCurrent: e.classList.contains('px-current') })) : null;
  const oldMarks = view ? [...view.querySelectorAll('.st-sb__it--on')].map(nameOf) : null;
  const ae = document.activeElement;
  const study = tabs.filter((t) => t.id.startsWith(`${TOOL}:`));
  return {
    count: tabs.length, labels: tabs.map((t) => t.label), ids: tabs.map((t) => t.id), active: act?.label ?? null, activeId: act?.id ?? null, activeIcon: act?.icon ?? false,
    activeIsSt: !!act && act.id.startsWith(`${TOOL}:`),
    st: study.map((t) => t.label), stIds: study.map((t) => t.id),
    crumbs, address: crumbs.length ? crumbs[crumbs.length - 1].address : '',
    title: title ? (title.textContent ?? '').trim() : null,
    back: back ? (back.textContent ?? '').trim() || '(a back link)' : null,
    column: !!view && vis(view), marked, oldMarks,
    focus: ae ? { tag: ae.tagName, cls: String(ae.className ?? ''), tabindex: ae.getAttribute('tabindex'), text: (ae.textContent ?? '').trim().slice(0, 40), inEditor: !!panes?.contains(ae) } : null,
  };
}, { TOOL, COLUMN });
const titleFocused = (s) => !!s.focus && s.focus.tag === 'H1' && /\bpx-page-header__title\b/.test(s.focus.cls) && s.focus.tabindex === '-1' && s.focus.inEditor;
const short = (s) => ({ active: s.active, activeId: s.activeId, st: s.st, crumbs: s.crumbs.map((c) => c.label), address: s.address, title: s.title });
const last = (s) => (s.crumbs.length ? s.crumbs[s.crumbs.length - 1].label : '');
/** The trail starts at Study (with its icon), its last crumb is the tab's name and matches `place`, and `between` crumbs come before it in order. */
function trailIs(s, place, between = []) {
  if (s.crumbs.length < 2 + between.length || s.crumbs[0].label !== 'Study' || !s.crumbs[0].icon) return false;
  const l = last(s);
  if (!(place instanceof RegExp ? place.test(l) : l === place)) return false;
  if (l !== s.active) return false;
  const mid = s.crumbs.slice(1, -1).map((c) => c.label);
  let i = 0; for (const b of between) { const j = mid.indexOf(b, i); if (j < 0) return false; i = j + 1; }
  return PLACE_ADDR.test(s.address);
}
/** On this place, in the one Study tab (no other Study tab open). */
const onePlace = (s, place) => s.st.length === 1 && s.activeIsSt && (place instanceof RegExp ? place.test(s.active ?? '') : s.active === place);

const centre = (sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
async function showColumn() {
  const shown = await page.evaluate((COLUMN) => { const v = document.querySelector(COLUMN); return !!v && v.getClientRects().length > 0; }, COLUMN);
  if (shown) return;
  const at = await centre('.activity-bar-item[data-icon-id="study-container"]');
  if (at) { await page.mouse.click(at.x, at.y); await wait(1_200); }
}
/** A control in Study's column named exactly `label` (a kit button's label, else its name), or holding `label` when `contains`: its centre, or null. */
async function columnControl(label, { contains = false } = {}) {
  await showColumn();
  return page.evaluate(({ label, contains, COLUMN }) => {
    const view = document.querySelector(COLUMN);
    if (!view) return null;
    const nameOf = (e) => ((e.querySelector('.px-btn__label')?.textContent) || e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim();
    const all = [...view.querySelectorAll('button, a[href], [role="link"], [role="button"], [role="treeitem"], .st-sb__it')];
    const e = all.find((x) => x.getClientRects().length && (contains ? nameOf(x).includes(label) : nameOf(x) === label));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
  }, { label, contains, COLUMN });
}
async function pressColumn(label, { ctrl = false, ms = 2_200, contains = false } = {}) {
  const at = await columnControl(label, { contains });
  if (!at) return false;
  if (ctrl) await page.keyboard.down('Control');
  await page.mouse.click(at.x, at.y);
  if (ctrl) await page.keyboard.up('Control');
  await wait(ms);
  return true;
}
/** A visible control in the active editor whose text (or name) starts with `text`: pressed by the mouse. */
async function pressInPage(text, { ms = 1_800, sel = 'button, [role="button"]', exact = false } = {}) {
  const at = await page.evaluate(({ text, sel, exact }) => {
    const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => t.getClientRects().length && !t.closest('.editor-pane-container'));
    const panes = act?.closest('.editor-group')?.querySelector('.editor-pane-container');
    const nm = (x) => (x.textContent ?? '').replace(/\s+/g, ' ').trim() || (x.getAttribute('aria-label') ?? '');
    const e = [...(panes?.querySelectorAll(sel) ?? [])].find((x) => x.getClientRects().length && !x.disabled && (exact ? nm(x) === text : nm(x).startsWith(text)));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { text, sel, exact });
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
}
/** The tab with this label (the last, if several; the active one when label is null), by the mouse. */
async function pressTab(label, { right = false, ms = 1_400, id = null } = {}) {
  const at = await page.evaluate(({ label, id }) => {
    const t = [...document.querySelectorAll('.editor-group .ui-tab')].filter((x) => x.getClientRects().length && !x.closest('.editor-pane-container') && !x.classList.contains('ui-tab--leaving') && (id !== null ? x.dataset.tabId === id : label === null ? x.classList.contains('ui-tab--active') : (x.querySelector('.ui-tab-label')?.textContent ?? '').trim() === label)).pop();
    if (!t) return null; const l = (t.querySelector('.ui-tab-label') ?? t).getBoundingClientRect(); return { x: l.x + Math.min(20, l.width / 2), y: l.y + l.height / 2 };
  }, { label, id });
  if (!at) return false;
  await page.mouse.click(at.x, at.y, { button: right ? 'right' : 'left' });
  await wait(ms);
  return true;
}
/** Each open Study tab, pressed in turn, read for whether it shows a Study place (its trail's address); the tab in front is pressed again after. */
async function classifyStudyTabs() {
  const s0 = await read();
  const out = [];
  for (const id of s0.stIds) {
    await pressTab(null, { id, ms: 1_200 });
    const s = await read();
    out.push({ id, label: s.active, place: PLACE_ADDR.test(s.address), address: s.address });
  }
  if (s0.activeId) await pressTab(null, { id: s0.activeId, ms: 1_000 });
  return out;
}
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.context-menu')].filter((m) => m.getClientRects().length).flatMap((m) => [...m.querySelectorAll('.context-menu-item')].map((r) => (r.querySelector('.context-menu-item-label')?.textContent ?? r.textContent ?? '').trim())));
async function pickMenuItem(text) {
  const at = await page.evaluate((text) => {
    const r = [...document.querySelectorAll('.context-menu .context-menu-item')].filter((x) => x.getClientRects().length).find((x) => (x.textContent ?? '').includes(text));
    if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, text);
  if (!at) { await page.keyboard.press('Escape'); await wait(300); return false; }
  await page.mouse.click(at.x, at.y); await wait(1_800);
  return true;
}
async function closeAllEditors() {
  for (let i = 0; i < 40 && (await read()).count > 0; i++) { await cmd(page, 'workbench.action.closeActiveEditor'); await wait(250); }
  await page.keyboard.press('Escape').catch(() => {});
  await wait(500);
}
const key = async (k, ms = 1_900) => { await page.keyboard.press(k); await wait(ms); };
/** A chat tool's handler, as the chat runs it: its text. */
const runToolText = (name, args) => page.evaluate(async ({ name, args }) => {
  const tools = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' });
  const t = tools.getTool(name); if (!t) return `no tool ${name}`;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  try { return String((await t.handler(args, token))?.content ?? ''); } catch (e) { return `failed: ${String(e?.message || e).slice(0, 160)}`; }
}, { name, args });
const runTool = async (name, args) => { const out = await runToolText(name, args); return (/id: ([0-9a-f-]{20,})/i.exec(out) || [])[1] ?? `no id: ${out.slice(0, 160)}`; };
/** Runs a command and returns what it returned; does not wait longer than `cap` ms for it (a sheet that waits for an answer). */
const runCmd = (id, args = [], cap = 8_000) => page.evaluate(async ({ id, args, cap }) => {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
  try { return await Promise.race([svc.executeCommand(id, ...args), new Promise((r) => setTimeout(() => r('(still running)'), cap))]); } catch (e) { return `failed: ${String(e?.message || e).slice(0, 160)}`; }
}, { id, args, cap });
const hasCommand = (id) => page.evaluate((id) => !!window.__parallx_workbench__._services.get({ id: 'ICommandService' }).hasCommand?.(id), id);
/** The column's mark: exactly one marked control, named `label`, with px-current. */
async function markRight(label) {
  const has = !!(await columnControl(label));
  const after = (await read()).marked ?? [];
  return { ok: has && after.length === 1 && after[0].name === label && after[0].pxCurrent, has, marked: after };
}

async function launch() {
  ({ app, page, errors } = await launchApp(appRoot));
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await wait(2_500);
}
async function ensureStudyOn() {
  const t = (await toolList(page)).find((x) => x.id === TOOL);
  if (t && !t.enabled) { await setToolEnabled(page, TOOL, true); await wait(4_000); }
  return (await toolList(page)).find((x) => x.id === TOOL)?.enabled === true;
}

// ── Run 1: Study on; a subject over a questions database (as audit-seed.mjs makes it), its plan, a notes material, one session from the setup sheet ──
await launch();
const onFirst = await ensureStudyOn();
const seedLog = await page.evaluate(async ({ SUBJECT, PLAN }) => {
  const services = window.__parallx_workbench__._services;
  const tools = services.get({ id: 'ILanguageModelToolsService' });
  const cmds = services.get({ id: 'ICommandService' });
  const make = tools.getTool('canvas_create_database'); const add = tools.getTool('canvas_add_database_row');
  if (!make || !add || !cmds.hasCommand('study.newSubject')) return 'no canvas tools, or Study is off';
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const made = String((await make.handler({ title: 'Seeded Questions', properties: [
    { name: 'Model Answer', type: 'text' }, { name: 'Paper', type: 'select', options: ['Mack', 'Clark', 'Venter'] },
    { name: 'Times Attempted', type: 'number' }, { name: 'Times Correct', type: 'number' }, { name: 'Last Result', type: 'select', options: ['Right', 'Partly', 'Wrong'] },
  ] }, token))?.content || '');
  const id = (/id: ([0-9a-f-]{20,})/i.exec(made) || [])[1];
  if (!id) return `no database: ${made.slice(0, 120)}`;
  const states = { Mack: ['Right', 'Right', 'Partly', 'Wrong', ''], Clark: ['Wrong', '', ''], Venter: ['Right', 'Right'] };
  let n = 0;
  for (const [paper, list] of Object.entries(states)) for (const result of list) {
    n += 1;
    await add.handler({ databaseId: id, title: `Seeded question ${n} on ${paper}?`, values: { 'Model Answer': `The answer to question ${n}.`, Paper: paper, ...(result ? { 'Times Attempted': 1, 'Times Correct': result === 'Right' ? 1 : 0, 'Last Result': result } : {}) } }, token);
  }
  await cmds.executeCommand('study.newSubject', { name: SUBJECT, questions: id });
  await new Promise((r) => setTimeout(r, 2500));
  const iso = (k) => { const d = new Date(); d.setDate(d.getDate() + k); const p = (v) => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const week = (a, b, c, d) => ({ Mon: a, Tue: a, Wed: a, Thu: a, Fri: b, Sat: c, Sun: d });
  if (cmds.hasCommand('study.newPlan')) await cmds.executeCommand('study.newPlan', { subject: SUBJECT, name: PLAN, start: iso(-10), exam: iso(32), goal: 120, personal: week(2, 2, 4, 3), work: week(1, 2, 0, 0) });
  await new Promise((r) => setTimeout(r, 2500));
  return 'ok';
}, { SUBJECT, PLAN });
await wait(2_000);
const materialMade = await runCmd('study.addMaterial', [path.join(ws, 'Probe Notes.md')], 15_000); await wait(2_000);
await closeAllEditors();
// One session over the subject, from its setup sheet's Start (a subject's bank asks no model).
await runCmd('study.studySubject', [SUBJECT], 6_000); await wait(2_500);
const startAt = await centre('[data-px-id="study.setup.start"]');
if (startAt) { await page.mouse.click(startAt.x, startAt.y); await wait(4_000); }
await closeAllEditors();
await wait(1_500);
await app.close(); app = null;

// The ids the older build's tabs named, read from Study's database and the subject's Units table.
const stDb = await studyDbPath();
let ids = { subject: 0, plan: 0, session: 0, row: '', clarkRow: '', concept: 0, unitsDb: '' };
try {
  const [subj, plan, sess, mat] = sql(stDb, [
    { sql: 'SELECT id, units_db FROM st_subjects ORDER BY id LIMIT 1' }, { sql: 'SELECT id FROM st_plans ORDER BY id LIMIT 1' },
    { sql: 'SELECT id FROM st_sessions ORDER BY id DESC LIMIT 1' }, { sql: 'SELECT id FROM st_materials ORDER BY id LIMIT 1' },
  ]);
  ids.subject = Number(subj[0]?.id) || 0; ids.unitsDb = String(subj[0]?.units_db || ''); ids.plan = Number(plan[0]?.id) || 0; ids.session = Number(sess[0]?.id) || 0;
  const now = Date.now();
  const material = Number(mat[0]?.id) || 0;
  // The session named after itself, and finished (its Results and Review); a weak concept on the notes; one question marked.
  const [, , conceptRows] = sql(stDb, [
    { sql: 'UPDATE st_sessions SET name = ?, finished_at = ? WHERE id = ?', args: [SESSION, now, ids.session] },
    ...(material ? [{ sql: 'INSERT INTO st_concepts (material_id, section_id, title, summary, page, ord, mastery, answers, misses, miss_streak, last_answered_at, created_at) VALUES (?, 0, ?, ?, 1, 0, 0.1, 3, 2, 1, ?, ?)', args: [material, 'Probe Concept', 'Mack gives the standard error.', now, now] }] : [{ sql: 'SELECT 1' }]),
    { sql: 'SELECT MAX(id) AS id FROM st_concepts' },
  ]);
  ids.concept = Number(conceptRows?.[0]?.id) || 0;
  sql(stDb, [{ sql: 'UPDATE st_questions SET marked = 1 WHERE id = (SELECT MIN(id) FROM st_questions WHERE hidden = 0)' }]);
} catch (e) { console.log(`[seed] Study's database: ${e?.message ?? e}`); }

// The unit rows' ids: Units' own rows, through the canvas tool, in a short run.
await launch();
await ensureStudyOn();
if (ids.unitsDb) {
  const out = await runToolText('canvas_query_database', { databaseId: ids.unitsDb });
  const rowOf = (name) => { const line = out.split(/\r?\n/).find((l) => new RegExp(`\\b${name}\\b`).test(l) && /[0-9a-f]{8}-[0-9a-f-]{27}/i.test(l)); return line ? (/([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(line) || [])[1] : ''; };
  ids.row = rowOf('Mack'); ids.clarkRow = rowOf('Clark');
  if (!ids.row) console.log(`[seed] Units listing: ${out.slice(0, 600)}`);
}
await wait(1_000);
await app.close(); app = null;
console.log(`[seed] Study on: ${onFirst}; subject/plan: ${seedLog}; material: ${JSON.stringify(materialMade)?.slice(0, 80)}; sheet Start: ${!!startAt}; db ${stDb ? path.relative(root, stDb) : 'none'}; ids ${JSON.stringify(ids)}`);

// The older build saved each Study screen as a tool editor of type `study` with the screen as its instanceId
// (stRouteInstanceId in ext/study/src/60-pane.js at ff7a4df0): home, progress-<subject>, unit-<subject>-<row>,
// plan-<plan>, new-plan-<subject>, new-subject, session-<id>.
const statePath = path.join(ws, '.parallx', 'workspace-state.json');
let seededOld = false;
const OLD = [
  ['home', 'Study'], [`progress-${ids.subject}`, `${SUBJECT} Progress`], [`unit-${ids.subject}-${ids.row}`, `${SUBJECT} · Mack`], [`plan-${ids.plan}`, PLAN],
  [`new-plan-${ids.subject}`, 'New Plan'], ['new-subject', 'New Subject'], [`session-${ids.session}`, `Study · ${SESSION}`],
];
try {
  const file = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const wb = JSON.parse(file.workbench);
  const groupId = wb.editors?.groups?.[0]?.id ?? 'editor-group-1';
  const old = ([instanceId, name]) => ({
    typeId: OLD_TYPE, inputId: `${TOOL}:${OLD_TYPE}:${instanceId}`, pinned: true,
    data: { inputId: `${TOOL}:${OLD_TYPE}:${instanceId}`, instanceId, name, ownerToolId: TOOL },
  });
  wb.editors = { groups: [{ id: groupId, editors: OLD.map(old), activeEditorIndex: 2 }], activeGroupIndex: 0, activeGroupId: groupId };
  file.workbench = JSON.stringify(wb);
  await fs.writeFile(statePath, JSON.stringify(file, null, 2));
  seededOld = !!(ids.subject && ids.row && ids.plan && ids.session);
} catch (e) { console.log(`[seed] the saved state could not be written: ${e?.message ?? e}`); }
console.log(`[seed] older-build tabs (${OLD.map(([i]) => i).join(', ')}) written into the saved state, the unit's showing: ${seededOld}`);

const idIn = (a, id) => { const q = decodeURIComponent(String(a).split('?')[1] ?? ''); return new RegExp(`(?:^|[=&:,-])${String(id).replace(/[-]/g, '\\-')}(?:$|[&:,-])`, 'i').test(q); };

try {
  await launch();
  await ensureStudyOn();

  // ── R. The older build's tabs ──
  let s = await read();
  const r0 = s;
  console.log(`[restore] ${JSON.stringify({ st: r0.st, stIds: r0.stIds, active: r0.active })}`);
  const sessionBack = r0.st.filter((l) => l.includes(SESSION));
  check(`R1 the older build's saved session tab (session-${ids.session}) comes back as a tab of its own, named after the session ("${SESSION}")`, sessionBack.length === 1, r0.st, { guard: true });
  const kinds = await classifyStudyTabs();
  const placeTabs = kinds.filter((k) => k.place);
  check('R2 the older build\'s saved Study screens (home, progress, unit, plan, and new-plan/new-subject where they are places) come back as ONE Study place tab', seededOld && placeTabs.length === 1, { seededOld, kinds });
  if (placeTabs.length === 1) await pressTab(null, { id: placeTabs[0].id, ms: 2_200 });
  s = await read();
  check('R3 that place tab shows the unit that was showing: named for Mack, trail "Study › Seeded Subject › Mack", its address parallx://place/study/…', placeTabs.length === 1 && s.activeId === placeTabs[0].id && /Mack/.test(s.active ?? '') && trailIs(s, 'Mack', [SUBJECT]), { place: placeTabs[0] ?? null, ...short(s) });
  // Read at startup, and again once every Study tab was pressed (a restored tab's pane is drawn when it is first shown).
  const doubledOf = (list) => list.filter((l, i) => list.indexOf(l) !== i);
  check('R4 nothing comes back twice: no two Study tabs share a name (at startup, and after each was pressed), and at most the place tab, the session and New Plan / New Subject (if things) are open', doubledOf(r0.st).length === 0 && doubledOf(s.st).length === 0 && r0.st.length <= 4 && s.st.length <= 4, { atStart: r0.st, afterPressing: s.st });

  await closeAllEditors();

  // ── W. The walk down the column ──
  const walk = [
    { row: 'Home', place: 'Home', between: [] },
    { row: SUBJECT, place: SUBJECT, between: [] },
    { row: 'Progress', place: /Progress/, between: [SUBJECT] },
    { row: PLAN, place: /Plan/, between: [SUBJECT] },
    { row: 'Mack', place: 'Mack', between: [SUBJECT] },
    { row: 'Clark', place: 'Clark', between: [SUBJECT] },
    { row: 'Weak Spots', place: 'Weak Spots', between: [] },
    { row: 'Marked', place: 'Marked', between: [] },
  ];
  const addresses = {};
  for (const w of walk) {
    const pressed = await pressColumn(w.row, { ms: 2_600 });
    s = await read();
    addresses[w.row] = s.address;
    console.log(`[walk] ${w.row} pressed: ${pressed} → ${JSON.stringify(short(s))}`);
    check(`W1 ${w.row}: exactly one Study tab, in front, named for the place (${w.place}), with an icon`, pressed && onePlace(s, w.place instanceof RegExp ? w.place : new RegExp(w.place)) && s.activeIcon, { pressed, ...short(s), icon: s.activeIcon });
    check(`W2 ${w.row}: on that place, the page has the kit's title (h1.px-page-header__title) and no kit back link`, pressed && s.activeIsSt && (w.place instanceof RegExp ? w.place : new RegExp(w.place)).test(s.active ?? '') && s.title !== null && s.back === null, { pressed, active: s.active, title: s.title, back: s.back });
    check(`W3 ${w.row}: the trail under the tabs is "Study › ${w.between.map((b) => `${b} › `).join('')}${w.place instanceof RegExp ? '…' + w.place.source + '…' : w.place}", the last crumb the tab's name; the address parallx://place/study/…`, pressed && trailIs(s, w.place, w.between), s.crumbs);
    check(`W4 ${w.row}: the keys are on the page's kit title (h1, tabindex -1, in the editor)`, pressed && titleFocused(s), s.focus);
    const m = await markRight(w.row);
    check(`W5 ${w.row}: the column marks this row only, with the shared mark (aria-current="page" + px-current)`, pressed && m.ok, { ...m, oldMarks: (await read()).oldMarks });
    if (w.row === 'Mack') await screenshot(app, page, path.join(shots, 'w-unit-dark.png'));
    if (w.row === 'Weak Spots') await screenshot(app, page, path.join(shots, 'w-weak-spots-dark.png'));
    if (w.row === 'Marked') await screenshot(app, page, path.join(shots, 'w-marked-dark.png'));
    if (w.row === SUBJECT) await screenshot(app, page, path.join(shots, 'w-subject-dark.png'));
  }
  const addrList = walk.map((w) => addresses[w.row]).filter((a) => PLACE_ADDR.test(a));
  check('W6 every row walked has its own address (as many different parallx://place/study/… addresses as rows)', addrList.length === walk.length && new Set(addrList).size === walk.length, addresses);
  check(`P1 the unit's address carries its subject (${ids.subject}) and its row (${ids.row})`, PLACE_ADDR.test(addresses.Mack ?? '') && !!ids.row && decodeURIComponent(addresses.Mack).includes(ids.row) && idIn(addresses.Mack, ids.subject), addresses.Mack);
  check(`P2 Progress's address carries its subject (${ids.subject}); the Plan's its plan (${ids.plan})`, PLACE_ADDR.test(addresses.Progress ?? '') && idIn(addresses.Progress, ids.subject) && PLACE_ADDR.test(addresses[PLAN] ?? '') && idIn(addresses[PLAN], ids.plan), { progress: addresses.Progress, plan: addresses[PLAN] });

  // ── A. Twice in a row; after a switch away ──
  await closeAllEditors();
  await pressColumn('Mack'); s = await read(); const a0 = s;
  await pressColumn('Mack'); s = await read();
  check('A1 Mack pressed twice in a row: still one Study tab, the same tab, on Mack', onePlace(a0, /Mack/) && onePlace(s, /Mack/) && s.activeId === a0.activeId && trailIs(s, 'Mack', [SUBJECT]), { first: short(a0), second: short(s) });
  const notesPage = await runTool('canvas_create_page', { title: 'Probe Elsewhere', markdown: 'Another tab.' });
  await cmd(page, 'canvas.openPage', notesPage); await wait(2_000);
  const away = await read();
  await pressColumn('Progress', { ms: 2_400 });
  s = await read();
  check('A2 after switching to a page\'s tab, Progress pressed: the one Study tab comes forward (same tab id) on Progress; the page\'s tab stays', !away.activeIsSt && onePlace(s, /Progress/) && s.activeId === a0.activeId && s.labels.includes('Probe Elsewhere') && trailIs(s, /Progress/, [SUBJECT]), { away: away.active, after: short(s) });

  // ── B. Back and Forward across places in the same tab ──
  await closeAllEditors();
  await pressColumn('Home'); await pressColumn('Progress'); await pressColumn('Mack', { ms: 2_400 });
  s = await read();
  const bId = s.activeId;
  await key('Alt+ArrowLeft');
  let b1 = await read();
  check('B1 Home → Progress → Mack, Alt+Left: Progress, in the same tab (same tab id), still one Study tab', onePlace(b1, /Progress/) && b1.activeId === bId && trailIs(b1, /Progress/, [SUBJECT]), { before: bId, after: short(b1) });
  check('B2 after Back, the keys are on Progress\'s page title', /Progress/.test(b1.active ?? '') && titleFocused(b1), b1.focus);
  await key('Alt+ArrowLeft');
  b1 = await read();
  check('B3 Alt+Left again: Home, in the same tab, trail "Study › Home"', onePlace(b1, 'Home') && b1.activeId === bId && trailIs(b1, 'Home'), short(b1));
  const bm = await markRight('Home');
  check('B4 after Back the column\'s mark follows: only Home is marked', b1.active === 'Home' && bm.ok, bm);
  await key('Alt+ArrowRight');
  b1 = await read();
  check('B5 Alt+Right: Progress again, in the same tab', onePlace(b1, /Progress/) && b1.activeId === bId, short(b1));

  // ── C. The manifest's commands land in the one place tab ──
  await closeAllEditors();
  const commands = [
    ['study.open', [], 'Home', []], ['study.openProgress', [SUBJECT], /Progress/, [SUBJECT]], ['study.openUnit', [SUBJECT, 'Mack'], 'Mack', [SUBJECT]],
    ['study.openPlan', [SUBJECT], /Plan/, [SUBJECT]], ['study.openUnit', [SUBJECT, 'Clark'], 'Clark', [SUBJECT]], ['study.openHome', [], 'Home', []],
  ];
  let cId = null;
  for (const [id, args, place, between] of commands) {
    const done = await runCmd(id, args); await wait(2_400);
    s = await read();
    if (cId === null) cId = s.activeId;
    check(`C ${id}${args.length ? ` ${JSON.stringify(args)}` : ''}: lands in the one Study tab (same tab), on ${place}, trail from Study`, typeof done !== 'string' || !/^failed/.test(done) ? onePlace(s, place instanceof RegExp ? place : new RegExp(`^${place}$`)) && s.activeId === cId && trailIs(s, place, between) : false, { done, ...short(s) });
  }
  // study.weakSpots: its place in the one tab, or a session of its own; never a second place tab.
  const before = await read();
  const weakDone = await runCmd('study.weakSpots', [], 6_000); await wait(2_600);
  await page.keyboard.press('Escape').catch(() => {});
  s = await read();
  const weakOk = (onePlace(s, 'Weak Spots') && s.activeId === cId && trailIs(s, 'Weak Spots'))
    || (s.activeIsSt && s.activeId !== cId && s.st.length === before.st.length + 1 && !PLACE_ADDR.test(s.address));
  check('C study.weakSpots: Weak Spots in the one Study tab (trail "Study › Weak Spots"), or a session in a tab of its own', weakOk, { weakDone, before: short(before), after: short(s) });
  await closeAllEditors();
  await runCmd('study.openHome'); await wait(2_000);
  const before2 = await read();
  const markedDone = await runCmd('study.studyMarked', [], 6_000); await wait(2_600);
  s = await read();
  const markedOk = (onePlace(s, 'Marked') && s.activeId === before2.activeId && trailIs(s, 'Marked'))
    || (s.activeIsSt && s.activeId !== before2.activeId && s.st.length === before2.st.length + 1 && s.stIds.includes(before2.activeId));
  check('C study.studyMarked: Marked in the one Study tab, or a session in a tab of its own (the tab before stays)', markedOk, { markedDone, before: short(before2), after: short(s) }, { guard: true });

  // ── D. The tool's other screens: nothing opens twice, the place tab stays one ──
  const others = [
    ['New Plan (study.newPlan)', () => runCmd('study.newPlan', [SUBJECT], 4_000)],
    ['New Session setup (study.studySubject)', () => runCmd('study.studySubject', [SUBJECT], 4_000)],
    ['New Subject (study.newSubject)', () => runCmd('study.newSubject', [], 4_000)],
    ['Learn (the chat\'s study_session tool, mode learn)', () => runToolText('study_session', { material: 'Probe Notes', mode: 'learn' })],
  ];
  for (const [name, run] of others) {
    await closeAllEditors();
    await runCmd('study.openHome'); await wait(2_200);
    const d0 = await read();
    const r1 = await run(); await wait(2_600);
    const d1 = await read();
    const r2 = await run(); await wait(2_600);
    const d2 = await read();
    const k = await classifyStudyTabs();
    const placesNow = k.filter((x) => x.place).length;
    check(`D ${name}, run twice from Home: Study in front, no tab more after the second run, and exactly ONE Study place tab`, onePlace(d0, 'Home') && d1.activeIsSt && d2.activeIsSt && d2.count === d1.count && d1.count <= d0.count + 1 && placesNow === 1, { r1: String(r1).slice(0, 80), r2: String(r2).slice(0, 80), d0: d0.st, d1: d1.st, d2: d2.st, kinds: k });
    await page.keyboard.press('Escape').catch(() => {});
  }
  // The app Home's Study card, "Start Session" (on the seeded plan's day).
  await closeAllEditors();
  await runCmd('study.openHome'); await wait(2_000);
  await cmd(page, 'home.open'); await wait(2_400);
  const h0 = await read();
  const started1 = await pressInPage('Start Session', { ms: 3_000 });
  const h1 = await read();
  await cmd(page, 'home.open'); await wait(2_000);
  const started2 = await pressInPage('Start Session', { ms: 3_000 });
  const h2 = await read();
  const hk = await classifyStudyTabs();
  check('D the app Home\'s Study card, "Start Session" pressed twice: Study in front, nothing opened twice, exactly ONE Study place tab', started1 && started2 && h1.activeIsSt && h2.activeIsSt && h2.count === h1.count && h1.count <= h0.count + 1 && hk.filter((x) => x.place).length === 1, { started1, started2, h0: h0.labels, h1: h1.labels, h2: h2.labels, kinds: hk });

  // ── L. Links in a page: a unit's address, the session's and the concept's deep links ──
  await closeAllEditors();
  const results = await runToolText('study_results', { sessionId: ids.session });
  const sessionLink = (/parallx:\/\/study\/session\/\d+/.exec(results) || [])[0] ?? `parallx://study/session/${ids.session}`;
  const conceptLink = `parallx://study/concept/${ids.concept}`;
  const unitAddress = PLACE_ADDR.test(addresses.Mack ?? '') ? addresses.Mack : '';
  const md = [`See [the unit](${unitAddress || 'parallx://place/study/none'}).`, `See [the drill](${sessionLink}).`, `See [the concept](${conceptLink}).`].join('\n\n');
  const linkPage = await runTool('canvas_create_page', { title: 'Probe Study Links', markdown: md });
  console.log(`[seed] study_results gave ${sessionLink}; a page with links ${unitAddress || '(no unit address read)'}, ${sessionLink}, ${conceptLink}: ${linkPage}`);
  const hasPage = !!linkPage && !/^no /.test(linkPage);
  async function clickLink(href) {
    if (!hasPage) return false;
    await cmd(page, 'canvas.openPage', linkPage); await wait(2_000);
    const at = await page.evaluate((href) => { const a = [...document.querySelectorAll('[data-px-surface="canvas"] a')].find((x) => x.getClientRects().length && x.getAttribute('href') === href); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, href);
    if (!at) return false;
    await page.mouse.click(at.x, at.y); await wait(2_800);
    return true;
  }
  await runCmd('study.openHome'); await wait(2_000);
  const l0 = await read();
  let clicked = unitAddress ? await clickLink(unitAddress) : false;
  let l1 = await read();
  check('L1 the unit\'s address, clicked as a link in a page: Mack in the one Study tab (the tab that was on Home)', clicked && onePlace(l1, /Mack/) && l1.activeId === l0.activeId && trailIs(l1, 'Mack', [SUBJECT]), { clicked, unitAddress, before: short(l0), after: short(l1) });
  clicked = await clickLink(sessionLink);
  l1 = await read();
  check(`L2 the deep link ${sessionLink} (from the chat's study_results), clicked in a page: the session in a tab of its own, named after it; the one place tab stays`, clicked && l1.activeIsSt && (l1.active ?? '').includes(SESSION) && l1.stIds.includes(l0.activeId) && l1.st.length === 2, { clicked, after: short(l1) }, { guard: true });
  clicked = await clickLink(conceptLink);
  l1 = await read();
  const l2c = await clickLink(conceptLink);
  const l2 = await read();
  const lk = await classifyStudyTabs();
  check(`L3 the deep link ${conceptLink}, clicked twice in a page: Study in front, nothing opened twice, exactly ONE Study place tab`, ids.concept > 0 && clicked && l2c && l1.activeIsSt && l2.activeIsSt && l2.count === l1.count && lk.filter((x) => x.place).length === 1, { concept: ids.concept, after: short(l2), kinds: lk });

  // ── T. A session is a thing ──
  await closeAllEditors();
  await runCmd('study.openHome'); await wait(2_000);
  const t0 = await read();
  const sessPressed = await pressColumn(SESSION, { contains: true, ms: 3_000 });
  let t1 = await read();
  check(`T1 the session's row in the column: a tab of its own, named after the session ("${SESSION}"); the tab that was in front stays`, sessPressed && t1.activeIsSt && (t1.active ?? '').includes(SESSION) && t1.activeId !== t0.activeId && t1.stIds.includes(t0.activeId), { sessPressed, before: short(t0), after: short(t1) }, { guard: true });
  const sessId = t1.activeId;
  const reviewed = await pressInPage('Review Answers', { ms: 2_400 });
  const t2 = await read();
  const backed = await pressInPage('', { sel: '[data-px-id="study.close"], button[aria-label="Back to Results"], button[title="Back to Results"]', ms: 2_400 });
  const t3 = await read();
  check('T2 the finished session\'s Results → Review Answers → Back to Results: all inside that one tab (same tab id, no tab more)', reviewed && backed && t2.activeId === sessId && t3.activeId === sessId && t3.count === t1.count && t2.count === t1.count, { reviewed, backed, t1: t1.labels, t2: t2.labels, t3: t3.labels }, { guard: true });

  // ── O. Ctrl+click and Open in Its Own Tab ──
  await closeAllEditors();
  await pressColumn('Progress', { ms: 2_200 });
  const o0 = await read();
  const ctrl = await pressColumn('Progress', { ctrl: true, ms: 2_400 });
  const o1 = await read();
  check('O1 on Progress, Ctrl+click on Progress in the column: a second Study tab, both on Progress, the new one in front', onePlace(o0, /Progress/) && ctrl && o1.st.length === 2 && o1.st.every((l) => /Progress/.test(l)) && o1.activeId !== o0.activeId && trailIs(o1, /Progress/, [SUBJECT]), { before: short(o0), ctrl, after: short(o1) });
  await pressTab(null, { right: true, ms: 800 });
  const tabMenu = await menuItems();
  const picked = await pickMenuItem('Open in Its Own Tab');
  const o2 = await read();
  check('O2 the Study tab\'s menu has "Open in Its Own Tab": one more tab on Progress', tabMenu.includes('Open in Its Own Tab') && picked && o2.st.length === o1.st.length + 1 && o2.st.every((l) => /Progress/.test(l)), { tabMenu, after: short(o2) });

  // ── Light and dark, the unit place ──
  await closeAllEditors();
  await pressColumn('Mack', { ms: 2_400 });
  await screenshot(app, page, path.join(shots, 'unit-dark.png'));
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
  await wait(700);
  await screenshot(app, page, path.join(shots, 'unit-light.png'));
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'dark'));

  // ── N. Nothing another tool owns changes ──
  await closeAllEditors();
  await cmd(page, 'worksheet.bank'); await wait(2_400);
  s = await read();
  check('N1 Worksheets\' Problem Bank: its own tab, "Problem Bank", trail "Worksheets › Problem Bank", a place address', s.active === 'Problem Bank' && s.crumbs[0]?.label === 'Worksheets' && last(s) === 'Problem Bank' && /^parallx:\/\/place\/worksheet\//.test(s.address) && !s.activeIsSt, short(s), { guard: true });

  // ── S. After the app is closed and opened ──
  await closeAllEditors();
  await pressColumn('Home', { ms: 2_000 });
  await pressColumn('Mack', { ms: 2_400 });
  const s0 = await read();
  await wait(1_500);
  await app.close(); app = null;
  await launch();
  s = await read();
  const back1 = s.st.length === 1 ? s.st[0] : null;
  if (back1) await pressTab(back1, { ms: 2_600 });
  s = await read();
  check('S1 Home then Mack in the one tab, the app closed and opened: one Study tab comes back, on Mack, trail "Study › Seeded Subject › Mack"', onePlace(s0, /Mack/) && onePlace(s, /Mack/) && trailIs(s, 'Mack', [SUBJECT]), { before: short(s0), after: short(s) });

  // ── X. Turned off and on ──
  await ensureStudyOn();
  await runCmd('study.openHome'); await wait(2_200);
  await pressColumn(SESSION, { contains: true, ms: 2_400 });
  const off = await setToolEnabled(page, TOOL, false); await wait(2_500);
  const x0 = await read();
  const cmdGone = !(await hasCommand('study.openHome'));
  check('X1 Study turned off: no Study tab (place or thing), no Study column, its commands gone', off === true && x0.st.length === 0 && !x0.column && cmdGone, { off, st: x0.st, column: x0.column, cmdGone }, { guard: true });
  const on = await setToolEnabled(page, TOOL, true); await wait(4_000);
  await runCmd('study.openHome'); await wait(2_400);
  await runCmd('study.openProgress', [SUBJECT]); await wait(2_400);
  const x1 = await read();
  check('X2 turned on again, openHome then openProgress: one Study tab, on Progress, trail "Study › Seeded Subject › …Progress"', on === true && onePlace(x1, /Progress/) && trailIs(x1, /Progress/, [SUBJECT]), { on, ...short(x1) });
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
