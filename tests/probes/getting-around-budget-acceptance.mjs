// getting-around-budget-acceptance.mjs — @acceptance for "Getting around",
// piece 8, Budget (ext/budget, extension parallx.budget) onto the core's places
// point (docs/MASTER_LIST.md, "Getting around: one way to move in every tool",
// "The order of work" item 8; his picks 1A, 2A, 3A and the rules every tab
// follows; the table's Budget row: places Overview, Review, Plan, Net Worth and
// Goals, Merchants and Rules, Categories, Transactions; things none).
//
// Written from the request before the build, by a verifier who is not the
// builder. The builder does not edit this file. Every line not marked [guard]
// failed on the app as it was when it was written (dev at 96ef397a); the lines
// marked [guard] passed then and must keep passing.
//
// The builder's calls, tested as the spec:
//   place ids and tab names: overview "Overview", review "Review", transactions
//   "Transactions", plan (named for its view), worth "Net Worth and Goals",
//   rules "Merchants and Rules", categories "Categories", sync-log "Sync Log",
//   import-export "Import / Export" (the last two have no column row: none is
//   marked on them). Plan's views are a parameter: /plan (Limits, no view
//   param), /plan?view=bills|trends|reconcile; the trail always names the view
//   (Budget › Plan › Limits) and the tab is named for it ("Limits", "Bills").
//   Transactions' filters ride in its address (view, month, category, account,
//   day, q, only, ai); Overview's and Plan Limits' month, Reconcile's account.
//   A way in that names none (column row, command) opens Transactions with no
//   filters. Forms (Add Transaction…, Add Asset or Debt…, Add Goal…, a row
//   opened for editing) are popovers over the place, not tabs, not in the
//   address; closed, the keys go back to what opened them (or the same control
//   drawn again, else the page title), not to nothing. The one tab's editor type
//   becomes budget.place (instance main); older budget.editor tabs come back
//   through the core's formerTabs.
//
// What it holds the piece to:
//   R. Budget tabs an older build saved come back as their place, in ONE tab:
//      budget.editor/budget:main → Overview; budget:dashboard → Overview,
//      budget:transactions → Transactions, budget:recurring → Plan › Bills,
//      budget:goals → Net Worth and Goals, budget:reviewQueue → Review; five of
//      them in one group → one Budget tab, on the one that was showing (Bills).
//   W. Each column row (Overview, Review, Transactions, Plan, Net Worth and
//      Goals, Merchants and Rules, Categories) pressed: one Budget tab, named for
//      the place, with Budget's icon (px-budget); the trail "Budget › <place>"
//      (Plan: "Budget › Plan › Limits"); its own address; the column's shared
//      mark on that row only; the kit's title [guard] and its header actions
//      [guard]; by Enter, the keys on the title.
//   C. Every way in by command (the manifest's open commands, the palette-only
//      aliases, budget.importCsv): its place, in the one tab, the keys on the
//      title, the column's mark following.
//   M. The ⋯ menu [guard for its items]: Sync Log and Import / Export as places
//      in the one tab, no row marked, the back link budget.back gone, every
//      crumb before the last going there in the same tab; Budget Settings opens
//      Settings as a dialog [guard].
//   P. Plan's views: the segmented control records the address and trail
//      without moving the keys, each choice a step of Back; the Plan crumb goes
//      to Limits; the column marks Plan on every view; Limits' month and
//      Reconcile's account in the address.
//   T. Transactions' filters in the address, both ways: changed on the page
//      (chip, month, search; the keys stay), and an address with them opening
//      with them; a way in naming none opens it unfiltered. Overview's month.
//   F. The forms are popovers over the place (tab, trail, address unchanged);
//      closed, the keys go back to what opened them.
//   B. Alt+Left / Alt+Right step between Budget's places in the one tab.
//   L. Links in a page: a place's address, parallx://budget/account/<id> (Net
//      Worth and Goals), parallx://budget/transaction/<id> (Transactions).
//   D. The dashboard widget's card: Overview in the one tab.
//   A. Twice in a row; after a switch away.
//   O. Ctrl+click on a row, the row's menu, the tab's menu: Open in Its Own Tab.
//   S. After the app is closed and opened, the one tab comes back at its place.
//   X. Turned off: no Budget tab or column, its commands gone [guard], its
//      place address opens nothing; on again, a command lands in the one tab.
//   G. [guards] the column's seven rows; no page errors.
// Screenshots (shots/) of Overview, Transactions, Plan › Bills and Sync Log,
// dark and light, are for a person to look at, not judged here.
// Not checked (said in the reply): the Transactions parameters category, day,
// only and ai=1 (view, month, q and account are); Budget has no Home card or
// feed entries (none in its code at 96ef397a), so none is demanded.
//
// Run against a build (default: this checkout; PARALLX_PROBE_BUILD names another
// built tree, e.g. a worktree at an older commit, its ext/ used with it):
//   node scripts/build.mjs && xvfb-run -a node tests/probes/getting-around-budget-acceptance.mjs [outDir]
//   PARALLX_PROBE_BUILD=/path/to/built/tree xvfb-run -a node tests/probes/getting-around-budget-acceptance.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { PROJECT_ROOT, launchEnv, cmd, screenshot, toolList, setToolEnabled } from './scene.mjs';

const BUILD = process.env.PARALLX_PROBE_BUILD ? path.resolve(process.env.PARALLX_PROBE_BUILD) : PROJECT_ROOT;
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-getting-around-budget');
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(BUILD, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }
console.log(`[probe] build: ${BUILD}`);

let passed = 0; const failed = []; const guards = [];
const check = (name, ok, got, { guard = false } = {}) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${guard ? '[guard] ' : ''}${name}${ok ? '' : `: ${JSON.stringify(got)}`}`);
  if (guard) guards.push(name.split(' ')[0]);
  if (ok) passed += 1; else failed.push(name);
};

const TOOL = 'parallx.budget';
const OLD_TYPE = 'budget.editor';
const COLUMN = '.view[data-view-id="budget.nav"]';
/** Budget's own icon (px-budget in its manifest): its pen stroke. */
const BUDGET_ICON_MARK = 'M7.5 17';
const ROWS = ['Overview', 'Review', 'Transactions', 'Plan', 'Net Worth and Goals', 'Merchants and Rules', 'Categories'];
/** Each place: its id in the address, its tab name, its trail after "Budget", the column row it marks (null: none). */
const P = {
  overview: { place: 'overview', tab: 'Overview', trail: ['Overview'], row: 'Overview' },
  review: { place: 'review', tab: 'Review', trail: ['Review'], row: 'Review' },
  transactions: { place: 'transactions', tab: 'Transactions', trail: ['Transactions'], row: 'Transactions' },
  limits: { place: 'plan', view: null, tab: 'Limits', trail: ['Plan', 'Limits'], row: 'Plan' },
  bills: { place: 'plan', view: 'bills', tab: 'Bills', trail: ['Plan', 'Bills'], row: 'Plan' },
  trends: { place: 'plan', view: 'trends', tab: 'Trends', trail: ['Plan', 'Trends'], row: 'Plan' },
  reconcile: { place: 'plan', view: 'reconcile', tab: 'Reconcile', trail: ['Plan', 'Reconcile'], row: 'Plan' },
  worth: { place: 'worth', tab: 'Net Worth and Goals', trail: ['Net Worth and Goals'], row: 'Net Worth and Goals' },
  rules: { place: 'rules', tab: 'Merchants and Rules', trail: ['Merchants and Rules'], row: 'Merchants and Rules' },
  categories: { place: 'categories', tab: 'Categories', trail: ['Categories'], row: 'Categories' },
  syncLog: { place: 'sync-log', tab: 'Sync Log', trail: ['Sync Log'], row: null },
  importExport: { place: 'import-export', tab: 'Import / Export', trail: ['Import / Export'], row: null },
};
const ROW_PLACE = { Overview: P.overview, Review: P.review, Transactions: P.transactions, Plan: P.limits, 'Net Worth and Goals': P.worth, 'Merchants and Rules': P.rules, Categories: P.categories };
const ACCT_A = { last4: '4242', name: 'Probe Checking' }; const ACCT_B = { last4: '5151', name: 'Probe Card' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

/** The parts of a place address: its tool, place and query. */
function parseAddr(a) {
  const m = /^parallx:\/\/place\/([^/?#]+)\/([^?#]*)(?:\?([^#]*))?$/i.exec(String(a ?? ''));
  if (!m) return null;
  return { tool: m[1], place: m[2], params: Object.fromEntries(new URLSearchParams(m[3] ?? '')) };
}
/** "November 2026" → "2026-11"; the month key one step from it. */
const keyOfLabel = (label) => { const m = new RegExp(`(${MONTHS.join('|')})\\s+(\\d{4})`).exec(label ?? ''); return m ? `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}` : null; };
const shiftKey = (k, n) => { const y = Number(k.slice(0, 4)); const m0 = Number(k.slice(5, 7)) - 1 + n; const d = new Date(Date.UTC(y, m0, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const labelOfKey = (k) => (k ? `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` : '');

let app; let page; let errors = [];
const allErrors = [];
const wait = (ms) => page.waitForTimeout(ms);

async function launch() {
  errors = [];
  app = await electron.launch({ args: ['.', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'], cwd: BUILD, env: launchEnv(appRoot) });
  await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, (route) => route.abort('connectionrefused'));
  page = await app.firstWindow();
  page.on('pageerror', (e) => { const t = `pageerror: ${String(e).slice(0, 400)}`; errors.push(t); allErrors.push(t); });
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED/.test(m.text())) { const t = `console: ${m.text().slice(0, 400)}`; errors.push(t); allErrors.push(t); } });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await wait(2_500);
}
async function ensureOn() {
  const t = (await toolList(page)).find((x) => x.id === TOOL);
  if (t && !t.enabled) { await setToolEnabled(page, TOOL, true); await wait(4_000); }
  return (await toolList(page)).find((x) => x.id === TOOL)?.enabled === true;
}

/** What a person sees: the tabs, the trail under them, the page, Budget's column, the focus. */
const read = () => page.evaluate(({ TOOL, COLUMN, BUDGET_ICON_MARK }) => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const tabs = [...document.querySelectorAll('.editor-group .ui-tab')].filter((t) => !t.classList.contains('ui-tab--leaving') && vis(t) && !t.closest('.editor-pane-container')).map((t) => {
    const icon = t.querySelector('.ui-tab-icon');
    return {
      id: t.dataset.tabId ?? '', label: (t.querySelector('.ui-tab-label')?.textContent ?? '').trim(), active: t.classList.contains('ui-tab--active'),
      budgetIcon: !!icon && vis(icon) && (icon.innerHTML ?? '').includes(BUDGET_ICON_MARK),
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
  const inPane = (sel) => [...(panes?.querySelectorAll(sel) ?? [])].filter(vis);
  const title = inPane('.px-page-header__title')[0];
  const back = inPane('.px-page-header__back, [data-px-id="budget.back"]')[0];
  const headerActions = inPane('.px-page-header__actions button').map((b) => ((b.querySelector('.px-btn__label')?.textContent) || b.getAttribute('aria-label') || '').trim());
  const view = document.querySelector(COLUMN);
  const nameOf = (e) => ((e.querySelector('.budget-label, .px-btn__label')?.textContent) || e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').replace(/\s*\d+$/, '').trim();
  const marked = view && vis(view) ? [...view.querySelectorAll('[aria-current="page"]')].filter(vis).map((e) => ({ name: nameOf(e), pxCurrent: e.classList.contains('px-current') })) : null;
  const rowNames = view && vis(view) ? [...view.querySelectorAll('a, button, [role="link"], [role="button"], [role="option"]')].filter(vis).map(nameOf) : null;
  // A Budget form over the page (a drawer or a popover), wherever drawn.
  const formSel = '[data-px-surface="budget.txEditor"], [data-px-surface="budget.holdingEditor"], [data-px-surface="budget.goalEditor"], .budget-drawer';
  const formTitles = /^(Add Transaction|Edit Transaction|Add Asset or Debt|Edit Asset or Debt|Add Goal|Edit Goal)$/;
  const formEls = [...document.querySelectorAll(formSel), ...[...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter((d) => [...d.querySelectorAll('h1, h2, h3, [class*="title"]')].some((h) => formTitles.test((h.textContent ?? '').trim())))].filter(vis);
  const forms = formEls.filter((f, i) => !formEls.some((g, j) => j !== i && g !== f && g.contains(f))).filter((f, i, a) => a.indexOf(f) === i).map((f) => ([...f.querySelectorAll('h1, h2, h3, [class*="title"]')].map((h) => (h.textContent ?? '').trim()).find((t) => formTitles.test(t)) ?? ''));
  const dialog = [...document.querySelectorAll('[aria-modal="true"], [role="dialog"]')].filter(vis).map((d) => (d.getAttribute('aria-label') || d.textContent || '').trim().slice(0, 40));
  const pressedChips = inPane('[data-px-id^="budget.tx.view."]').filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.getAttribute('data-px-id').slice('budget.tx.view.'.length));
  const monthLabel = (inPane('.budget-ov-month-label')[0]?.textContent ?? '').trim();
  const search = inPane('[data-px-id="budget.tx.search"]')[0];
  const txAccount = (inPane('[data-px-id="budget.tx.account"]')[0]?.textContent ?? '').trim();
  const planView = inPane('[data-px-id="budget.plan.view"] [role="radio"][aria-checked="true"]').map((b) => (b.textContent ?? '').trim())[0] ?? null;
  const planDd = inPane('.budget-plan-view .budget-dd').map((d) => (d.textContent ?? '').trim());
  const ae = document.activeElement;
  const bud = tabs.filter((t) => t.id.startsWith(`${TOOL}:`));
  return {
    count: tabs.length, labels: tabs.map((t) => t.label), active: act?.label ?? null, activeId: act?.id ?? null, activeBudgetIcon: act?.budgetIcon ?? false,
    activeIsBudget: !!act && act.id.startsWith(`${TOOL}:`),
    budget: bud.map((t) => t.label), budgetIds: bud.map((t) => t.id),
    crumbs, address: crumbs.length ? crumbs[crumbs.length - 1].address : '',
    title: title ? (title.textContent ?? '').trim() : null, back: back ? (back.textContent ?? '').trim() || '(a back link)' : null, headerActions,
    column: !!view && vis(view), marked, rowNames, forms, dialog,
    pressedChips, monthLabel, search: search ? search.value : null, txAccount, planView, planDd,
    focus: ae ? {
      tag: ae.tagName, cls: String(ae.className ?? ''), tabindex: ae.getAttribute('tabindex'), pxid: ae.getAttribute('data-px-id') ?? ae.closest('[data-px-id]')?.getAttribute('data-px-id') ?? null,
      text: (ae.textContent ?? '').trim().slice(0, 50), inEditor: !!panes?.contains(ae), inPlanView: !!ae.closest?.('[data-px-id="budget.plan.view"]'),
    } : null,
  };
}, { TOOL, COLUMN, BUDGET_ICON_MARK });
const titleFocused = (s) => !!s.focus && s.focus.tag === 'H1' && /\bpx-page-header__title\b/.test(s.focus.cls) && s.focus.inEditor;
const onBody = (s) => !s.focus || s.focus.tag === 'BODY';
const short = (s) => ({ active: s.active, activeId: s.activeId, budget: s.budget, crumbs: s.crumbs.map((c) => c.label), address: s.address, title: s.title });
/** On this place, in exactly one Budget tab in front: its name, Budget's icon, the trail "Budget › …", the address. */
function atPlace(s, p, { params = {}, noParams = [] } = {}) {
  if (!(s.budget.length === 1 && s.activeIsBudget && s.active === p.tab && s.activeBudgetIcon)) return false;
  const want = ['Budget', ...p.trail];
  if (s.crumbs.length !== want.length || s.crumbs.some((c, i) => c.label !== want[i]) || !s.crumbs[0].icon) return false;
  const a = parseAddr(s.address);
  if (!a || a.tool !== 'budget' || a.place !== p.place) return false;
  if (p.view === null && a.params.view !== undefined) return false;
  if (p.view && a.params.view !== p.view) return false;
  for (const [k, v] of Object.entries(params)) if (a.params[k] !== String(v)) return false;
  for (const k of noParams) if (a.params[k] !== undefined) return false;
  return true;
}
/** The same, allowing more than one Budget tab (the one in front is checked). */
const atPlaceAny = (s, p) => atPlace({ ...s, budget: [s.active] }, p);

const centre = (sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
async function showColumn() {
  const shown = await page.evaluate((COLUMN) => { const v = document.querySelector(COLUMN); return !!v && v.getClientRects().length > 0; }, COLUMN);
  if (shown) return true;
  const at = await centre('.activity-bar-item[data-icon-id="budget-container"]');
  if (at) { await page.mouse.click(at.x, at.y); await wait(1_400); }
  return page.evaluate((COLUMN) => { const v = document.querySelector(COLUMN); return !!v && v.getClientRects().length > 0; }, COLUMN);
}
/** A column row named exactly `label`: its centre (scrolled into view), or null. With `focus`, it is given the keys. */
async function rowAt(label, { focus = false } = {}) {
  await showColumn();
  return page.evaluate(({ label, COLUMN, focus }) => {
    const view = document.querySelector(COLUMN);
    if (!view) return null;
    const nameOf = (e) => ((e.querySelector('.budget-label, .px-btn__label')?.textContent) || e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').replace(/\s*\d+$/, '').trim();
    const e = [...view.querySelectorAll('a, button, [role="link"], [role="button"], [role="option"]')].find((x) => x.getClientRects().length && nameOf(x) === label);
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    if (focus) e.focus();
    const r = e.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2, focused: document.activeElement === e };
  }, { label, COLUMN, focus });
}
async function pressRow(label, { ctrl = false, right = false, ms = 2_200 } = {}) {
  const at = await rowAt(label);
  if (!at) return false;
  if (ctrl) await page.keyboard.down('Control');
  await page.mouse.click(at.x, at.y, { button: right ? 'right' : 'left' });
  if (ctrl) await page.keyboard.up('Control');
  await wait(ms);
  return true;
}
/** The row given the keys, then Enter. */
async function enterRow(label, { ms = 2_200 } = {}) {
  const at = await rowAt(label, { focus: true });
  if (!at?.focused) return false;
  await page.keyboard.press('Enter'); await wait(ms);
  return true;
}
/** A visible control in the active editor: by data-px-id (exact), or whose text starts with `text`. Pressed by the mouse. */
async function pressInPage({ id = null, text = null }, { ms = 1_800 } = {}) {
  const at = await page.evaluate(({ id, text }) => {
    const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => t.getClientRects().length && !t.closest('.editor-pane-container'));
    const panes = act?.closest('.editor-group')?.querySelector('.editor-pane-container');
    const nm = (x) => (x.textContent ?? '').replace(/\s+/g, ' ').trim() || (x.getAttribute('aria-label') ?? '');
    const all = [...(panes?.querySelectorAll(id ? `[data-px-id="${id}"]` : 'button, [role="button"], [role="radio"]') ?? [])];
    const e = all.find((x) => x.getClientRects().length && !x.disabled && (id ? true : nm(x).startsWith(text)));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { id, text });
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
}
/** A Plan view chosen on the segmented control by the mouse. */
const pressPlanView = async (label, ms = 2_000) => {
  const at = await page.evaluate((label) => {
    const b = [...document.querySelectorAll('.editor-pane-container [data-px-id="budget.plan.view"] [role="radio"]')].find((x) => x.getClientRects().length && (x.textContent ?? '').trim() === label);
    if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
};
/** The tab with this id, or the active one, by the mouse. */
async function pressTab({ id = null, right = false, ms = 1_400 } = {}) {
  const at = await page.evaluate(({ id }) => {
    const t = [...document.querySelectorAll('.editor-group .ui-tab')].filter((x) => x.getClientRects().length && !x.closest('.editor-pane-container') && !x.classList.contains('ui-tab--leaving') && (id !== null ? x.dataset.tabId === id : x.classList.contains('ui-tab--active'))).pop();
    if (!t) return null; const l = (t.querySelector('.ui-tab-label') ?? t).getBoundingClientRect(); return { x: l.x + Math.min(20, l.width / 2), y: l.y + l.height / 2 };
  }, { id });
  if (!at) return false;
  await page.mouse.click(at.x, at.y, { button: right ? 'right' : 'left' });
  await wait(ms);
  return true;
}
/** A crumb of the trail under the tabs, by index, by the mouse. */
async function pressCrumb(index, { ms = 2_200 } = {}) {
  const at = await page.evaluate((index) => {
    const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => t.getClientRects().length && !t.closest('.editor-pane-container'));
    const ribbon = act?.closest('.editor-group')?.querySelector('.editor-ribbon');
    const c = [...(ribbon?.querySelectorAll('.parallx-breadcrumb-item') ?? [])].filter((x) => x.getClientRects().length)[index];
    if (!c) return null; const r = (c.querySelector('.breadcrumb-label, [class*="label"]') ?? c).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, index);
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
}
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.context-menu')].filter((m) => m.getClientRects().length).flatMap((m) => [...m.querySelectorAll('.context-menu-item')].map((r) => (r.querySelector('.context-menu-item-label')?.textContent ?? r.textContent ?? '').trim())));
async function pickMenuItem(text, ms = 2_200) {
  const at = await page.evaluate((text) => {
    const r = [...document.querySelectorAll('.context-menu .context-menu-item')].filter((x) => x.getClientRects().length).find((x) => ((x.querySelector('.context-menu-item-label')?.textContent ?? x.textContent ?? '').trim()) === text);
    if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, text);
  if (!at) { await page.keyboard.press('Escape'); await wait(300); return false; }
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
}
/** The page header's ⋯ (More Actions): its items, and one picked. */
async function moreMenu(item = null) {
  const opened = await pressInPage({ id: 'pageHeader.more' }, { ms: 700 });
  const items = opened ? await menuItems() : [];
  if (!item) { await page.keyboard.press('Escape'); await wait(300); return { opened, items, picked: false }; }
  const picked = opened ? await pickMenuItem(item) : false;
  return { opened, items, picked };
}
async function closeAllEditors() {
  for (let i = 0; i < 40 && (await read()).count > 0; i++) { await cmd(page, 'workbench.action.closeActiveEditor'); await wait(250); }
  await page.keyboard.press('Escape').catch(() => {});
  await wait(500);
}
const key = async (k, ms = 2_200) => { await page.keyboard.press(k); await wait(ms); };
const runToolText = (name, args) => page.evaluate(async ({ name, args }) => {
  const tools = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' });
  const t = tools.getTool(name); if (!t) return `no tool ${name}`;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  try { return String((await t.handler(args, token))?.content ?? ''); } catch (e) { return `failed: ${String(e?.message || e).slice(0, 160)}`; }
}, { name, args });
const runTool = async (name, args) => { const out = await runToolText(name, args); return (/id: ([0-9a-f-]{20,})/i.exec(out) || [])[1] ?? `no id: ${out.slice(0, 160)}`; };
/** Runs a command and returns what it returned; does not wait longer than `cap` ms for it. */
const runCmd = (id, args = [], cap = 8_000) => page.evaluate(async ({ id, args, cap }) => {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
  try { return await Promise.race([svc.executeCommand(id, ...args), new Promise((r) => setTimeout(() => r('(still running)'), cap))]); } catch (e) { return `failed: ${String(e?.message || e).slice(0, 160)}`; }
}, { id, args, cap });
const hasCommand = (id) => page.evaluate((id) => !!window.__parallx_workbench__._services.get({ id: 'ICommandService' }).hasCommand?.(id), id);
/** The column's mark: exactly the row `label` (aria-current="page" + px-current); with null, no row marked. */
async function markIs(label) {
  const shown = await showColumn();
  const s = await read();
  const m = s.marked ?? [];
  const ok = shown && (label === null ? m.length === 0 : m.length === 1 && m[0].name === label && m[0].pxCurrent);
  return { ok, shown, marked: m };
}
async function makeLinkPage(title, hrefs) {
  const md = hrefs.map((h, i) => `See [link ${i + 1}](${h}).`).join('\n\n');
  return runTool('canvas_create_page', { title, markdown: md });
}
async function clickLink(pageId, href) {
  if (!pageId || /^no /.test(pageId)) return false;
  await cmd(page, 'canvas.openPage', pageId); await wait(2_000);
  const at = await page.evaluate((href) => { const a = [...document.querySelectorAll('[data-px-surface="canvas"] a')].find((x) => x.getClientRects().length && x.getAttribute('href') === href); if (!a) return null; a.scrollIntoView({ block: 'nearest' }); const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, href);
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(2_800);
  return true;
}
/** Each crumb before the last pressed: the same tab goes to that crumb's address; Alt+Left comes back. */
async function crumbsGoThere() {
  const s0 = await read();
  const out = [];
  for (let i = 0; i < s0.crumbs.length - 1; i++) {
    const want = s0.crumbs[i].address;
    const pressed = await pressCrumb(i);
    const s = await read();
    out.push({ crumb: s0.crumbs[i].label, want, pressed, got: s.address, sameTab: s.activeId === s0.activeId, one: s.budget.length === 1, title: titleFocused(s) });
    await key('Alt+ArrowLeft');
  }
  const ok = s0.crumbs.length >= 2 && out.every((o) => o.pressed && !!parseAddr(o.want) && o.got === o.want && o.sameTab && o.one && o.title);
  return { ok, out };
}

// SQL on Budget's own database, with the app closed (better-sqlite3 under Electron's node).
const sqlScript = path.join(root, 'sql.cjs');
await fs.writeFile(sqlScript, `
const Database = require(${JSON.stringify(path.join(PROJECT_ROOT, 'node_modules', 'better-sqlite3'))});
const db = new Database(process.argv[2], { readonly: true });
const out = [];
for (const s of JSON.parse(process.argv[3])) out.push(db.prepare(s.sql).all(...(s.args || [])));
db.close();
console.log(JSON.stringify(out));
`);
function sql(dbPath, statements) {
  const r = spawnSync(ELECTRON, [sqlScript, dbPath, JSON.stringify(statements)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`sql: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
}
async function budgetDb() {
  const dir = path.join(ws, '.parallx', 'extensions');
  for (const n of ['budget', TOOL, ...(await fs.readdir(dir).catch(() => [])).filter((x) => /budget/i.test(x))]) {
    const p = path.join(dir, n, 'data.db');
    try { await fs.access(p); return p; } catch { /* next */ }
  }
  return null;
}

// ── Run 1: Budget on; a CSV pasted into Import / Export and imported (two accounts, this month and the one before) ──
await launch();
const onFirst = await ensureOn();
const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
const prevMonthDay = `${shiftKey(today.slice(0, 7), -1)}-15`;
const csv = [
  'date,merchant,amount,type,account,last_four',
  `${today},Probe Grocer,42.50,purchase,${ACCT_A.name},${ACCT_A.last4}`,
  `${today},Probe Cafe,6.25,purchase,${ACCT_B.name},${ACCT_B.last4}`,
  `${prevMonthDay},Probe Hardware,88.00,purchase,${ACCT_A.name},${ACCT_A.last4}`,
].join('\n');
await runCmd('budget.openImportExport'); await wait(2_500);
const ta = await centre('.editor-pane-container [data-px-id="budget.import.text"]');
let imported = 'no CSV box';
if (ta) {
  await page.mouse.click(ta.x, ta.y); await wait(300);
  await page.keyboard.type(csv, { delay: 2 }); await wait(500);
  const ran = await pressInPage({ id: 'budget.import.run' }, { ms: 3_000 });
  imported = ran ? await page.evaluate(() => (document.querySelector('.editor-pane-container')?.innerText ?? '').match(/[^\n]*(?:imported|Imported|added)[^\n]*/)?.[0] ?? '(no line)') : 'no Import button';
}
await closeAllEditors();
await wait(1_000);
await app.close(); app = null;
const ids = { acctA: '', acctB: '', txn: '' };
const dbPath = await budgetDb();
try {
  const [accts, txns] = sql(dbPath, [
    { sql: 'SELECT id, last_four, display_name FROM accounts' },
    { sql: "SELECT id, merchant FROM transactions WHERE merchant = 'Probe Hardware'" },
  ]);
  ids.acctA = accts.find((a) => a.last_four === ACCT_A.last4)?.id ?? '';
  ids.acctB = accts.find((a) => a.last_four === ACCT_B.last4)?.id ?? '';
  ids.txn = txns[0]?.id ?? '';
} catch (e) { console.log(`[seed] Budget's database: ${e?.message ?? e}`); }
console.log(`[seed] Budget on: ${onFirst}; import: ${imported}; db ${dbPath ? path.relative(root, dbPath) : 'none'}; ids ${JSON.stringify(ids)}`);
const seeded = !!(ids.acctA && ids.acctB && ids.txn);

// ── R. Tabs an older build saved ──
// The build before this piece saves its one tab as typeId budget.editor, instance budget:main, named
// "Budget", icon wallet (read from a workspace-state.json the app at 96ef397a wrote); the builds before the
// one-editor change saved a tab per section, instance budget:<section>.
const statePath = path.join(ws, '.parallx', 'workspace-state.json');
const oldTab = (instanceId) => ({
  typeId: OLD_TYPE, inputId: `${TOOL}:${OLD_TYPE}:${instanceId}`, pinned: true,
  data: { inputId: `${TOOL}:${OLD_TYPE}:${instanceId}`, instanceId, name: 'Budget', icon: 'wallet', ownerToolId: TOOL },
  state: {},
});
async function writeSaved(instanceIds, activeIndex) {
  const file = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const wb = JSON.parse(file.workbench);
  const groupId = wb.editors?.groups?.[0]?.id ?? 'editor-group-1';
  wb.editors = { groups: [{ id: groupId, editors: instanceIds.map(oldTab), activeEditorIndex: activeIndex }], activeGroupIndex: 0, activeGroupId: groupId };
  file.workbench = JSON.stringify(wb);
  await fs.writeFile(statePath, JSON.stringify(file, null, 2));
}
/** Launch on a saved state; the one Budget tab pressed if it is not in front. */
async function restoreRead() {
  await launch(); await ensureOn(); await wait(4_500);
  let s = await read();
  if (s.budgetIds.length === 1 && !s.activeIsBudget) { await pressTab({ id: s.budgetIds[0], ms: 2_400 }); s = await read(); }
  return s;
}
const restores = [
  { name: 'Ra the current build\'s tab (budget.editor, budget:main)', ids: ['budget:main'], active: 0, p: P.overview },
  { name: 'Rb1 budget:dashboard', ids: ['budget:dashboard'], active: 0, p: P.overview },
  { name: 'Rb2 budget:transactions', ids: ['budget:transactions'], active: 0, p: P.transactions },
  { name: 'Rb3 budget:recurring', ids: ['budget:recurring'], active: 0, p: P.bills },
  { name: 'Rb4 budget:goals', ids: ['budget:goals'], active: 0, p: P.worth },
  { name: 'Rb5 budget:reviewQueue', ids: ['budget:reviewQueue'], active: 0, p: P.review },
  { name: 'Rc five section tabs in one group (dashboard, transactions, recurring in front, goals, reviewQueue)', ids: ['budget:dashboard', 'budget:transactions', 'budget:recurring', 'budget:goals', 'budget:reviewQueue'], active: 2, p: P.bills },
];
try {
  for (let i = 0; i < restores.length; i++) {
    const r = restores[i];
    let wrote = false;
    try { await writeSaved(r.ids, r.active); wrote = true; } catch (e) { console.log(`[seed] the saved state could not be written: ${e?.message ?? e}`); }
    const s = await restoreRead();
    check(`${r.name}, saved by an older build, comes back as ONE Budget tab on its place: "${r.p.tab}", trail "Budget › ${r.p.trail.join(' › ')}", Budget's icon, a place address`, wrote && atPlace(s, r.p), short(s));
    if (i < restores.length - 1) { await app.close(); app = null; }
  }

  // ── G. The column's rows [guard] ──
  await closeAllEditors();
  await showColumn();
  let s = await read();
  const inOrder = (s.rowNames ?? []).filter((n) => ROWS.includes(n));
  check(`G1 Budget's column shows its seven rows, once each, in order: ${ROWS.join(', ')}`, JSON.stringify(inOrder) === JSON.stringify(ROWS), s.rowNames, { guard: true });

  // ── W. The walk down the column ──
  const addresses = {};
  for (const row of ROWS) {
    const p = ROW_PLACE[row];
    const pressed = await pressRow(row, { ms: 2_600 });
    s = await read();
    addresses[row] = s.address;
    console.log(`[walk] ${row}: ${pressed} → ${JSON.stringify(short(s))}`);
    check(`W1 ${row} pressed: one Budget tab, in front, named "${p.tab}", Budget's icon; trail "Budget › ${p.trail.join(' › ')}" (Budget with its icon); address parallx://place/budget/${p.place}${p.view === null ? ' (no view)' : ''}`, pressed && atPlace(s, p), { pressed, ...short(s), icon: s.activeBudgetIcon });
    const m = await markIs(row);
    check(`W2 ${row}: the column marks this row only, with the shared mark (aria-current="page" + px-current)`, pressed && m.ok, m);
    check(`W3 ${row}: the page's title is the kit's (.px-page-header__title), no back link`, pressed && s.title !== null && s.back === null, { title: s.title, back: s.back }, { guard: true });
    if (row === 'Overview') await screenshot(app, page, path.join(shots, 'overview-dark.png'));
    if (row === 'Transactions') await screenshot(app, page, path.join(shots, 'transactions-dark.png'));
  }
  const addrList = ROWS.map((r) => addresses[r]).filter((a) => parseAddr(a)?.tool === 'budget');
  check('W4 every row has its own address (seven different parallx://place/budget/… addresses)', addrList.length === ROWS.length && new Set(addrList).size === ROWS.length, addresses);
  // Header actions each page keeps.
  const actionsOf = async (row) => { await pressRow(row, { ms: 2_400 }); return (await read()).headerActions; };
  const ha = { tx: await actionsOf('Transactions'), worth: await actionsOf('Net Worth and Goals'), rules: await actionsOf('Merchants and Rules') };
  const mm = await moreMenu();
  check('W5 the pages keep their header actions: Transactions\' "Add Transaction…", Net Worth and Goals\' "Add Asset or Debt…" and "Add Goal…", Merchants and Rules\' "New Rule", and ⋯ More Actions', ha.tx.includes('Add Transaction…') && ha.worth.includes('Add Asset or Debt…') && ha.worth.includes('Add Goal…') && ha.rules.includes('New Rule') && ['tx', 'worth', 'rules'].every((k) => ha[k].includes('More Actions')), ha, { guard: true });
  check('W6 the ⋯ menu holds Sync Now, Sync Log, Import / Export, Reprocess History…, Budget Settings', mm.opened && ['Sync Now', 'Sync Log', 'Import / Export', 'Reprocess History…', 'Budget Settings'].every((x) => mm.items.includes(x)), mm, { guard: true });
  // By Enter: the keys land on the title.
  const byEnter = [];
  for (const row of ROWS) {
    const other = row === 'Overview' ? 'Review' : 'Overview';
    await pressRow(other, { ms: 1_800 });
    const went = await enterRow(row, { ms: 2_400 });
    s = await read();
    byEnter.push({ row, went, at: atPlace(s, ROW_PLACE[row]), title: titleFocused(s), focus: s.focus });
  }
  check('W7 each row given the keys and Enter pressed: its place, and the keys on the page\'s kit title (h1.px-page-header__title)', byEnter.every((b) => b.went && b.at && b.title), byEnter.filter((b) => !(b.went && b.at && b.title)));

  // ── C. Every way in by command ──
  await closeAllEditors();
  await showColumn();
  const commands = [
    ['budget.openDashboard', P.overview], ['budget.openReviewQueue', P.review], ['budget.openTransactions', P.transactions],
    ['budget.openPlan', P.limits], ['budget.openAccounts', P.worth], ['budget.openRules', P.rules], ['budget.openCategories', P.categories],
    ['budget.openRecurring', P.bills], ['budget.openCashFlow', P.trends], ['budget.openReconcile', P.reconcile],
    ['budget.openSyncLog', P.syncLog], ['budget.openImportExport', P.importExport],
    ['budget.openBudgets', P.limits], ['budget.openReports', P.trends], ['budget.openGoals', P.worth], ['budget.importCsv', P.importExport],
  ];
  let cId = null;
  for (const [id, p] of commands) {
    const done = await runCmd(id); await wait(2_600);
    s = await read();
    if (cId === null) cId = s.activeId;
    const m = await markIs(p.row);
    const failedRun = typeof done === 'string' && /^failed/.test(done);
    check(`C ${id}: "${p.tab}" (Budget › ${p.trail.join(' › ')}) in the one Budget tab (the same tab), the keys on its title, the column marking ${p.row ?? 'no row'}`, !failedRun && atPlace(s, p) && s.activeId === cId && titleFocused(s) && m.ok, { done, ...short(s), focus: s.focus, mark: m.marked });
  }

  // ── M. The ⋯ menu's places; Budget Settings ──
  await closeAllEditors();
  for (const [item, p, shot] of [['Sync Log', P.syncLog, 'sync-log-dark.png'], ['Import / Export', P.importExport, null]]) {
    await pressRow('Categories', { ms: 2_200 });
    const m0 = await read();
    const mo = await moreMenu(item);
    s = await read();
    const mk = await markIs(null);
    check(`M ⋯ › ${item}: "${p.tab}" in the one Budget tab (the tab that was on Categories), trail "Budget › ${p.tab}", the keys on its title, no back link (budget.back gone), no column row marked`, mo.picked && atPlace(s, p) && s.activeId === m0.activeId && titleFocused(s) && s.back === null && mk.ok, { mo, ...short(s), back: s.back, focus: s.focus, mark: mk.marked });
    if (shot) await screenshot(app, page, path.join(shots, shot));
    const cg = await crumbsGoThere();
    check(`M on ${item}, each crumb before the last pressed: that crumb's address in the same tab, the keys on the title (then Alt+Left back)`, mo.picked && cg.ok, cg.out);
  }
  const m1 = await read();
  const ms = await moreMenu('Budget Settings');
  await wait(1_200);
  s = await read();
  check('M Budget Settings (⋯): Settings opens as a dialog, no new tab', ms.picked && s.dialog.length > 0 && s.count === m1.count, { ms, dialog: s.dialog, before: m1.count, after: s.count }, { guard: true });
  await page.keyboard.press('Escape'); await wait(800);

  // ── P. Plan's views ──
  await closeAllEditors();
  await runCmd('budget.openBudgets'); await wait(2_400);
  const p0 = await read();
  check('P1 Plan (budget.openBudgets): "Limits", trail "Budget › Plan › Limits", address parallx://place/budget/plan with no view', atPlace(p0, P.limits), short(p0));
  const pv1 = await pressPlanView('Bills');
  s = await read();
  let pm = await markIs('Plan');
  check('P2 Bills chosen on the segmented control (mouse): the one tab named "Bills", trail "Budget › Plan › Bills", address plan?view=bills; the keys still on the control (on Bills); the column marks Plan', pv1 && atPlace(s, P.bills) && s.activeId === p0.activeId && !!s.focus?.inPlanView && s.focus.text === 'Bills' && pm.ok, { pv1, ...short(s), focus: s.focus, mark: pm.marked });
  await screenshot(app, page, path.join(shots, 'plan-bills-dark.png'));
  // ArrowRight on the control, as a keyboard user moves along it.
  await page.evaluate(() => { const b = [...document.querySelectorAll('.editor-pane-container [data-px-id="budget.plan.view"] [role="radio"][aria-checked="true"]')].find((x) => x.getClientRects().length); b?.focus(); });
  await key('ArrowRight', 2_000);
  s = await read();
  pm = await markIs('Plan');
  check('P3 ArrowRight on the control: Trends, the tab "Trends", trail "Budget › Plan › Trends", address plan?view=trends, the keys still on the control (on Trends), the column marks Plan', atPlace(s, P.trends) && s.activeId === p0.activeId && !!s.focus?.inPlanView && s.focus.text === 'Trends' && pm.ok, { ...short(s), focus: s.focus, mark: pm.marked });
  await key('Alt+ArrowLeft');
  s = await read();
  check('P4 Alt+Left: back to Bills in the same tab (a view chosen is a step of Back)', atPlace(s, P.bills) && s.activeId === p0.activeId, short(s));
  await key('Alt+ArrowLeft');
  s = await read();
  check('P5 Alt+Left again: Limits in the same tab', atPlace(s, P.limits) && s.activeId === p0.activeId, short(s));
  await key('Alt+ArrowRight');
  s = await read();
  check('P6 Alt+Right: Bills again, in the same tab, the segmented control showing Bills', atPlace(s, P.bills) && s.activeId === p0.activeId && s.planView === 'Bills', { ...short(s), planView: s.planView });
  const planCrumbAt = s.crumbs.findIndex((c) => c.label === 'Plan');
  const crumbed = planCrumbAt > 0 ? await pressCrumb(planCrumbAt) : false;
  s = await read();
  check('P7 on Bills, the "Plan" crumb pressed: Plan › Limits in the same tab, the keys on its title', crumbed && atPlace(s, P.limits) && s.activeId === p0.activeId && titleFocused(s) && s.planView === 'Limits', { crumbed, ...short(s), focus: s.focus, planView: s.planView });
  await runCmd('budget.openRecurring'); await wait(2_400);
  const pc = await crumbsGoThere();
  check('P8 on Bills, each crumb before the last pressed: that crumb\'s address in the same tab (then Alt+Left back)', pc.ok, pc.out);
  // Limits' month.
  await runCmd('budget.openBudgets'); await wait(2_400);
  s = await read();
  const planMonthNow = keyOfLabel(s.monthLabel);
  const prevPressed = await pressInPage({ id: 'budget.month.prev' }, { ms: 2_200 });
  s = await read();
  const planPrev = planMonthNow ? shiftKey(planMonthNow, -1) : null;
  check(`P9 on Limits, Previous Month pressed: address plan?month=${planPrev} (no view), the page on ${labelOfKey(planPrev)}`, !!planPrev && prevPressed && atPlace(s, P.limits, { params: { month: planPrev } }) && s.monthLabel.includes(labelOfKey(planPrev)), { planMonthNow, prevPressed, ...short(s), month: s.monthLabel });
  await pressInPage({ id: 'budget.month.current' }, { ms: 1_800 });
  const limitsAddr = planMonthNow ? `parallx://place/budget/plan?month=${shiftKey(planMonthNow, -2)}` : '';
  // Reconcile's account; both addresses as links in a page.
  const reconAddr = `parallx://place/budget/plan?view=reconcile&account=${encodeURIComponent(ids.acctB)}`;
  const pPage = await makeLinkPage('Probe Plan Addresses', [limitsAddr || 'parallx://place/budget/plan', reconAddr]);
  await runCmd('budget.openDashboard'); await wait(2_000);
  const pl0 = await read();
  let clicked = limitsAddr ? await clickLink(pPage, limitsAddr) : false;
  s = await read();
  check(`P10 ${limitsAddr || '(no month read)'} clicked in a page: Limits on ${labelOfKey(planMonthNow ? shiftKey(planMonthNow, -2) : null)}, in the one Budget tab (the tab that was on Overview)`, clicked && atPlace(s, P.limits) && s.activeId === pl0.activeId && s.monthLabel.includes(labelOfKey(shiftKey(planMonthNow, -2))), { clicked, ...short(s), month: s.monthLabel });
  clicked = seeded ? await clickLink(pPage, reconAddr) : false;
  s = await read();
  check(`P11 ${reconAddr} clicked in a page: Plan › Reconcile in the one tab, on ${ACCT_B.name} (the account in the address)`, clicked && atPlace(s, P.reconcile, { params: { account: ids.acctB } }) && s.activeId === pl0.activeId && s.planDd.some((t) => t.includes(ACCT_B.name)), { clicked, ...short(s), planDd: s.planDd });

  // ── T. Transactions' filters ──
  await closeAllEditors();
  await pressRow('Transactions', { ms: 2_600 });
  const t0 = await read();
  const txNow = keyOfLabel(t0.monthLabel);
  const chip = await pressInPage({ id: 'budget.tx.view.spend' }, { ms: 2_000 });
  s = await read();
  check('T1 Transactions, the Spending chip pressed: address transactions?view=spend, the chip pressed, the keys still on it, same tab', chip && atPlace(s, P.transactions, { params: { view: 'spend' } }) && s.activeId === t0.activeId && s.pressedChips.includes('spend') && s.focus?.pxid === 'budget.tx.view.spend', { chip, ...short(s), chips: s.pressedChips, focus: s.focus });
  const txPrev = txNow ? shiftKey(txNow, -1) : null;
  const prevTx = await pressInPage({ id: 'budget.month.prev' }, { ms: 2_200 });
  s = await read();
  check(`T2 then Previous Month: address view=spend&month=${txPrev}, the page on ${labelOfKey(txPrev)}, the keys still on Previous Month`, !!txPrev && prevTx && atPlace(s, P.transactions, { params: { view: 'spend', month: txPrev } }) && s.monthLabel.includes(labelOfKey(txPrev)) && s.focus?.pxid === 'budget.month.prev', { prevTx, ...short(s), month: s.monthLabel, focus: s.focus });
  const searchAt = await centre('.editor-pane-container [data-px-id="budget.tx.search"]');
  if (searchAt) { await page.mouse.click(searchAt.x, searchAt.y); await page.keyboard.type('Probe', { delay: 30 }); await wait(1_800); }
  s = await read();
  check('T3 then "Probe" typed in Search merchants: address q=Probe (with view and month kept), the keys still in the search box', !!searchAt && atPlace(s, P.transactions, { params: { view: 'spend', month: txPrev, q: 'Probe' } }) && s.focus?.pxid === 'budget.tx.search' && s.search === 'Probe', { ...short(s), focus: s.focus, search: s.search });
  await pressRow('Review', { ms: 2_000 });
  await pressRow('Transactions', { ms: 2_600 });
  s = await read();
  check('T4 then Review, then the Transactions row: Transactions with no filters (address with no query; All pressed, this month, empty search)', atPlace(s, P.transactions, { noParams: ['view', 'month', 'q', 'account', 'category', 'day', 'only', 'ai'] }) && parseAddr(s.address) && !String(s.address).includes('?') && s.pressedChips.join() === 'all' && s.monthLabel.includes(labelOfKey(txNow)) && !s.search, { ...short(s), chips: s.pressedChips, month: s.monthLabel, search: s.search });
  await pressInPage({ id: 'budget.tx.view.income' }, { ms: 1_600 });
  await runCmd('budget.openTransactions'); await wait(2_400);
  s = await read();
  check('T5 Income chosen, then budget.openTransactions: Transactions with no filters', atPlace(s, P.transactions) && !String(s.address).includes('?') && s.pressedChips.join() === 'all', { ...short(s), chips: s.pressedChips });
  const txAddr = txPrev ? `parallx://place/budget/transactions?view=spend&month=${txPrev}` : '';
  const txAddr2 = `parallx://place/budget/transactions?q=Probe%20Cafe&account=${encodeURIComponent(ids.acctB)}`;
  const tPage = await makeLinkPage('Probe Transactions Addresses', [txAddr || 'parallx://place/budget/transactions', txAddr2]);
  await runCmd('budget.openCategories'); await wait(2_000);
  const tl0 = await read();
  clicked = txAddr ? await clickLink(tPage, txAddr) : false;
  s = await read();
  check(`T6 ${txAddr || '(no month read)'} clicked in a page: Transactions in the one tab (the tab that was on Categories), the Spending chip pressed, the page on ${labelOfKey(txPrev)}`, clicked && atPlace(s, P.transactions, { params: { view: 'spend', month: txPrev } }) && s.activeId === tl0.activeId && s.pressedChips.join() === 'spend' && s.monthLabel.includes(labelOfKey(txPrev)), { clicked, ...short(s), chips: s.pressedChips, month: s.monthLabel });
  clicked = seeded ? await clickLink(tPage, txAddr2) : false;
  s = await read();
  check(`T7 ${txAddr2} clicked in a page: Transactions in the one tab, the search box "Probe Cafe", the account ${ACCT_B.name}`, clicked && atPlace(s, P.transactions, { params: { q: 'Probe Cafe', account: ids.acctB } }) && s.activeId === tl0.activeId && s.search === 'Probe Cafe' && s.txAccount.includes(ACCT_B.name), { clicked, ...short(s), search: s.search, account: s.txAccount });
  // Overview's month.
  await pressRow('Overview', { ms: 2_400 });
  s = await read();
  const ovNow = keyOfLabel(s.monthLabel);
  const ovPrevPressed = await pressInPage({ id: 'budget.month.prev' }, { ms: 2_400 });
  s = await read();
  const ovPrev = ovNow ? shiftKey(ovNow, -1) : null;
  check(`T8 Overview, Previous Month: address overview?month=${ovPrev}, the page on ${labelOfKey(ovPrev)}`, !!ovPrev && ovPrevPressed && atPlace(s, P.overview, { params: { month: ovPrev } }) && s.monthLabel.includes(labelOfKey(ovPrev)), { ovNow, ovPrevPressed, ...short(s), month: s.monthLabel });
  await pressRow('Review', { ms: 2_000 });
  await pressRow('Overview', { ms: 2_400 });
  s = await read();
  check(`T9 then Review, then the Overview row: Overview keeps the month it was left on (${labelOfKey(ovPrev)}, month=${ovPrev} in the address)`, !!ovPrev && atPlace(s, P.overview, { params: { month: ovPrev } }) && s.monthLabel.includes(labelOfKey(ovPrev)), { ...short(s), month: s.monthLabel });
  await pressInPage({ id: 'budget.month.current' }, { ms: 1_800 });

  // ── F. Forms over a place ──
  const formCheck = async ({ name, row, open, close, opener, p }) => {
    await closeAllEditors();
    await pressRow(row, { ms: 2_600 });
    const f0 = await read();
    const opened = await pressInPage({ id: open }, { ms: 1_800 });
    const f1 = await read();
    if (close === 'Escape') await key('Escape', 1_500);
    else await pressInPageAnywhere(close);
    const f2 = await read();
    const sameOver = f1.forms.length === 1 && f1.count === f0.count && f1.budget.length === 1 && f1.activeId === f0.activeId && atPlace(f1, p) && f1.address === f0.address;
    const keysBack = f2.forms.length === 0 && !onBody(f2) && (f2.focus?.pxid === opener || titleFocused(f2));
    check(`F ${name}: opens once as a popover over ${p.tab} (one Budget tab, its name, trail and address unchanged); closed by ${close === 'Escape' ? 'Escape' : 'its Close'}, the keys go back to ${opener} (or the title), not to nothing`, opened && sameOver && keysBack, { opened, before: short(f0), open: { forms: f1.forms, ...short(f1) }, after: { forms: f2.forms, focus: f2.focus } });
  };
  async function pressInPageAnywhere(id) {
    const at = await centre(`[data-px-id="${id}"]`);
    if (!at) return false;
    await page.mouse.click(at.x, at.y); await wait(1_500);
    return true;
  }
  await formCheck({ name: 'Add Transaction…', row: 'Transactions', open: 'budget.addTransaction', close: 'Escape', opener: 'budget.addTransaction', p: P.transactions });
  await formCheck({ name: 'Add Asset or Debt…', row: 'Net Worth and Goals', open: 'budget.addHolding', close: 'budget.holdingEditor.close', opener: 'budget.addHolding', p: P.worth });
  await formCheck({ name: 'Add Goal…', row: 'Net Worth and Goals', open: 'budget.addGoal', close: 'Escape', opener: 'budget.addGoal', p: P.worth });
  // A transaction row opened for editing.
  await closeAllEditors();
  await pressRow('Transactions', { ms: 2_600 });
  const e0 = await read();
  const rowAtTx = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.editor-pane-container button, .editor-pane-container [role="button"], .editor-pane-container [role="row"], .editor-pane-container a')].find((x) => x.getClientRects().length && /Probe Grocer/.test(x.textContent ?? '') && !/Probe Cafe|Probe Hardware/.test(x.textContent ?? ''));
    if (!r) return null; r.scrollIntoView({ block: 'nearest' }); const b = r.getBoundingClientRect(); return { x: b.x + Math.min(60, b.width / 2), y: b.y + b.height / 2 };
  });
  if (rowAtTx) { await page.mouse.click(rowAtTx.x, rowAtTx.y); await wait(1_800); }
  const e1 = await read();
  await key('Escape', 1_500);
  const e2 = await read();
  const backOnRow = !!e2.focus && /Probe Grocer/.test(e2.focus.text) && e2.focus.inEditor;
  check('F a transaction row (Probe Grocer) opened for editing: a popover over Transactions (tab, trail and address unchanged); Escape gives the keys back to that row (or the title), not to nothing', !!rowAtTx && e1.forms.length === 1 && e1.budget.length === 1 && e1.activeId === e0.activeId && atPlace(e1, P.transactions) && e1.address === e0.address && e2.forms.length === 0 && !onBody(e2) && (backOnRow || titleFocused(e2)), { rowAtTx: !!rowAtTx, open: { forms: e1.forms, ...short(e1) }, after: { forms: e2.forms, focus: e2.focus } });

  // ── B. Back and Forward ──
  await closeAllEditors();
  await pressRow('Overview'); await pressRow('Review'); await pressRow('Transactions', { ms: 2_600 });
  s = await read();
  const bId = s.activeId;
  await key('Alt+ArrowLeft');
  let b = await read();
  check('B1 Overview → Review → Transactions, Alt+Left: Review, in the same tab, one Budget tab', atPlace(b, P.review) && b.activeId === bId, short(b));
  let bm = await markIs('Review');
  check('B2 after Back, the keys on Review\'s title, the column\'s mark on Review', titleFocused(b) && bm.ok, { focus: b.focus, mark: bm.marked });
  await key('Alt+ArrowLeft');
  b = await read();
  bm = await markIs('Overview');
  check('B3 Alt+Left again: Overview, in the same tab, marked in the column', atPlace(b, P.overview) && b.activeId === bId && bm.ok, { ...short(b), mark: bm.marked });
  await key('Alt+ArrowRight');
  b = await read();
  check('B4 Alt+Right: Review, in the same tab', atPlace(b, P.review) && b.activeId === bId, short(b));
  await key('Alt+ArrowRight');
  b = await read();
  check('B5 Alt+Right again: Transactions, in the same tab, the keys on its title', atPlace(b, P.transactions) && b.activeId === bId && titleFocused(b), { ...short(b), focus: b.focus });

  // ── L. Links in a page ──
  await closeAllEditors();
  const worthAddr = addresses['Net Worth and Goals'];
  const acctLink = `parallx://budget/account/${ids.acctA}`; const txnLink = `parallx://budget/transaction/${ids.txn}`;
  const lPage = await makeLinkPage('Probe Budget Links', [parseAddr(worthAddr) ? worthAddr : 'parallx://place/budget/none', acctLink, txnLink]);
  await pressRow('Categories', { ms: 2_200 });
  const l0 = await read();
  clicked = parseAddr(worthAddr) ? await clickLink(lPage, worthAddr) : false;
  s = await read();
  const lm = await markIs('Net Worth and Goals');
  check(`L1 Net Worth and Goals' address (${worthAddr || 'none read'}) clicked in a page: there, in the one Budget tab (the tab that was on Categories), the column's mark following`, clicked && atPlace(s, P.worth) && s.activeId === l0.activeId && lm.ok, { clicked, ...short(s), mark: lm.marked });
  await pressRow('Categories', { ms: 2_000 });
  clicked = seeded ? await clickLink(lPage, acctLink) : false;
  s = await read();
  check(`L2 ${acctLink} clicked in a page: Net Worth and Goals in the one Budget tab`, clicked && atPlace(s, P.worth) && s.activeId === l0.activeId, { clicked, ...short(s) });
  await pressRow('Categories', { ms: 2_000 });
  clicked = seeded ? await clickLink(lPage, txnLink) : false;
  s = await read();
  check(`L3 ${txnLink} clicked in a page: Transactions in the one Budget tab`, clicked && atPlace(s, P.transactions) && s.activeId === l0.activeId, { clicked, ...short(s) });

  // ── D. The dashboard widget ──
  await closeAllEditors();
  await pressRow('Categories', { ms: 2_200 });
  const d0 = await read();
  const widgetId = await runCmd('dashboard.addWidgetWith', ['parallx.budget.mtd-spend', {}, 'Probe Spend']); await wait(3_500);
  const card = await centre('.bmtd__net, .bmtd__empty, .bmtd__sub');
  if (card) { await page.mouse.click(card.x, card.y); await wait(2_800); }
  s = await read();
  check('D1 the dashboard\'s Budget card (month-to-date spend) pressed: Overview in the one Budget tab (the tab that was on Categories)', !!card && atPlace(s, P.overview) && s.activeId === d0.activeId, { widgetId: String(widgetId).slice(0, 60), card: !!card, ...short(s) });

  // ── A. Twice in a row; after a switch away ──
  await closeAllEditors();
  await pressRow('Review'); const a0 = await read();
  await pressRow('Review'); s = await read();
  check('A1 Review pressed twice in a row: one Budget tab, the same tab, on Review', atPlace(a0, P.review) && atPlace(s, P.review) && s.activeId === a0.activeId, { first: short(a0), second: short(s) });
  const elsewhere = await runTool('canvas_create_page', { title: 'Probe Elsewhere', markdown: 'Another tab.' });
  await cmd(page, 'canvas.openPage', elsewhere); await wait(2_000);
  const away = await read();
  await pressRow('Categories', { ms: 2_400 });
  s = await read();
  check('A2 after switching to a page\'s tab, Categories pressed: the one Budget tab comes forward (same tab) on Categories; the page\'s tab stays', !away.activeIsBudget && atPlace(s, P.categories) && s.activeId === a0.activeId && s.labels.includes('Probe Elsewhere'), { away: away.active, after: short(s) });

  // ── O. A tab of its own ──
  await closeAllEditors();
  await pressRow('Review', { ms: 2_200 });
  const o0 = await read();
  const ctrl = await pressRow('Categories', { ctrl: true, ms: 2_600 });
  let o1 = await read();
  check('O1 on Review, Ctrl+click on Categories: a second Budget tab, on Categories, in front; the Review tab stays', atPlace(o0, P.review) && ctrl && o1.budget.length === 2 && o1.activeId !== o0.activeId && o1.budgetIds.includes(o0.activeId) && atPlaceAny(o1, P.categories) && o1.budget.includes('Review'), { before: short(o0), ctrl, after: short(o1) });
  await closeAllEditors();
  await pressRow('Review', { ms: 2_200 });
  const o2 = await read();
  await pressRow('Plan', { right: true, ms: 800 });
  const rowMenu = await menuItems();
  const pickedRow = await pickMenuItem('Open in Its Own Tab', 2_600);
  o1 = await read();
  check('O2 the Plan row\'s menu (right-click) has "Open in Its Own Tab": one more Budget tab, on Plan › Limits; the Review tab stays', rowMenu.includes('Open in Its Own Tab') && pickedRow && o1.budget.length === o2.budget.length + 1 && o1.budget.includes('Review') && o1.budget.includes('Limits'), { rowMenu, after: short(o1) });
  await closeAllEditors();
  await pressRow('Merchants and Rules', { ms: 2_200 });
  const o3 = await read();
  await pressTab({ right: true, ms: 800 });
  const tabMenu = await menuItems();
  const pickedTab = await pickMenuItem('Open in Its Own Tab', 2_600);
  o1 = await read();
  check('O3 the Budget tab\'s own menu has "Open in Its Own Tab": one more Budget tab, both on Merchants and Rules', tabMenu.includes('Open in Its Own Tab') && pickedTab && o1.budget.length === o3.budget.length + 1 && o1.budget.every((l) => l === 'Merchants and Rules') && atPlaceAny(o1, P.rules), { tabMenu, after: short(o1) });

  // ── Light and dark ──
  await closeAllEditors();
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
  await wait(700);
  for (const [row, f] of [['Overview', 'overview-light.png'], ['Transactions', 'transactions-light.png']]) { await pressRow(row, { ms: 2_400 }); await screenshot(app, page, path.join(shots, f)); }
  await runCmd('budget.openRecurring'); await wait(2_400); await screenshot(app, page, path.join(shots, 'plan-bills-light.png'));
  await runCmd('budget.openSyncLog'); await wait(2_400); await screenshot(app, page, path.join(shots, 'sync-log-light.png'));
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'dark'));

  // ── S. After the app is closed and opened ──
  await closeAllEditors();
  await runCmd('budget.openRecurring'); await wait(2_600);
  const s0 = await read();
  await wait(1_500);
  await app.close(); app = null;
  await launch(); await ensureOn(); await wait(2_000);
  s = await read();
  if (s.budgetIds.length === 1 && !s.activeIsBudget) await pressTab({ id: s.budgetIds[0], ms: 2_600 });
  s = await read();
  check('S1 on Plan › Bills, the app closed and opened: one Budget tab comes back, on Bills (trail "Budget › Plan › Bills", plan?view=bills)', atPlace(s0, P.bills) && atPlace(s, P.bills), { before: short(s0), after: short(s) });

  // ── X. Turned off and on ──
  await runCmd('budget.openCategories'); await wait(2_200);
  const catAddr = (await read()).address;
  const xPage = await makeLinkPage('Probe Budget Off', [parseAddr(catAddr) ? catAddr : 'parallx://place/budget/categories']);
  const off = await setToolEnabled(page, TOOL, false); await wait(2_500);
  const x0 = await read();
  const cmdGone = !(await hasCommand('budget.openDashboard'));
  check('X1 Budget turned off: no Budget tab, no Budget column, its commands gone', off === true && x0.budget.length === 0 && !x0.column && cmdGone, { off, budget: x0.budget, column: x0.column, cmdGone }, { guard: true });
  const offClicked = parseAddr(catAddr) ? await clickLink(xPage, catAddr) : 'no address read';
  await wait(1_500);
  const x1 = await read();
  check(`X2 while off, Categories' place address (${catAddr || 'none read'}, read while on) opens nothing: no Budget tab`, !!parseAddr(catAddr) && x1.budget.length === 0, { catAddr, offClicked, budget: x1.budget });
  const on = await setToolEnabled(page, TOOL, true); await wait(4_000);
  await runCmd('budget.openRules'); await wait(2_600);
  const x2 = await read();
  check('X3 turned on again, budget.openRules: one Budget tab on Merchants and Rules, trail "Budget › Merchants and Rules"', on === true && atPlace(x2, P.rules), { on, ...short(x2) });
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); failed.push('the probe stopped');
  if (page) await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app?.close().catch(() => {}); }

const real = allErrors.filter((e) => !/Ollama|EmbeddingService|ERR_CONNECTION_REFUSED/.test(e));
check('G2 no page errors across the runs', real.length === 0, real.slice(0, 6), { guard: true });
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] shots: ${shots}`);
console.log(`[probe] guards (true before the piece, must stay true): ${guards.join(', ') || 'none'}`);
const total = passed + failed.length;
console.log(`RESULT: ${passed}/${total} passed`);
process.exitCode = failed.length ? 1 : 0;
