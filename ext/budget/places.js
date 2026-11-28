// places.js — Budget's places (the core's `api.places`): its screens share
// ONE tab, named for the screen, with Budget's icon; the core keeps the tab,
// the trail in the bar under the tabs (`Budget › Plan › Bills`), the address
// (parallx://place/budget/transactions?view=spend&month=2026-10), Back and
// Forward, and where the keys land (the page header's title). Budget has no
// things: a transaction, an asset or a goal opens in a drawer over the place.
//
// The page in main.js still draws a section ('plan') with a Plan view
// ('bills') and what the section was given (a month, a filter); this module
// turns those into a place and back.

export const BUDGET_PLACES_ID = 'budget';
/** The one place tab's editor type; the older build's tabs were 'budget.editor'. */
export const BUDGET_PLACE_TYPE = 'budget.place';
export const BUDGET_FORMER_TYPE = 'budget.editor';

// ─── Sections of the one Budget tab ────────────────────────────────────────
//
// The column lists the `nav` sections. Sync Log and Import / Export are
// places too, reached from the page header's ⋯ menu and their commands.
export const SECTIONS = [
  { id: 'overview',     place: 'overview',      title: 'Overview',            icon: 'layout-dashboard', nav: true },
  { id: 'review',       place: 'review',        title: 'Review',              icon: 'inbox',            nav: true },
  { id: 'transactions', place: 'transactions',  title: 'Transactions',        icon: 'list',             nav: true },
  { id: 'plan',         place: 'plan',          title: 'Plan',                icon: 'target',           nav: true },
  { id: 'worth',        place: 'worth',         title: 'Net Worth and Goals', icon: 'landmark',         nav: true },
  { id: 'rules',        place: 'rules',         title: 'Merchants and Rules', icon: 'filter',           nav: true },
  { id: 'categories',   place: 'categories',    title: 'Categories',          icon: 'tag',              nav: true },
  { id: 'syncLog',      place: 'sync-log',      title: 'Sync Log',            icon: 'scroll-text',      nav: false },
  { id: 'importExport', place: 'import-export', title: 'Import / Export',     icon: 'arrow-up-down',    nav: false },
];

/** Plan's views: a parameter of the Plan place (`view`; Limits, the first, is the default). */
export const PLAN_VIEWS = [
  { value: 'budgets',   label: 'Limits' },
  { value: 'bills',     label: 'Bills' },
  { value: 'trends',    label: 'Trends' },
  { value: 'reconcile', label: 'Reconcile' },
];

// Command → [section, Plan view]. Kept for the palette, chat tools and deep links.
export const COMMAND_ROUTES = {
  'budget.openDashboard':    ['overview'],
  'budget.openReviewQueue':  ['review'],
  'budget.openTransactions': ['transactions'],
  'budget.openPlan':         ['plan'],
  'budget.openBudgets':      ['plan', 'budgets'],
  'budget.openRecurring':    ['plan', 'bills'],
  'budget.openCashFlow':     ['plan', 'trends'],
  'budget.openReports':      ['plan', 'trends'],
  'budget.openReconcile':    ['plan', 'reconcile'],
  'budget.openAccounts':     ['worth'],
  'budget.openGoals':        ['worth'],
  'budget.openRules':        ['rules'],
  'budget.openCategories':   ['categories'],
  'budget.openSyncLog':      ['syncLog'],
  'budget.openImportExport': ['importExport'],
};

// Tabs saved before Budget became one tab carry their old section id.
const LEGACY_SECTION = {
  dashboard: ['overview'], accounts: ['worth'], goals: ['worth'], settings: ['categories'],
  budgets: ['plan', 'budgets'], recurring: ['plan', 'bills'], cashflow: ['plan', 'trends'],
  reports: ['plan', 'trends'], reconcile: ['plan', 'reconcile'], reviewQueue: ['review'],
};

/** The section (and Plan view) an older build's tab showed: 'budget:goals' → Net Worth and Goals; 'budget:main' kept none → Overview. */
export function routeForInstanceId(instanceId) {
  const idx = (instanceId || '').lastIndexOf(':');
  const id = idx >= 0 ? instanceId.slice(idx + 1) : instanceId || '';
  if (SECTIONS.some(s => s.id === id)) return [id];
  return LEGACY_SECTION[id] || ['overview'];
}

// ─── Transactions' filters ─────────────────────────────────────────────────
//
// The page's quick filters. `status` and `type` are what each selects; a
// link's filter ({ type, status, monthKey, categoryId, … }) maps onto them.
export const TX_VIEWS = [
  { id: 'all',      label: 'All',          status: 'live',      type: 'all' },
  { id: 'spend',    label: 'Spending',     status: 'live',      type: 'spend' },
  { id: 'income',   label: 'Income',       status: 'live',      type: 'deposit' },
  { id: 'transfer', label: 'Transfers',    status: 'live',      type: 'transfer' },
  { id: 'review',   label: 'Needs review', status: 'review',    type: 'all' },
  { id: 'hidden',   label: 'Hidden',       status: 'hidden',    type: 'all' },
];

export function txViewFor(incoming) {
  if (!incoming) return 'all';
  if (incoming.status === 'review') return 'review';
  if (incoming.status === 'hidden') return 'hidden';
  if (incoming.type === 'spend' || incoming.type === 'purchase' || incoming.type === 'fee') return 'spend';
  if (incoming.type === 'deposit') return 'income';
  if (incoming.type === 'transfer') return 'transfer';
  return 'all';
}

const MONTH = /^\d{4}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
let currentMonth = () => '';

/** A month for the address: none for the month we are in, or one that is not a month. */
export function monthParam(key) {
  return key && MONTH.test(key) && key !== currentMonth() ? key : undefined;
}

/** A month the address names, or null. */
export function monthOfParams(params) {
  const m = params && params.month;
  return m && MONTH.test(m) ? m : null;
}

/** Transactions' address parameters for a filter (what the page shows, or what a link asks for). */
export function txParamsOf(f = {}) {
  const view = f.view || txViewFor(f);
  const only = f.type === 'purchase' || f.type === 'fee' ? f.type : f.only;
  return clean({
    view: view === 'all' ? undefined : view,
    month: monthParam(f.monthKey),
    category: f.categoryId || undefined,
    account: f.accountId || undefined,
    day: f.dayYmd && DAY.test(f.dayYmd) ? f.dayYmd : undefined,
    q: (f.merchant || '').trim() || undefined,
    only: only === 'purchase' || only === 'fee' ? only : undefined,
    ai: f.aiTyped ? '1' : undefined,
  });
}

/** The filter Transactions opens with, from its address parameters ({} for none). */
export function txFilterOf(p = {}) {
  const f = {};
  const view = TX_VIEWS.some(v => v.id === p.view) ? p.view : 'all';
  if (view === 'review' || view === 'hidden') f.status = view;
  else if (view === 'income') f.type = 'deposit';
  else if (view === 'transfer') f.type = 'transfer';
  else if (view === 'spend') f.type = p.only === 'purchase' || p.only === 'fee' ? p.only : 'spend';
  else if (view === 'all') f.type = 'all';
  const month = monthOfParams(p);
  if (month) f.monthKey = month;
  if (p.category) f.categoryId = String(p.category);
  if (p.account) f.accountId = String(p.account);
  if (p.day && DAY.test(p.day)) f.dayYmd = p.day;
  if (p.q) f.merchant = String(p.q);
  if (p.ai === '1') f.aiTyped = true;
  return f;
}

function clean(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  return out;
}

// ─── Section ↔ place ───────────────────────────────────────────────────────

const sectionOfPlace = (place) => SECTIONS.find(s => s.place === place) || SECTIONS[0];
const planView = (v) => (PLAN_VIEWS.some(x => x.value === v) ? v : 'budgets');

/** The place a section shows (with its Plan view, and what else it was given). */
export function placeOf(sectionId, view, params) {
  const section = SECTIONS.find(s => s.id === sectionId) || SECTIONS[0];
  const p = clean(params);
  if (section.id === 'plan') {
    const v = planView(view || p.view);
    if (v === 'budgets') delete p.view; else p.view = v;
  }
  return Object.keys(p).length ? { place: section.place, params: p } : { place: section.place };
}

/** The section, Plan view and parameters a place is. */
export function routeOf(location) {
  const section = sectionOfPlace(location && location.place);
  const params = { ...(location && location.params) };
  return { section: section.id, view: section.id === 'plan' ? planView(params.view) : null, params };
}

function titleOf(location) {
  const r = routeOf(location);
  if (r.section === 'plan') return PLAN_VIEWS.find(v => v.value === r.view).label;
  return SECTIONS.find(s => s.id === r.section).title;
}

/** The trail after Budget: the place, and on Plan the view (`Plan › Bills`). */
function trailOf(location) {
  const r = routeOf(location);
  if (r.section !== 'plan') return [{ label: titleOf(location), location }];
  return [{ label: 'Plan', location: { place: 'plan' } }, { label: titleOf(location), location }];
}

// ─── Going there ───────────────────────────────────────────────────────────

let _api = null;

/** Go to a section's place in Budget's one tab (with `newTab`, a tab of its own). */
export function openBudgetPlace(sectionId, view, params, options) {
  if (!_api || !_api.places) return Promise.resolve(false);
  const at = placeOf(sectionId, view, params);
  return _api.places.open({ tool: BUDGET_PLACES_ID, place: at.place, ...(at.params ? { params: at.params } : {}) }, options && options.newTab ? { newTab: true } : undefined);
}

/** A section's address, for a row (Ctrl+click, its menu). */
export function budgetPlaceAddress(api, sectionId) {
  return api && api.places ? api.places.addressOf(BUDGET_PLACES_ID, placeOf(sectionId)) : '';
}

/** For the column: the section Budget's tab shows now (null with no tab), and every move after. */
export function onBudgetSection(api, listener) {
  const at = api && api.places ? api.places.current(BUDGET_PLACES_ID) : undefined;
  listener(at ? routeOf(at).section : null);
  if (!api || !api.places) return { dispose() {} };
  return api.places.onDidMove((e) => { if (e.tool === BUDGET_PLACES_ID) listener(routeOf(e.location).section); });
}

// ─── The view ──────────────────────────────────────────────────────────────

class BudgetPlaceView {
  constructor(container, host, createPage) {
    this._location = { place: SECTIONS[0].place };
    // The page's own moves go through the core: the tab is named, the trail drawn, the move is a step of Back.
    this._page = createPage(container, {
      go: (sectionId, view, params) => host.go(placeOf(sectionId, view, params)),
      // The page changed what it shows (a Plan view, a filter, a month): recorded, the keys left where they are.
      replace: (sectionId, view, params) => {
        const at = placeOf(sectionId, view, params);
        this._location = at;
        host.replace(at);
      },
    });
  }

  show(location) {
    this._location = location;
    const r = routeOf(location);
    return this._page.show(r.section, r.view, r.params);
  }

  /** The page's scroll, kept by the editor area across a switch of tabs. */
  saveViewState() { try { return this._page.saveViewState(); } catch { return undefined; } }
  restoreViewState(state) { try { this._page.restoreViewState(state); } catch { /* drawn as it is */ } }

  dispose() {
    try { this._page.dispose(); } catch (err) { console.warn('[Budget] a place failed to close:', err); }
  }
}

/** A tab of the older type the core did not bring back as a place: open its place, then close it. */
function formerTabPane(api, container, input) {
  api.ui.createEmptyState(container, { icon: 'px-budget', headline: 'Budget now opens in one tab.' });
  const instanceId = String((input && (input.instanceId || input.id)) || '');
  const [sid, view] = routeForInstanceId(instanceId);
  setTimeout(async () => {
    try {
      await openBudgetPlace(sid, view);
      const old = (api.editors.openEditors || []).find(e => e.id === (input && input.id));
      if (old) await api.editors.closeEditor(old.id);
    } catch (err) { console.warn('[Budget] could not fold an old tab into Budget:', err); }
  }, 0);
  return { dispose() { container.replaceChildren(); } };
}

/**
 * Register Budget's places. h: {
 *   createPage(container, nav) -> page { show(sectionId, view, params), dispose(), saveViewState(), restoreViewState(state) }:
 *     draws a section in one tab (`show` resolves once it is drawn); its own moves go to nav.go, what it shows now to nav.replace;
 *   currentMonth() -> 'YYYY-MM': the month we are in, in Budget's time zone (left out of addresses);
 * }
 * Returns the disposables.
 */
export function budgetPlacesActivate(api, h) {
  _api = api;
  currentMonth = h.currentMonth;
  const out = [];
  // The older build's type stays registered so its saved tabs are read; the core brings each back as its place.
  out.push(api.editors.registerEditorProvider(BUDGET_FORMER_TYPE, { createEditorPane: (container, input) => formerTabPane(api, container, input) }));
  out.push(api.places.register({
    id: BUDGET_PLACES_ID,
    title: 'Budget',
    icon: 'px-budget',
    editorType: BUDGET_PLACE_TYPE,
    places: SECTIONS.map(s => ({ id: s.place, title: s.title })),
    formerTabs: { editorType: BUDGET_FORMER_TYPE, placeOf: (instanceId) => { const [sid, view] = routeForInstanceId(instanceId); return placeOf(sid, view); } },
    titleOf,
    trailOf,
    createView: (container, host) => new BudgetPlaceView(container, host, h.createPage),
  }));
  out.push({ dispose: () => { _api = null; } });
  return out;
}
