// Budget extension — main.js
//
//   • One module plus ./skills/budget-sync.js; no runtime build step.
//   • Per-extension SQLite via api.database. Migrations under ./db/migrations.
//   • Money is INTEGER cents (D3). Dates are 'YYYY-MM-DD' local (D4).
//
// UX shape:
//   • The sidebar ('budget.nav') shows the month at a glance (what is left to
//     spend), the sections, the review count, and the sync status.
//   • Budget opens as ONE editor tab ('budget:main') whose content switches
//     between Overview, Review, Transactions, Plan, Net Worth and Goals,
//     Merchants and Rules, Categories, and (from ⋯) Sync Log and Import / Export.
//   • Every number about the month comes from readMonthPlan(), so the sidebar,
//     Overview and Plan cannot disagree.

import { BUDGET_SYNC_SKILL } from './skills/budget-sync.js';

// ─── Module-level state ────────────────────────────────────────────────────
let _activated = false;
let _api = null;
let _dbBridge = null;
let _toolPath = '';
const _disposables = [];

// Cross-view nav state — Dashboard sets this when the user clicks a category
// slice; Transactions reads & clears it on next render. Cleared after consumption.
// `section` / `planView` carry a deep link into a Budget editor that is not
// open yet; an open one is switched directly (openBudgetSection).
const _navState = { txFilter: null, section: null, planView: null };

// ─── Cross-view sync event bus ────────────────────────────────────────────
//
// Every open section can subscribe to be notified of sync lifecycle events:
//   { kind: 'start',    runId }
//   { kind: 'progress', runId, stage, detail }
//   { kind: 'complete', runId, counts }
//   { kind: 'error',    runId, message }
// This is what keeps Dashboard, Transactions, Recurring etc. all auto-refresh
// the moment a sync — initiated from any surface — completes.
const _syncListeners = new Set();
let _lastSyncEvent = null; // remembered so newly-mounted sections can snapshot the latest state immediately
let _syncInFlight = false; // guards against concurrent syncs (double-click / button + tool)
function _emitSync(evt) {
  _lastSyncEvent = evt;
  for (const fn of _syncListeners) {
    try { fn(evt); } catch (e) { console.error('[Budget] sync listener error:', e); }
  }
}
function onSyncEvent(fn) {
  _syncListeners.add(fn);
  return () => _syncListeners.delete(fn);
}

// ─── Manual-sync orchestrator ─────────────────────────────────────────────
//
// Single entry point for every "Sync now" / "Run First Sync" button in the UI.
// M82: runs the deterministic in-process pipeline (budgetSync) directly — one
// focused LLM call per stage per email — so it is reliable on local models and
// the user sees a concrete result immediately. No cron hand-off, no invisible
// ephemeral chat turn. Guards against double-click while a sync is in flight.
async function triggerSyncFromUI(api, _opts = {}) {
  if (_syncInFlight) {
    await api.window?.showInformationMessage?.('A budget sync is already running.');
    return { alreadyRunning: true };
  }
  if (!api.lm || !api.mcp) {
    await api.window?.showErrorMessage?.('Budget sync needs a model and the Gmail connection. Connect Gmail in Settings › AI › MCP Servers.');
    return { ok: false, error: 'missing lm/mcp api' };
  }
  _syncInFlight = true;
  try {
    await api.window?.showInformationMessage?.('Budget sync started. Pulling and categorizing transaction emails…');
    const counts = await budgetSync(api);
    const summary =
      `Budget sync complete: ${counts.confirmed} recorded, ` +
      `${counts.snapshot} balance snapshot(s), ${counts.review} flagged for review, ` +
      `${counts.skipped} already imported.`;
    // If nothing was recorded AND we had parse failures or everything classified
    // as "other", surface that loudly instead of presenting it as success.
    const processed = (counts.confirmed + counts.review + counts.snapshot);
    if (processed === 0 && (counts.malformed > 0 || counts.classifiedOther > 0)) {
      const detail =
        `Budget sync: 0 transactions recorded out of ${counts.malformed + counts.classifiedOther} processed ` +
        `(${counts.malformed} unparseable model output, ${counts.classifiedOther} classified as non-financial). ` +
        `See sync_log for the raw sample. Try a non-thinking model or a stronger one.`;
      await api.window?.showWarningMessage?.(detail);
    } else {
      await api.window?.showInformationMessage?.(summary);
    }
    return { ok: true, counts };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await api.window?.showErrorMessage?.(`Budget sync failed: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    _syncInFlight = false;
  }
}

// Convenience wrapper around api.database that throws on error
// so callers can use try/catch instead of result-tuple plumbing.
const db = {
  async run(sql, params = []) {
    const r = await _dbBridge.run(sql, params);
    if (r.error) throw new Error(`[budget.db] ${r.error.code}: ${r.error.message}`);
    return r;
  },
  async get(sql, params = []) {
    const r = await _dbBridge.get(sql, params);
    if (r.error) throw new Error(`[budget.db] ${r.error.code}: ${r.error.message}`);
    return r.row;
  },
  async all(sql, params = []) {
    const r = await _dbBridge.all(sql, params);
    if (r.error) throw new Error(`[budget.db] ${r.error.code}: ${r.error.message}`);
    return r.rows;
  },
};

// ─── DB lifecycle ──────────────────────────────────────────────────────────

async function ensureDatabase(api) {
  // D11 invariant: api.database.open() BEFORE api.database.migrate(absoluteDir).
  const openResult = await api.database.open();
  if (openResult.error) {
    console.error('[Budget] Database open failed:', openResult.error.message);
    return false;
  }
  const sep = _toolPath.includes('\\') ? '\\' : '/';
  const migrationsDir = _toolPath + sep + 'db' + sep + 'migrations';
  const res = await api.database.migrate(migrationsDir);
  if (res.error) {
    console.error('[Budget] Migration failed:', res.error.message);
    return false;
  }
  return true;
}

// ─── Default category seeds ────────────────────────────────────────────────
//
// Idempotent: only runs when categories table is empty. User may rename,
// recolour, archive, or delete these freely — re-sync never re-creates them.
// Seeded into a new ledger only. Housing holds rent or a mortgage, the one
// bill large enough to drown out everything else in Utilities.
const DEFAULT_CATEGORIES = [
  { name: 'Housing',       color: '#8a7cd8', icon: 'house',             kind: 'expense',  sort: 5 },
  { name: 'Groceries',     color: '#5cb87a', icon: 'shopping-cart',     kind: 'expense',  sort: 10 },
  { name: 'Dining',        color: '#e8924a', icon: 'utensils',          kind: 'expense',  sort: 20 },
  { name: 'Transport',     color: '#5b8fd6', icon: 'car',               kind: 'expense',  sort: 30 },
  { name: 'Utilities',     color: '#e3c04e', icon: 'zap',               kind: 'expense',  sort: 40 },
  { name: 'Shopping',      color: '#e07ba0', icon: 'shopping-bag',      kind: 'expense',  sort: 50 },
  { name: 'Health',        color: '#e0625e', icon: 'heart-pulse',       kind: 'expense',  sort: 60 },
  { name: 'Entertainment', color: '#b07fb0', icon: 'film',              kind: 'expense',  sort: 70 },
  { name: 'Subscriptions', color: '#5bb5bf', icon: 'repeat',            kind: 'expense',  sort: 80 },
  { name: 'Travel',        color: '#b08968', icon: 'plane',             kind: 'expense',  sort: 90 },
  { name: 'Other',         color: '#98a2b3', icon: 'circle-help',       kind: 'expense',  sort: 100 },
  { name: 'Income',        color: '#4e9e6a', icon: 'banknote-arrow-up', kind: 'income',   sort: 110 },
  { name: 'Transfer',      color: '#7d8aa0', icon: 'arrow-right-left',  kind: 'transfer', sort: 120 },
];

async function seedDefaultCategoriesIfEmpty() {
  const row = await db.get('SELECT COUNT(*) AS n FROM categories');
  if (row && Number(row.n) > 0) return;
  for (const c of DEFAULT_CATEGORIES) {
    await db.run(
      `INSERT INTO categories (id, name, color, icon, kind, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), c.name, c.color, c.icon, c.kind, c.sort],
    );
  }
}

// ─── Labels ────────────────────────────────────────────────────────────────
const CATEGORY_KIND_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
];
const ACCOUNT_KIND_LABELS = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit Card',
  other: 'Account',
};
function titleCaseToken(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

// ─── Transaction types — single source of truth ───────────────────────────
//
// `value` is what's stored in transactions.tx_type (the AI pipeline's
// vocabulary); `label` is what every UI surface shows; `kind` is the matching
// category kind. txTypeLabel(), categoryKindForTxType(), the editor dropdown,
// and the sync / AI-tool validators all derive from this list, so a label can
// never again drift from its stored value. (refund and cc_payment were
// collapsed into purchase / transfer in migration 004; a negative-amount
// purchase still displays as "Refund".)
const TX_TYPES = [
  { value: 'purchase', label: 'Expense',  kind: 'expense'  },
  { value: 'fee',      label: 'Fee',      kind: 'expense'  },
  { value: 'deposit',  label: 'Income',   kind: 'income'   },
  { value: 'transfer', label: 'Transfer', kind: 'transfer' },
];
const TX_TYPE_VALUES = TX_TYPES.map(t => t.value);

function txTypeLabel(txType, amountCents = 0) {
  if (txType === 'purchase' && Number(amountCents) < 0) return 'Refund';
  const t = TX_TYPES.find(x => x.value === txType);
  return t ? t.label : titleCaseToken(txType || 'Unknown');
}

function categoryKindForTxType(txType) {
  const t = TX_TYPES.find(x => x.value === txType);
  return t ? t.kind : 'expense';
}

// Returns what learnRuleFromOverride changed (for Undo), or null.
async function learnExpenseRuleFromOverride(merchant, categoryId) {
  if (categoryId && merchant) {
    try {
      const cat = await db.get('SELECT kind FROM categories WHERE id=?', [categoryId]);
      if (!cat || cat.kind === 'expense') {
        return await learnRuleFromOverride(merchant, categoryId);
      }
    } catch { /* best-effort */ }
  }
  return null;
}

// `learn: false` confirms without teaching a rule (Review's "Remember" off).
async function confirmReviewedTransaction(txId, categoryId, merchant, txType = null, { learn = true } = {}) {
  const sets = ["status='confirmed'", 'user_overridden=1', 'category_id=?', "categorization_source='manual'", 'matched_rule_id=NULL', 'updated_at=?'];
  const params = [categoryId || null, new Date().toISOString()];
  if (txType) { sets.push('tx_type=?', "tx_type_source='manual'"); params.push(txType); }
  params.push(txId);
  await db.run(`UPDATE transactions SET ${sets.join(', ')} WHERE id=?`, params);
  return learn ? await learnExpenseRuleFromOverride(merchant, categoryId) : null;
}

async function hideReviewedTransaction(txId, reason = '') {
  await db.run(
    `UPDATE transactions SET status='hidden', user_overridden=1, updated_at=?, notes = CASE WHEN ? = '' THEN notes ELSE COALESCE(notes,'') || ' [hidden: ' || ? || ']' END WHERE id=?`,
    [new Date().toISOString(), reason, reason, txId],
  );
}

// ─── Sections of the one Budget editor ─────────────────────────────────────
//
// Budget opens as ONE editor tab ('budget:main') whose content switches; the
// sidebar lists the `nav` sections. Sync Log and Import / Export are reached
// from the page header's ⋯ menu. Every older `budget.open*` command still
// works: COMMAND_ROUTES maps it to a section (and a Plan view).
const SECTIONS = [
  { id: 'overview',     title: 'Overview',            icon: 'layout-dashboard', nav: true },
  { id: 'review',       title: 'Review',              icon: 'inbox',            nav: true },
  { id: 'transactions', title: 'Transactions',        icon: 'list',             nav: true },
  { id: 'plan',         title: 'Plan',                icon: 'target',           nav: true },
  { id: 'worth',        title: 'Net Worth and Goals', icon: 'landmark',         nav: true },
  { id: 'rules',        title: 'Merchants and Rules', icon: 'filter',           nav: true },
  { id: 'categories',   title: 'Categories',          icon: 'tag',              nav: true },
  { id: 'syncLog',      title: 'Sync Log',            icon: 'scroll-text',      nav: false },
  { id: 'importExport', title: 'Import / Export',     icon: 'arrow-up-down',    nav: false },
];

// Command → [section, Plan view]. Kept for the palette, chat tools and deep links.
const COMMAND_ROUTES = {
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

// Editors restored from before the one-editor change carry their old section id.
const LEGACY_SECTION = {
  dashboard: ['overview'], accounts: ['worth'], goals: ['worth'], settings: ['categories'],
  budgets: ['plan', 'budgets'], recurring: ['plan', 'bills'], cashflow: ['plan', 'trends'],
  reports: ['plan', 'trends'], reconcile: ['plan', 'reconcile'], reviewQueue: ['review'],
};

function routeForInstanceId(instanceId) {
  const idx = (instanceId || '').lastIndexOf(':');
  const id = idx >= 0 ? instanceId.slice(idx + 1) : instanceId || '';
  if (SECTIONS.some(s => s.id === id)) return [id];
  return LEGACY_SECTION[id] || ['overview'];
}

// The section the open Budget editor shows, and who wants to know (the sidebar).
let _currentSection = 'overview';
const _sectionListeners = new Set();
let _liveEditorShow = null;
// Sets the open page's header actions ({ primary, secondary }); a no-op when no
// Budget editor is open. Pages call it while they render.
let _setPageActions = null;
function setPageActions(actions) { if (_setPageActions) _setPageActions(actions || {}); }
function _setCurrentSection(id) {
  _currentSection = id;
  for (const fn of _sectionListeners) { try { fn(id); } catch { /* listener errors stay local */ } }
}

// A page refresh that never runs twice at once: a call while one is running
// asks for one more run after it, so the last paint always shows the latest
// ledger and an older, slower read can never paint over a newer one.
function serialRefresh(fn) {
  let running = false;
  let again = false;
  return async function run() {
    if (running) { again = true; return; }
    running = true;
    try {
      do { again = false; await fn(); } while (again);
    } finally { running = false; }
  };
}

// Ledger changed outside a sync (a review verdict, an edit): views refresh.
const _ledgerListeners = new Set();
function notifyLedgerChanged() {
  for (const fn of _ledgerListeners) { try { fn(); } catch { /* listener errors stay local */ } }
}
function onLedgerChanged(fn) { _ledgerListeners.add(fn); return () => _ledgerListeners.delete(fn); }

async function openBudgetSection(api, sectionId, view) {
  _navState.section = sectionId;
  _navState.planView = view || null;
  if (_liveEditorShow) { _liveEditorShow(sectionId, view || null); }
  await api.editors.openEditor({ typeId: 'budget.editor', title: 'Budget', icon: 'wallet', instanceId: 'budget:main' });
  // A freshly mounted editor consumed _navState; an open one was switched above.
}

// ─── Stylesheet (injected once) ────────────────────────────────────────────
//
// All Parallx-native tokens. No hard-coded colours outside design fallbacks.
let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'budget-extension-styles';
  style.textContent = `
/* ═══ Chart palette — ledger inks ═══
   Charts read the theme's --vscode-charts-* variables. Override them for the
   whole budget surface with classic ledger-ink colors: forest green, brick
   red, steel blue, ochre, mustard, plum. This exact ordered set passes the
   dataviz palette validator on BOTH light and dark surfaces (adjacent-pair
   CVD ΔE ≥ 8 incl. the income/expense green↔red pair, normal-vision ΔE ≥ 15,
   lightness band, chroma floor). The red/plum contrast WARN on dark is
   relieved everywhere by written amounts: every mark ships with a numeric
   label, tooltip, or table — accounting notation IS the secondary encoding. */
.budget-editor, .budget-nav {
  --vscode-charts-green:  #5da56e;
  --vscode-charts-red:    #a43b38;
  --vscode-charts-blue:   #5a8bca;
  --vscode-charts-orange: #965719;
  --vscode-charts-yellow: #a9912b;
  --vscode-charts-purple: #784d96;
  /* Ledger typography: amounts render in the editor's mono face. */
}
/* ═══ Sidebar: the month at a glance, the sections, the sync line ═══ */
.budget-nav {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--px-space-2);
  box-sizing: border-box;
  gap: var(--px-space-3);
  color: var(--px-text);
  font-size: var(--px-text-base);
  overflow: hidden;
}
.budget-glance {
  display: flex;
  flex-direction: column;
  gap: var(--px-space-1);
  padding: var(--px-space-3);
  border: 1px solid var(--px-border);
  border-radius: var(--px-radius-md);
  background: var(--px-bg-elevated);
}
.budget-glance-label { font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.budget-glance-big { color: var(--px-text-muted); font-size: var(--px-text-sm); }
.budget-glance-big .budget-num { font-size: var(--px-text-lg); font-weight: 600; color: var(--px-text); margin-right: 2px; }
.budget-glance-bar { height: 6px; border-radius: var(--px-radius-full); background: var(--px-divider); overflow: hidden; }
.budget-glance-fill { height: 100%; background: var(--px-accent); border-radius: var(--px-radius-full); transition: width var(--px-dur-base, 200ms) var(--px-ease, ease); }
.budget-glance-fill.is-over { background: var(--px-danger); }
.budget-glance-hint { font-size: var(--px-text-xs); color: var(--px-text-faint); }
.budget-nav-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
.budget-nav-row {
  display: flex;
  align-items: center;
  gap: var(--px-space-2);
  width: 100%;
  height: var(--px-control-h);
  padding: 0 var(--px-space-2);
  border: 0;
  border-radius: var(--px-radius-sm);
  background: transparent;
  color: var(--px-text-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.budget-nav-row:hover { background: var(--px-surface-hover); color: var(--px-text); }
.budget-nav-row[aria-current="page"] { background: var(--px-surface-selected); color: var(--px-text); font-weight: 600; }
.budget-nav-row:focus-visible { outline: 1px solid var(--px-accent); outline-offset: -1px; }
.budget-nav-row .budget-icon { display: inline-flex; width: 16px; height: 16px; flex: 0 0 16px; color: var(--px-text-muted); }
.budget-nav-row .budget-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.budget-nav-count {
  min-width: 18px; height: 18px; padding: 0 6px; box-sizing: border-box;
  border-radius: var(--px-radius-full);
  background: var(--px-warning-soft); color: var(--px-warning);
  font-size: var(--px-text-2xs); font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
}
.budget-nav-count[hidden] { display: none; }
.budget-nav-footer {
  flex-shrink: 0;
  display: flex; align-items: center; gap: var(--px-space-2);
  padding: var(--px-space-2) var(--px-space-1) 0;
  border-top: 1px solid var(--px-divider);
}
.budget-nav-status { flex: 1; min-width: 0; font-size: var(--px-text-xs); color: var(--px-text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ═══ The Budget editor ═══ */
.budget-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
  background: var(--px-bg);
  color: var(--px-text);
  font-size: var(--px-text-base);
  box-sizing: border-box;
}
/* The kit page header pads itself; the body lines up under its title. */
/* One page column, as Planner's Today: the header and every page share one
   width and sit centred in the tab, so the header's actions line up with the
   right edge of the content instead of the far edge of a wide pane. */
.budget-page {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 var(--px-space-6) var(--px-space-8);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.budget-editor-head .px-page-header { padding: var(--px-space-5) 0 var(--px-space-4); }
.budget-editor-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--px-space-4);
  min-width: 0;
}
.budget-plan-switch { display: flex; }
.budget-plan-view, .budget-plan-view > div:not([class]) { display: flex; flex-direction: column; gap: var(--px-space-4); min-width: 0; }
.budget-chart-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--px-space-4); }
@container (max-width: 820px) {
.budget-chart-pair { grid-template-columns: minmax(0, 1fr); }
}
.budget-chart-card {
  padding: var(--px-space-4); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg);
  background: var(--px-bg-elevated); min-width: 0;
}
.budget-chart-card svg { width: 100%; height: auto; }
.budget-chart-card .budget-chart-legend { margin-top: 0; }
.budget-worth { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: var(--px-space-8); align-items: start; }
@container (max-width: 820px) {
.budget-worth { grid-template-columns: minmax(0, 1fr); gap: var(--px-space-6); }
}
.budget-worth-col { display: flex; flex-direction: column; gap: var(--px-space-4); min-width: 0; }
.budget-worth-goals .budget-section:empty + .budget-goals .px-empty { padding: var(--px-space-6) var(--px-space-4); }
.budget-worth-manage { margin-top: var(--px-space-4); }
/* Shared: amounts line up, links read as links, a category's colour dot. */
.budget-num { font-variant-numeric: tabular-nums; }
.budget-link {
  border: 0; background: none; padding: 0; cursor: pointer;
  color: var(--px-accent-text); font: inherit; font-size: var(--px-text-sm); text-align: left;
}
.budget-link:hover { text-decoration: underline; }
.budget-link:focus-visible { outline: 1px solid var(--px-accent); outline-offset: 2px; border-radius: var(--px-radius-sm); }
.budget-dot { width: 8px; height: 8px; border-radius: var(--px-radius-full); flex: 0 0 8px; display: inline-block; }
/* ═══ Overview ═══ */
.budget-ov { display: flex; flex-direction: column; gap: var(--px-space-4); }
.budget-ov-month { display: flex; align-items: center; gap: var(--px-space-1); }
.budget-ov-month-label { font-weight: 600; padding: 0 var(--px-space-2); min-width: 130px; text-align: center; }
.budget-ov-card {
  background: var(--px-bg-elevated);
  border: 1px solid var(--px-border);
  border-radius: var(--px-radius-lg);
  padding: var(--px-space-4);
  display: flex; flex-direction: column; gap: var(--px-space-2);
  min-width: 0;
}
.budget-ov-sync { flex-direction: row; align-items: center; flex-wrap: wrap; gap: var(--px-space-4); padding: var(--px-space-3) var(--px-space-4); }
.budget-ov-sync-head { display: flex; flex-direction: column; min-width: 180px; }
.budget-ov-sync-items { display: flex; align-items: center; flex-wrap: wrap; gap: var(--px-space-4); flex: 1; min-width: 0; }
.budget-ov-sync-act { margin-left: auto; }
.budget-ov-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: var(--px-space-4); align-items: start; }
@container (max-width: 820px) {
.budget-ov-grid { grid-template-columns: minmax(0, 1fr); }
}
.budget-editor { container-type: inline-size; }
.budget-ov-col { display: flex; flex-direction: column; gap: var(--px-space-4); min-width: 0; }
.budget-ov-label { font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.budget-ov-muted { color: var(--px-text-muted); }
.budget-ov-faint { color: var(--px-text-faint); font-size: var(--px-text-sm); }
.budget-ov-bad { color: var(--px-danger); }
.budget-ov-left { display: flex; align-items: baseline; gap: var(--px-space-2); flex-wrap: wrap; }
.budget-ov-big { font-size: var(--px-text-xl); font-weight: 600; }
.budget-ov-chart { width: 100%; height: 80px; display: block; border-bottom: 1px solid var(--px-divider); }
.budget-ov-even { stroke: var(--px-border-strong); stroke-width: 1.5; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
.budget-ov-spent { fill: none; stroke: var(--px-accent); stroke-width: 2.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.budget-ov-spent.is-ahead { stroke: var(--px-warning); }
.budget-ov-axis { display: flex; justify-content: space-between; font-size: var(--px-text-xs); color: var(--px-text-faint); }
.budget-ov-note { font-size: var(--px-text-sm); color: var(--px-text-secondary); }
.budget-ov-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--px-space-4); }
.budget-ov-fact { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.budget-ov-value { font-size: var(--px-text-md); font-weight: 600; }
.budget-ov-head { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-2); }
.budget-ov-cat {
  display: grid; grid-template-columns: 8px 110px minmax(0, 1fr) 170px; align-items: center; gap: var(--px-space-3);
  min-height: 32px; padding: 0 var(--px-space-2); margin: 0 calc(-1 * var(--px-space-2));
  border: 0; border-top: 1px solid var(--px-divider); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.budget-ov-cat:hover { background: var(--px-surface-hover); }
.budget-ov-cat:focus-visible { outline: 1px solid var(--px-accent); outline-offset: -1px; }
.budget-ov-cat-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.budget-ov-bar { height: 6px; border-radius: var(--px-radius-full); background: var(--px-divider); overflow: hidden; }
.budget-ov-fill { display: block; height: 100%; border-radius: var(--px-radius-full); background: var(--px-accent); }
.budget-ov-fill.is-over { background: var(--px-danger); }
.budget-ov-fill.is-unplanned { opacity: 0.45; }
.budget-ov-cat-amt { text-align: right; white-space: nowrap; }
.budget-ov-cat-amt .budget-ov-faint { font-size: inherit; }
.budget-ov-row { display: flex; align-items: center; gap: var(--px-space-3); min-height: 32px; border-top: 1px solid var(--px-divider); }
.budget-ov-when { width: 52px; flex: 0 0 52px; color: var(--px-text-faint); font-size: var(--px-text-sm); }
.budget-ov-grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ═══ Merchants and Rules ═══ */
.budget-ru { display: flex; flex-direction: column; gap: var(--px-space-4); }
.budget-ru-help { margin: 0; max-width: 720px; }
.budget-ru-form { gap: var(--px-space-3); }
.budget-ru-field { display: grid; grid-template-columns: 140px auto minmax(0, 1fr); align-items: center; gap: var(--px-space-2); }
.budget-ru-field > :last-child:nth-child(2) { grid-column: 2 / -1; }
.budget-ru-input { height: 28px; font-size: var(--px-text-sm); min-width: 0; }
.budget-ru-cat { max-width: 280px; }
.budget-ru-dry { display: flex; flex-direction: column; gap: 2px; padding: var(--px-space-3); border-radius: var(--px-radius-md); background: var(--px-surface-hover); font-size: var(--px-text-sm); }
.budget-ru-change { display: grid; grid-template-columns: minmax(0, 1fr) auto 32px; gap: var(--px-space-3); align-items: center; }
.budget-ru-change > :last-child { text-align: right; }
.budget-ru-acts { display: flex; justify-content: flex-end; gap: var(--px-space-2); }
.budget-ru-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: var(--px-space-1); }
.budget-ru-row {
  display: grid; grid-template-columns: minmax(0, 1fr) 170px 70px 100px 110px; align-items: center; gap: var(--px-space-3);
  min-height: 40px; padding: 0 var(--px-space-3); border-top: 1px solid var(--px-divider);
}
.budget-ru-row.is-off { opacity: 0.6; }
.budget-ru-cols { min-height: 28px; border-top: 0; font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.budget-ru-who { display: flex; flex-direction: column; min-width: 0; }
.budget-ru-more { display: flex; justify-content: flex-end; }
@container (max-width: 700px) {
  .budget-ru-row { grid-template-columns: minmax(0, 1fr) 120px 90px; }
  .budget-ru-row > :nth-child(3), .budget-ru-row > :nth-child(4) { display: none; }
  .budget-ru-field { grid-template-columns: minmax(0, 1fr); }
  .budget-ru-field > :last-child:nth-child(2) { grid-column: auto; }
}

/* ═══ Plan › Budgets ═══ */
.budget-pl { display: flex; flex-direction: column; gap: var(--px-space-4); }
.budget-pl-bar { display: flex; align-items: center; gap: var(--px-space-2); flex-wrap: wrap; }
.budget-pl-acts { margin-left: auto; display: flex; gap: var(--px-space-2); }
.budget-pl-card { gap: var(--px-space-3); }
.budget-pl-stack { display: flex; height: 10px; border-radius: var(--px-radius-full); overflow: hidden; background: var(--px-divider); }
.budget-pl-seg { display: block; height: 100%; }
.budget-pl-seg.is-bills, .budget-pl-key.is-bills { background: var(--px-text-muted); }
.budget-pl-seg.is-everyday, .budget-pl-key.is-everyday { background: var(--px-accent); }
.budget-pl-seg.is-goals, .budget-pl-key.is-goals { background: var(--px-success); }
.budget-pl-legend { display: flex; flex-wrap: wrap; align-items: center; gap: var(--px-space-4); font-size: var(--px-text-sm); }
.budget-pl-legend > span { display: inline-flex; align-items: center; gap: var(--px-space-1); }
.budget-pl-key { width: 8px; height: 8px; border-radius: var(--px-radius-full); display: inline-block; }
.budget-pl-group { display: flex; flex-direction: column; border-top: 1px solid var(--px-divider); padding-top: var(--px-space-3); }
.budget-pl-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--px-space-3); margin-bottom: var(--px-space-1); }
.budget-pl-title { font-weight: 600; }
.budget-pl-amt { font-weight: 600; white-space: nowrap; }
.budget-pl-line { display: flex; align-items: center; gap: var(--px-space-3); min-height: 30px; }
.budget-pl-cat {
  display: grid; grid-template-columns: minmax(0, 1fr) auto 120px 150px; align-items: center; gap: var(--px-space-3);
  min-height: 44px; border-top: 1px solid var(--px-divider);
}
.budget-pl-cat:first-of-type { border-top: 0; }
@container (max-width: 680px) {
.budget-pl-cat { grid-template-columns: minmax(0, 1fr) 110px; }
.budget-pl-use, .budget-pl-spent { grid-column: 1 / -1; }
}
.budget-pl-catname { display: flex; flex-direction: column; min-width: 0; }
.budget-pl-cattop { display: flex; align-items: center; gap: var(--px-space-2); min-width: 0; }
.budget-pl-input { width: 100%; box-sizing: border-box; height: 28px; text-align: right; font-size: var(--px-text-sm); }
.budget-pl-spent { display: flex; flex-direction: column; gap: 4px; text-align: right; font-size: var(--px-text-sm); }
.budget-pl-left {
  display: flex; align-items: flex-start; justify-content: space-between; gap: var(--px-space-3);
  padding: var(--px-space-3); border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
}
.budget-pl-left.is-over { border-color: var(--px-danger); }
/* ═══ Transactions ═══ */
.budget-tx { display: flex; flex-direction: column; gap: var(--px-space-3); }
.budget-tx-bar { display: flex; align-items: center; gap: var(--px-space-2); flex-wrap: wrap; }
.budget-tx-search { min-width: 200px; height: 28px; font-size: var(--px-text-sm); }
.budget-ov-month[hidden], .budget-tx-allmonths[hidden] { display: none; }
.budget-tx-allmonths { text-align: left; min-width: 0; padding: 0 var(--px-space-1); }
.budget-tx-chips { display: flex; align-items: center; gap: var(--px-space-2); flex-wrap: wrap; }
.budget-tx-narrow { display: inline-flex; gap: var(--px-space-2); flex-wrap: wrap; }
.budget-tx-narrow:not(:empty) { padding-left: var(--px-space-2); border-left: 1px solid var(--px-divider); }
.budget-tx-row {
  display: grid; grid-template-columns: minmax(0, 1fr) 170px 170px 110px; align-items: center; gap: var(--px-space-3);
  padding: 0 var(--px-space-3); box-sizing: border-box; width: 100%;
}
@container (max-width: 760px) {
.budget-tx-row { grid-template-columns: minmax(0, 1fr) 130px 96px; }
.budget-tx-row > :nth-child(3) { display: none; }
}
.budget-tx-cols { font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); margin-top: var(--px-space-2); }
.budget-tx-list { display: flex; flex-direction: column; }
.budget-tx-day {
  display: flex; justify-content: space-between; gap: var(--px-space-3);
  padding: var(--px-space-3) var(--px-space-3) var(--px-space-1);
  font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-muted);
}
.budget-tx-item {
  min-height: 44px; border: 0; border-radius: var(--px-radius-md); background: none;
  color: var(--px-text); font: inherit; text-align: left; cursor: pointer;
}
.budget-tx-item:hover { background: var(--px-surface-hover); }
.budget-tx-item:focus-visible { outline: 1px solid var(--px-accent); outline-offset: -1px; }
.budget-tx-who { display: flex; flex-direction: column; min-width: 0; }
.budget-tx-who > :first-child { font-weight: 500; }
.budget-tx-cat { display: flex; align-items: center; gap: var(--px-space-2); min-width: 0; }
.budget-tx-warn { color: var(--px-warning); }
.budget-dot-empty { box-shadow: inset 0 0 0 1px var(--px-border-strong); }
.budget-tx-amt { text-align: right; }
.budget-tx-amt.is-out { color: var(--px-text); }
.budget-tx-amt.is-in { color: var(--px-success); }
.budget-tx-amt.is-move { color: var(--px-text-muted); }
.budget-tx-more { padding: var(--px-space-3); }
.budget-how { display: flex; flex-direction: column; gap: var(--px-space-1); padding-top: var(--px-space-3); border-top: 1px solid var(--px-divider); }
.budget-how-step { display: flex; gap: var(--px-space-2); padding: var(--px-space-1) 0; }
.budget-how-icon {
  width: 22px; height: 22px; flex: 0 0 22px; border-radius: var(--px-radius-full);
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--px-surface-hover); color: var(--px-text-secondary);
}
.budget-how-text { display: flex; flex-direction: column; min-width: 0; font-size: var(--px-text-sm); }
/* ═══ Review ═══ */
.budget-rv-undo {
  box-sizing: border-box;
  display: flex; align-items: center; gap: var(--px-space-2);
  padding: var(--px-space-1) var(--px-space-2) var(--px-space-1) var(--px-space-4);
  border: 1px solid var(--px-border); border-radius: var(--px-radius-md);
  background: var(--px-bg-elevated); font-size: var(--px-text-sm);
}
.budget-rv-undo[hidden] { display: none; }
.budget-rv-grid { display: grid; grid-template-columns: minmax(200px, 280px) minmax(0, 1fr); gap: var(--px-space-4); align-items: start; }
@container (max-width: 720px) {
.budget-rv-grid { grid-template-columns: minmax(0, 1fr); }
}
.budget-rv-side { display: flex; flex-direction: column; gap: var(--px-space-2); min-width: 0; }
.budget-rv-list { display: flex; flex-direction: column; gap: 2px; }
.budget-rv-item {
  display: flex; flex-direction: column; gap: 2px; width: 100%; box-sizing: border-box;
  padding: var(--px-space-2) var(--px-space-3);
  border: 1px solid transparent; border-radius: var(--px-radius-md);
  background: none; color: var(--px-text); font: inherit; text-align: left; cursor: pointer;
}
.budget-rv-item:hover { background: var(--px-surface-hover); }
.budget-rv-item[aria-current="true"] { background: var(--px-bg-elevated); border-color: var(--px-border-strong); }
.budget-rv-item:focus-visible { outline: 1px solid var(--px-accent); outline-offset: -1px; }
.budget-rv-item-top { display: flex; gap: var(--px-space-2); min-width: 0; }
.budget-rv-tag { font-size: var(--px-text-sm); color: var(--px-warning); }
.budget-rv-card { gap: var(--px-space-4); padding: var(--px-space-5); }
.budget-rv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--px-space-3); }
.budget-rv-who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.budget-rv-name { font-size: var(--px-text-lg); font-weight: 600; overflow-wrap: anywhere; }
.budget-rv-block { display: flex; flex-direction: column; gap: var(--px-space-1); }
.budget-rv-compare { display: flex; flex-direction: column; gap: var(--px-space-1); padding: var(--px-space-3); border-radius: var(--px-radius-md); background: var(--px-surface-hover); }
.budget-rv-compare-row { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: var(--px-space-2); }
.budget-rv-verdict { overflow-x: auto; }
.budget-rv-cat { max-width: 280px; }
.budget-rv-remember { display: flex; flex-direction: column; gap: 2px; margin-top: var(--px-space-1); }
.budget-rv-check { display: inline-flex; align-items: center; gap: var(--px-space-2); cursor: pointer; }
.budget-rv-check input { accent-color: var(--px-accent); margin: 0; }
.budget-rv-check[hidden] { display: none; }
.budget-rv-actions { display: flex; align-items: center; gap: var(--px-space-2); padding-top: var(--px-space-3); border-top: 1px solid var(--px-divider); }
.budget-rv-pos { margin-left: auto; }
.budget-editor-blurb {
  margin: 0;
  font-size: var(--px-text-base, 13px);
  color: var(--vscode-descriptionForeground, #888);
  line-height: 1.55;
  max-width: 680px;
}
/* ═══ Section toolbar + content ═══
   The older pages (Bills, Trends, Reconcile, Categories, Sync Log, Import /
   Export) draw with these shared classes; they follow the same tokens and
   spacing as the redesigned pages. Buttons are the kit's (makeButton). */
.budget-toolbar {
  display: flex;
  align-items: center;
  gap: var(--px-space-2);
  flex-wrap: wrap;
  min-height: var(--px-control-h);
}
.budget-toolbar .spacer { flex: 1; }
.budget-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.budget-input {
  height: var(--px-control-h);
  box-sizing: border-box;
  background: var(--px-bg-inset);
  color: var(--px-text);
  border: 1px solid var(--px-border);
  border-radius: var(--px-radius-sm);
  padding: 0 var(--px-space-2);
  font: inherit;
  font-size: var(--px-text-sm);
}
.budget-input::placeholder { color: var(--px-text-faint); }
.budget-input:hover { border-color: var(--px-border-strong); }
/* A name you can retype in place: reads as text until hovered or focused. */
.budget-inline-input { width: 100%; max-width: 260px; background: transparent; border-color: transparent; font-weight: 500; }
.budget-inline-input:hover { background: var(--px-bg-inset); }
.budget-inline-input::placeholder { color: var(--px-text); }
.budget-cat-limit { width: 110px; text-align: right; }
.budget-color {
  width: 28px; height: 20px; padding: 0; border: 1px solid var(--px-border); border-radius: var(--px-radius-sm);
  background: transparent; cursor: pointer;
}
.budget-color::-webkit-color-swatch-wrapper { padding: 2px; }
.budget-color::-webkit-color-swatch { border: 0; border-radius: var(--px-radius-xs, 2px); }
.budget-cell-more { text-align: right; }
/* A narrow pane keeps the name readable: Transactions and As of step aside. */
@container (max-width: 820px) {
.budget-accounts-table th:nth-child(4), .budget-accounts-table td:nth-child(4),
.budget-accounts-table th:nth-child(6), .budget-accounts-table td:nth-child(6) { display: none; }
.budget-accounts-table th:nth-child(2) { width: 140px !important; }
}
/* The ~40 lines of .budget-select styling that used to sit here are gone with the
   last native <select> in this extension — including the appearance:none +
   gradient-arrow trick and the option/optgroup colours, which only ever existed
   because a Chromium-drawn <select> popup cannot be themed. That is the reason
   for the rule; there is nothing left here to theme around. */
/* ═══ Dropdown host ═══
   The dropdown itself is the core .ui-dropdown component, mounted inside this
   wrapper by makeDropdown(). ~45 lines of trigger/menu/option styling used to
   live here for a hand-rolled clone; all of it is now dropdown.css, so the whole
   app's dropdowns look and behave the same and get fixed together.

   What remains is the sizing bridge only: .ui-dropdown is inline-block with its
   own min-width, so it has to be told to fill a table cell or a form field.
   Same shape as text-generator's .tg-dd. */
.budget-dd { position: relative; display: inline-block; }
.budget-dd .ui-dropdown { width: 100%; min-width: 0; }
.budget-table .budget-dd { min-width: 150px; }
.budget-input:focus { outline: none; border-color: var(--px-accent); }
.budget-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--px-text-muted);
  font-size: var(--px-text-sm);
}
/* Tables: the same rows as the redesigned lists — a hairline between rows,
   a quiet heading row, amounts right-aligned in tabular figures. */
.budget-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--px-text-sm);
}
.budget-table th, .budget-table td {
  text-align: left;
  height: 40px;
  padding: 0 var(--px-space-3);
  border-bottom: 1px solid var(--px-divider);
  vertical-align: middle;
}
.budget-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 32px;
  background: var(--px-bg);
  font-weight: 600;
  color: var(--px-text-secondary);
  white-space: nowrap;
}
.budget-table tbody tr:hover { background: var(--px-surface-hover); }
.budget-table td.budget-amount, .budget-table th.budget-amount { text-align: right; }
.budget-table tbody tr.is-archived td { color: var(--px-text-muted); }
.budget-table tr.budget-total-row td {
  border-top: 1px solid var(--px-border-strong);
  border-bottom: none;
  font-weight: 600;
}
.budget-amount {
  font-variant-numeric: tabular-nums;
  font-variant-numeric: tabular-nums lining-nums;
  text-align: right;
  white-space: nowrap;
}
.budget-amount.negative { color: var(--vscode-charts-red, #a43b38); }
.budget-amount.positive { color: var(--vscode-charts-green, #5da56e); }
/* Status tags — quiet outline chips, uppercase, square. No filled pills. */
.budget-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 5px;
  border-radius: 2px;
  font-size: var(--px-text-xs);
  letter-spacing: normal;
  text-transform: none;
  line-height: 15px;
  background: transparent;
  border: 1px solid var(--vscode-panel-border, #555);
  color: var(--vscode-descriptionForeground, #aaa);
}
.budget-pill.review, .budget-pill.low {
  border-color: var(--vscode-charts-orange, #965719);
  color: var(--px-warning);
}
.budget-pill.confirmed, .budget-pill.high {
  border-color: var(--vscode-charts-green, #5da56e);
  color: var(--px-success);
}
.budget-pill.hidden { opacity: 0.7; }
.budget-pill.deleted {
  border-color: var(--vscode-charts-red, #a43b38);
  color: var(--px-danger);
}
.budget-pill.medium {
  border-color: var(--vscode-charts-blue, #5a8bca);
  color: var(--vscode-charts-blue, #5a8bca);
}
.budget-cat-swatch {
  display: inline-block;
  width: 9px; height: 9px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: middle;
}
/* Summary cards: the Overview's card, three across. */
.budget-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--px-space-4);
}
.budget-card {
  padding: var(--px-space-4);
  border: 1px solid var(--px-border);
  border-radius: var(--px-radius-lg);
  background: var(--px-bg-elevated);
  display: flex; flex-direction: column; gap: 2px;
  min-width: 0;
}
.budget-card-clickable { cursor: pointer; }
.budget-card-clickable:hover { border-color: var(--px-border-strong); background: var(--px-surface-hover); }
.budget-card-clickable:focus-visible { outline: 2px solid var(--px-accent); outline-offset: 1px; }
.budget-card-label { font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.budget-card-value {
  font-size: var(--px-text-xl);
  font-weight: 600;
  margin-top: var(--px-space-1);
  font-variant-numeric: tabular-nums;
  color: var(--px-text);
}
.budget-card-sub { font-size: var(--px-text-sm); color: var(--px-text-muted); }
.budget-cat-bar {
  display: grid;
  grid-template-columns: 110px 1fr 70px;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  font-size: var(--px-text-xs, 11px);
}
.budget-cat-bar .bar-track {
  height: 6px;
  background: var(--vscode-input-background, rgba(255,255,255,0.06));
  border-radius: 3px;
  overflow: hidden;
}
.budget-cat-bar .bar-fill {
  height: 100%;
  border-radius: 3px;
}
.budget-cat-bar .amt {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--vscode-descriptionForeground, #aaa);
}
.budget-section {
  display: flex;
  flex-direction: column;
  gap: var(--px-space-3);
}
.budget-section:empty { display: none; }
.budget-section h3 {
  margin: 0;
  font-size: var(--px-text-sm);
  font-weight: 600;
  color: var(--px-text-secondary);
}
.budget-log-row {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}
.budget-log-row.warn  td { color: var(--vscode-charts-yellow, #a9912b); }
.budget-log-row.error td { color: var(--vscode-charts-red, #a43b38); }
/* ═══ Month picker ═══ */
.budget-month-picker .label {
  min-width: 110px;
  text-align: center;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
/* ═══ Account card ═══ */
.budget-account-card .acct-balance.credit { color: var(--vscode-charts-orange, #fb923c); }
/* ═══ Hero cards (M64 P2) — equal-height grid ═══ */
.budget-hero-cards .budget-card {
  display: flex;
  flex-direction: column;
  min-height: 96px;
}
/* ═══ Toolbar meta ═══ */
/* ═══ Status chips (above hero cards) ═══ */
.budget-status-chip .dot {
  width: 6px; height: 6px; border-radius: 50%;
}
.budget-status-chip--review .dot { background: var(--vscode-charts-orange, #f97316); }
.budget-status-chip--untyped .dot { background: var(--vscode-charts-yellow, #eab308); }
/* ═══ Account card kind selector ═══ */
/* ═══ Section heading ═══ */
/* ═══ Segmented control (range pills, mode toggles) ═══ */
/* ═══ Icon button (heatmap month nav) ═══ */
/* ═══ Balance trend chart ═══ */
.budget-trend-tip .d { font-weight: 600; margin-bottom: 4px; }
.budget-trend-tip .sw {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 2px; margin-right: 6px; vertical-align: middle;
}
.budget-trend-delta.is-up { color: var(--vscode-charts-green, #22c55e); }
.budget-trend-delta.is-down { color: var(--vscode-charts-red,   #f87171); }
/* ═══ Cash-flow chart (M64 P3 redesign) ═══ */
/* ═══ Headline narrative ═══ */
/* ═══ Filter chip (account multi-select) ═══ */
/* (Category budget bars styled further down — see "Category budget bars".) */
/* ═══ Allocation bar (single stacked bar over Accounts) ═══ */
.budget-alloc-legend-item .sw {
  width: 8px; height: 8px; border-radius: 2px; display: inline-block;
}
/* ═══ Needs attention panel ═══ */
/* ═══ Two-column dashboard layout ═══ */
/* ═══ Daily heatmap ═══ */
.budget-heatmap-cell .day {
  font-size: 10px;
  font-weight: 500;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.budget-heatmap-cell.is-today .day {
  opacity: 1;
  font-weight: 700;
}
/* Discrete intensity buckets — five steps look more honest than a smooth gradient. */
/* ═══ SVG chart accents ═══ */
.budget-chart-bar { cursor: pointer; transition: opacity 0.12s; }
.budget-chart-bar:hover { opacity: .82; }
.budget-chart-grid { stroke: var(--vscode-panel-border, #2a2a2a); stroke-width: 1; opacity: .4; }
.budget-chart-axis {
  fill: var(--vscode-descriptionForeground, #888);
  font-size: 11px;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}
.budget-chart-legend {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #aaa);
  margin-top: 10px;
  flex-wrap: wrap;
  font-family: inherit;
}
.budget-chart-legend .swatch {
  display: inline-block;
  width: 12px; height: 2px;
  border-radius: 1px;
  vertical-align: middle;
}
/* ═══ Transaction editor drawer ═══ */
.budget-drawer-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0, 0, 0, 0.5);
  display: flex; justify-content: flex-end;
  animation: budget-fade 120ms ease;
}
.budget-drawer {
  width: 440px; max-width: 92vw; height: 100%;
  display: flex; flex-direction: column;
  background: var(--px-bg-elevated, var(--vscode-editor-background, #1e1e1e));
  color: var(--px-text, var(--vscode-editor-foreground, #ddd));
  border-left: 1px solid var(--px-border, var(--vscode-panel-border, #2a2a2a));
  box-shadow: var(--px-shadow-lg, -8px 0 30px rgba(0, 0, 0, 0.45));
  animation: budget-slide-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes budget-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes budget-slide-in { from { transform: translateX(24px); opacity: 0.5; } to { transform: none; opacity: 1; } }
.budget-drawer-head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--px-divider, var(--vscode-panel-border, #2a2a2a));
}
.budget-drawer-title { margin: 0; font-size: var(--px-text-md, 15px); font-weight: 600; flex: 1; }
.budget-drawer-sub { font-size: var(--px-text-xs, 11px); color: var(--px-text-muted, var(--vscode-descriptionForeground, #888)); }
.budget-drawer-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--px-control-h-sm); height: var(--px-control-h-sm); padding: 0; border: none; border-radius: var(--px-radius-sm, 4px);
  background: transparent; color: var(--px-text-muted, var(--vscode-descriptionForeground, #888)); cursor: pointer;
}
.budget-drawer-close:hover { background: var(--px-surface-hover, var(--vscode-list-hoverBackground, rgba(255,255,255,0.06))); color: var(--px-text, inherit); }
.budget-drawer-body { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }
.budget-field { display: flex; flex-direction: column; gap: 5px; }
.budget-field-label { font-size: var(--px-text-xs, 11px); font-weight: 600; letter-spacing: normal; text-transform: none; color: var(--px-text-muted, var(--vscode-descriptionForeground, #888)); }
.budget-field-hint { font-size: var(--px-text-xs, 11px); color: var(--px-text-faint, var(--vscode-descriptionForeground, #777)); }
.budget-field .budget-input, .budget-field .budget-drawer-textarea, .budget-field .budget-dd { width: 100%; box-sizing: border-box; }
.budget-field-row { display: flex; gap: 10px; }
.budget-field-row > .budget-field { flex: 1; min-width: 0; }
.budget-drawer-textarea {
  background: var(--px-bg-inset, var(--vscode-input-background, rgba(255,255,255,0.04)));
  color: var(--px-text, var(--vscode-input-foreground, #ccc));
  border: 1px solid var(--px-border, var(--vscode-input-border, #555));
  border-radius: var(--px-radius-sm, 4px); padding: 7px 9px; font: inherit; font-size: var(--px-text-sm, 12px);
  min-height: 58px; resize: vertical;
}
.budget-drawer-foot {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--px-divider, var(--vscode-panel-border, #2a2a2a));
}
.budget-drawer-foot .spacer { flex: 1; }
.budget-btn-danger {
  background: var(--px-danger-soft, rgba(224, 108, 102, 0.15));
  color: var(--px-danger, #e06c66);
  border-color: transparent;
}
.budget-btn-danger:hover { background: var(--px-danger, #e06c66); color: #fff; }
.budget-table tbody tr.budget-row-clickable { cursor: pointer; }
.budget-table tbody tr.budget-row-clickable:hover { background: var(--px-surface-hover, var(--vscode-list-hoverBackground, rgba(255,255,255,0.05))); }
.budget-table tbody tr:hover .budget-row-edit, .budget-table tbody tr:focus-within .budget-row-edit { opacity: 1; }
/* ═══ Net Worth ═══ */
.budget-networth-head { display: flex; flex-direction: column; gap: 2px; }
.budget-networth-label { font-size: var(--px-text-xs, 11px); text-transform: none; letter-spacing: normal; color: var(--px-text-muted, var(--vscode-descriptionForeground, #888)); }
.budget-networth-value { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; margin-top: 2px; color: var(--px-text, var(--vscode-editor-foreground, #eee)); font-variant-numeric: tabular-nums; }
.budget-networth-sub { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.budget-nw-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: var(--px-radius-full, 999px);
  font-size: var(--px-text-xs, 11px); font-weight: 600;
  background: var(--px-bg-inset, var(--vscode-input-background, rgba(255, 255, 255, 0.05)));
  color: var(--px-text-secondary, var(--vscode-descriptionForeground, #bbb));
  border: 1px solid var(--px-border, transparent);
}
.budget-nw-chip.is-liab { color: var(--px-danger, #e06c66); }
.budget-nw-chip.is-up { color: var(--px-success, #6cbf8f); }
.budget-nw-chip.is-down { color: var(--px-danger, #e06c66); }
.budget-nw-groups { display: flex; flex-direction: column; gap: 18px; }
.budget-nw-group { display: flex; flex-direction: column; }
.budget-nw-group-head {
  display: flex; align-items: baseline; justify-content: space-between;
  padding: 0 2px 6px; border-bottom: 1px solid var(--px-divider, var(--vscode-panel-border, #2a2a2a));
}
.budget-nw-group-title { font-size: var(--px-text-xs, 11px); font-weight: 700; text-transform: none; letter-spacing: normal; color: var(--px-text-muted, var(--vscode-descriptionForeground, #888)); }
.budget-nw-group-total { font-size: var(--px-text-base, 13px); font-weight: 600; color: var(--px-text, inherit); font-variant-numeric: tabular-nums; }
.budget-nw-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  width: 100%; box-sizing: border-box; text-align: left;
  padding: 9px 2px; border: none; border-bottom: 1px solid var(--px-chrome-line, rgba(255, 255, 255, 0.04));
  background: transparent; color: inherit; font: inherit;
}
.budget-nw-row-clickable { cursor: pointer; border-radius: var(--px-radius-sm, 4px); }
.budget-nw-row-clickable:hover { background: var(--px-surface-hover, var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05))); }
.budget-nw-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.budget-nw-row-name { font-size: var(--px-text-base, 13px); font-weight: 500; color: var(--px-text, inherit); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.budget-nw-row-sub { font-size: var(--px-text-xs, 11px); color: var(--px-text-muted, var(--vscode-descriptionForeground, #888)); }
.budget-nw-row-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex: 0 0 auto; }
.budget-nw-row-amt { font-size: var(--px-text-base, 13px); font-weight: 600; font-variant-numeric: tabular-nums; }
.budget-nw-row-pct { font-size: var(--px-text-xs, 11px); color: var(--px-text-faint, var(--vscode-descriptionForeground, #777)); }
.budget-nw-mgmt-head { font-size: var(--px-text-xs, 11px); font-weight: 700; text-transform: none; letter-spacing: normal; color: var(--px-text-muted, var(--vscode-descriptionForeground, #888)); margin: 4px 2px 8px; }
/* ═══ Goals ═══ */
.budget-goals { display: flex; flex-direction: column; gap: var(--px-space-3); }
.budget-goal-card {
  display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box; text-align: left;
  padding: 14px 16px; border: 1px solid var(--px-border, var(--vscode-panel-border, #2a2a2a)); border-radius: var(--px-radius-md, 6px);
  background: var(--px-bg-elevated, var(--vscode-input-background, rgba(255, 255, 255, 0.03))); color: inherit; font: inherit; cursor: pointer;
  transition: border-color 120ms ease;
}
.budget-goal-card:hover { border-color: var(--px-border-strong, var(--vscode-focusBorder, #5b9bd5)); }
.budget-goal-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.budget-goal-name { font-size: var(--px-text-md, 15px); font-weight: 600; color: var(--px-text, inherit); }
.budget-goal-kind { font-size: var(--px-text-xs, 11px); font-weight: 600; text-transform: none; letter-spacing: normal; color: var(--px-accent-text); }
.budget-goal-kind.is-debt { color: var(--px-warning, #dcaa5a); }
.budget-goal-bar { height: 8px; border-radius: 999px; background: var(--px-bg-inset, rgba(255, 255, 255, 0.07)); overflow: hidden; }
.budget-goal-fill { height: 100%; border-radius: 999px; background: var(--px-success, #6cbf8f); transition: width 320ms cubic-bezier(0.16, 1, 0.3, 1); }
.budget-goal-fill.is-debt { background: var(--px-warning, #dcaa5a); }
.budget-goal-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.budget-goal-amt { font-size: var(--px-text-sm, 12px); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--px-text, inherit); }
.budget-goal-proj { font-size: var(--px-text-xs, 11px); color: var(--px-text-muted, var(--vscode-descriptionForeground, #888)); }
/* ═══ Spending donut ═══ */
/* With nothing to chart, the empty message spans the row like every other empty state. */
.budget-donut-wrap > .budget-empty { flex: 1 1 100%; }
/* ═══ Recurring / subscriptions list ═══ */
.budget-recur { display: flex; flex-direction: column; border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); overflow: hidden; }
.budget-recur:empty { display: none; }
.budget-recur-row { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-bottom: 1px solid var(--px-chrome-line, rgba(255, 255, 255, 0.04)); }
.budget-recur-row:last-child { border-bottom: none; }
.budget-recur-row:hover { background: var(--px-surface-hover, var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.04))); }
.budget-recur-row.is-cancelled { opacity: 0.5; }
.budget-recur-main { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.budget-recur-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.budget-recur-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.budget-recur-name { font-size: var(--px-text-base, 13px); font-weight: 500; color: var(--px-text, inherit); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.budget-recur-sub { font-size: var(--px-text-xs, 11px); color: var(--px-text-muted, var(--vscode-descriptionForeground, #888)); }
.budget-recur-low { color: var(--px-warning, #dcaa5a); }
.budget-recur-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex: 0 0 auto; min-width: 92px; }
.budget-recur-amt { font-size: var(--px-text-base, 13px); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--px-text, inherit); }
.budget-recur-due { font-size: var(--px-text-xs, 11px); color: var(--px-text-muted, var(--vscode-descriptionForeground, #888)); }
.budget-recur-acts { display: flex; gap: 6px; flex: 0 0 auto; opacity: 0; transition: opacity 120ms ease; }
.budget-recur-row:hover .budget-recur-acts, .budget-recur-row:focus-within .budget-recur-acts { opacity: 1; }
/* ═══ Category budget bars (actual vs target vs prior) ═══ */
.budget-catrow-left .budget-cat-swatch { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; display: inline-block; }
.budget-catrow-fill.is-over { background: var(--px-danger, #e06c66); }
.budget-catrow-amt.is-over { color: var(--px-danger, #e06c66); }
.budget-catrow-trend.is-up { color: var(--px-danger, #e06c66); }
.budget-catrow-trend.is-down { color: var(--px-success, #6cbf8f); }
/* ═══ M93 ledger components ═══ */
/* Category progress tracks — square ruled bars, not rounded pills. */
.bar-track {
  height: 6px;
  background: color-mix(in srgb, var(--vscode-foreground, #ddd) 7%, transparent);
  border-radius: 1px;
  overflow: hidden;
}
.bar-fill { height: 100%; border-radius: 1px; }
/* Insights register — ruled rows, typographic glyph column, mono amounts. */
.budget-insight-title .sub { color: var(--vscode-descriptionForeground, #888); }
.budget-insight-amt.negative { color: var(--vscode-charts-red, #a43b38); }
.budget-insight-amt.positive { color: var(--vscode-charts-green, #5da56e); }
/* Bullet bar (budget vs actual): track = limit, fill = spent, tick = pace. */
.budget-bullet-fill.is-over { background: var(--vscode-charts-red, #a43b38); }
/* Next-month planning */
`;
  document.head.appendChild(style);
}

function makeIcon(api, name, size) {
  if (!api.icons || typeof api.icons.createIconHtml !== 'function' || !api.icons.hasIcon(name)) return '';
  return api.icons.createIconHtml(name, size || 16);
}

// ─── Sidebar ───────────────────────────────────────────────────────────────
//
// The month at a glance (what is left to spend), the sections with the review
// count, and the sync status with one Sync Now. Refreshes on sync and ledger
// changes.
function renderSidebarNav(container, api) {
  injectStyles();
  const root = document.createElement('div');
  root.className = 'budget-nav';

  const glance = document.createElement('div');
  glance.className = 'budget-glance';
  root.appendChild(glance);

  const list = document.createElement('nav');
  list.className = 'budget-nav-list';
  list.setAttribute('aria-label', 'Budget');
  root.appendChild(list);

  const rows = new Map();
  for (const section of SECTIONS) {
    if (section.nav === false) continue;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'budget-nav-row';
    const iconHtml = makeIcon(api, section.icon, 16);
    if (iconHtml) {
      const iconWrap = document.createElement('span');
      iconWrap.className = 'budget-icon';
      iconWrap.innerHTML = iconHtml;
      row.appendChild(iconWrap);
    }
    const label = document.createElement('span');
    label.className = 'budget-label';
    label.textContent = section.title;
    row.appendChild(label);
    const count = document.createElement('span');
    count.className = 'budget-nav-count';
    count.hidden = true;
    row.appendChild(count);
    row.addEventListener('click', () => {
      openBudgetSection(api, section.id).catch(err => console.error('[Budget] open section failed:', err));
    });
    list.appendChild(row);
    rows.set(section.id, { row, count });
  }

  const footer = document.createElement('div');
  footer.className = 'budget-nav-footer';
  const status = document.createElement('div');
  status.className = 'budget-nav-status';
  footer.appendChild(status);
  const syncBtn = api.ui.createIconButton(footer, { icon: 'refresh-cw', title: 'Sync Now' });
  syncBtn.addEventListener('click', () => { api.commands.executeCommand('budget.sync').catch(err => console.error('[Budget] sync failed:', err)); });
  root.appendChild(footer);

  const markCurrent = (id) => {
    for (const [sid, r] of rows) {
      if (sid === id) r.row.setAttribute('aria-current', 'page'); else r.row.removeAttribute('aria-current');
    }
  };
  markCurrent(_currentSection);

  let disposed = false;
  async function refresh() {
    if (disposed || !_dbBridge) return;
    try {
      const [g, review, sync] = await Promise.all([readMonthGlance(), countReview(), readSyncStatus()]);
      if (disposed) return;
      renderGlance(glance, g);
      const rc = rows.get('review');
      if (rc) { rc.count.hidden = !review; rc.count.textContent = String(review); }
      status.textContent = sync;
    } catch (err) {
      console.warn('[Budget] sidebar refresh failed:', err);
    }
  }
  function onSync(evt) {
    if (evt.kind === 'start') status.textContent = 'Syncing with Gmail…';
    else if (evt.kind === 'progress' && evt.stage) status.textContent = `Syncing: ${evt.stage}…`;
    else refresh();
  }
  refresh = serialRefresh(refresh);
  const offSync = onSyncEvent(onSync);
  const offLedger = onLedgerChanged(refresh);
  _sectionListeners.add(markCurrent);
  refresh();

  container.appendChild(root);
  return {
    dispose() {
      disposed = true;
      offSync(); offLedger(); _sectionListeners.delete(markCurrent);
      try { container.removeChild(root); } catch { /* container already gone */ }
    },
  };
}

function renderGlance(host, g) {
  host.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'budget-glance-label';
  label.textContent = g.monthName;
  host.appendChild(label);
  const big = document.createElement('div');
  big.className = 'budget-glance-big';
  if (g.limitCents > 0) {
    const n = document.createElement('span');
    n.className = 'budget-num';
    n.textContent = fmtMoney(Math.abs(g.leftCents));
    big.appendChild(n);
    big.appendChild(document.createTextNode(g.leftCents >= 0 ? ' left to spend' : ' over plan'));
    host.appendChild(big);
    const bar = document.createElement('div');
    bar.className = 'budget-glance-bar';
    const fill = document.createElement('div');
    fill.className = 'budget-glance-fill' + (g.leftCents < 0 ? ' is-over' : '');
    fill.style.width = `${Math.max(0, Math.min(100, g.usedPct))}%`;
    bar.appendChild(fill);
    host.appendChild(bar);
    const hint = document.createElement('div');
    hint.className = 'budget-glance-hint';
    hint.textContent = g.daysLeft > 0 && g.leftCents > 0
      ? `${g.daysLeft} day${g.daysLeft === 1 ? '' : 's'} left · about ${fmtMoney(Math.floor(g.leftCents / g.daysLeft / 100) * 100).replace(/\.00$/, '')} a day`
      : `${g.daysLeft} day${g.daysLeft === 1 ? '' : 's'} left`;
    host.appendChild(hint);
  } else {
    big.textContent = 'No plan for this month yet.';
    host.appendChild(big);
  }
}

async function countReview() {
  const r = await db.get(`SELECT COUNT(*) AS n FROM transactions WHERE status='review'`);
  return Number(r?.n) || 0;
}

async function readSyncStatus() {
  const last = (await getSyncStateValue('last_run_at')) || (await getSyncStateValue('last_synced_at'));
  if (!last) return 'Not synced yet';
  const d = new Date(last);
  if (Number.isNaN(d.getTime())) return 'Synced';
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return same ? `Synced at ${time}` : `Synced ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// ─── The Budget editor ─────────────────────────────────────────────────────
//
// One tab. A page header per section (title, the section's one main action,
// ⋯ with sync, logs, import and settings), then the section's content.
function renderEditorPane(container, api, input) {
  injectStyles();
  const instanceId = String((input && (input.instanceId || input.id)) || '');
  // A tab restored from before Budget became one tab ('budget:dashboard',
  // 'budget:goals', …): open its section in the Budget tab, then close it.
  if (instanceId && !instanceId.endsWith('budget:main')) {
    const note = emptyState('Budget now opens in one tab.');
    container.appendChild(note);
    const [sid, view] = routeForInstanceId(instanceId);
    const legacyKey = instanceId.slice(instanceId.lastIndexOf('budget:'));
    setTimeout(async () => {
      try {
        await openBudgetSection(api, sid, view);
        const old = (api.editors.openEditors || []).find(e => e.id.endsWith(legacyKey));
        if (old) await api.editors.closeEditor(old.id);
      } catch (err) { console.warn('[Budget] could not fold an old tab into Budget:', err); }
    }, 0);
    return { dispose() { try { container.removeChild(note); } catch { /* gone */ } } };
  }
  const el = document.createElement('div');
  el.className = 'budget-editor';
  const pageEl = document.createElement('div');
  pageEl.className = 'budget-page';
  const head = document.createElement('div');
  head.className = 'budget-editor-head';
  const body = document.createElement('div');
  body.className = 'budget-editor-body';
  pageEl.append(head, body);
  el.appendChild(pageEl);
  container.appendChild(el);

  let cleanup = null;
  function moreItems() {
    return [
      { label: 'Sync Now', icon: 'refresh-cw', onSelect: () => api.commands.executeCommand('budget.sync') },
      { label: 'Sync Log', icon: 'scroll-text', onSelect: () => show('syncLog') },
      { label: 'Import / Export', icon: 'arrow-up-down', onSelect: () => show('importExport') },
      { label: 'Reprocess History…', onSelect: () => api.commands.executeCommand('budget.reprocessHistory') },
      { separator: true },
      { label: 'Budget Settings…', icon: 'settings', onSelect: () => api.commands.executeCommand('settings.open', 'schema:Budget') },
    ];
  }
  function show(sectionId, view) {
    const section = SECTIONS.find(s => s.id === sectionId) || SECTIONS[0];
    if (typeof cleanup === 'function') { try { cleanup(); } catch { /* best-effort */ } }
    cleanup = null;
    head.innerHTML = '';
    body.innerHTML = '';
    body.dataset.section = section.id;
    _setCurrentSection(section.id);
    const back = section.nav === false ? { label: 'Overview', onClick: () => show('overview') } : undefined;
    // A page puts its own main action in the header (setPageActions), as
    // every Parallx page does, instead of a stray button in its body.
    const drawHeader = (actions = {}) => {
      head.replaceChildren();
      api.ui.createPageHeader(head, { title: section.title, back, primary: actions.primary, secondary: actions.secondary, more: moreItems() });
    };
    _setPageActions = drawHeader;
    drawHeader();
    try {
      cleanup = renderSection(section.id, body, api, view) || null;
    } catch (e) {
      console.error('[Budget] section render failed:', section.id, e);
      body.appendChild(emptyState('This page could not be drawn: ' + (e instanceof Error ? e.message : String(e))));
    }
    el.scrollTop = 0;
  }

  const [startId, startView] = _navState.section
    ? [_navState.section, _navState.planView]
    : ['overview', null];
  _navState.section = null;
  _navState.planView = null;
  _liveEditorShow = show;
  show(startId, startView);

  return {
    dispose() {
      if (_liveEditorShow === show) { _liveEditorShow = null; _setPageActions = null; }
      try { if (typeof cleanup === 'function') cleanup(); } catch { /* best-effort */ }
      try { container.removeChild(el); } catch { /* container already gone */ }
    },
  };
}

function renderSection(id, body, api, view) {
  switch (id) {
    case 'overview':     return renderOverviewSection(body, api);
    case 'review':       return renderReviewQueueSection(body, api);
    case 'transactions': return renderTransactionsSection(body, api);
    case 'plan':         return renderPlanSection(body, api, view);
    case 'worth':        return renderWorthSection(body, api);
    case 'rules':        return renderRulesSection(body, api);
    case 'categories':   return renderCategoriesSection(body, api);
    case 'syncLog':      return renderSyncLogSection(body, api);
    case 'importExport': return renderImportExportSection(body, api);
    default:             return renderOverviewSection(body, api);
  }
}

// Net Worth and Goals: what you hold beside what you are saving toward, then
// the synced accounts to rename, retype or archive. The two "add" actions sit
// in the page header.
function renderWorthSection(body, api) {
  const grid = document.createElement('div');
  grid.className = 'budget-worth';
  const holdings = document.createElement('div');
  holdings.className = 'budget-worth-col';
  const goals = document.createElement('div');
  goals.className = 'budget-worth-col budget-worth-goals';
  grid.append(holdings, goals);
  const manage = document.createElement('div');
  manage.className = 'budget-worth-manage';
  body.append(grid, manage);
  const actions = {};
  const a = renderAccountsSection(holdings, api, { manageHost: manage, actions });
  const g = renderGoalsSection(goals, api, { actions });
  setPageActions({
    primary: { label: 'Add Asset or Debt…', icon: 'plus', onClick: () => actions.addHolding?.() },
    secondary: [{ label: 'New Goal…', icon: 'plus', onClick: () => actions.newGoal?.() }],
  });
  return () => { if (typeof a === 'function') a(); if (typeof g === 'function') g(); };
}

// ─── Display helpers ───────────────────────────────────────────────────────

function fmtMoney(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100);
  const c = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars.toLocaleString('en-US')}.${c}`;
}

function fmtDate(d) {
  if (!d) return '';
  return String(d).slice(0, 10);
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// The kit's button (api.ui.createButton): one height, radius and hierarchy
// with the rest of Parallx. The label is the button's last <span>.
function makeButton(label, opts = {}) {
  return _api.ui.createButton(null, {
    label,
    kind: opts.primary ? 'primary' : (opts.kind || 'secondary'),
    size: opts.size,
    icon: opts.icon,
    title: opts.title,
    onClick: typeof opts.onClick === 'function' ? opts.onClick : undefined,
  });
}

function emptyState(msg) {
  // THE empty-state box (.px-empty): the same centring, spacing and hint rule
  // every core surface uses; the copy stays the caller's one line.
  const div = document.createElement('div');
  div.className = 'budget-empty px-empty';
  const hint = document.createElement('div');
  hint.className = 'px-empty__hint';
  hint.textContent = msg;
  div.appendChild(hint);
  return div;
}

// ─── Dropdown: adapter over api.ui.createDropdown ───────────────────────────
//
// This used to be a 200-line hand-rolled dropdown. It is now a thin shim over
// `api.ui.createDropdown` — the ONE `.ui-dropdown` component the whole app uses.
//
// The clone existed because the core component could not survive being inside a
// scrolling table: its option list was `position: absolute` inside the wrapper,
// so `.budget-editor { overflow: auto }` clipped it. Rather than keep a second
// dropdown alive to work around that, the core one now mounts its list in a
// body-level fixed layer, flips above the trigger when space is tight, scrolls
// long option sets without dismissing itself, and takes an optional `color` per
// item — the swatch this extension needs for categories. So there is nothing left
// for a local copy to do.
//
// What the clone cost, for the record: a capture-phase `window` scroll listener
// that closed the menu unconditionally, which meant the category list on a
// transaction row could not be scrolled at all — it dismissed itself on the first
// wheel tick. Every fix here is a fix everywhere now.
//
// The signature and the `.value` / `.setOptions` surface are unchanged, so the
// call sites did not move.
function makeDropdown(options, value, onChange, opts = {}) {
  const root = document.createElement('div');
  root.className = 'budget-dd' + (opts.className ? ' ' + opts.className : '');

  const items = (Array.isArray(options) ? options : []).map(o => ({
    value: String(o.value ?? ''), label: String(o.label ?? ''), color: o.color,
  }));

  const dd = _api.ui.createDropdown(root, {
    items,
    selected: value == null ? '' : String(value),
    placeholder: opts.placeholder || 'Select…',
    ariaLabel: opts.ariaLabel,
  });

  if (typeof onChange === 'function') dd.onDidChange(v => onChange(v));

  Object.defineProperty(root, 'value', {
    get() { return dd.value; },
    set(v) { dd.value = v == null ? '' : String(v); },
  });

  // Swap the option set (and optionally the value) — for dependent dropdowns.
  // Both in one call so the trigger never flashes the placeholder in between.
  root.setOptions = (newOptions, newValue) => {
    dd.setItems(
      (Array.isArray(newOptions) ? newOptions : []).map(o => ({
        value: String(o.value ?? ''), label: String(o.label ?? ''), color: o.color,
      })),
      newValue === undefined ? undefined : (newValue == null ? '' : String(newValue)),
    );
  };
  root.focus = () => dd.focus();
  root.dispose = () => dd.dispose();
  return root;
}

// Category options for makeDropdown, with the category colour as a swatch.
function categoryOptions(categories, placeholder) {
  return [{ value: '', label: placeholder || 'No category' }].concat(
    (categories || []).map(c => ({ value: c.id, label: c.name, color: c.color })),
  );
}

/**
 * Category options narrowed to the kind that matches a transaction type, so an
 * expense does not offer "Income" and a transfer does not offer "Groceries".
 *
 * Restores what appendCategoryOptions() did for the old native <select>; the
 * behaviour was dropped when the editor moved to makeDropdown and nothing carried
 * the scoping across. Two guards from the original are kept because both matter:
 *
 *  - The currently-selected category survives even when its kind does not match.
 *    Rows categorised across kinds exist (the AI pipeline can produce them), and
 *    an editor that silently drops the category on open would save that loss the
 *    moment the user touched anything else.
 *  - If scoping would empty the list — a workspace whose categories are all one
 *    kind — the unscoped list is used. An empty picker is worse than a loose one.
 */
function scopedCategoryOptions(categories, txType, selectedId, placeholder) {
  const all = Array.isArray(categories) ? categories : [];
  const targetKind = txType ? categoryKindForTxType(txType) : null;
  let scoped = all;
  if (targetKind) {
    const match = all.filter(c => c.kind === targetKind || c.id === selectedId);
    if (match.length > 0) scoped = match;
  }
  return categoryOptions(scoped, placeholder);
}

// ─── Month / date math ─────────────────────────────────────────────────────
//
// Everything user-facing in this extension is anchored to American Central
// Time (America/Chicago). The user lives in CT; the dashboard "today,"
// month buckets, transaction-date stamps, and "5m ago" labels must all
// agree with their wall clock — not with whatever zone the OS reports or
// whatever zone an email's ISO timestamp happens to be in.
//
// Internal storage stays ISO-UTC (received_at, processed_at, etc.); only
// the rendering / bucketing layer reads through these helpers.
const BUDGET_TZ = 'America/Chicago';

// Extract {y, m, d} (1-indexed month) for a Date in Central Time.
function ctParts(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) d = new Date();
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: BUDGET_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (k) => Number(p.find((x) => x.type === k).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

// Returns a Date whose LOCAL-zone Y/M/D match Central's wall clock for the
// given instant (or "now" if omitted). All downstream month-arithmetic in
// this file uses local-zone Date constructors + getFullYear/getMonth/getDate,
// so we hand it a Date pre-tuned to Central so that arithmetic produces
// the months the user expects to see.
function ctToday(d) {
  const p = ctParts(d || new Date());
  return new Date(p.y, p.m - 1, p.d);
}

function localYmd(d) {
  const p = ctParts(d);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function todayYmd() {
  return localYmd(new Date());
}

// Returns {start, end, label, year, month0} for a YYYY-MM key.
// Defaults to the current Central-Time month when called with no arg.
function monthRange(yearMonth) {
  let y, m0;
  if (yearMonth && /^\d{4}-\d{2}$/.test(yearMonth)) {
    y = Number(yearMonth.slice(0, 4));
    m0 = Number(yearMonth.slice(5, 7)) - 1;
  } else {
    const p = ctParts(new Date());
    y = p.y;
    m0 = p.m - 1;
  }
  const start = `${y}-${String(m0+1).padStart(2,'0')}-01`;
  const lastDay = new Date(y, m0 + 1, 0).getDate();
  const end = `${y}-${String(m0+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  const label = new Date(y, m0, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return { start, end, label, year: y, month0: m0, key: `${y}-${String(m0+1).padStart(2,'0')}` };
}

function monthShift(yearMonth, delta) {
  const r = monthRange(yearMonth);
  const d = new Date(r.year, r.month0 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

// Last N months as an array of {start,end,label,key}, oldest first.
function monthsBack(n) {
  const out = [];
  const today = ctToday();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push(monthRange(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`));
  }
  return out;
}

// ─── Account helpers ───────────────────────────────────────────────────────

const ACCOUNT_KINDS = ['checking', 'savings', 'credit_card', 'other'];

function normalizeAccountKind(hint) {
  if (typeof hint !== 'string') return 'other';
  const v = hint.trim().toLowerCase();
  if (v === 'checking' || v === 'savings' || v === 'credit_card' || v === 'other') return v;
  if (v.includes('check')) return 'checking';
  if (v.includes('save')) return 'savings';
  if (v.includes('credit') || v.includes('card') || v.includes('visa') || v.includes('mastercard')) return 'credit_card';
  return 'other';
}

function defaultAccountName(kind, last4) {
  const tail = last4 ? ' ••' + last4 : '';
  if (kind === 'checking') return 'Checking' + tail;
  if (kind === 'savings') return 'Savings' + tail;
  if (kind === 'credit_card') return 'Credit Card' + tail;
  return 'Account' + tail;
}

function isDefaultAccountName(name, last4) {
  if (!name) return true;
  const value = String(name).trim();
  return ACCOUNT_KINDS.some(kind => value === defaultAccountName(kind, last4));
}

// Idempotent upsert by last_four (which is UNIQUE in the schema).
// Returns the account row { id, last_four, kind, display_name }.
async function upsertAccount(last4, kindHint, displayHint, opts = {}) {
  if (!last4 || !/^\d{4}$/.test(String(last4))) return null;
  const kind = normalizeAccountKind(kindHint);
  const existing = await db.get('SELECT id, last_four, kind, display_name FROM accounts WHERE last_four=?', [last4]);
  if (existing) {
    // Transaction emails often expose a card's last four but not the bank
    // account kind, so only balance-summary evidence is allowed to correct
    // a known checking/savings/credit label.
    const trustedKind = !!(opts && opts.trustedKind);
    const shouldApplyKind = kind !== 'other' && (
      existing.kind === 'other' ||
      (trustedKind && existing.kind !== kind)
    );
    if (shouldApplyKind) {
      const displayWasDefault = isDefaultAccountName(existing.display_name, existing.last_four);
      const nextName = displayWasDefault ? (displayHint || defaultAccountName(kind, last4)) : existing.display_name;
      await db.run('UPDATE accounts SET kind=?, display_name=?, updated_at=? WHERE id=?',
        [kind, nextName, new Date().toISOString(), existing.id]);
      existing.kind = kind;
      existing.display_name = nextName;
    }
    return existing;
  }
  const id = crypto.randomUUID();
  const name = displayHint || defaultAccountName(kind, last4);
  await db.run(
    'INSERT INTO accounts (id, last_four, kind, display_name) VALUES (?, ?, ?, ?)',
    [id, last4, kind, name],
  );
  return { id, last_four: last4, kind, display_name: name };
}

// ─── Section: Transactions ─────────────────────────────────────────────────

async function reconcileAccountKindsFromSnapshots() {
  let rows = [];
  try {
    rows = await db.all(`
      SELECT a.id, a.last_four, a.kind, a.display_name,
             (SELECT bs.kind
                FROM balance_snapshots bs
               WHERE bs.account_id = a.id
                 AND bs.kind IS NOT NULL
                 AND bs.kind <> 'other'
               ORDER BY bs.snapshot_date DESC, bs.created_at DESC
               LIMIT 1) AS snapshot_kind
        FROM accounts a
       WHERE a.archived = 0`);
  } catch { return 0; }

  let changed = 0;
  for (const a of rows || []) {
    const kind = normalizeAccountKind(a.snapshot_kind);
    if (kind === 'other' || kind === a.kind) continue;
    const displayWasDefault = isDefaultAccountName(a.display_name, a.last_four);
    const nextName = displayWasDefault ? defaultAccountName(kind, a.last_four) : a.display_name;
    try {
      await db.run(
        `UPDATE accounts SET kind=?, display_name=?, updated_at=? WHERE id=?`,
        [kind, nextName, new Date().toISOString(), a.id],
      );
      changed++;
    } catch { /* best-effort repair */ }
  }
  return changed;
}

// ─── Transaction editor drawer (create / edit / delete) ────────────────────
//
// One human-editing surface for the whole ledger: fix a misparsed merchant,
// amount, date, type, account, or category; add notes; confirm a review row;
// add a manual (cash) transaction; or move one to trash. Reuses the same DB
// ops the AI tools use (learnExpenseRuleFromOverride, budgetToolDeleteTransaction)
// so the human and AI paths stay consistent.
async function openTxEditor(api, opts = {}) {
  const isCreate = !opts.id;
  let row = null;
  if (!isCreate) {
    row = await db.get('SELECT * FROM transactions WHERE id=?', [opts.id]).catch(() => null);
    if (!row) { await api.window?.showErrorMessage?.('Transaction not found.'); return; }
  }
  const [categories, accounts] = await Promise.all([
    db.all(`SELECT id, name, color, kind FROM categories WHERE archived=0 ORDER BY kind, sort_order, name`).catch(() => []),
    db.all(`SELECT id, last_four, kind, display_name FROM accounts WHERE archived=0 ORDER BY kind, last_four`).catch(() => []),
  ]);

  const overlay = document.createElement('div');
  overlay.className = 'budget-drawer-overlay';
  const drawer = document.createElement('div');
  drawer.className = 'budget-drawer';
  overlay.appendChild(drawer);

  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  // Header
  const head = document.createElement('div'); head.className = 'budget-drawer-head';
  const titleWrap = document.createElement('div'); titleWrap.style.flex = '1';
  const title = document.createElement('h3'); title.className = 'budget-drawer-title';
  title.textContent = isCreate ? 'Add Transaction' : 'Edit Transaction';
  titleWrap.appendChild(title);
  if (!isCreate) {
    const sub = document.createElement('div'); sub.className = 'budget-drawer-sub';
    sub.textContent = { email: 'Imported from email', 'email-gone': 'Imported from email', csv: 'Imported from a CSV', manual: 'Added by hand' }[txOrigin(row)];
    titleWrap.appendChild(sub);
  }
  head.appendChild(titleWrap);
  const closeBtn = document.createElement('button'); closeBtn.className = 'budget-drawer-close'; closeBtn.type = 'button';
  closeBtn.innerHTML = makeIcon(api, 'x', 16) || '✕';
  closeBtn.addEventListener('click', close);
  head.appendChild(closeBtn);
  drawer.appendChild(head);

  // Body / form
  const form = document.createElement('div'); form.className = 'budget-drawer-body';
  function field(labelText, control, hint) {
    const f = document.createElement('label'); f.className = 'budget-field';
    const l = document.createElement('span'); l.className = 'budget-field-label'; l.textContent = labelText;
    f.appendChild(l); f.appendChild(control);
    if (hint) { const h = document.createElement('span'); h.className = 'budget-field-hint'; h.textContent = hint; f.appendChild(h); }
    return f;
  }

  const merchantInput = document.createElement('input');
  merchantInput.className = 'budget-input'; merchantInput.type = 'text';
  merchantInput.placeholder = 'e.g. Starbucks'; merchantInput.value = row?.merchant || '';

  const dateInput = document.createElement('input');
  dateInput.className = 'budget-input'; dateInput.type = 'date';
  dateInput.value = row?.transaction_date ? String(row.transaction_date).slice(0, 10) : todayYmd();

  const amountInput = document.createElement('input');
  amountInput.className = 'budget-input'; amountInput.type = 'number'; amountInput.step = '0.01';
  amountInput.placeholder = '0.00';
  amountInput.value = row ? ((Number(row.amount_cents) || 0) / 100).toFixed(2) : '';

  // Options come straight from the TX_TYPES source of truth (same labels the
  // ledger shows). If a row carries an out-of-set type (e.g. the AI's 'other'),
  // surface it so it stays representable instead of showing blank.
  const typeOpts = TX_TYPES.map(t => ({ value: t.value, label: t.label }));
  if (row?.tx_type && !TX_TYPE_VALUES.includes(row.tx_type)) {
    typeOpts.push({ value: row.tx_type, label: txTypeLabel(row.tx_type) });
  }
  const acctSel = makeDropdown(
    [{ value: '', label: 'No Account' }].concat(accounts.map(a => ({ value: a.id, label: a.display_name || defaultAccountName(a.kind, a.last_four) }))),
    row?.account_id || '');

  // Declared before typeSel so the type handler can re-scope it without a forward
  // reference.
  const initialType = row?.tx_type || 'purchase';
  const catSel = makeDropdown(
    scopedCategoryOptions(categories, initialType, row?.category_id || ''),
    row?.category_id || '');

  const typeSel = makeDropdown(typeOpts, initialType, (txType) => {
    // Changing the type re-scopes the categories. Keep the current pick when it
    // is still offered; clear it when it is not, rather than leaving an income
    // category selected on an expense and saving that.
    const keep = catSel.value;
    const opts = scopedCategoryOptions(categories, txType, keep);
    catSel.setOptions(opts, opts.some(o => o.value === keep) ? keep : '');
  });

  const statusSel = makeDropdown(
    [['confirmed', 'Confirmed'], ['review', 'Needs review'], ['hidden', 'Hidden']].map(([value, label]) => ({ value, label })),
    row?.status || 'confirmed');

  const notesInput = document.createElement('textarea');
  notesInput.className = 'budget-drawer-textarea'; notesInput.placeholder = 'Notes (optional)';
  // The sync's own tags ([cross-check: …], [possible duplicate of …],
  // [hidden: …]) stay stored for Review and How It Got Here, but out of the
  // note the user edits; save puts them back.
  const { note: userNote, tags: systemTags } = splitTxNotes(row?.notes);
  notesInput.value = userNote;

  form.appendChild(field('Merchant', merchantInput));
  const row1 = document.createElement('div'); row1.className = 'budget-field-row';
  row1.appendChild(field('Date', dateInput));
  row1.appendChild(field('Amount', amountInput, 'Positive = money out · negative = money in'));
  form.appendChild(row1);
  const row2 = document.createElement('div'); row2.className = 'budget-field-row';
  row2.appendChild(field('Type', typeSel));
  row2.appendChild(field('Account', acctSel));
  form.appendChild(row2);
  form.appendChild(field('Category', catSel));
  form.appendChild(field('Status', statusSel));
  form.appendChild(field('Notes', notesInput));
  drawer.appendChild(form);
  if (!isCreate) {
    // Filled in after the drawer is up; the form does not wait on it.
    void readTxHistory(row).then((steps) => { if (overlay.isConnected) drawTxHistory(api, form, steps); }).catch(() => {});
  }

  // Footer
  const foot = document.createElement('div'); foot.className = 'budget-drawer-foot';
  if (!isCreate) {
    let armed = false; let armTimer = null;
    const delBtn = makeButton('Delete', { onClick: async () => {
      if (!armed) {
        armed = true; delBtn.querySelector('span:last-child').textContent = 'Click again to delete';
        delBtn.classList.add('px-btn--danger');
        armTimer = setTimeout(() => { armed = false; delBtn.querySelector('span:last-child').textContent = 'Delete'; delBtn.classList.remove('px-btn--danger'); }, 3000);
        return;
      }
      if (armTimer) clearTimeout(armTimer);
      try {
        await budgetToolDeleteTransaction({ id: opts.id, reason: 'deleted from editor' });
        close(); opts.onSaved?.();
        notifyLedgerChanged();
      } catch (e) { await api.window?.showErrorMessage?.('Delete failed: ' + (e instanceof Error ? e.message : String(e))); }
    } });
    foot.appendChild(delBtn);
  }
  const spacer = document.createElement('div'); spacer.className = 'spacer'; foot.appendChild(spacer);
  foot.appendChild(makeButton('Cancel', { onClick: close }));

  async function save(forceStatus) {
    const merchant = merchantInput.value.trim();
    const dateYmd = dateInput.value;
    const amt = parseFloat(amountInput.value);
    if (!Number.isFinite(amt)) { amountInput.focus(); return; }
    if (!dateYmd) { dateInput.focus(); return; }
    const cents = dollarsToCents(amt);
    const txType = typeSel.value;
    const categoryId = catSel.value || null;
    const accountId = acctSel.value || null;
    const notes = [notesInput.value.trim(), ...systemTags].filter(Boolean).join(' ') || null;
    const status = forceStatus || statusSel.value || 'confirmed';
    const now = new Date().toISOString();
    const categoryChanged = (categoryId !== (row?.category_id || null));
    try {
      if (isCreate) {
        await db.run(
          `INSERT INTO transactions
             (id, gmail_message_id, merchant, amount_cents, transaction_date, tx_type,
              category_id, account_id, notes, status, categorization_source, user_overridden,
              created_at, updated_at, tx_type_source, source)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1, ?, ?, 'manual', 'manual')`,
          [crypto.randomUUID(), merchant || null, cents, dateYmd, txType, categoryId, accountId, notes, status, now, now],
        );
      } else {
        const sets = ['merchant=?', 'amount_cents=?', 'transaction_date=?', 'tx_type=?', "tx_type_source='manual'", 'category_id=?', 'account_id=?', 'notes=?', 'status=?', 'user_overridden=1', 'updated_at=?'];
        const params = [merchant || null, cents, dateYmd, txType, categoryId, accountId, notes, status, now];
        if (categoryChanged) sets.push("categorization_source='manual'", 'matched_rule_id=NULL');
        params.push(opts.id);
        await db.run(`UPDATE transactions SET ${sets.join(', ')} WHERE id=?`, params);
      }
      if (categoryChanged && categoryId && merchant) await learnExpenseRuleFromOverride(merchant, categoryId);
      close(); opts.onSaved?.();
      notifyLedgerChanged();
    } catch (e) {
      await api.window?.showErrorMessage?.('Save failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  if (!isCreate && row.status === 'review') {
    foot.appendChild(makeButton('Confirm', { primary: true, onClick: () => save('confirmed') }));
    foot.appendChild(makeButton('Save', { onClick: () => save() }));
  } else {
    foot.appendChild(makeButton(isCreate ? 'Add Transaction' : 'Save', { primary: true, onClick: () => save() }));
  }
  drawer.appendChild(foot);

  document.body.appendChild(overlay);
  merchantInput.focus();
}

// "How it got here": where a row came from, who typed it, who put it in its
// category, and where it stands now. Every line is read from the row and
// its email; nothing is guessed.
const TX_NOTE_TAG = /\[(?:cross-check: |possible duplicate of |hidden: )[^\]]*\]/g;
function splitTxNotes(notes) {
  const text = String(notes || '');
  const tags = text.match(TX_NOTE_TAG) || [];
  return { note: text.replace(TX_NOTE_TAG, ' ').replace(/\s+/g, ' ').trim(), tags };
}

// Where a row came from. A row whose email was cleaned up keeps the AI's
// marks, so it still reads as imported, not as typed by hand.
function txOrigin(row) {
  if (row.source === 'csv') return 'csv';
  if (row.gmail_message_id) return 'email';
  if (row.source === 'manual') return 'manual';
  if (row.tx_type_source === 'ai' || row.tx_type_source === 'subject') return 'email-gone';
  return 'manual';
}

async function readTxHistory(row) {
  const steps = [];
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  // 1. Where it came from.
  const email = row.gmail_message_id
    ? await db.get('SELECT raw_subject, received_at FROM email_imports WHERE gmail_message_id=?', [row.gmail_message_id]).catch(() => null)
    : null;
  const origin = txOrigin(row);
  if (email) {
    steps.push({ icon: 'mail', what: `An email, ${when(email.received_at)}`, detail: email.raw_subject ? `“${email.raw_subject}”` : '' });
  } else if (origin === 'csv') {
    steps.push({ icon: 'file-text', what: 'Imported from a CSV', detail: when(row.created_at) });
  } else if (origin === 'email' || origin === 'email-gone') {
    steps.push({ icon: 'mail', what: 'An email', detail: 'The email itself is no longer stored.' });
  } else {
    steps.push({ icon: 'user', what: 'Added by hand', detail: when(row.created_at) });
  }
  // 2. Who typed it.
  const type = txTypeLabel(row.tx_type, row.amount_cents);
  const conf = { high: 'High confidence.', medium: 'Medium confidence.', low: 'Low confidence.' }[row.ai_confidence] || '';
  if (row.tx_type_source === 'ai') steps.push({ icon: 'sparkles', what: `The AI read it as ${type}`, detail: conf });
  else if (row.tx_type_source === 'subject') steps.push({ icon: 'mail', what: `The email subject marked it as ${type}`, detail: '' });
  else if (row.tx_type_source === 'csv') steps.push({ icon: 'file-text', what: `The CSV said ${type}`, detail: '' });
  else if (row.tx_type_source === 'manual') steps.push({ icon: 'user', what: `You set the type to ${type}`, detail: '' });
  // 3. Who put it in its category.
  const cat = row.category_id ? await db.get('SELECT name FROM categories WHERE id=?', [row.category_id]).catch(() => null) : null;
  const catName = cat ? cat.name : null;
  if (!catName) {
    steps.push({ icon: 'tag', what: 'No category yet', detail: row.status === 'review' ? 'Pick one in Review.' : '' });
  } else if (row.categorization_source === 'rule') {
    const rule = row.matched_rule_id
      ? await db.get('SELECT pattern, hits, auto_created FROM categorization_rules WHERE id=?', [row.matched_rule_id]).catch(() => null)
      : null;
    steps.push(rule
      ? { icon: 'filter', what: `${catName}, by ${rule.auto_created ? 'a learned rule' : 'your rule'} “${rule.pattern}”`, detail: `${Number(rule.hits) || 0} match${Number(rule.hits) === 1 ? '' : 'es'} so far.` }
      : { icon: 'filter', what: `${catName}, by a rule`, detail: 'That rule has since been deleted.' });
  } else if (row.categorization_source === 'ai') {
    steps.push({ icon: 'sparkles', what: `The AI put it in ${catName}`, detail: '' });
  } else if (row.categorization_source === 'manual') {
    steps.push({ icon: 'user', what: `You put it in ${catName}`, detail: '' });
  } else {
    steps.push({ icon: 'tag', what: catName, detail: 'Set before Budget kept track of who set it.' });
  }
  // 4. Where it stands.
  if (row.status === 'review') {
    steps.push({ icon: 'inbox', what: 'Waiting in Review', detail: reviewReason(row).why });
  } else if (row.status === 'hidden') {
    const m = /\[hidden: ([^\]]+)\]/.exec(row.notes || '');
    const why = m ? ({ duplicate: 'As a duplicate.', ignored: 'You ignored it.' }[m[1]] || `Reason: ${m[1]}.`) : '';
    steps.push({ icon: 'eye-off', what: 'Hidden, not counted', detail: why });
  }
  return steps;
}

function drawTxHistory(api, host, steps) {
  const wrap = document.createElement('div');
  wrap.className = 'budget-how';
  const label = document.createElement('div');
  label.className = 'budget-ov-label';
  label.textContent = 'How it got here';
  wrap.appendChild(label);
  for (const s of steps) {
    const row = document.createElement('div');
    row.className = 'budget-how-step';
    const ic = document.createElement('span');
    ic.className = 'budget-how-icon';
    ic.innerHTML = makeIcon(api, s.icon, 14);
    const text = document.createElement('span');
    text.className = 'budget-how-text';
    const w = document.createElement('span'); w.textContent = s.what;
    text.appendChild(w);
    if (s.detail) { const d = document.createElement('span'); d.className = 'budget-ov-faint'; d.textContent = s.detail; text.appendChild(d); }
    row.append(ic, text);
    wrap.appendChild(row);
  }
  host.appendChild(wrap);
}

// The Transactions page's quick filters. `status` and `type` are what each
// one selects; deep links ({type, status} in _navState.txFilter) map onto them.
const TX_VIEWS = [
  { id: 'all',      label: 'All',          status: 'live',      type: 'all' },
  { id: 'spend',    label: 'Spending',     status: 'live',      type: 'spend' },
  { id: 'income',   label: 'Income',       status: 'live',      type: 'deposit' },
  { id: 'transfer', label: 'Transfers',    status: 'live',      type: 'transfer' },
  { id: 'review',   label: 'Needs Review', status: 'review',    type: 'all' },
  { id: 'hidden',   label: 'Hidden',       status: 'hidden',    type: 'all' },
];

function txViewFor(incoming) {
  if (!incoming) return 'all';
  if (incoming.status === 'review') return 'review';
  if (incoming.status === 'hidden') return 'hidden';
  if (incoming.type === 'spend' || incoming.type === 'purchase' || incoming.type === 'fee') return 'spend';
  if (incoming.type === 'deposit') return 'income';
  if (incoming.type === 'transfer') return 'transfer';
  return 'all';
}

function dayHeading(iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// How a row reads in the ledger: money in is marked + and green, a transfer
// is muted (it moves money between your accounts), spending is plain text.
function txAmountView(r) {
  const cents = Number(r.amount_cents) || 0;
  if (r.tx_type === 'transfer') return { text: fmtMoney(Math.abs(cents)), tone: 'move' };
  if (cents < 0) return { text: '+' + fmtMoney(-cents), tone: 'in' };
  return { text: fmtMoney(cents), tone: 'out' };
}

function renderTransactionsSection(body, api) {
  // Deep links (an Overview category, a chart slice, a Review link) arrive
  // in _navState.txFilter and are read once.
  const incoming = _navState.txFilter;
  _navState.txFilter = null;

  let view       = txViewFor(incoming);
  let monthKey   = (incoming && incoming.monthKey) || monthRange().key;
  let categoryId = (incoming && incoming.categoryId) || null;
  let accountId  = (incoming && incoming.accountId)  || null;
  let dayYmd     = (incoming && incoming.dayYmd)     || null;
  let search     = (incoming && incoming.merchant)   || '';
  // A link for fees only, or purchases only, narrows Spending further.
  let typeOnly   = incoming && (incoming.type === 'purchase' || incoming.type === 'fee') ? incoming.type : null;

  const root = document.createElement('div');
  root.className = 'budget-tx';
  body.appendChild(root);

  // Month, search, account, Add.
  const bar = document.createElement('div');
  bar.className = 'budget-tx-bar';
  const monthHost = document.createElement('div');
  monthHost.className = 'budget-ov-month';
  bar.appendChild(monthHost);
  const allMonthsNote = document.createElement('span');
  allMonthsNote.className = 'budget-ov-month-label budget-tx-allmonths';
  allMonthsNote.textContent = 'Every month';
  allMonthsNote.hidden = true;
  bar.appendChild(allMonthsNote);
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'budget-input budget-tx-search';
  searchInput.placeholder = 'Search merchants';
  searchInput.setAttribute('aria-label', 'Search merchants');
  searchInput.value = search;
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    search = searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void refresh(), 150);
  });
  bar.appendChild(searchInput);
  const acctSlot = document.createElement('span');
  acctSlot.className = 'budget-dd-slot';
  bar.appendChild(acctSlot);
  setPageActions({ primary: { label: 'Add Transaction…', icon: 'plus', onClick: () => void openTxEditor(api, { onSaved: refresh }) } });
  root.appendChild(bar);

  // Quick filters, and the narrowing a link brought (category, day, type).
  const chipsBar = document.createElement('div');
  chipsBar.className = 'budget-tx-chips';
  root.appendChild(chipsBar);
  const chips = new Map();
  for (const v of TX_VIEWS) {
    const chip = api.ui.createFilterChip(chipsBar, {
      label: v.label,
      pressed: v.id === view,
      onToggle: () => { view = v.id; if (v.id !== 'spend') typeOnly = null; syncChips(); void refresh(); },
    });
    chips.set(v.id, chip);
  }
  function syncChips() { for (const [id, chip] of chips) chip.pressed = id === view; }
  const narrowHost = document.createElement('span');
  narrowHost.className = 'budget-tx-narrow';
  chipsBar.appendChild(narrowHost);

  const head = document.createElement('div');
  head.className = 'budget-tx-row budget-tx-cols';
  for (const [t, cls] of [['Merchant', ''], ['Category', ''], ['Account', ''], ['Amount', 'budget-tx-amt']]) {
    const s = document.createElement('span'); s.textContent = t; if (cls) s.className = cls; head.appendChild(s);
  }
  root.appendChild(head);
  const list = document.createElement('div');
  list.className = 'budget-tx-list';
  root.appendChild(list);

  let alive = true;
  let categoriesList = [];
  let accountsList = [];
  let seq = 0;

  function drawMonth() {
    drawMonthNav(monthHost, api, monthKey, (k) => { monthKey = k; dayYmd = null; drawMonth(); void refresh(); });
  }

  async function populateAccountSelect() {
    accountsList = await db.all('SELECT id, last_four, kind, display_name FROM accounts WHERE archived=0 ORDER BY kind, last_four').catch(() => []);
    const opts = [{ value: '', label: 'All accounts' }].concat(
      accountsList.map(a => ({ value: a.id, label: a.display_name || defaultAccountName(a.kind, a.last_four) })));
    acctSlot.replaceChildren(makeDropdown(opts, accountId || '', (v) => { accountId = v || null; void refresh(); }, { ariaLabel: 'Account' }));
  }

  // A link's narrowing shows as pressed chips; clicking one lets it go.
  function drawNarrowing() {
    narrowHost.replaceChildren();
    const add = (label, clear) => api.ui.createFilterChip(narrowHost, {
      label, pressed: true, title: 'Click to remove this filter',
      onToggle: () => { clear(); drawNarrowing(); void refresh(); },
    });
    if (categoryId) {
      const cat = categoriesList.find(c => c.id === categoryId);
      add(cat ? cat.name : 'One category', () => { categoryId = null; });
    }
    if (dayYmd) add(shortDate(dayYmd), () => { dayYmd = null; });
    if (typeOnly) add(typeOnly === 'fee' ? 'Fees only' : 'Purchases only', () => { typeOnly = null; });
  }

  async function refresh() {
    if (!alive) return;
    const mySeq = ++seq;
    const v = TX_VIEWS.find(x => x.id === view) || TX_VIEWS[0];
    const range = monthRange(monthKey);
    // Needs Review spans every month, the same rows the sidebar counts.
    const allMonths = v.id === 'review';
    monthHost.hidden = allMonths;
    allMonthsNote.hidden = !allMonths;
    const where = allMonths ? ['1=1'] : ['t.transaction_date >= ?', 't.transaction_date <= ?'];
    const params = allMonths ? [] : [range.start, range.end];
    if (dayYmd && !allMonths) { where.push('t.transaction_date = ?'); params.push(dayYmd); }
    if (v.status === 'live') where.push("t.status IN ('confirmed','review')");
    else { where.push('t.status = ?'); params.push(v.status); }
    if (typeOnly) { where.push('t.tx_type = ?'); params.push(typeOnly); }
    else if (v.type === 'spend') where.push("t.tx_type IN ('purchase','fee')");
    else if (v.type !== 'all') { where.push('t.tx_type = ?'); params.push(v.type); }
    if (categoryId) { where.push('t.category_id = ?'); params.push(categoryId); }
    if (accountId)  { where.push('t.account_id = ?'); params.push(accountId); }
    if (search.trim()) { where.push('LOWER(t.merchant) LIKE ?'); params.push(`%${search.trim().toLowerCase()}%`); }

    let rows;
    let reviewCount = 0;
    try {
      categoriesList = await db.all(`SELECT id, name, color, kind FROM categories WHERE archived=0 ORDER BY kind, sort_order, name`).catch(() => []);
      rows = await db.all(`
        SELECT t.id, t.merchant, t.amount_cents, t.transaction_date, t.status, t.tx_type, t.notes,
               t.ai_confidence, t.card_last_four,
               c.name AS category_name, c.color AS category_color,
               a.kind AS account_kind, a.display_name AS account_name, a.last_four AS account_last_four
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
          LEFT JOIN accounts   a ON a.id = t.account_id
         WHERE ${where.join(' AND ')}
         ORDER BY t.transaction_date DESC, t.created_at DESC
         LIMIT 500`, params);
      reviewCount = await countReview();
    } catch (e) {
      if (mySeq === seq) list.replaceChildren(emptyState('The ledger could not be read: ' + (e instanceof Error ? e.message : String(e))));
      return;
    }
    if (!alive || mySeq !== seq) return;
    chips.get('review')?.setCount(reviewCount || undefined);
    drawNarrowing();
    list.replaceChildren();
    if (rows.length === 0) {
      list.appendChild(emptyState(allMonths ? 'Nothing is waiting for review.'
        : search.trim() || categoryId || accountId || dayYmd ? `Nothing in ${range.label} matches these filters.`
        : `Nothing in ${range.label} here.`));
      return;
    }
    let lastDay = null;
    for (const r of rows) {
      if (r.transaction_date !== lastDay) {
        lastDay = r.transaction_date;
        const spent = rows
          .filter(x => x.transaction_date === lastDay && x.status === 'confirmed' && (x.tx_type === 'purchase' || x.tx_type === 'fee'))
          .reduce((a, x) => a + (Number(x.amount_cents) || 0), 0);
        const dh = document.createElement('div');
        dh.className = 'budget-tx-day';
        const dl = document.createElement('span'); dl.textContent = dayHeading(lastDay);
        const dt = document.createElement('span'); dt.className = 'budget-num';
        dt.textContent = spent > 0 ? `${fmtMoney(spent)} spent` : '';
        dh.append(dl, dt);
        list.appendChild(dh);
      }
      list.appendChild(drawRow(r));
    }
    if (rows.length === 500) {
      const more = document.createElement('div');
      more.className = 'budget-ov-faint budget-tx-more';
      more.textContent = 'Showing the latest 500. Search or filter to find older ones.';
      list.appendChild(more);
    }
  }

  function drawRow(r) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'budget-tx-row budget-tx-item';
    b.addEventListener('click', () => void openTxEditor(api, { id: r.id, onSaved: refresh }));

    const who = document.createElement('span');
    who.className = 'budget-tx-who';
    const name = document.createElement('span');
    name.className = 'budget-ov-grow';
    name.textContent = r.merchant || 'No payee';
    who.appendChild(name);
    const subText = r.status === 'review' ? reviewReason(r).tag
      : r.status === 'hidden' ? 'Hidden'
      : (r.tx_type === 'purchase' && Number(r.amount_cents) >= 0) ? ''
      : txTypeLabel(r.tx_type, r.amount_cents) === r.category_name ? '' : txTypeLabel(r.tx_type, r.amount_cents);
    if (subText) {
      const sub = document.createElement('span');
      sub.className = 'budget-ov-faint' + (r.status === 'review' ? ' budget-tx-warn' : '');
      sub.textContent = subText;
      who.appendChild(sub);
    }

    const cat = document.createElement('span');
    cat.className = 'budget-tx-cat';
    if (r.status === 'review') {
      cat.classList.add('budget-tx-warn');
      cat.textContent = 'Needs review';
    } else {
      const dot = document.createElement('span');
      dot.className = 'budget-dot';
      dot.style.background = r.category_name ? (r.category_color || 'var(--px-text-faint)') : 'transparent';
      if (!r.category_name) dot.classList.add('budget-dot-empty');
      const n = document.createElement('span');
      n.className = 'budget-ov-grow' + (r.category_name ? '' : ' budget-ov-faint');
      n.textContent = r.category_name || 'No category';
      cat.append(dot, n);
    }

    const acct = document.createElement('span');
    acct.className = 'budget-ov-faint budget-ov-grow';
    acct.textContent = r.account_name ? r.account_name + (r.account_last_four ? ` ••${r.account_last_four}` : '')
      : (r.account_last_four || r.card_last_four) ? `••${r.account_last_four || r.card_last_four}` : '';

    const amt = document.createElement('span');
    const a = txAmountView(r);
    amt.className = `budget-num budget-tx-amt is-${a.tone}`;
    amt.textContent = a.text;

    b.append(who, cat, acct, amt);
    return b;
  }

  drawMonth();
  void populateAccountSelect().then(refresh);
  const offBus = onSyncEvent((evt) => { if (evt.kind === 'complete') void refresh(); });
  const offLedger = onLedgerChanged(() => void refresh());
  return () => { alive = false; clearTimeout(searchTimer); offBus(); offLedger(); };
}

// ─── Section: Review ───────────────────────────────────────────────────────
//
// One row at a time: why it is here, what it is (the verdict), its category,
// and whether to remember the choice as a rule. The list on the left is the
// queue; Confirm moves to the next row and offers Undo.

const REVIEW_VERDICTS = [
  ...TX_TYPES.map(t => ({ value: t.value, label: t.label })),
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'ignore', label: 'Ignore' },
];

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function reviewAccountLabel(r) {
  if (r.account_name) return r.account_name + (r.account_last_four ? ` ••${r.account_last_four}` : '');
  if (r.account_last_four || r.card_last_four) return `••${r.account_last_four || r.card_last_four}`;
  return '';
}

function reviewDuplicateOf(notes) {
  const m = /\[possible duplicate of ([^\]]+)\]/.exec(notes || '');
  return m ? m[1].trim() : null;
}

// Why the sync sent a row here: a short tag for the list and a sentence.
// Read from the notes the sync wrote and the AI's confidence.
function reviewReason(r) {
  const notes = r.notes || '';
  const merchant = r.merchant || 'the payee';
  if (reviewDuplicateOf(notes)) {
    return { tag: 'Possible duplicate', why: 'The same amount and payee is already in the ledger within two days, from a different email.' };
  }
  if (/\[cross-check:/.test(notes)) {
    if (/payee looks external/.test(notes)) {
      return { tag: 'Transfer to a person?', why: `It was typed as a transfer, but ${merchant} does not look like one of your accounts. Money sent to a person is usually spending.` };
    }
    if (/merchant=NULL/.test(notes)) {
      return { tag: 'No payee', why: 'The email did not name who was paid, so the type could not be checked.' };
    }
    if (/tx_type=deposit/.test(notes)) {
      return { tag: 'Income or money out?', why: 'It was typed as income, but the amount reads as money going out.' };
    }
    return { tag: 'Did not add up', why: 'The type and the amount did not agree when the sync checked them.' };
  }
  if (r.ai_confidence === 'low') {
    return { tag: 'AI unsure', why: 'The AI was not sure what this is, so it was not counted yet.' };
  }
  return { tag: 'To check', why: 'The sync set this aside for you to check before it is counted.' };
}

function reviewTypeSource(r) {
  const label = txTypeLabel(r.tx_type, r.amount_cents);
  const unsure = r.ai_confidence === 'low' ? ', and was not sure' : '';
  switch (r.tx_type_source) {
    case 'ai':      return `The AI typed it as ${label}${unsure}.`;
    case 'subject': return `The email subject typed it as ${label}.`;
    case 'csv':     return `It came from a CSV as ${label}.`;
    case 'manual':  return `You typed it as ${label}.`;
    default:        return `It is typed as ${label}${unsure}.`;
  }
}

// The verdict a row opens with: Duplicate when it was flagged as one,
// otherwise the type it already has.
function reviewDefaultVerdict(r) {
  if (reviewDuplicateOf(r.notes)) return 'duplicate';
  return TX_TYPE_VALUES.includes(r.tx_type) ? r.tx_type : 'purchase';
}

// What a rule would do for this merchant today: the first active rule that
// matches wins (highest priority first), the same order the sync uses.
function reviewRuleFor(rules, merchant) {
  for (const rule of rules) if (ruleMatchesMerchant(rule, merchant)) return rule;
  return null;
}

function renderReviewQueueSection(body, api) {
  // What the last Confirm did, with Undo. In the page, not a modal prompt:
  // the next row is already up and the user keeps going.
  const undoBar = document.createElement('div');
  undoBar.className = 'budget-rv-undo';
  undoBar.setAttribute('role', 'status');
  undoBar.hidden = true;
  const root = document.createElement('div');
  root.className = 'budget-rv';
  body.append(undoBar, root);
  let undoTimer = null;
  function hideUndo() {
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
    undoBar.hidden = true;
    undoBar.replaceChildren();
  }
  function showUndo(message, onUndo) {
    hideUndo();
    const text = document.createElement('span');
    text.className = 'budget-ov-grow';
    text.textContent = message;
    undoBar.appendChild(text);
    api.ui.createButton(undoBar, { label: 'Undo', kind: 'ghost', size: 'sm', onClick: () => { hideUndo(); void onUndo(); } });
    api.ui.createIconButton(undoBar, { icon: 'x', title: 'Dismiss' }).addEventListener('click', hideUndo);
    undoBar.hidden = false;
    undoTimer = setTimeout(hideUndo, 12000);
  }

  let disposed = false;
  let rows = [];
  let categories = [];
  let rules = [];
  let currentId = null;
  let taught = 0;
  let drawSeq = 0; // a newer draw wins; an older one stops at its next await
  const drafts = new Map(); // row id → { verdict, categoryId, remember }

  function draftFor(r) {
    let d = drafts.get(r.id);
    if (!d) {
      const verdict = reviewDefaultVerdict(r);
      d = { verdict, categoryId: categoryFor(r, verdict, r.category_id), remember: true };
      drafts.set(r.id, d);
    }
    return d;
  }

  // Keep a category that fits the type; otherwise the only one of that kind.
  function categoryFor(r, verdict, current) {
    if (!TX_TYPE_VALUES.includes(verdict)) return null;
    const kind = categoryKindForTxType(verdict);
    const fits = categories.filter(c => c.kind === kind);
    if (current && fits.some(c => c.id === current)) return current;
    return fits.length === 1 ? fits[0].id : null;
  }

  async function load() {
    categories = await db.all(`SELECT id, name, color, kind FROM categories WHERE archived=0 ORDER BY kind, sort_order, name`).catch(() => []);
    rules = await db.all(
      `SELECT id, pattern, match_type, category_id, priority, auto_created FROM categorization_rules
        WHERE active = 1 ORDER BY priority DESC, length(pattern) DESC, created_at ASC`).catch(() => []);
    rows = await db.all(`
      SELECT t.id, t.merchant, t.amount_cents, t.transaction_date, t.ai_confidence, t.category_id,
             t.tx_type, t.tx_type_source, t.notes, t.card_last_four,
             a.display_name AS account_name, a.last_four AS account_last_four, e.raw_subject
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
       WHERE t.status = 'review'
       ORDER BY t.transaction_date DESC, t.created_at DESC
       LIMIT 200`);
  }

  async function draw() {
    if (disposed) return;
    const seq = ++drawSeq;
    try { await load(); }
    catch (err) {
      root.replaceChildren(emptyState('The review queue could not be read: ' + (err instanceof Error ? err.message : String(err))));
      return;
    }
    if (disposed || seq !== drawSeq) return;
    root.replaceChildren();
    for (const id of [...drafts.keys()]) if (!rows.some(r => r.id === id)) drafts.delete(id);
    if (rows.length === 0) {
      currentId = null;
      api.ui.createEmptyState(root, {
        icon: 'inbox',
        headline: 'Nothing to review.',
        hint: taught
          ? `You taught it ${taught} rule${taught === 1 ? '. It applies' : 's. They apply'} from the next sync.`
          : 'Everything the sync brought in is counted.',
        action: { label: 'Back to Overview', onClick: () => openBudgetSection(api, 'overview') },
      });
      return;
    }
    if (!rows.some(r => r.id === currentId)) currentId = rows[0].id;
    const grid = document.createElement('div');
    grid.className = 'budget-rv-grid';
    drawList(grid);
    await drawItem(grid, rows.find(r => r.id === currentId), seq);
    if (disposed || seq !== drawSeq) return;
    root.appendChild(grid);
  }

  function select(id) {
    currentId = id;
    void draw();
  }

  function drawList(grid) {
    const side = document.createElement('div');
    side.className = 'budget-rv-side';
    const hint = document.createElement('div');
    hint.className = 'budget-ov-faint';
    hint.textContent = `${rows.length} to look at`;
    side.appendChild(hint);
    const list = document.createElement('div');
    list.className = 'budget-rv-list';
    list.setAttribute('role', 'list');
    for (const r of rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'budget-rv-item';
      b.setAttribute('role', 'listitem');
      if (r.id === currentId) b.setAttribute('aria-current', 'true');
      const top = document.createElement('span');
      top.className = 'budget-rv-item-top';
      const name = document.createElement('span');
      name.className = 'budget-ov-grow';
      name.textContent = r.merchant || 'No payee';
      const amt = document.createElement('span');
      amt.className = 'budget-num';
      amt.textContent = fmtMoney(r.amount_cents);
      top.append(name, amt);
      const tag = document.createElement('span');
      tag.className = 'budget-rv-tag';
      tag.textContent = reviewReason(r).tag;
      b.append(top, tag);
      b.addEventListener('click', () => select(r.id));
      b.addEventListener('keydown', (e) => {
        const i = rows.findIndex(x => x.id === r.id);
        const j = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : -1;
        if (j < 0 || j >= rows.length) return;
        e.preventDefault();
        select(rows[j].id);
        requestAnimationFrame(() => root.querySelector('.budget-rv-item[aria-current="true"]')?.focus());
      });
      list.appendChild(b);
    }
    side.appendChild(list);
    grid.appendChild(side);
  }

  async function drawItem(grid, r, seq) {
    const d = draftFor(r);
    const card = document.createElement('div');
    card.className = 'budget-ov-card budget-rv-card';
    grid.appendChild(card);

    // Who and how much.
    const head = document.createElement('div');
    head.className = 'budget-rv-head';
    const who = document.createElement('div');
    who.className = 'budget-rv-who';
    const name = document.createElement('div');
    name.className = 'budget-rv-name';
    name.textContent = r.merchant || 'No payee';
    const meta = document.createElement('div');
    meta.className = 'budget-ov-faint';
    meta.textContent = [shortDate(r.transaction_date), reviewAccountLabel(r)].filter(Boolean).join(' · ');
    who.append(name, meta);
    const amount = document.createElement('div');
    amount.className = 'budget-ov-big budget-num';
    amount.textContent = fmtMoney(r.amount_cents);
    head.append(who, amount);
    card.appendChild(head);

    // Why it is here.
    const why = document.createElement('div');
    why.className = 'budget-rv-block';
    const whyLabel = document.createElement('div');
    whyLabel.className = 'budget-ov-label';
    whyLabel.textContent = 'Why it is here';
    const whyText = document.createElement('div');
    whyText.textContent = reviewReason(r).why;
    why.append(whyLabel, whyText);
    if (r.raw_subject) {
      const subj = document.createElement('div');
      subj.className = 'budget-ov-faint';
      subj.textContent = `From the email: “${r.raw_subject}”`;
      why.appendChild(subj);
    }
    card.appendChild(why);

    const dupId = reviewDuplicateOf(r.notes);
    if (dupId) {
      const orig = await db.get(
        `SELECT t.merchant, t.amount_cents, t.transaction_date, t.status, e.raw_subject
           FROM transactions t LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
          WHERE t.id = ?`, [dupId]).catch(() => null);
      if (disposed || seq !== drawSeq) return;
      const cmp = document.createElement('div');
      cmp.className = 'budget-rv-compare';
      const line = (label, x) => {
        const row = document.createElement('div');
        row.className = 'budget-rv-compare-row';
        const l = document.createElement('span');
        l.className = 'budget-ov-label';
        l.textContent = label;
        const v = document.createElement('span');
        v.textContent = x
          ? `${x.merchant || 'No payee'} · ${fmtMoney(x.amount_cents)} · ${shortDate(x.transaction_date)}${x.raw_subject ? ` · email “${x.raw_subject}”` : ''}`
          : 'That row is no longer in the ledger.';
        row.append(l, v);
        cmp.appendChild(row);
      };
      line('This one', r);
      line(orig && orig.status === 'review' ? 'Also waiting for review' : 'Already in the ledger', orig && orig.status !== 'deleted' ? orig : null);
      card.appendChild(cmp);
    }

    // What it is.
    const what = document.createElement('div');
    what.className = 'budget-rv-block';
    const whatLabel = document.createElement('div');
    whatLabel.className = 'budget-ov-label';
    whatLabel.textContent = 'What it is';
    what.appendChild(whatLabel);
    const seg = document.createElement('div');
    seg.className = 'budget-rv-verdict';
    what.appendChild(seg);
    api.ui.createSegmented(seg, {
      ariaLabel: 'What it is',
      items: REVIEW_VERDICTS.filter(v => v.value !== 'duplicate' || dupId),
      value: d.verdict,
      onChange: (v) => {
        d.verdict = v;
        d.categoryId = categoryFor(r, v, d.categoryId);
        drawChoice();
      },
    });
    const said = document.createElement('div');
    said.className = 'budget-ov-faint';
    said.textContent = reviewTypeSource(r);
    what.appendChild(said);
    card.appendChild(what);

    // Category, the rule, and the explanation that change with the verdict.
    const choice = document.createElement('div');
    choice.className = 'budget-rv-block';
    card.appendChild(choice);

    function drawChoice() { drawChoiceBody(); syncConfirm(); }
    function drawChoiceBody() {
      choice.replaceChildren();
      const v = d.verdict;
      if (v === 'duplicate' || v === 'ignore') {
        const note = document.createElement('div');
        note.className = 'budget-ov-note';
        note.textContent = v === 'duplicate'
          ? 'Duplicate hides this row and keeps the other one. The reason is noted on it.'
          : 'Ignore hides this row. It is not counted anywhere, and you can find it under Hidden in Transactions.';
        choice.appendChild(note);
        return;
      }
      const catLabel = document.createElement('div');
      catLabel.className = 'budget-ov-label';
      catLabel.textContent = 'Category';
      const dd = makeDropdown(
        scopedCategoryOptions(categories, v, d.categoryId, 'Choose a category…'),
        d.categoryId || '',
        (val) => { d.categoryId = val || null; drawRemember(); syncConfirm(); },
        { ariaLabel: 'Category', className: 'budget-rv-cat' },
      );
      choice.append(catLabel, dd);
      const remember = document.createElement('div');
      remember.className = 'budget-rv-remember';
      choice.appendChild(remember);

      function drawRemember() {
        remember.replaceChildren();
        // Rules sort expenses only (the sync applies them to purchases), so
        // only an Expense with a category can be remembered.
        if (v !== 'purchase' || !d.categoryId || !r.merchant || String(r.merchant).trim().length < 2) return;
        const cat = categories.find(c => c.id === d.categoryId);
        if (!cat || cat.kind !== 'expense') return;
        const rule = reviewRuleFor(rules, r.merchant);
        const ruleCat = rule && categories.find(c => c.id === rule.category_id);
        if (rule && rule.category_id === d.categoryId) {
          remember.className = 'budget-rv-remember budget-ov-faint';
          remember.textContent = `A rule already puts ${r.merchant} in ${cat.name}.`;
          return;
        }
        if (rule && !rule.auto_created) {
          remember.className = 'budget-rv-remember budget-ov-faint';
          remember.textContent = `Your rule “${rule.pattern}” puts ${r.merchant} in ${ruleCat ? ruleCat.name : 'another category'}. Change it in Merchants and Rules.`;
          return;
        }
        remember.className = 'budget-rv-remember';
        const label = document.createElement('label');
        label.className = 'budget-rv-check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = d.remember;
        box.addEventListener('change', () => { d.remember = box.checked; });
        const text = document.createElement('span');
        text.textContent = `Remember: ${r.merchant} goes in ${cat.name}`;
        label.append(box, text);
        const sub = document.createElement('div');
        sub.className = 'budget-ov-faint';
        sub.textContent = rule
          ? `Changes the learned rule from ${ruleCat ? ruleCat.name : 'its category'}. It applies from the next sync.`
          : 'Adds a rule. It applies from the next sync.';
        remember.append(label, sub);
      }
      drawRemember();
    }

    // Confirm, Skip, where we are.
    const acts = document.createElement('div');
    acts.className = 'budget-rv-actions';
    const confirmBtn = api.ui.createButton(acts, { label: 'Confirm', kind: 'primary', onClick: () => void confirmRow(r, d) });
    function syncConfirm() {
      const missing = needsCategory(d) && !d.categoryId;
      confirmBtn.disabled = missing;
      confirmBtn.title = missing ? 'Choose a category first.' : '';
    }
    drawChoice();
    if (rows.length > 1) {
      api.ui.createButton(acts, { label: 'Skip', onClick: () => select(nextId(r.id)) });
    }
    const pos = document.createElement('span');
    pos.className = 'budget-ov-faint budget-rv-pos';
    pos.textContent = `${rows.findIndex(x => x.id === r.id) + 1} of ${rows.length}`;
    acts.appendChild(pos);
    card.appendChild(acts);
  }

  // Transfers may stay uncategorized; everything counted needs a category.
  function needsCategory(d) {
    return d.verdict === 'purchase' || d.verdict === 'fee' || d.verdict === 'deposit';
  }

  function nextId(id) {
    const i = rows.findIndex(x => x.id === id);
    return rows.length > 1 ? rows[(i + 1) % rows.length].id : null;
  }

  let saving = false;
  async function confirmRow(r, d) {
    if (saving) return; // a double click saves once
    saving = true;
    try { await saveRow(r, d); } finally { saving = false; }
  }

  async function saveRow(r, d) {
    const v = d.verdict;
    if (needsCategory(d) && !d.categoryId) return;
    const before = await db.get(
      `SELECT status, category_id, tx_type, tx_type_source, categorization_source, matched_rule_id, user_overridden, notes, updated_at
         FROM transactions WHERE id = ?`, [r.id]).catch(() => null);
    let ruleChange = null;
    let what;
    try {
      if (v === 'duplicate') {
        await hideReviewedTransaction(r.id, 'duplicate');
        what = 'hidden as a duplicate';
      } else if (v === 'ignore') {
        await hideReviewedTransaction(r.id, 'ignored');
        what = 'hidden';
      } else {
        ruleChange = await confirmReviewedTransaction(r.id, d.categoryId, r.merchant, v, { learn: v === 'purchase' && d.remember });
        const cat = categories.find(c => c.id === d.categoryId);
        const label = TX_TYPES.find(t => t.value === v)?.label || v;
        what = `saved as ${label}${cat ? ` in ${cat.name}` : ''}`;
      }
    } catch (e) {
      await api.window?.showErrorMessage?.('Could not save: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    if (ruleChange) taught++;
    currentId = nextId(r.id);
    drafts.delete(r.id);
    notifyLedgerChanged(); // this page redraws too, on the next row
    const ruleNote = !ruleChange ? '' : ruleChange.created ? ' A rule was added.' : ' The learned rule was changed.';
    showUndo(`${r.merchant || 'The row'} ${what}.${ruleNote}`, async () => {
      if (!before) return;
      try {
        await db.run(
          `UPDATE transactions SET status=?, category_id=?, tx_type=?, tx_type_source=?, categorization_source=?,
                  matched_rule_id=?, user_overridden=?, notes=?, updated_at=? WHERE id=?`,
          [before.status, before.category_id, before.tx_type, before.tx_type_source, before.categorization_source,
           before.matched_rule_id, before.user_overridden, before.notes, before.updated_at, r.id]);
        await undoLearnedRule(ruleChange);
        if (ruleChange) taught = Math.max(0, taught - 1);
      } catch (e) {
        await api.window?.showErrorMessage?.('Could not undo: ' + (e instanceof Error ? e.message : String(e)));
        return;
      }
      currentId = r.id;
      drafts.set(r.id, d);
      notifyLedgerChanged();
    });
  }

  const offSync = onSyncEvent((e) => { if (e.kind === 'complete' || e.kind === 'error') void draw(); });
  const offLedger = onLedgerChanged(() => void draw());
  void draw();
  return () => { disposed = true; hideUndo(); offSync(); offLedger(); };
}

// ─── Section: Sync Log ─────────────────────────────────────────────────────

// Sync Now, Reprocess History… and Import / Export live in the sidebar and
// the header's ⋯; this page is the record. It redraws when a sync ends.
function renderSyncLogSection(body, api) {
  const statusEl = document.createElement('div');
  statusEl.className = 'budget-ov-card budget-synclog-status';
  body.appendChild(statusEl);

  const tableWrap = document.createElement('div');
  body.appendChild(tableWrap);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    statusEl.replaceChildren();
    let last;
    try { last = await getSyncStateValue('last_run_status'); } catch { last = null; }
    const lastAt = await getSyncStateValue('last_run_at');
    const lastSyncedAt = await getSyncStateValue('last_synced_at');
    const lab = document.createElement('div'); lab.className = 'budget-ov-label';
    lab.textContent = 'The last sync' + (lastAt ? ` · ${describeWhen(lastAt)}` : '');
    const val = document.createElement('div');
    if (last && typeof last === 'object') {
      if (last.ok) {
        const n = (k) => Number(last[k]) || 0;
        val.textContent = [`${n('confirmed')} new`, `${n('review')} to review`,
          n('duplicates') ? `${n('duplicates')} possible duplicate${n('duplicates') === 1 ? '' : 's'}` : '',
          n('snapshot') ? `${n('snapshot')} balance${n('snapshot') === 1 ? '' : 's'} read` : '',
          n('rulesLearned') ? `${n('rulesLearned')} rule${n('rulesLearned') === 1 ? '' : 's'} learned` : '',
        ].filter(Boolean).join(', ') + '.';
      } else {
        val.className = 'budget-ov-bad';
        val.textContent = `It failed: ${last.error || 'unknown error'}.`;
      }
    } else {
      val.textContent = 'No sync recorded yet.';
    }
    const sub = document.createElement('div'); sub.className = 'budget-ov-faint';
    const cursor = lastSyncedAt ? new Date(lastSyncedAt) : null;
    sub.textContent = cursor && !Number.isNaN(cursor.getTime())
      ? `The next sync reads email received after ${cursor.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`
      : 'The first sync reads the window set in Budget Settings.';
    statusEl.append(lab, val, sub);

    tableWrap.innerHTML = '';
    let rows;
    try {
      rows = await db.all(`SELECT id, run_id, ts, level, msg_id, stage, message FROM sync_log ORDER BY id DESC LIMIT 200`);
    } catch (e) {
      tableWrap.appendChild(emptyState('Query error: ' + (e instanceof Error ? e.message : String(e))));
      return;
    }
    if (!rows || rows.length === 0) { tableWrap.appendChild(emptyState('Nothing logged yet. Each sync writes its steps here.')); return; }
    const table = document.createElement('table');
    table.className = 'budget-table';
    table.innerHTML = `<thead><tr><th>Time</th><th>Level</th><th>Stage</th><th>Message</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.className = 'budget-log-row ' + (r.level || 'info');
      tr.innerHTML = `
        <td>${escHtml(String(r.ts).slice(11, 19))}</td>
        <td>${escHtml({ info: 'Info', warn: 'Warning', error: 'Error' }[r.level] || r.level)}</td>
        <td>${escHtml(r.stage || '')}</td>
        <td>${escHtml(r.message)}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }
  refresh = serialRefresh(refresh);
  void refresh();
  const offBus = onSyncEvent((evt) => {
    if (evt.kind === 'complete' || evt.kind === 'error') void refresh();
  });
  return () => { alive = false; offBus(); };
}

// ─── Section: Categories ───────────────────────────────────────────────────

function renderCategoriesSection(body, api) {
  setPageActions({ primary: {
    label: 'Add Category…',
    icon: 'plus',
    onClick: async () => {
      const name = (await api.window?.showInputBox?.({ prompt: 'Category name', placeHolder: 'e.g. Pets' }) || '').trim();
      if (!name) return;
      try {
        const lastSort = (await db.get('SELECT MAX(sort_order) AS m FROM categories'))?.m ?? 0;
        await db.run(
          `INSERT INTO categories (id, name, color, icon, kind, sort_order) VALUES (?,?,?,?,?,?)`,
          [crypto.randomUUID(), name, '#94a3b8', 'circle', 'expense', Number(lastSort) + 10],
        );
        notifyLedgerChanged();
      } catch (e) {
        await api.window?.showErrorMessage?.('Add failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    },
  } });

  const tableWrap = document.createElement('div');
  body.appendChild(tableWrap);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    tableWrap.innerHTML = '';
    let rows;
    try {
      rows = await db.all(`
        SELECT c.id, c.name, c.color, c.icon, c.kind, c.monthly_limit_cents, c.archived, c.sort_order,
               (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id AND t.status='confirmed') AS tx_count
          FROM categories c
         ORDER BY c.archived ASC, c.sort_order ASC, c.name ASC`);
    } catch (e) {
      tableWrap.appendChild(emptyState('Query error: ' + (e instanceof Error ? e.message : String(e))));
      return;
    }
    if (!rows || rows.length === 0) { tableWrap.appendChild(emptyState('No categories yet.')); return; }
    const table = document.createElement('table');
    table.className = 'budget-table';
    table.innerHTML = `
      <thead><tr>
        <th>Name</th><th style="width:64px">Color</th><th style="width:170px">Kind</th>
        <th style="text-align:right;width:130px" title="Used in any month that has no limit of its own in Plan">Default limit</th>
        <th style="text-align:right;width:110px">Transactions</th><th style="width:48px"><span class="budget-sr">Actions</span></th>
      </tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.archived) tr.className = 'is-archived';

      // Name (click to rename)
      const tdName = document.createElement('td');
      const swatch = document.createElement('span'); swatch.className = 'budget-cat-swatch'; swatch.style.background = r.color || '#888';
      const nameSpan = document.createElement('span'); nameSpan.textContent = r.name;
      tdName.appendChild(swatch); tdName.appendChild(nameSpan);
      if (r.archived) { const a = document.createElement('span'); a.className = 'budget-ov-faint'; a.textContent = ' · archived'; tdName.appendChild(a); }
      tr.appendChild(tdName);

      // Color
      const tdColor = document.createElement('td');
      const colorInput = document.createElement('input');
      colorInput.type = 'color'; colorInput.value = r.color || '#94a3b8';
      colorInput.className = 'budget-color';
      colorInput.title = 'Colour';
      colorInput.addEventListener('change', async () => {
        try { await db.run(`UPDATE categories SET color=? WHERE id=?`, [colorInput.value, r.id]); swatch.style.background = colorInput.value; }
        catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
      });
      tdColor.appendChild(colorInput);
      tr.appendChild(tdColor);

      // Kind
      const tdKind = document.createElement('td');
      const kindSel = makeDropdown(CATEGORY_KIND_OPTIONS.map(k => ({ value: k.value, label: k.label })), r.kind, async (val) => {
        try { await db.run(`UPDATE categories SET kind=? WHERE id=?`, [val, r.id]); }
        catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
      });
      tdKind.appendChild(kindSel);
      tr.appendChild(tdKind);

      // Monthly limit (editable)
      const tdLimit = document.createElement('td'); tdLimit.className = 'budget-amount';
      const limitInput = document.createElement('input');
      limitInput.type = 'number'; limitInput.step = '1'; limitInput.min = '0';
      limitInput.className = 'budget-input budget-cat-limit';
      limitInput.placeholder = 'No limit';
      limitInput.value = r.monthly_limit_cents != null ? String(Math.round(r.monthly_limit_cents) / 100) : '';
      limitInput.addEventListener('change', async () => {
        const v = limitInput.value.trim();
        const cents = v === '' ? null : Math.round(Number(v) * 100);
        if (cents !== null && !Number.isFinite(cents)) { limitInput.value = r.monthly_limit_cents != null ? String(r.monthly_limit_cents/100) : ''; return; }
        try { await db.run(`UPDATE categories SET monthly_limit_cents=? WHERE id=?`, [cents, r.id]); notifyLedgerChanged(); }
        catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
      });
      tdLimit.appendChild(limitInput);
      tr.appendChild(tdLimit);

      // Tx count
      const tdTx = document.createElement('td'); tdTx.className = 'budget-amount'; tdTx.textContent = String(r.tx_count || 0);
      tr.appendChild(tdTx);

      // Actions: one ⋯ per row, as on Merchants and Rules. (A cell made
      // display:flex stops being a table cell and pulls every column out of
      // line with its heading.)
      const tdAct = document.createElement('td'); tdAct.className = 'budget-cell-more';
      const moreBtn = api.ui.createIconButton(tdAct, { icon: 'ellipsis', title: 'Category Actions', size: 'sm' });
      moreBtn.addEventListener('click', () => api.ui.showContextMenu(moreBtn, [
        { label: 'Rename…', onSelect: async () => {
          const next = (await api.window?.showInputBox?.({ prompt: 'New name', value: r.name }) || '').trim();
          if (!next || next === r.name) return;
          try { await db.run(`UPDATE categories SET name=? WHERE id=?`, [next, r.id]); notifyLedgerChanged(); }
          catch (e) { await api.window?.showErrorMessage?.('Rename failed: ' + (e instanceof Error ? e.message : String(e))); }
        } },
        { label: r.archived ? 'Unarchive' : 'Archive', onSelect: async () => {
          try { await db.run(`UPDATE categories SET archived=? WHERE id=?`, [r.archived ? 0 : 1, r.id]); notifyLedgerChanged(); }
          catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
        } },
      ]));
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }
  refresh = serialRefresh(refresh);
  void refresh();
  const offLedger = onLedgerChanged(() => void refresh());
  return () => { alive = false; offLedger(); };
}

// ─── Section: Dashboard ────────────────────────────────────────────────────

// ─── Overview ───────────────────────────────────────────────────────────────
//
// What is left this month (bills counted as committed), how everyday spending
// is pacing, what the last sync did and what waits for you, the bills coming
// up, everyday spending by category, the accounts. Everything is a way in:
// each count opens the rows behind it.
let _overviewMonth = null;
let _planMonth = null; // Plan › Budgets month, kept while switching views

function renderOverviewSection(body, api) {
  const root = document.createElement('div');
  root.className = 'budget-ov';
  body.appendChild(root);
  let disposed = false;

  async function draw() {
    if (disposed) return;
    const monthKey = _overviewMonth || monthRange().key;
    let data;
    try { data = await readOverview(monthKey); }
    catch (err) {
      root.replaceChildren(emptyState('The overview could not be read: ' + (err instanceof Error ? err.message : String(err))));
      return;
    }
    if (disposed) return;
    root.replaceChildren();
    if (!data.hasAny) {
      api.ui.createEmptyState(root, {
        icon: 'wallet',
        headline: 'Nothing in the ledger yet.',
        hint: 'Sync your transaction emails from Gmail, or import a CSV, to see the month here.',
        action: { label: 'Sync Now', onClick: () => api.commands.executeCommand('budget.sync') },
      });
      return;
    }
    drawMonthBar(root, data, api, draw);
    drawSyncStrip(root, data, api);
    const grid = document.createElement('div');
    grid.className = 'budget-ov-grid';
    const main = document.createElement('div');
    main.className = 'budget-ov-col';
    const side = document.createElement('div');
    side.className = 'budget-ov-col';
    grid.append(main, side);
    root.appendChild(grid);
    drawLeftCard(main, data);
    drawFacts(main, data, api);
    drawCategories(main, data, api);
    drawComingUp(side, data, api);
    drawAccounts(side, data, api);
  }

  draw = serialRefresh(draw);
  const offSync = onSyncEvent((e) => { if (e.kind === 'complete' || e.kind === 'error') draw(); });
  const offLedger = onLedgerChanged(draw);
  draw();
  return () => { disposed = true; offSync(); offLedger(); };
}

async function readOverview(monthKey) {
  const plan = await readMonthPlan(monthKey);
  const r = plan.range;
  const anyRow = await db.get(`SELECT COUNT(*) AS n FROM transactions`);
  const income = await db.get(
    `SELECT COALESCE(SUM(-amount_cents),0) AS cents FROM transactions
      WHERE status='confirmed' AND tx_type='deposit' AND transaction_date >= ? AND transaction_date <= ?`,
    [r.start, r.end]);
  const incomeExpectedCents = await readExpectedIncome(r.key);
  const daily = await db.all(
    `SELECT transaction_date AS d, COALESCE(SUM(amount_cents),0) AS cents FROM transactions
      WHERE status='confirmed' AND tx_type IN ('purchase','fee') AND transaction_date >= ? AND transaction_date <= ?
      GROUP BY transaction_date`,
    [r.start, r.end]);
  const transfersAi = await db.get(
    `SELECT COUNT(*) AS n FROM transactions WHERE status='confirmed' AND tx_type='transfer' AND tx_type_source='ai'
      AND transaction_date >= ? AND transaction_date <= ?`, [r.start, r.end]);
  const review = await countReview();
  let last = null;
  try { last = await getSyncStateValue('last_run_status'); } catch { last = null; }
  const lastAt = (await getSyncStateValue('last_run_at')) || null;
  const accounts = await db.all(
    `SELECT v.account_id, v.last_four, v.kind, v.display_name, v.latest_balance_cents
       FROM v_account_latest_balance v JOIN accounts a ON a.id = v.account_id
      WHERE a.archived = 0 AND v.latest_balance_cents IS NOT NULL ORDER BY v.kind, v.last_four`);
  const goals = await db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(current_cents),0) AS cur, COALESCE(SUM(target_cents),0) AS tgt FROM goals WHERE archived = 0`);

  // Everyday spending by day: each bill's payment comes off the day it was paid.
  const byDay = new Map(daily.map(x => [x.d, Number(x.cents) || 0]));
  for (const b of plan.bills) {
    if (b.paidOn && byDay.has(b.paidOn)) byDay.set(b.paidOn, Math.max(0, byDay.get(b.paidOn) - b.paidCents));
  }
  const cumulative = [];
  let run = 0;
  for (let d = 1; d <= plan.dayOfMonth; d++) {
    const iso = `${r.key}-${String(d).padStart(2, '0')}`;
    run += byDay.get(iso) || 0;
    cumulative.push(run);
  }
  return {
    ...plan,
    hasAny: (Number(anyRow?.n) || 0) > 0 || !!lastAt,
    incomeCents: Number(income?.cents) || 0,
    incomeExpectedCents,
    cumulative,
    transfersAi: Number(transfersAi?.n) || 0,
    review,
    last: last && typeof last === 'object' ? last : null,
    lastAt,
    accounts,
    goals: { n: Number(goals?.n) || 0, cur: Number(goals?.cur) || 0, tgt: Number(goals?.tgt) || 0 },
  };
}

function drawMonthBar(root, data, api, redraw) {
  const bar = document.createElement('div');
  drawMonthNav(bar, api, data.range.key, (k) => { _overviewMonth = k === monthRange().key ? null : k; redraw(); });
  root.appendChild(bar);
}

function linkButton(host, text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'budget-link';
  b.textContent = text;
  b.addEventListener('click', onClick);
  host.appendChild(b);
  return b;
}

function drawSyncStrip(root, data, api) {
  if (!data.lastAt && !data.review) return;
  const strip = document.createElement('div');
  strip.className = 'budget-ov-card budget-ov-sync';
  const head = document.createElement('div');
  head.className = 'budget-ov-sync-head';
  const t = document.createElement('div');
  t.className = 'budget-ov-label';
  t.textContent = 'The last sync';
  const when = document.createElement('div');
  when.className = 'budget-ov-faint';
  when.textContent = data.lastAt ? describeWhen(data.lastAt) : 'Not synced yet';
  head.append(t, when);
  strip.appendChild(head);
  const items = document.createElement('div');
  items.className = 'budget-ov-sync-items';
  const last = data.last;
  if (last && last.ok === false) {
    const err = document.createElement('span');
    err.className = 'budget-ov-bad';
    err.textContent = `It failed: ${last.error || 'unknown error'}.`;
    items.appendChild(err);
    linkButton(items, 'Open Sync Log', () => openBudgetSection(api, 'syncLog'));
  } else if (last) {
    const n = document.createElement('span');
    n.textContent = `${Number(last.confirmed) || 0} new`;
    items.appendChild(n);
  }
  if (data.transfersAi) {
    linkButton(items, `${data.transfersAi} transfer${data.transfersAi === 1 ? '' : 's'} the AI typed this month`, () => {
      _navState.txFilter = { monthKey: data.range.key, type: 'transfer' };
      openBudgetSection(api, 'transactions');
    }).title = 'Kept out of spending. A wrong one hides an expense.';
  }
  if (last && Number(last.duplicates) > 0) {
    linkButton(items, `${last.duplicates} possible duplicate${Number(last.duplicates) === 1 ? '' : 's'}`, () => openBudgetSection(api, 'review'));
  }
  if (last && Number(last.rulesLearned) > 0) {
    linkButton(items, `${last.rulesLearned} rule${Number(last.rulesLearned) === 1 ? '' : 's'} learned`, () => openBudgetSection(api, 'rules'));
  }
  strip.appendChild(items);
  if (data.review) {
    const act = document.createElement('div');
    act.className = 'budget-ov-sync-act';
    api.ui.createButton(act, { label: `Review ${data.review}`, kind: 'primary', onClick: () => openBudgetSection(api, 'review') });
    strip.appendChild(act);
  }
  root.appendChild(strip);
}

function describeWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const same = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return same ? `Today at ${time}, from Gmail` : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}, from Gmail`;
}

function paceSentence(p) {
  if (p.limitCents <= 0) return 'Set limits in Plan to see what is left and how spending is pacing.';
  const everyday = fmtMoney(p.everydaySpentCents);
  if (p.dayOfMonth === 0) return 'This month has not started yet.';
  if (p.pace === 'over') return `Everyday spending is ${fmtMoney(p.everydaySpentCents - p.everydayBudgetCents)} past its budget of ${fmtMoney(p.everydayBudgetCents)}.`;
  if (p.projectedCents === null) {
    return `${p.dayOfMonth} day${p.dayOfMonth === 1 ? '' : 's'} in: ${everyday} of everyday spending, ${p.everydaySpentCents <= p.evenByNowCents ? 'under' : 'over'} an even pace. Bills are counted as committed, not as pace.`;
  }
  if (p.pace === 'ahead') return `At this rate everyday spending reaches ${fmtMoney(p.projectedCents)} by the end of the month, past its ${fmtMoney(p.everydayBudgetCents)}.`;
  return `At this rate everyday spending ends near ${fmtMoney(p.projectedCents)}, inside its ${fmtMoney(p.everydayBudgetCents)}.`;
}

function drawLeftCard(col, data) {
  const card = document.createElement('div');
  card.className = 'budget-ov-card';
  const top = document.createElement('div');
  top.className = 'budget-ov-left';
  const big = document.createElement('span');
  big.className = 'budget-ov-big budget-num';
  big.textContent = fmtMoney(Math.abs(data.leftCents));
  const what = document.createElement('span');
  what.className = 'budget-ov-muted';
  what.textContent = data.limitCents > 0
    ? (data.leftCents >= 0 ? `left to spend, of ${fmtMoney(data.limitCents)} planned` : `over the ${fmtMoney(data.limitCents)} planned`)
    : 'spent so far';
  if (data.limitCents <= 0) big.textContent = fmtMoney(data.allSpentCents);
  top.append(big, what);
  card.appendChild(top);

  if (data.limitCents > 0 && data.everydayBudgetCents > 0) {
    const days = data.daysInMonth;
    const max = Math.max(data.everydayBudgetCents, data.cumulative[data.cumulative.length - 1] || 0, 1);
    const W = 600, H = 80;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'budget-ov-chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Everyday spending so far, ${fmtMoney(data.everydaySpentCents)}, against an even pace to ${fmtMoney(data.everydayBudgetCents)}`);
    const even = document.createElementNS(ns, 'line');
    even.setAttribute('x1', '0'); even.setAttribute('y1', String(H));
    even.setAttribute('x2', String(W)); even.setAttribute('y2', String(H - (data.everydayBudgetCents / max) * (H - 4)));
    even.setAttribute('class', 'budget-ov-even');
    svg.appendChild(even);
    if (data.cumulative.length) {
      const pts = ['0,' + H].concat(data.cumulative.map((c, i) => `${((i + 1) / days) * W},${H - (c / max) * (H - 4)}`));
      const line = document.createElementNS(ns, 'polyline');
      line.setAttribute('points', pts.join(' '));
      line.setAttribute('class', 'budget-ov-spent' + (data.pace === 'over' || data.pace === 'ahead' ? ' is-ahead' : ''));
      svg.appendChild(line);
    }
    card.appendChild(svg);
    const axis = document.createElement('div');
    axis.className = 'budget-ov-axis';
    const short = new Date(data.range.year, data.range.month0, 1).toLocaleString('en-US', { month: 'short' });
    axis.innerHTML = '';
    for (const t of [`${short} 1`, `Even pace to ${fmtMoney(data.everydayBudgetCents)}`, `${short} ${days}`]) {
      const s = document.createElement('span'); s.textContent = t; axis.appendChild(s);
    }
    card.appendChild(axis);
  }
  const note = document.createElement('div');
  note.className = 'budget-ov-note';
  note.textContent = paceSentence(data);
  card.appendChild(note);
  col.appendChild(card);
}

function fact(host, label, value, hint) {
  const f = document.createElement('div');
  f.className = 'budget-ov-fact';
  const l = document.createElement('div'); l.className = 'budget-ov-label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'budget-ov-value budget-num'; v.textContent = value;
  const h = document.createElement('div'); h.className = 'budget-ov-faint'; h.textContent = hint;
  f.append(l, v, h);
  host.appendChild(f);
}

function drawFacts(col, data) {
  const card = document.createElement('div');
  card.className = 'budget-ov-card budget-ov-facts';
  fact(card, 'Income', fmtMoney(data.incomeCents),
    data.incomeExpectedCents > 0 ? `of about ${fmtMoney(data.incomeExpectedCents)} in a usual month` : 'this month');
  const toCome = data.allBillsToComeCents;
  fact(card, 'Bills', `${fmtMoney(data.allBillsPaidCents)} paid`, toCome > 0 ? `${fmtMoney(toCome)} still to come` : 'nothing more due this month');
  fact(card, 'Goals', data.goals.tgt > 0 ? `${Math.round((data.goals.cur / data.goals.tgt) * 100)}%` : 'None yet',
    data.goals.tgt > 0 ? `${fmtMoney(data.goals.cur)} of ${fmtMoney(data.goals.tgt)} across ${data.goals.n}` : 'add one in Net Worth and Goals');
  col.appendChild(card);
}

// Every category with a limit or with spending this month. A limited one fills
// toward its limit; one without a limit is drawn against the month's largest
// category, in its own colour, faintly, and says it has no limit.
function drawCategories(col, data, api) {
  const rows = data.categories
    .filter(c => (Number(c.effective_limit_cents) || 0) > 0 || (Number(c.spent_cents) || 0) > 0)
    .sort((a, b) => (Number(b.spent_cents) || 0) - (Number(a.spent_cents) || 0));
  const biggest = Math.max(1, ...rows.map(c => Number(c.spent_cents) || 0));
  const card = document.createElement('div');
  card.className = 'budget-ov-card';
  const head = document.createElement('div');
  head.className = 'budget-ov-head';
  const l = document.createElement('span'); l.className = 'budget-ov-label'; l.textContent = 'Spending by category';
  head.appendChild(l);
  linkButton(head, 'Edit Plan', () => openBudgetSection(api, 'plan', 'budgets'));
  card.appendChild(head);
  for (const c of rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'budget-ov-cat';
    row.title = `Open ${c.name} transactions`;
    const dot = document.createElement('span'); dot.className = 'budget-dot'; dot.style.background = c.color || 'var(--px-text-faint)';
    const name = document.createElement('span'); name.className = 'budget-ov-cat-name'; name.textContent = c.name;
    const bar = document.createElement('span'); bar.className = 'budget-ov-bar';
    const limited = (Number(c.effective_limit_cents) || 0) > 0;
    const fill = document.createElement('span'); fill.className = 'budget-ov-fill' + (c.status === 'over' ? ' is-over' : '') + (limited ? '' : ' is-unplanned');
    fill.style.width = `${Math.min(100, Math.round((limited ? c.pct : (Number(c.spent_cents) || 0) / biggest) * 100))}%`;
    fill.style.background = c.status === 'over' ? '' : (c.color || '');
    bar.appendChild(fill);
    const amt = document.createElement('span'); amt.className = 'budget-ov-cat-amt budget-num';
    const sp = document.createElement('strong'); sp.textContent = fmtMoney(c.spent_cents);
    const of = document.createElement('span'); of.className = 'budget-ov-faint'; of.textContent = limited ? ` of ${fmtMoney(c.effective_limit_cents)}` : ' · no limit';
    amt.append(sp, of);
    row.append(dot, name, bar, amt);
    row.addEventListener('click', () => {
      _navState.txFilter = { categoryId: c.id, monthKey: data.range.key, type: 'spend' };
      openBudgetSection(api, 'transactions');
    });
    card.appendChild(row);
  }
  if (!rows.length) {
    const none = document.createElement('div'); none.className = 'budget-ov-faint'; none.textContent = 'Nothing spent yet this month.';
    card.appendChild(none);
  }
  col.appendChild(card);
}

function drawComingUp(col, data, api) {
  const card = document.createElement('div');
  card.className = 'budget-ov-card';
  const head = document.createElement('div');
  head.className = 'budget-ov-head';
  const l = document.createElement('span'); l.className = 'budget-ov-label'; l.textContent = 'Bills';
  head.appendChild(l);
  linkButton(head, 'All Bills', () => openBudgetSection(api, 'plan', 'bills'));
  card.appendChild(head);
  const bills = data.bills.slice().sort((a, b) => (a.paid === b.paid ? String(a.dueDate || a.paidOn).localeCompare(String(b.dueDate || b.paidOn)) : a.paid ? 1 : -1));
  if (!bills.length) {
    const none = document.createElement('div'); none.className = 'budget-ov-faint'; none.textContent = 'No bills found yet. They show up after a few months of the same charge.';
    card.appendChild(none);
  }
  for (const b of bills) {
    const row = document.createElement('div');
    row.className = 'budget-ov-row';
    const when = document.createElement('span'); when.className = 'budget-ov-when budget-num';
    const date = b.paid ? b.paidOn : b.dueDate;
    when.textContent = date ? new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const name = document.createElement('span'); name.className = 'budget-ov-grow';
    name.textContent = b.name;
    if (b.paid || b.unsure) {
      const tag = document.createElement('span'); tag.className = 'budget-ov-faint';
      tag.textContent = b.paid ? ' · paid' : ' · not sure yet';
      name.appendChild(tag);
    }
    const amt = document.createElement('span'); amt.className = 'budget-num' + (b.paid ? ' budget-ov-faint' : '');
    amt.textContent = fmtMoney(b.paid ? b.paidCents : b.usualCents);
    row.append(when, name, amt);
    card.appendChild(row);
  }
  col.appendChild(card);
}

function drawAccounts(col, data, api) {
  if (!data.accounts.length) return;
  const card = document.createElement('div');
  card.className = 'budget-ov-card';
  const head = document.createElement('div');
  head.className = 'budget-ov-head';
  const l = document.createElement('span'); l.className = 'budget-ov-label'; l.textContent = 'Accounts';
  head.appendChild(l);
  linkButton(head, 'Net Worth', () => openBudgetSection(api, 'worth'));
  card.appendChild(head);
  for (const a of data.accounts) {
    const row = document.createElement('div');
    row.className = 'budget-ov-row';
    const name = document.createElement('span'); name.className = 'budget-ov-grow';
    name.textContent = a.display_name || 'Account';
    if (a.last_four) { const f = document.createElement('span'); f.className = 'budget-ov-faint'; f.textContent = ` ••${a.last_four}`; name.appendChild(f); }
    const bal = Number(a.latest_balance_cents) || 0;
    const amt = document.createElement('span'); amt.className = 'budget-num';
    amt.textContent = a.kind === 'credit_card' ? `${fmtMoney(Math.abs(bal))} owed` : fmtMoney(bal);
    row.append(name, amt);
    card.appendChild(row);
  }
  col.appendChild(card);
}

// Monthly-ized cost of a recurring series, in cents.
function recurringMonthlyCents(cadence, avgCents) {
  const a = Math.max(0, Number(avgCents) || 0);
  switch (cadence) {
    case 'weekly':    return Math.round(a * 52 / 12);
    case 'biweekly':  return Math.round(a * 26 / 12);
    case 'quarterly': return Math.round(a / 3);
    case 'yearly':    return Math.round(a / 12);
    default:          return a; // monthly
  }
}

// Suggested next-month limit for one category. Pure so it can be tested:
// weighted recency average of the last three COMPLETED months (0.5/0.3/0.2,
// most recent first), never below the category's recurring commitment,
// rounded UP to the nearest $5. Zero history + zero recurring → 0 (no
// suggestion). All values in cents.
function suggestLimitCents(m1, m2, m3, recurringCents) {
  const h1 = Math.max(0, Number(m1) || 0);
  const h2 = Math.max(0, Number(m2) || 0);
  const h3 = Math.max(0, Number(m3) || 0);
  const rec = Math.max(0, Number(recurringCents) || 0);
  const base = 0.5 * h1 + 0.3 * h2 + 0.2 * h3;
  const raw = Math.max(base, rec);
  if (raw <= 0) return 0;
  return Math.ceil(raw / 500) * 500;
}

// Per-category history + recurring commitments + expected income for planning
// a FUTURE month. History window = the last three completed months (the
// current, still-running month would bias every average low).
async function computePlanSuggestions() {
  const curKey = monthRange().key;
  const k1 = monthShift(curKey, -1), k2 = monthShift(curKey, -2), k3 = monthShift(curKey, -3);
  const r1 = monthRange(k1), r3 = monthRange(k3);

  let spendRows = [];
  try {
    spendRows = await db.all(
      `SELECT category_id, strftime('%Y-%m', transaction_date) AS m,
              COALESCE(SUM(amount_cents),0) AS net
         FROM transactions
        WHERE status='confirmed' AND tx_type IN ('purchase','fee')
          AND transaction_date >= ? AND transaction_date <= ?
        GROUP BY category_id, m`,
      [r3.start, r1.end]);
  } catch { spendRows = []; }
  const hist = new Map(); // category_id → {m1,m2,m3}
  for (const r of spendRows) {
    const id = r.category_id || '';
    if (!hist.has(id)) hist.set(id, { m1: 0, m2: 0, m3: 0 });
    const h = hist.get(id);
    if (r.m === k1) h.m1 = Math.max(0, Number(r.net) || 0);
    else if (r.m === k2) h.m2 = Math.max(0, Number(r.net) || 0);
    else if (r.m === k3) h.m3 = Math.max(0, Number(r.net) || 0);
  }

  let recRows = [];
  try {
    recRows = await db.all(
      `SELECT category_id, cadence, avg_amount_cents
         FROM recurring_series
        WHERE cancelled=0 AND (user_confirmed=1 OR detection_confidence='high')`);
  } catch { recRows = []; }
  const recurring = new Map(); // category_id → monthly-ized cents
  for (const r of recRows) {
    const id = r.category_id || '';
    recurring.set(id, (recurring.get(id) || 0) + recurringMonthlyCents(r.cadence, r.avg_amount_cents));
  }

  let expectedIncomeCents = 0;
  try {
    const inc = await db.get(
      `SELECT COALESCE(SUM(ABS(amount_cents)),0) AS total
         FROM transactions
        WHERE status='confirmed' AND tx_type='deposit'
          AND transaction_date >= ? AND transaction_date <= ?`,
      [r3.start, r1.end]);
    expectedIncomeCents = Math.round((Number(inc?.total) || 0) / 3);
  } catch { /* keep 0 */ }

  return { hist, recurring, expectedIncomeCents, windowKeys: [k1, k2, k3] };
}

function makeCard(label, value, sub, opts) {
  const c = document.createElement('div'); c.className = 'budget-card';
  const l = document.createElement('div'); l.className = 'budget-card-label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'budget-card-value'; v.textContent = value;
  c.appendChild(l); c.appendChild(v);
  if (sub) { const s = document.createElement('div'); s.className = 'budget-card-sub'; s.textContent = sub; c.appendChild(s); }
  if (opts && typeof opts.onClick === 'function') {
    c.style.cursor = 'pointer';
    c.classList.add('budget-card-clickable');
    if (opts.title) c.title = opts.title;
    c.addEventListener('click', opts.onClick);
    c.setAttribute('role', 'button');
    c.setAttribute('tabindex', '0');
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick(e); }
    });
  }
  return c;
}

// ─── Net Worth: manual assets & liabilities ────────────────────────────────

const MANUAL_ASSET_CLASSES = [
  ['cash', 'Cash'],
  ['investment', 'Investments'],
  ['real_estate', 'Real estate'],
  ['vehicle', 'Vehicle'],
  ['other_asset', 'Other asset'],
];
const MANUAL_LIABILITY_CLASSES = [
  ['credit', 'Credit card'],
  ['loan', 'Loan'],
  ['other_liability', 'Other liability'],
];
function manualClassLabel(cls) {
  const f = [...MANUAL_ASSET_CLASSES, ...MANUAL_LIABILITY_CLASSES].find(x => x[0] === cls);
  return f ? f[1] : cls;
}

// Drawer to add / edit / delete a manual holding (house, 401k, car loan, …).
async function openManualBalanceEditor(api, opts = {}) {
  const isCreate = !opts.id;
  let row = null;
  if (!isCreate) {
    row = await db.get('SELECT * FROM manual_balances WHERE id=?', [opts.id]).catch(() => null);
    if (!row) { await api.window?.showErrorMessage?.('Holding not found.'); return; }
  }

  const overlay = document.createElement('div'); overlay.className = 'budget-drawer-overlay';
  const drawer = document.createElement('div'); drawer.className = 'budget-drawer'; overlay.appendChild(drawer);
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  const head = document.createElement('div'); head.className = 'budget-drawer-head';
  const title = document.createElement('h3'); title.className = 'budget-drawer-title'; title.style.flex = '1';
  title.textContent = isCreate ? 'Add Asset or Debt' : 'Edit Holding';
  head.appendChild(title);
  const closeBtn = document.createElement('button'); closeBtn.className = 'budget-drawer-close'; closeBtn.type = 'button';
  closeBtn.innerHTML = makeIcon(api, 'x', 16) || '✕'; closeBtn.addEventListener('click', close);
  head.appendChild(closeBtn);
  drawer.appendChild(head);

  const form = document.createElement('div'); form.className = 'budget-drawer-body';
  function field(labelText, control, hint) {
    const f = document.createElement('label'); f.className = 'budget-field';
    const l = document.createElement('span'); l.className = 'budget-field-label'; l.textContent = labelText;
    f.appendChild(l); f.appendChild(control);
    if (hint) { const h = document.createElement('span'); h.className = 'budget-field-hint'; h.textContent = hint; f.appendChild(h); }
    return f;
  }

  const nameInput = document.createElement('input'); nameInput.className = 'budget-input'; nameInput.type = 'text';
  nameInput.placeholder = 'e.g. 401(k), House, Car loan'; nameInput.value = row?.name || '';

  const kindSel = makeDropdown(
    [['asset', 'Asset (you own)'], ['liability', 'Liability (you owe)']].map(([value, label]) => ({ value, label })),
    row?.kind || 'asset',
    () => fillClasses());

  const classSel = makeDropdown([], '');
  function fillClasses() {
    const list = kindSel.value === 'liability' ? MANUAL_LIABILITY_CLASSES : MANUAL_ASSET_CLASSES;
    const keep = classSel.value;
    const want = list.some(x => x[0] === keep) ? keep : (row && list.some(x => x[0] === row.asset_class) ? row.asset_class : list[0][0]);
    classSel.setOptions(list.map(([value, label]) => ({ value, label })), want);
  }
  fillClasses();

  const valueInput = document.createElement('input'); valueInput.className = 'budget-input'; valueInput.type = 'number'; valueInput.step = '0.01'; valueInput.min = '0';
  valueInput.placeholder = '0.00'; valueInput.value = row ? ((Number(row.value_cents) || 0) / 100).toFixed(2) : '';

  const dateInput = document.createElement('input'); dateInput.className = 'budget-input'; dateInput.type = 'date';
  dateInput.value = row?.as_of_date ? String(row.as_of_date).slice(0, 10) : todayYmd();

  const notesInput = document.createElement('textarea'); notesInput.className = 'budget-drawer-textarea';
  notesInput.placeholder = 'Notes (optional)'; notesInput.value = row?.notes || '';

  form.appendChild(field('Name', nameInput));
  const r1 = document.createElement('div'); r1.className = 'budget-field-row';
  r1.appendChild(field('Type', kindSel)); r1.appendChild(field('Class', classSel));
  form.appendChild(r1);
  const r2 = document.createElement('div'); r2.className = 'budget-field-row';
  r2.appendChild(field('Value', valueInput, 'Current value (positive)'));
  r2.appendChild(field('As of', dateInput));
  form.appendChild(r2);
  form.appendChild(field('Notes', notesInput));
  drawer.appendChild(form);

  const foot = document.createElement('div'); foot.className = 'budget-drawer-foot';
  if (!isCreate) {
    let armed = false, armTimer = null;
    const delBtn = makeButton('Delete', { onClick: async () => {
      if (!armed) {
        armed = true; delBtn.querySelector('span:last-child').textContent = 'Click again to delete';
        delBtn.classList.add('px-btn--danger');
        armTimer = setTimeout(() => { armed = false; delBtn.querySelector('span:last-child').textContent = 'Delete'; delBtn.classList.remove('px-btn--danger'); }, 3000);
        return;
      }
      if (armTimer) clearTimeout(armTimer);
      try { await db.run('DELETE FROM manual_balances WHERE id=?', [opts.id]); close(); opts.onSaved?.(); }
      catch (e) { await api.window?.showErrorMessage?.('Delete failed: ' + (e instanceof Error ? e.message : String(e))); }
    } });
    foot.appendChild(delBtn);
  }
  const spacer = document.createElement('div'); spacer.className = 'spacer'; foot.appendChild(spacer);
  foot.appendChild(makeButton('Cancel', { onClick: close }));
  async function save() {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const val = parseFloat(valueInput.value);
    if (!Number.isFinite(val) || val < 0) { valueInput.focus(); return; }
    const cents = dollarsToCents(val);
    const kind = kindSel.value; const cls = classSel.value;
    const asOf = dateInput.value || null; const notes = notesInput.value.trim() || null;
    const now = new Date().toISOString();
    try {
      if (isCreate) {
        await db.run(
          `INSERT INTO manual_balances (id, name, kind, asset_class, value_cents, as_of_date, notes, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [crypto.randomUUID(), name, kind, cls, cents, asOf, notes, now, now]);
      } else {
        await db.run(
          `UPDATE manual_balances SET name=?, kind=?, asset_class=?, value_cents=?, as_of_date=?, notes=?, updated_at=? WHERE id=?`,
          [name, kind, cls, cents, asOf, notes, now, opts.id]);
      }
      close(); opts.onSaved?.();
    } catch (e) { await api.window?.showErrorMessage?.('Save failed: ' + (e instanceof Error ? e.message : String(e))); }
  }
  foot.appendChild(makeButton(isCreate ? 'Add holding' : 'Save', { primary: true, onClick: () => void save() }));
  drawer.appendChild(foot);

  document.body.appendChild(overlay);
  nameInput.focus();
}

// ─── Section: Net Worth (accounts + manual holdings) ───────────────────────

function renderAccountsSection(body, api, opts = {}) {
  if (opts.actions) opts.actions.addHolding = () => void openManualBalanceEditor(api, { onSaved: refresh });

  const headEl = document.createElement('div'); headEl.className = 'budget-networth-head'; body.appendChild(headEl);
  const groupsEl = document.createElement('div'); groupsEl.className = 'budget-nw-groups'; body.appendChild(groupsEl);
  const mgmtEl = document.createElement('div'); mgmtEl.className = 'budget-section'; (opts.manageHost || body).appendChild(mgmtEl);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    headEl.innerHTML = ''; groupsEl.innerHTML = ''; mgmtEl.innerHTML = '';

    // Where each balance comes from, and when it was last true.
    const syncedFrom = (a) => `from balance emails${a.latest_balance_date ? ` · ${shortDate(a.latest_balance_date)}` : ''}`;
    const typedBy = (m) => `you update it${m.as_of_date ? ` · ${shortDate(m.as_of_date)}` : ''}`;
    const [acctRows, manualRows, delta30row] = await Promise.all([
      db.all('SELECT * FROM v_account_latest_balance WHERE latest_balance_cents IS NOT NULL ORDER BY kind, last_four').catch(() => []),
      db.all("SELECT * FROM manual_balances WHERE archived=0 ORDER BY kind, asset_class, name").catch(() => []),
      db.get(`WITH d_now AS (SELECT a.id, (SELECT bs.balance_cents FROM balance_snapshots bs WHERE bs.account_id=a.id ORDER BY bs.snapshot_date DESC, bs.created_at DESC LIMIT 1) AS bal FROM accounts a WHERE a.archived=0),
                   d_then AS (SELECT a.id, (SELECT bs.balance_cents FROM balance_snapshots bs WHERE bs.account_id=a.id AND bs.snapshot_date <= date('now','-30 days') ORDER BY bs.snapshot_date DESC, bs.created_at DESC LIMIT 1) AS bal FROM accounts a WHERE a.archived=0)
              SELECT (SELECT COALESCE(SUM(bal),0) FROM d_now) - (SELECT COALESCE(SUM(bal),0) FROM d_then) AS delta`).catch(() => null),
    ]);

    // ── Group synced accounts + manual holdings into asset classes.
    const groups = {
      cash:        { label: 'Cash', items: [] },
      investment:  { label: 'Investments', items: [] },
      real_estate: { label: 'Real Estate', items: [] },
      vehicle:     { label: 'Vehicles', items: [] },
      other_asset: { label: 'Other Assets', items: [] },
      liability:   { label: 'Liabilities', items: [] },
    };
    let assetTotal = 0, liabilityTotal = 0;

    for (const a of acctRows) {
      const bal = Number(a.latest_balance_cents) || 0;
      const name = a.display_name || defaultAccountName(a.kind, a.last_four);
      if (a.kind === 'credit_card' && bal < 0) {
        liabilityTotal += -bal;
        groups.liability.items.push({ name, amount: -bal, side: 'liability', sub: 'Credit card', source: syncedFrom(a) });
      } else {
        assetTotal += bal;
        groups.cash.items.push({ name, amount: bal, side: 'asset', sub: a.kind === 'savings' ? 'Savings' : a.kind === 'credit_card' ? 'Credit card' : 'Checking', source: syncedFrom(a) });
      }
    }
    for (const m of manualRows) {
      const val = Number(m.value_cents) || 0;
      if (m.kind === 'liability') {
        liabilityTotal += val;
        groups.liability.items.push({ name: m.name, amount: val, side: 'liability', sub: manualClassLabel(m.asset_class), id: m.id, source: typedBy(m) });
      } else {
        assetTotal += val;
        const g = groups[m.asset_class] ? m.asset_class : 'other_asset';
        groups[g].items.push({ name: m.name, amount: val, side: 'asset', sub: manualClassLabel(m.asset_class), id: m.id, source: typedBy(m) });
      }
    }
    const netWorth = assetTotal - liabilityTotal;

    // ── Net-worth headline.
    const lbl = document.createElement('div'); lbl.className = 'budget-networth-label'; lbl.textContent = 'Net worth';
    const big = document.createElement('div'); big.className = 'budget-networth-value'; big.textContent = fmtMoney(netWorth);
    headEl.appendChild(lbl); headEl.appendChild(big);
    const sub = document.createElement('div'); sub.className = 'budget-networth-sub';
    const d = delta30row ? Number(delta30row.delta) || 0 : 0;
    sub.innerHTML =
      `<span class="budget-nw-chip">Assets ${escHtml(fmtMoney(assetTotal))}</span>` +
      `<span class="budget-nw-chip is-liab">Liabilities ${escHtml(fmtMoney(liabilityTotal))}</span>` +
      (d ? `<span class="budget-nw-chip ${d >= 0 ? 'is-up' : 'is-down'}" title="Synced accounts only; holdings you update are not tracked over time">Synced accounts ${d >= 0 ? 'up' : 'down'} ${escHtml(fmtMoney(Math.abs(d)))} in 30 days</span>` : '');
    headEl.appendChild(sub);

    if (acctRows.length === 0 && manualRows.length === 0) {
      groupsEl.appendChild(emptyState('No accounts or holdings yet. A sync brings in balances from your bank emails; Add Asset or Debt… adds one by hand.'));
      return;
    }

    // ── Grouped holdings (Cash / Investments / Real Estate / … / Liabilities).
    for (const key of ['cash', 'investment', 'real_estate', 'vehicle', 'other_asset', 'liability']) {
      const g = groups[key];
      if (!g.items.length) continue;
      const subtotal = g.items.reduce((s, i) => s + i.amount, 0);
      const sec = document.createElement('div'); sec.className = 'budget-nw-group';
      const gh = document.createElement('div'); gh.className = 'budget-nw-group-head';
      gh.innerHTML = `<span class="budget-nw-group-title">${escHtml(g.label)}</span><span class="budget-nw-group-total">${escHtml(fmtMoney(subtotal))}</span>`;
      sec.appendChild(gh);
      for (const it of g.items.sort((a, b) => b.amount - a.amount)) {
        const rowEl = document.createElement(it.id ? 'button' : 'div');
        rowEl.className = 'budget-nw-row' + (it.id ? ' budget-nw-row-clickable' : '');
        if (it.id) { rowEl.type = 'button'; rowEl.addEventListener('click', () => void openManualBalanceEditor(api, { id: it.id, onSaved: refresh })); }
        const pct = (it.side === 'asset' && assetTotal > 0) ? Math.round(it.amount / assetTotal * 100) : null;
        rowEl.innerHTML =
          `<span class="budget-nw-row-main"><span class="budget-nw-row-name">${escHtml(it.name)}</span>` +
          `<span class="budget-nw-row-sub">${escHtml([it.sub, it.source].filter(Boolean).join(' · '))}</span></span>` +
          `<span class="budget-nw-row-right"><span class="budget-nw-row-amt">${escHtml(fmtMoney(it.amount))}</span>` +
          (pct != null ? `<span class="budget-nw-row-pct">${pct}% of assets</span>` : '') + `</span>`;
        sec.appendChild(rowEl);
      }
      groupsEl.appendChild(sec);
    }

    // ── Synced-account management (rename / kind / archive).
    let allRows;
    try {
      allRows = await db.all(`
        SELECT a.id, a.last_four, a.kind, a.display_name, a.archived,
               (SELECT COUNT(*) FROM transactions t WHERE t.account_id=a.id) AS tx_count,
               (SELECT bs.balance_cents FROM balance_snapshots bs WHERE bs.account_id=a.id ORDER BY bs.snapshot_date DESC, bs.created_at DESC LIMIT 1) AS bal,
               (SELECT bs.snapshot_date FROM balance_snapshots bs WHERE bs.account_id=a.id ORDER BY bs.snapshot_date DESC, bs.created_at DESC LIMIT 1) AS bal_date
          FROM accounts a
         ORDER BY a.archived ASC, a.kind ASC, a.last_four ASC`);
    } catch { allRows = []; }
    if (allRows.length) {
      api.ui.createSectionLabel(mgmtEl, 'Synced accounts');
      const table = document.createElement('table'); table.className = 'budget-table budget-accounts-table';
      table.innerHTML = `<thead><tr><th>Name</th><th style="width:170px">Kind</th><th style="width:80px">Last 4</th><th style="text-align:right;width:110px">Transactions</th><th style="text-align:right;width:140px">Latest balance</th><th style="width:90px">As of</th><th style="width:48px"><span class="budget-sr">Actions</span></th></tr></thead>`;
      const tb = document.createElement('tbody');
      for (const a of allRows) {
        const tr = document.createElement('tr');
        if (a.archived) tr.className = 'is-archived';
        const tdName = document.createElement('td');
        const inp = document.createElement('input'); inp.type = 'text'; inp.value = a.display_name || ''; inp.className = 'budget-input budget-inline-input';
        inp.placeholder = defaultAccountName(a.kind, a.last_four);
        inp.title = 'Rename';
        inp.addEventListener('change', async () => {
          try { await db.run('UPDATE accounts SET display_name=?, updated_at=? WHERE id=?', [inp.value || null, new Date().toISOString(), a.id]); }
          catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
        });
        tdName.appendChild(inp); tr.appendChild(tdName);
        const tdKind = document.createElement('td');
        const kindSel = makeDropdown(
          ACCOUNT_KINDS.map(k => ({ value: k, label: ACCOUNT_KIND_LABELS[k] || titleCaseToken(k) })),
          a.kind,
          async (val) => {
            try { await db.run('UPDATE accounts SET kind=?, updated_at=? WHERE id=?', [val, new Date().toISOString(), a.id]); await refresh(); }
            catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
          });
        tdKind.appendChild(kindSel); tr.appendChild(tdKind);
        const td4 = document.createElement('td'); td4.textContent = a.last_four ? '••' + a.last_four : '—'; tr.appendChild(td4);
        const tdTx = document.createElement('td'); tdTx.className = 'budget-amount'; tdTx.textContent = String(a.tx_count || 0); tr.appendChild(tdTx);
        const tdBal = document.createElement('td'); tdBal.className = 'budget-amount'; tdBal.textContent = a.bal != null ? fmtMoney(a.bal) : '—'; tr.appendChild(tdBal);
        const tdDate = document.createElement('td'); tdDate.textContent = a.bal_date ? shortDate(a.bal_date) : '—'; tr.appendChild(tdDate);
        const tdAct = document.createElement('td'); tdAct.className = 'budget-cell-more';
        const moreBtn = api.ui.createIconButton(tdAct, { icon: 'ellipsis', title: 'Account Actions', size: 'sm' });
        moreBtn.addEventListener('click', () => api.ui.showContextMenu(moreBtn, [
          { label: a.archived ? 'Unarchive' : 'Archive', onSelect: async () => {
            try { await db.run('UPDATE accounts SET archived=?, updated_at=? WHERE id=?', [a.archived ? 0 : 1, new Date().toISOString(), a.id]); await refresh(); }
            catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
          } },
        ]));
        tr.appendChild(tdAct); tb.appendChild(tr);
      }
      table.appendChild(tb); mgmtEl.appendChild(table);
    }
  }
  refresh = serialRefresh(refresh);
  void refresh();
  const offLedger = onLedgerChanged(() => void refresh());
  return () => { alive = false; offLedger(); };
}

// ─── Savings & debt goals ──────────────────────────────────────────────────

// Average monthly net surplus (income − spend) over the last 3 months — drives
// goal projections.
async function estimateMonthlySurplus() {
  try {
    const months = monthsBack(3);
    let netSum = 0, n = 0;
    for (const m of months) {
      const r = await db.get(
        `SELECT COALESCE(SUM(CASE WHEN tx_type='deposit' THEN ABS(amount_cents) ELSE 0 END),0) AS income,
                COALESCE(SUM(CASE WHEN tx_type IN ('purchase','fee') THEN amount_cents ELSE 0 END),0) AS spend
           FROM transactions WHERE status='confirmed' AND transaction_date >= ? AND transaction_date <= ?`,
        [m.start, m.end]);
      const income = Number(r?.income) || 0, spend = Number(r?.spend) || 0;
      if (income > 0 || spend > 0) { netSum += (income - spend); n++; }
    }
    return n > 0 ? Math.round(netSum / n) : 0;
  } catch { return 0; }
}

function buildGoalCard(g, monthlySurplus, api, refresh) {
  const target = Number(g.target_cents) || 0;
  const current = Math.max(0, Number(g.current_cents) || 0);
  const pct = target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0;
  const remaining = Math.max(0, target - current);

  const card = document.createElement('button'); card.type = 'button'; card.className = 'budget-goal-card';
  card.addEventListener('click', () => void openGoalEditor(api, { id: g.id, onSaved: refresh }));

  const top = document.createElement('div'); top.className = 'budget-goal-top';
  top.innerHTML = `<span class="budget-goal-name">${escHtml(g.name)}</span>` +
    `<span class="budget-goal-kind${g.kind === 'debt' ? ' is-debt' : ''}">${g.kind === 'debt' ? 'Debt payoff' : 'Savings'}</span>`;
  card.appendChild(top);

  const bar = document.createElement('div'); bar.className = 'budget-goal-bar';
  const fill = document.createElement('div'); fill.className = 'budget-goal-fill' + (g.kind === 'debt' ? ' is-debt' : '');
  fill.style.width = pct + '%'; bar.appendChild(fill); card.appendChild(bar);

  // Projection: prefer the explicit target-date pace check; else project from
  // the recent monthly surplus.
  let detail = '';
  if (remaining <= 0) {
    detail = 'Complete';
  } else if (g.target_date) {
    const needed = goalMonthlyNeed(g);
    if (needed == null) detail = `Past its date · ${fmtMoney(remaining)} to go`;
    else {
      const onPace = monthlySurplus >= needed;
      detail = `${fmtMoney(needed)} a month to make ${shortDate(g.target_date)} · ${onPace ? 'on pace' : 'behind'}`;
    }
  } else if (monthlySurplus > 0) {
    const months = Math.ceil(remaining / monthlySurplus);
    const dt = new Date(); dt.setMonth(dt.getMonth() + months);
    detail = `About ${dt.toLocaleString('en-US', { month: 'short', year: 'numeric' })} at ${fmtMoney(monthlySurplus)} a month`;
  } else {
    detail = `${fmtMoney(remaining)} to go`;
  }

  const meta = document.createElement('div'); meta.className = 'budget-goal-meta';
  meta.innerHTML = `<span class="budget-goal-amt">${escHtml(fmtMoney(current))} / ${escHtml(fmtMoney(target))} · ${pct}%</span>` +
    `<span class="budget-goal-proj">${escHtml(detail)}</span>`;
  card.appendChild(meta);
  return card;
}

// Drawer to add / edit / delete a savings or debt goal.
async function openGoalEditor(api, opts = {}) {
  const isCreate = !opts.id;
  let row = null;
  if (!isCreate) {
    row = await db.get('SELECT * FROM goals WHERE id=?', [opts.id]).catch(() => null);
    if (!row) { await api.window?.showErrorMessage?.('Goal not found.'); return; }
  }
  const overlay = document.createElement('div'); overlay.className = 'budget-drawer-overlay';
  const drawer = document.createElement('div'); drawer.className = 'budget-drawer'; overlay.appendChild(drawer);
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);

  const head = document.createElement('div'); head.className = 'budget-drawer-head';
  const title = document.createElement('h3'); title.className = 'budget-drawer-title'; title.style.flex = '1';
  title.textContent = isCreate ? 'New Goal' : 'Edit Goal';
  head.appendChild(title);
  const closeBtn = document.createElement('button'); closeBtn.className = 'budget-drawer-close'; closeBtn.type = 'button';
  closeBtn.innerHTML = makeIcon(api, 'x', 16) || '✕'; closeBtn.addEventListener('click', close); head.appendChild(closeBtn);
  drawer.appendChild(head);

  const form = document.createElement('div'); form.className = 'budget-drawer-body';
  function field(labelText, control, hint) {
    const f = document.createElement('label'); f.className = 'budget-field';
    const l = document.createElement('span'); l.className = 'budget-field-label'; l.textContent = labelText;
    f.appendChild(l); f.appendChild(control);
    if (hint) { const h = document.createElement('span'); h.className = 'budget-field-hint'; h.textContent = hint; f.appendChild(h); }
    return f;
  }
  const nameInput = document.createElement('input'); nameInput.className = 'budget-input'; nameInput.type = 'text';
  nameInput.placeholder = 'e.g. Emergency fund, Pay off Visa'; nameInput.value = row?.name || '';
  const kindSel = makeDropdown(
    [['savings', 'Savings target'], ['debt', 'Debt payoff']].map(([value, label]) => ({ value, label })),
    row?.kind || 'savings');
  const targetInput = document.createElement('input'); targetInput.className = 'budget-input'; targetInput.type = 'number'; targetInput.step = '0.01'; targetInput.min = '0';
  targetInput.placeholder = '0.00'; targetInput.value = row ? ((Number(row.target_cents) || 0) / 100).toFixed(2) : '';
  const currentInput = document.createElement('input'); currentInput.className = 'budget-input'; currentInput.type = 'number'; currentInput.step = '0.01'; currentInput.min = '0';
  currentInput.placeholder = '0.00'; currentInput.value = row ? ((Number(row.current_cents) || 0) / 100).toFixed(2) : '0.00';
  const dateInput = document.createElement('input'); dateInput.className = 'budget-input'; dateInput.type = 'date';
  dateInput.value = row?.target_date ? String(row.target_date).slice(0, 10) : '';
  const notesInput = document.createElement('textarea'); notesInput.className = 'budget-drawer-textarea'; notesInput.placeholder = 'Notes (optional)'; notesInput.value = row?.notes || '';

  form.appendChild(field('Name', nameInput));
  form.appendChild(field('Type', kindSel));
  const r1 = document.createElement('div'); r1.className = 'budget-field-row';
  r1.appendChild(field('Target', targetInput, 'Amount to reach'));
  r1.appendChild(field('Saved so far', currentInput, 'Or paid off'));
  form.appendChild(r1);
  form.appendChild(field('Target date', dateInput, 'Optional: drives the on-pace check'));
  form.appendChild(field('Notes', notesInput));
  drawer.appendChild(form);

  const foot = document.createElement('div'); foot.className = 'budget-drawer-foot';
  if (!isCreate) {
    let armed = false, armTimer = null;
    const delBtn = makeButton('Delete', { onClick: async () => {
      if (!armed) { armed = true; delBtn.querySelector('span:last-child').textContent = 'Click again to delete'; delBtn.classList.add('px-btn--danger'); armTimer = setTimeout(() => { armed = false; delBtn.querySelector('span:last-child').textContent = 'Delete'; delBtn.classList.remove('px-btn--danger'); }, 3000); return; }
      if (armTimer) clearTimeout(armTimer);
      try { await db.run('DELETE FROM goals WHERE id=?', [opts.id]); close(); opts.onSaved?.(); }
      catch (e) { await api.window?.showErrorMessage?.('Delete failed: ' + (e instanceof Error ? e.message : String(e))); }
    } });
    foot.appendChild(delBtn);
  }
  const spacer = document.createElement('div'); spacer.className = 'spacer'; foot.appendChild(spacer);
  foot.appendChild(makeButton('Cancel', { onClick: close }));
  async function save() {
    const name = nameInput.value.trim(); if (!name) { nameInput.focus(); return; }
    const target = parseFloat(targetInput.value); if (!Number.isFinite(target) || target <= 0) { targetInput.focus(); return; }
    const current = parseFloat(currentInput.value); const cur = Number.isFinite(current) ? Math.max(0, current) : 0;
    const now = new Date().toISOString();
    try {
      if (isCreate) {
        await db.run(`INSERT INTO goals (id, name, kind, target_cents, current_cents, target_date, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
          [crypto.randomUUID(), name, kindSel.value, dollarsToCents(target), dollarsToCents(cur), dateInput.value || null, notesInput.value.trim() || null, now, now]);
      } else {
        await db.run(`UPDATE goals SET name=?, kind=?, target_cents=?, current_cents=?, target_date=?, notes=?, updated_at=? WHERE id=?`,
          [name, kindSel.value, dollarsToCents(target), dollarsToCents(cur), dateInput.value || null, notesInput.value.trim() || null, now, opts.id]);
      }
      close(); opts.onSaved?.();
    } catch (e) { await api.window?.showErrorMessage?.('Save failed: ' + (e instanceof Error ? e.message : String(e))); }
  }
  foot.appendChild(makeButton(isCreate ? 'Create goal' : 'Save', { primary: true, onClick: () => void save() }));
  drawer.appendChild(foot);
  document.body.appendChild(overlay);
  nameInput.focus();
}

function renderGoalsSection(body, api, opts = {}) {
  if (opts.actions) opts.actions.newGoal = () => void openGoalEditor(api, { onSaved: refresh });
  api.ui.createSectionLabel(body, 'Goals');

  const headEl = document.createElement('div'); headEl.className = 'budget-section'; body.appendChild(headEl);
  const listEl = document.createElement('div'); listEl.className = 'budget-goals'; body.appendChild(listEl);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    headEl.innerHTML = ''; listEl.innerHTML = '';
    const [goals, monthlySurplus] = await Promise.all([
      db.all('SELECT * FROM goals WHERE archived=0 ORDER BY sort_order, created_at').catch(() => []),
      estimateMonthlySurplus(),
    ]);
    if (!goals.length) {
      listEl.appendChild(emptyState('No goals yet. New Goal… sets a savings target or a debt to pay off, and says when you would get there.'));
      return;
    }
    const totalTarget = goals.reduce((s, g) => s + (Number(g.target_cents) || 0), 0);
    const totalCurrent = goals.reduce((s, g) => s + (Number(g.current_cents) || 0), 0);
    const sub = document.createElement('div'); sub.className = 'budget-networth-sub';
    sub.innerHTML = `<span class="budget-nw-chip">${goals.length} goal${goals.length > 1 ? 's' : ''}</span>` +
      `<span class="budget-nw-chip">${escHtml(fmtMoney(totalCurrent))} of ${escHtml(fmtMoney(totalTarget))}</span>` +
      (monthlySurplus > 0 ? `<span class="budget-nw-chip is-up">About ${escHtml(fmtMoney(monthlySurplus))} a month left over</span>` : `<span class="budget-nw-chip is-down">Nothing left over in recent months</span>`);
    headEl.appendChild(sub);
    for (const g of goals) listEl.appendChild(buildGoalCard(g, monthlySurplus, api, refresh));
  }
  refresh = serialRefresh(refresh);
  void refresh();
  const offBus = onSyncEvent((evt) => { if (evt.kind === 'complete') void refresh(); });
  const offLedger = onLedgerChanged(() => void refresh());
  return () => { alive = false; offBus(); offLedger(); };
}

// ─── Spending donut (category breakdown ring for the Overview) ──────────────

function renderCashFlowSection(body, api) {
  let monthsBackN = 6;

  const toolbar = document.createElement('div'); toolbar.className = 'budget-toolbar';
  const rangeSel = makeDropdown(
    [[3, 'Last 3 months'], [6, 'Last 6 months'], [12, 'Last 12 months']].map(([v, label]) => ({ value: String(v), label })),
    String(monthsBackN),
    (val) => { monthsBackN = Number(val) || 6; void refresh(); });
  toolbar.appendChild(rangeSel);
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  body.appendChild(toolbar);

  const cards = document.createElement('div'); cards.className = 'budget-cards'; body.appendChild(cards);
  // The two charts side by side, each a card that scales its chart to fit.
  const charts = document.createElement('div'); charts.className = 'budget-chart-pair'; body.appendChild(charts);
  const chartWrap = document.createElement('div'); chartWrap.className = 'budget-section budget-chart-card'; charts.appendChild(chartWrap);
  const savingsWrap = document.createElement('div'); savingsWrap.className = 'budget-section budget-chart-card'; charts.appendChild(savingsWrap);
  const tableWrap = document.createElement('div'); body.appendChild(tableWrap);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    cards.innerHTML = ''; chartWrap.innerHTML = ''; savingsWrap.innerHTML = ''; tableWrap.innerHTML = '';

    const months = monthsBack(monthsBackN);
    const groups = [];
    const savingsPoints = [];
    let totalIn = 0, totalOut = 0;

    for (const m of months) {
      const r = await db.get(
        `SELECT COALESCE(SUM(CASE WHEN tx_type IN ('purchase','fee') THEN amount_cents ELSE 0 END),0) AS spend,
                COALESCE(SUM(CASE WHEN tx_type='deposit' THEN ABS(amount_cents) ELSE 0 END),0) AS income
           FROM transactions
          WHERE status='confirmed' AND transaction_date >= ? AND transaction_date <= ?`,
        [m.start, m.end],
      ) || { spend: 0, income: 0 };
      const spend = Number(r.spend) || 0;
      const income = Number(r.income) || 0;
      totalIn += income; totalOut += spend;
      groups.push({
        label: m.label.split(' ')[0].slice(0, 3) + ' ' + String(m.year).slice(2),
        values: [
          { name: 'Income', value: income / 100, color: 'var(--vscode-charts-green, #5da56e)' },
          { name: 'Expenses',  value: spend / 100, color: 'var(--vscode-charts-red, #a43b38)' },
        ],
        meta: { monthKey: m.key, income, spend },
      });
      savingsPoints.push({ label: m.label.split(' ')[0].slice(0, 3), value: (income - spend) / 100 });
    }

    cards.appendChild(makeCard(`Total income (${monthsBackN} months)`, fmtMoney(totalIn), ''));
    cards.appendChild(makeCard(`Total expenses (${monthsBackN} months)`, fmtMoney(totalOut), ''));
    cards.appendChild(makeCard('Average savings rate', totalIn > 0 ? `${Math.round(((totalIn - totalOut) / totalIn) * 100)}%` : '—',
      totalIn > 0 ? `Net ${fmtMoney(totalIn - totalOut)}` : ''));

    const h1 = document.createElement('h3'); h1.textContent = 'Income vs Expenses'; chartWrap.appendChild(h1);
    const chart = buildBar(groups, {
      width: 720, height: 220,
      onClick: (g) => {
        if (g && g.meta) {
          _navState.txFilter = { monthKey: g.meta.monthKey, type: 'all' };
          api.commands.executeCommand('budget.openTransactions').catch(() => {});
        }
      },
    });
    chartWrap.appendChild(chart);
    const legend = document.createElement('div'); legend.className = 'budget-chart-legend';
    legend.innerHTML = `<span><span class="swatch" style="background:var(--vscode-charts-green,#5da56e)"></span>Income</span><span><span class="swatch" style="background:var(--vscode-charts-red,#a43b38)"></span>Expenses</span>`;
    chartWrap.appendChild(legend);

    const h2 = document.createElement('h3'); h2.textContent = 'Net Savings'; savingsWrap.appendChild(h2);
    savingsWrap.appendChild(buildLine(savingsPoints, { width: 720, height: 220 }));

    // Table
    const table = document.createElement('table'); table.className = 'budget-table';
    table.innerHTML = `<thead><tr><th>Month</th><th style="text-align:right">Income</th><th style="text-align:right">Expenses</th><th style="text-align:right">Savings</th><th style="text-align:right">Rate</th></tr></thead>`;
    const tb = document.createElement('tbody');
    months.forEach((m, i) => {
      const inc = groups[i].meta.income, sp = groups[i].meta.spend, save = inc - sp;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escHtml(m.label)}</td>
        <td class="budget-amount positive">${escHtml(fmtMoney(inc))}</td>
        <td class="budget-amount negative">${escHtml(fmtMoney(sp))}</td>
        <td class="budget-amount ${save >= 0 ? 'positive' : 'negative'}">${escHtml(fmtMoney(save))}</td>
        <td class="budget-amount">${inc > 0 ? Math.round((save / inc) * 100) + '%' : '—'}</td>`;
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    tableWrap.appendChild(table);
  }
  refresh = serialRefresh(refresh);
  void refresh();
  const offLedger = onLedgerChanged(() => void refresh());
  return () => { alive = false; offLedger(); };
}

// ─── Section: Reports ──────────────────────────────────────────────────────

function renderReportsSection(body, api) {
  let monthsBackN = 3;

  const toolbar = document.createElement('div'); toolbar.className = 'budget-toolbar';
  const rangeSel = makeDropdown(
    [[1, 'This month'], [3, 'Last 3 months'], [6, 'Last 6 months'], [12, 'Last 12 months']].map(([v, label]) => ({ value: String(v), label })),
    String(monthsBackN),
    (val) => { monthsBackN = Number(val) || 3; void refresh(); });
  toolbar.appendChild(rangeSel);
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  body.appendChild(toolbar);

  const merchSection = document.createElement('div'); merchSection.className = 'budget-section'; body.appendChild(merchSection);
  const catSection = document.createElement('div'); catSection.className = 'budget-section'; body.appendChild(catSection);
  const trendSection = document.createElement('div'); trendSection.className = 'budget-section'; body.appendChild(trendSection);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    merchSection.innerHTML = ''; catSection.innerHTML = ''; trendSection.innerHTML = '';

    const months = monthsBack(monthsBackN);
    const fromDate = months[0].start;
    const toDate = months[months.length - 1].end;

    // Top merchants
    const h1 = document.createElement('h3'); h1.textContent = `Top Merchants (${monthsBackN} Months)`; merchSection.appendChild(h1);
    let merchants = [];
    try {
      merchants = await db.all(`
        SELECT COALESCE(merchant, 'Unknown') AS merchant,
               SUM(amount_cents) AS spend,
               COUNT(*) AS n
          FROM transactions
         WHERE status='confirmed' AND tx_type IN ('purchase','fee')
           AND transaction_date >= ? AND transaction_date <= ?
         GROUP BY merchant
         ORDER BY spend DESC
         LIMIT 15`, [fromDate, toDate]);
    } catch { merchants = []; }

    if (merchants.length === 0) {
      merchSection.appendChild(emptyState('No merchant data in this window.'));
    } else {
      const max = Math.max(1, ...merchants.map(r => Number(r.spend) || 0));
      for (const r of merchants) {
        const row = document.createElement('div'); row.className = 'budget-cat-bar';
        const pct = Math.round((Number(r.spend) / max) * 100);
        row.innerHTML = `
          <div>${escHtml(r.merchant)} <span style="color:var(--vscode-descriptionForeground,#888);font-size:10px">(${r.n})</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:var(--vscode-charts-blue,#5a8bca)"></div></div>
          <div class="amt">${escHtml(fmtMoney(r.spend))}</div>`;
        merchSection.appendChild(row);
      }
    }

    // Category breakdown over window
    const h2 = document.createElement('h3'); h2.textContent = `Expenses by Category (${monthsBackN} Months)`; catSection.appendChild(h2);
    let cats = [];
    try {
      cats = await db.all(`
        SELECT COALESCE(c.name, 'Uncategorized') AS name,
               COALESCE(c.color, '#94a3b8') AS color,
               COALESCE(c.id, '') AS id,
               SUM(t.amount_cents) AS spend
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.status='confirmed' AND t.tx_type IN ('purchase','fee')
           AND t.transaction_date >= ? AND t.transaction_date <= ?
         GROUP BY c.id
         ORDER BY spend DESC`, [fromDate, toDate]);
    } catch { cats = []; }

    if (cats.length > 0) {
      const totalCat = cats.reduce((acc, r) => acc + (Number(r.spend) || 0), 0);
      const layout = document.createElement('div');
      layout.style.display = 'flex'; layout.style.gap = '20px'; layout.style.flexWrap = 'wrap';
      if (totalCat > 0) {
        const slices = cats.filter(r => (Number(r.spend) || 0) > 0).map(r => ({ id: r.id, name: r.name, color: r.color, spend: Number(r.spend) }));
        layout.appendChild(buildDonut(slices, totalCat));
      }
      const list = document.createElement('div'); list.style.flex = '1 1 280px';
      const max = Math.max(1, ...cats.map(r => Number(r.spend) || 0));
      for (const r of cats) {
        const pct = Math.round((Number(r.spend) / max) * 100);
        const row = document.createElement('div'); row.className = 'budget-cat-bar';
        row.innerHTML = `
          <div><span class="budget-cat-swatch" style="background:${escHtml(r.color)}"></span>${escHtml(r.name)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${escHtml(r.color)}"></div></div>
          <div class="amt">${escHtml(fmtMoney(r.spend))}</div>`;
        list.appendChild(row);
      }
      layout.appendChild(list);
      catSection.appendChild(layout);
    } else {
      catSection.appendChild(emptyState('No category data in this window.'));
    }

    // Expense trend over months
    const h3 = document.createElement('h3'); h3.textContent = 'Monthly Expense Trend'; trendSection.appendChild(h3);
    const points = [];
    for (const m of months) {
      const r = await db.get(
        `SELECT COALESCE(SUM(amount_cents), 0) AS spend
           FROM transactions
          WHERE status='confirmed' AND tx_type IN ('purchase','fee')
            AND transaction_date >= ? AND transaction_date <= ?`,
        [m.start, m.end]);
      points.push({ label: m.label.split(' ')[0].slice(0, 3), value: (Number(r?.spend) || 0) / 100 });
    }
    trendSection.appendChild(buildLine(points, { width: 720, height: 160, color: 'var(--vscode-charts-red, #a43b38)' }));
  }
  refresh = serialRefresh(refresh);
  void refresh();
  const offLedger = onLedgerChanged(() => void refresh());
  return () => { alive = false; offLedger(); };
}

// ─── Section: Budgets ──────────────────────────────────────────────────────

// What a goal needs set aside each month to make its date: what is left,
// spread over the months to the target date. null when it has no date, is
// complete, or the date has passed. The goal cards and Plan both use it.
function goalMonthlyNeed(goal, nowMs = Date.now()) {
  const remaining = Math.max(0, (Number(goal.target_cents) || 0) - Math.max(0, Number(goal.current_cents) || 0));
  if (remaining <= 0 || !goal.target_date) return null;
  const days = Math.ceil((new Date(goal.target_date).getTime() - nowMs) / 86400000);
  if (!Number.isFinite(days) || days < 0) return null;
  return Math.ceil(remaining / Math.max(0.5, days / 30.4));
}

// One month as an allocation of expected income. Limits already hold the
// bills (rent sits inside Housing's limit), so everyday is limits less the
// bills. Bills are committed even before limits are set, so what is
// committed is the larger of the two, and what has no job yet is income
// less that and less the goal needs: bills + everyday + goals + the rest
// always add up to the income.
// `billsInLimitsCents` is the part of the bills that sits in a category with a
// limit (default: all of them); a bill in a category without a limit is
// committed but takes nothing from the limits.
function computeAllocation({ incomeCents, limitCents, billsCents, goalsCents, billsInLimitsCents }) {
  const income = Math.max(0, Number(incomeCents) || 0);
  const limits = Math.max(0, Number(limitCents) || 0);
  const bills = Math.max(0, Number(billsCents) || 0);
  const goals = Math.max(0, Number(goalsCents) || 0);
  const inLimits = billsInLimitsCents == null ? bills : Math.max(0, Math.min(bills, Number(billsInLimitsCents) || 0));
  const everyday = Math.max(0, limits - inLimits);
  return {
    incomeCents: income,
    billsCents: bills,
    everydayCents: everyday,
    goalsCents: goals,
    unassignedCents: income - bills - everyday - goals,
  };
}

// Expected income for a month: the average of the three completed months
// before it (never counting a month still running). Overview and Plan share it.
async function readExpectedIncome(monthKey) {
  const nowKey = monthRange().key;
  const anchor = monthKey && monthKey < nowKey ? monthKey : nowKey;
  const from = monthRange(monthShift(anchor, -3)).start;
  const to = monthRange(anchor).start;
  const row = await db.get(
    `SELECT COALESCE(SUM(-amount_cents),0) AS cents FROM transactions
      WHERE status='confirmed' AND tx_type='deposit' AND transaction_date >= ? AND transaction_date < ?`,
    [from, to]).catch(() => null);
  return Math.round((Number(row?.cents) || 0) / 3);
}

// The month arrows Overview, Transactions and Plan share.
function drawMonthNav(host, api, monthKey, go) {
  host.replaceChildren();
  host.classList.add('budget-ov-month');
  const prev = api.ui.createIconButton(host, { icon: 'chevron-left', title: 'Previous Month' });
  const label = document.createElement('span');
  label.className = 'budget-ov-month-label';
  label.textContent = monthRange(monthKey).label;
  host.appendChild(label);
  const next = api.ui.createIconButton(host, { icon: 'chevron-right', title: 'Next Month' });
  prev.addEventListener('click', () => go(monthShift(monthKey, -1)));
  next.addEventListener('click', () => go(monthShift(monthKey, 1)));
  if (monthKey !== monthRange().key) {
    api.ui.createButton(host, { label: 'This Month', kind: 'ghost', size: 'sm', onClick: () => go(monthRange().key) });
  }
}

function monthName(key) {
  const r = monthRange(key);
  return new Date(r.year, r.month0, 1).toLocaleString('en-US', { month: 'long' });
}

// Plan › Budgets: the month as one allocation. Income expected, the bills
// already committed, the everyday limits, what the goals need, and what has
// no job yet. "Left to spend" is the same number the sidebar shows.
function renderBudgetsSection(body, api) {
  let monthKey = _planMonth || monthRange().key;
  const root = document.createElement('div');
  root.className = 'budget-pl';
  body.appendChild(root);
  let alive = true;
  let seq = 0;

  async function writeLimit(categoryId, cents) {
    const now = new Date().toISOString();
    if (cents > 0) {
      const existing = await db.get('SELECT id FROM budgets WHERE category_id=? AND month_key=?', [categoryId, monthKey]);
      if (existing) await db.run('UPDATE budgets SET limit_cents=?, updated_at=? WHERE id=?', [cents, now, existing.id]);
      else await db.run(`INSERT INTO budgets (id, category_id, month_key, limit_cents, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
        [crypto.randomUUID(), categoryId, monthKey, cents, now, now]);
    } else {
      await db.run('DELETE FROM budgets WHERE category_id=? AND month_key=?', [categoryId, monthKey]);
    }
  }

  async function copyPrevious() {
    const prev = monthShift(monthKey, -1);
    const prevRows = await db.all('SELECT category_id, limit_cents FROM budgets WHERE month_key=?', [prev]);
    if (!prevRows || prevRows.length === 0) {
      await api.window?.showInformationMessage?.(`${monthName(prev)} has no limits to copy.`);
      return;
    }
    const now = new Date().toISOString();
    for (const p of prevRows) {
      await db.run(
        `INSERT OR REPLACE INTO budgets (id, category_id, month_key, limit_cents, rollover_cents, created_at, updated_at)
         VALUES (COALESCE((SELECT id FROM budgets WHERE category_id=? AND month_key=?), ?), ?, ?, ?, 0, ?, ?)`,
        [p.category_id, monthKey, crypto.randomUUID(), p.category_id, monthKey, p.limit_cents, now, now]);
    }
    notifyLedgerChanged();
  }

  function go(k) { monthKey = k; _planMonth = k === monthRange().key ? null : k; void draw(); }

  async function draw() {
    if (!alive) return;
    const mySeq = ++seq;
    let plan, income, goals, sugg;
    try {
      plan = await readMonthPlan(monthKey);
      income = await readExpectedIncome(monthKey);
      goals = await db.all(`SELECT id, name, kind, target_cents, current_cents, target_date FROM goals WHERE archived = 0 ORDER BY sort_order, name`).catch(() => []);
      sugg = await computePlanSuggestions();
    } catch (err) {
      if (mySeq === seq) root.replaceChildren(emptyState('The plan could not be read: ' + (err instanceof Error ? err.message : String(err))));
      return;
    }
    if (!alive || mySeq !== seq) return;
    // A limit typed then Tab: the redraw keeps focus on the field it moved to.
    const focusables = () => [...root.querySelectorAll('input, button')];
    const focusAt = root.contains(document.activeElement) ? focusables().indexOf(document.activeElement) : -1;
    const nowKey = monthRange().key;
    const isFuture = monthKey > nowKey;
    const isCurrent = monthKey === nowKey;
    const billsCents = plan.bills.reduce((a, b) => a + (b.paid ? b.paidCents : b.toComeCents), 0);
    const needs = goals.map(g => ({ g, need: goalMonthlyNeed(g) }));
    const goalsCents = needs.reduce((a, x) => a + (x.need || 0), 0);
    const limited = new Set(plan.categories.filter(r => (Number(r.effective_limit_cents) || 0) > 0).map(r => r.id));
    const billsInLimitsCents = plan.bills.filter(b => limited.has(b.categoryId)).reduce((a, b) => a + (b.paid ? b.paidCents : b.toComeCents), 0);
    const alloc = computeAllocation({ incomeCents: income, limitCents: plan.limitCents, billsCents, goalsCents, billsInLimitsCents });

    root.replaceChildren();

    // Month and actions.
    const bar = document.createElement('div');
    bar.className = 'budget-pl-bar';
    const nav = document.createElement('div');
    drawMonthNav(nav, api, monthKey, go);
    bar.appendChild(nav);
    const acts = document.createElement('div');
    acts.className = 'budget-pl-acts';
    api.ui.createButton(acts, { label: `Copy ${monthName(monthShift(monthKey, -1))}`, title: `Use ${monthName(monthShift(monthKey, -1))}'s limits for ${monthName(monthKey)}`, onClick: () => void copyPrevious() });
    if (isCurrent) api.ui.createButton(acts, { label: `Plan ${monthName(monthShift(monthKey, 1))}`, onClick: () => go(monthShift(monthKey, 1)) });
    bar.appendChild(acts);
    root.appendChild(bar);

    // Where the month stands: the sidebar's number, explained.
    if (!isFuture && plan.limitCents > 0) {
      const now = document.createElement('div');
      now.className = 'budget-ov-card budget-pl-now';
      const big = document.createElement('div');
      big.className = 'budget-ov-left';
      const v = document.createElement('span');
      v.className = 'budget-ov-big budget-num' + (plan.leftCents < 0 ? ' budget-ov-bad' : '');
      v.textContent = fmtMoney(plan.leftCents);
      const l = document.createElement('span');
      l.className = 'budget-ov-muted';
      l.textContent = isCurrent ? 'left to spend' : 'left at the end of the month';
      big.append(v, l);
      const how = document.createElement('div');
      how.className = 'budget-ov-note';
      how.textContent = `${fmtMoney(plan.limitCents)} in limits, less ${fmtMoney(plan.spentCents)} spent`
        + (plan.billsToComeCents > 0 ? ` and ${fmtMoney(plan.billsToComeCents)} of bills still to come.` : '.')
        + (plan.unplannedSpentCents > 0 ? ` ${fmtMoney(plan.unplannedSpentCents)} went to categories without a limit.` : '');
      now.append(big, how);
      root.appendChild(now);
    }

    // The allocation.
    const card = document.createElement('div');
    card.className = 'budget-ov-card budget-pl-card';
    root.appendChild(card);
    const total = Math.max(alloc.incomeCents, alloc.billsCents + alloc.everydayCents + alloc.goalsCents, 1);
    const stack = document.createElement('div');
    stack.className = 'budget-pl-stack';
    stack.setAttribute('role', 'img');
    stack.setAttribute('aria-label', `Bills ${fmtMoney(alloc.billsCents)}, everyday ${fmtMoney(alloc.everydayCents)}, goals ${fmtMoney(alloc.goalsCents)} of ${fmtMoney(alloc.incomeCents)} expected income`);
    for (const [cls, cents] of [['is-bills', alloc.billsCents], ['is-everyday', alloc.everydayCents], ['is-goals', alloc.goalsCents]]) {
      const seg = document.createElement('span');
      seg.className = 'budget-pl-seg ' + cls;
      seg.style.width = `${(cents / total) * 100}%`;
      stack.appendChild(seg);
    }
    card.appendChild(stack);
    const legend = document.createElement('div');
    legend.className = 'budget-pl-legend';
    for (const [cls, name, cents] of [['is-bills', 'Bills', alloc.billsCents], ['is-everyday', 'Everyday', alloc.everydayCents], ['is-goals', 'Goals', alloc.goalsCents]]) {
      const item = document.createElement('span');
      const sw = document.createElement('span'); sw.className = 'budget-pl-key ' + cls;
      const t = document.createElement('span'); t.textContent = `${name} `;
      const n = document.createElement('span'); n.className = 'budget-num'; n.textContent = fmtMoney(cents);
      item.append(sw, t, n);
      legend.appendChild(item);
    }
    const of = document.createElement('span');
    of.className = 'budget-ov-faint';
    of.textContent = alloc.incomeCents > 0 ? `of ${fmtMoney(alloc.incomeCents)} expected income` : 'No income recorded in the last three months';
    legend.appendChild(of);
    card.appendChild(legend);

    const group = (title, hint, cents) => {
      const g = document.createElement('div');
      g.className = 'budget-pl-group';
      const h = document.createElement('div');
      h.className = 'budget-pl-head';
      const left = document.createElement('div');
      const t = document.createElement('div'); t.className = 'budget-pl-title'; t.textContent = title;
      const s = document.createElement('div'); s.className = 'budget-ov-faint'; s.textContent = hint;
      left.append(t, s);
      const amt = document.createElement('div'); amt.className = 'budget-num budget-pl-amt'; amt.textContent = fmtMoney(cents);
      h.append(left, amt);
      g.appendChild(h);
      card.appendChild(g);
      return g;
    };

    group('Income expected', 'The average of the last three completed months', alloc.incomeCents);

    const bills = group('Bills', 'From Bills, counted as already spent', alloc.billsCents);
    const dueBills = plan.bills.filter(b => b.paid || b.toComeCents > 0);
    const billLine = document.createElement('div');
    billLine.className = 'budget-pl-line';
    const names = document.createElement('span');
    names.className = 'budget-ov-grow budget-ov-muted';
    names.textContent = dueBills.length ? dueBills.map(b => b.name).join(', ') : 'No bills due this month.';
    billLine.appendChild(names);
    linkButton(billLine, 'See Bills', () => openBudgetSection(api, 'plan', 'bills'));
    bills.appendChild(billLine);

    const cats = group('Everyday', 'Your limits, less the bills inside them. Suggestions come from the last three months.', alloc.everydayCents);
    const billsByCat = new Map();
    for (const b of dueBills) billsByCat.set(b.categoryId, (billsByCat.get(b.categoryId) || 0) + (b.paid ? b.paidCents : b.toComeCents));
    for (const r of plan.categories) {
      const row = document.createElement('div');
      row.className = 'budget-pl-cat';
      const nameCol = document.createElement('div');
      nameCol.className = 'budget-pl-catname';
      const top = document.createElement('span');
      top.className = 'budget-pl-cattop';
      const dot = document.createElement('span'); dot.className = 'budget-dot'; dot.style.background = r.color || 'var(--px-text-faint)';
      const nm = document.createElement('span'); nm.className = 'budget-ov-grow'; nm.textContent = r.name;
      top.append(dot, nm);
      nameCol.appendChild(top);
      const sub = document.createElement('span');
      sub.className = 'budget-ov-faint';
      const parts = [];
      const inBills = billsByCat.get(r.id) || 0;
      if (inBills) parts.push(`includes ${fmtMoney(inBills)} of bills`);
      const h = sugg.hist.get(r.id) || { m1: 0, m2: 0, m3: 0 };
      const suggested = suggestLimitCents(h.m1, h.m2, h.m3, sugg.recurring.get(r.id) || 0);
      sub.textContent = parts.join(' · ');
      if (parts.length) nameCol.appendChild(sub);

      const input = document.createElement('input');
      input.type = 'number'; input.step = '1'; input.min = '0';
      input.className = 'budget-input budget-pl-input';
      input.setAttribute('aria-label', `${r.name} limit for ${monthName(monthKey)}`);
      input.placeholder = 'No limit';
      input.value = r.effective_limit_cents > 0 ? (r.effective_limit_cents / 100).toFixed(2) : '';
      input.addEventListener('change', async () => {
        const cents = Math.round(parseFloat(input.value || '0') * 100) || 0;
        try { await writeLimit(r.id, cents); notifyLedgerChanged(); }
        catch (e) { await api.window?.showErrorMessage?.('The limit was not saved: ' + (e instanceof Error ? e.message : String(e))); }
      });

      const useCol = document.createElement('div');
      useCol.className = 'budget-pl-use';
      if (suggested > 0 && suggested !== r.effective_limit_cents) {
        api.ui.createButton(useCol, { label: `Use ${fmtMoney(suggested)}`, kind: 'ghost', size: 'sm', title: `Set the limit to ${fmtMoney(suggested)}, from the last three months`, onClick: async () => {
          try { await writeLimit(r.id, suggested); notifyLedgerChanged(); }
          catch (e) { await api.window?.showErrorMessage?.('The limit was not saved: ' + (e instanceof Error ? e.message : String(e))); }
        } });
      }

      const spentCol = document.createElement('div');
      spentCol.className = 'budget-pl-spent';
      if (!isFuture) {
        const eff = Number(r.effective_limit_cents) || 0;
        const st = document.createElement('span');
        st.className = 'budget-num' + (eff > 0 && r.spent_cents > eff ? ' budget-ov-bad' : ' budget-ov-muted');
        st.textContent = `${fmtMoney(r.spent_cents)} spent`;
        spentCol.appendChild(st);
        if (eff > 0) {
          const barEl = document.createElement('span'); barEl.className = 'budget-ov-bar';
          const fill = document.createElement('span'); fill.className = 'budget-ov-fill' + (r.spent_cents > eff ? ' is-over' : '');
          fill.style.width = `${Math.min(100, (r.spent_cents / eff) * 100)}%`;
          barEl.appendChild(fill);
          spentCol.appendChild(barEl);
        }
      }
      row.append(nameCol, useCol, input, spentCol);
      cats.appendChild(row);
    }

    const goalsGroup = group('Goals', 'What each goal needs a month to make its date', alloc.goalsCents);
    if (!goals.length) {
      const none = document.createElement('div');
      none.className = 'budget-pl-line';
      const t = document.createElement('span'); t.className = 'budget-ov-grow budget-ov-muted'; t.textContent = 'No goals yet.';
      none.appendChild(t);
      linkButton(none, 'Net Worth and Goals', () => openBudgetSection(api, 'worth'));
      goalsGroup.appendChild(none);
    }
    for (const { g, need } of needs) {
      const line = document.createElement('div');
      line.className = 'budget-pl-line';
      const n = document.createElement('span'); n.className = 'budget-ov-grow'; n.textContent = g.name;
      const d = document.createElement('span'); d.className = 'budget-ov-faint';
      const remaining = Math.max(0, (Number(g.target_cents) || 0) - Math.max(0, Number(g.current_cents) || 0));
      d.textContent = remaining <= 0 ? 'Complete'
        : need != null ? `${fmtMoney(need)} a month to make ${shortDate(g.target_date)}`
        : g.target_date ? 'Past its date' : 'No date set';
      line.append(n, d);
      goalsGroup.appendChild(line);
    }

    // What has no job yet.
    const left = document.createElement('div');
    left.className = 'budget-pl-left' + (alloc.unassignedCents < 0 ? ' is-over' : '');
    const lt = document.createElement('div');
    const ln = document.createElement('div'); ln.className = 'budget-pl-title';
    ln.textContent = alloc.unassignedCents >= 0 ? 'Not yet given a job' : 'Planned past your income';
    const lh = document.createElement('div'); lh.className = 'budget-ov-faint';
    lh.textContent = alloc.unassignedCents >= 0 ? 'Leave it as a cushion, or put it toward a goal.' : 'Lower a limit until this is zero or more.';
    lt.append(ln, lh);
    const la = document.createElement('div'); la.className = 'budget-num budget-pl-amt' + (alloc.unassignedCents < 0 ? ' budget-ov-bad' : '');
    la.textContent = fmtMoney(alloc.unassignedCents);
    left.append(lt, la);
    card.appendChild(left);
    if (focusAt >= 0) focusables()[focusAt]?.focus();
  }

  const offLedger = onLedgerChanged(() => void draw());
  const offSync = onSyncEvent((e) => { if (e.kind === 'complete') void draw(); });
  void draw();
  return () => { alive = false; offLedger(); offSync(); };
}

// ─── Section: Recurring ────────────────────────────────────────────────────

function renderRecurringSection(body, api) {
  let showCancelled = false;

  const toolbar = document.createElement('div'); toolbar.className = 'budget-toolbar';
  api.ui.createFilterChip(toolbar, { label: 'Show Cancelled', pressed: false, onToggle: (on) => { showCancelled = on; void refresh(); } });
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  toolbar.appendChild(makeButton('Detect Bills', {
    icon: 'refresh-cw',
    title: 'Look through the ledger for charges that repeat',
    onClick: async () => {
      try {
        const n = await detectRecurring(api);
        await api.window?.showInformationMessage?.(`Detected ${n} new recurring series.`);
        await refresh();
      } catch (e) {
        await api.window?.showErrorMessage?.('Detection failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    },
  }));
  body.appendChild(toolbar);

  const summary = document.createElement('div'); summary.className = 'budget-cards'; body.appendChild(summary);
  const listWrap = document.createElement('div'); listWrap.className = 'budget-recur'; body.appendChild(listWrap);

  // Relative due label: "Today" / "in 4 days" / "overdue · date" / plain date.
  function dueLabel(ymd, today) {
    if (!ymd) return '—';
    const d = Math.round((new Date(ymd + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000);
    if (d < 0) return `overdue · ${fmtDate(ymd)}`;
    if (d === 0) return 'Today';
    if (d === 1) return 'Tomorrow';
    if (d <= 30) return `in ${d} days`;
    return fmtDate(ymd);
  }

  let alive = true;
  async function refresh() {
    if (!alive) return;
    summary.innerHTML = ''; listWrap.innerHTML = '';

    const all = await db.all(`
      SELECT r.*, c.name AS category_name, c.color AS category_color
        FROM recurring_series r
        LEFT JOIN categories c ON c.id = r.category_id
       ${showCancelled ? '' : 'WHERE r.cancelled = 0'}
       ORDER BY r.cancelled ASC, (r.next_due_date IS NULL), r.next_due_date ASC, r.merchant_pattern ASC`);

    const active = all.filter(r => !r.cancelled);
    const totalMonthly = active.reduce((acc, r) => {
      const cents = Number(r.avg_amount_cents) || 0;
      switch (r.cadence) {
        case 'weekly':    return acc + cents * 4.33;
        case 'biweekly':  return acc + cents * 2.17;
        case 'monthly':   return acc + cents;
        case 'quarterly': return acc + cents / 3;
        case 'yearly':    return acc + cents / 12;
        default: return acc;
      }
    }, 0);

    const today = todayYmd();
    const next30 = active.filter(r => r.next_due_date && r.next_due_date <= addDays(today, 30));
    const next30Total = next30.reduce((s, r) => s + (Number(r.avg_amount_cents) || 0), 0);

    summary.appendChild(makeCard('Active bills', String(active.length), 'Found from repeating charges'));
    summary.appendChild(makeCard('Bills a month', fmtMoney(Math.round(totalMonthly)), 'Each usual amount, spread over a month'));
    summary.appendChild(makeCard('Due in 30 days', String(next30.length), next30.length ? `~${fmtMoney(Math.round(next30Total))} upcoming` : 'Nothing due soon'));

    if (all.length === 0) {
      listWrap.appendChild(emptyState('No bills found yet. Sync more transactions, then choose Detect Bills.'));
      return;
    }

    // One clean list, soonest due first. Actions reveal on hover.
    for (const r of all) {
      const row = document.createElement('div');
      row.className = 'budget-recur-row' + (r.cancelled ? ' is-cancelled' : '');

      const main = document.createElement('div'); main.className = 'budget-recur-main';
      const lowHint = (!r.cancelled && r.detection_confidence === 'low') ? ' · <span class="budget-recur-low">unsure</span>' : '';
      main.innerHTML =
        `<span class="budget-recur-dot" style="background:${escHtml(r.category_color || '#98a2b3')}"></span>` +
        `<span class="budget-recur-text"><span class="budget-recur-name">${escHtml(r.display_name || r.merchant_pattern)}</span>` +
        `<span class="budget-recur-sub">${escHtml(titleCaseToken(r.cadence))}${r.category_name ? ' · ' + escHtml(r.category_name) : ''}${lowHint}</span></span>`;

      const right = document.createElement('div'); right.className = 'budget-recur-right';
      right.innerHTML =
        `<span class="budget-recur-amt">${escHtml(fmtMoney(r.avg_amount_cents))}</span>` +
        `<span class="budget-recur-due">${escHtml(r.cancelled ? 'Cancelled' : dueLabel(r.next_due_date, today))}</span>`;

      const acts = document.createElement('div'); acts.className = 'budget-recur-acts';
      acts.appendChild(makeButton(r.cancelled ? 'Reactivate' : 'Cancel', {
        onClick: async () => {
          await db.run('UPDATE recurring_series SET cancelled=?, updated_at=? WHERE id=?', [r.cancelled ? 0 : 1, new Date().toISOString(), r.id]);
          await refresh();
        },
      }));
      if (!r.cancelled && !r.user_confirmed) {
        acts.appendChild(makeButton('Confirm', {
          primary: true,
          onClick: async () => {
            await db.run('UPDATE recurring_series SET user_confirmed=1, updated_at=? WHERE id=?', [new Date().toISOString(), r.id]);
            await refresh();
          },
        }));
      }

      row.appendChild(main); row.appendChild(right); row.appendChild(acts);
      listWrap.appendChild(row);
    }
  }
  refresh = serialRefresh(refresh);
  void refresh();
  const offLedger = onLedgerChanged(() => void refresh());
  return () => { alive = false; offLedger(); };
}

// ─── Section: Rules ────────────────────────────────────────────────────────

// What a rule would do to the ledger before it is saved. `rows` are past
// confirmed purchases ({merchant, category_id, categorization_source}). A row
// whose category you set by hand is never changed by a rule; it is counted
// as kept. Changes are grouped by merchant and the category they leave.
function ruleDryRun(probe, rows, categoryId) {
  const groups = new Map();
  let matched = 0, changing = 0, keptManual = 0;
  for (const r of rows) {
    if (!ruleMatchesMerchant(probe, r.merchant)) continue;
    matched++;
    if (r.category_id === categoryId) continue;
    if (r.categorization_source === 'manual') { keptManual++; continue; }
    changing++;
    const key = `${r.merchant}\u0000${r.category_id || ''}`;
    const g = groups.get(key) || { merchant: r.merchant, fromId: r.category_id || null, n: 0 };
    g.n++;
    groups.set(key, g);
  }
  return { matched, changing, keptManual, changes: [...groups.values()].sort((a, b) => b.n - a.n) };
}

const RULE_MATCH_LABELS = { contains: 'contains', exact: 'is exactly', regex: 'matches the pattern' };

function ruleMadeBy(r) {
  if (!r.auto_created) return 'You';
  return Number(r.priority) === 50 ? 'Learned' : 'Automatic';
}

// Merchants and Rules: every rule, and every merchant still left to the AI.
// A rule decides the category before the AI is asked.
function renderRulesSection(body, api) {
  const root = document.createElement('div');
  root.className = 'budget-ru';
  body.appendChild(root);

  setPageActions({ primary: { label: 'New Rule…', icon: 'plus', onClick: () => showEditor(null) } });
  const help = document.createElement('p');
  help.className = 'budget-ov-note budget-ru-help';
  help.textContent = 'A rule decides the category before the AI is asked. Merchants without a rule are left to the AI; three matching AI answers make a learned rule, as long as none disagree.';
  root.appendChild(help);

  const editorWrap = document.createElement('div');
  root.appendChild(editorWrap);
  const rulesWrap = document.createElement('div');
  root.appendChild(rulesWrap);
  const aiWrap = document.createElement('div');
  root.appendChild(aiWrap);

  let alive = true;
  let categories = [];
  const catName = (id) => categories.find(c => c.id === id)?.name || 'No category';

  async function pastPurchases() {
    return db.all(`SELECT merchant, category_id, categorization_source FROM transactions
                    WHERE status='confirmed' AND tx_type='purchase' AND merchant IS NOT NULL`).catch(() => []);
  }

  // The rule form, with the dry run that says what saving would change.
  function showEditor(rule, preset) {
    editorWrap.replaceChildren();
    const card = document.createElement('div');
    card.className = 'budget-ov-card budget-ru-form';
    const title = document.createElement('div');
    title.className = 'budget-pl-title';
    title.textContent = rule ? 'Edit Rule' : 'New Rule';
    card.appendChild(title);

    let matchType = rule ? rule.match_type : (preset?.matchType || 'contains');
    const rowA = document.createElement('div');
    rowA.className = 'budget-ru-field';
    const la = document.createElement('span'); la.className = 'budget-ov-label'; la.textContent = 'When the merchant';
    const seg = document.createElement('div');
    api.ui.createSegmented(seg, {
      ariaLabel: 'How the merchant is matched',
      items: [{ value: 'contains', label: 'Contains' }, { value: 'exact', label: 'Is Exactly' }, { value: 'regex', label: 'Matches Pattern' }],
      value: matchType,
      onChange: (v) => { matchType = v; schedule(); },
    });
    const patternInp = document.createElement('input');
    patternInp.className = 'budget-input budget-ru-input';
    patternInp.setAttribute('aria-label', 'Merchant text');
    patternInp.placeholder = 'e.g. BLUE BOTTLE';
    patternInp.value = rule ? rule.pattern : (preset?.pattern || '');
    rowA.append(la, seg, patternInp);
    card.appendChild(rowA);

    const rowB = document.createElement('div');
    rowB.className = 'budget-ru-field';
    const lb = document.createElement('span'); lb.className = 'budget-ov-label'; lb.textContent = 'File it under';
    const catSel = makeDropdown(categoryOptions(categories, 'Choose a category…'),
      rule ? (rule.category_id || '') : (preset?.categoryId || ''), () => schedule(), { ariaLabel: 'Category', className: 'budget-ru-cat' });
    rowB.append(lb, catSel);
    card.appendChild(rowB);

    const dry = document.createElement('div');
    dry.className = 'budget-ru-dry';
    card.appendChild(dry);

    const pastLabel = document.createElement('label');
    pastLabel.className = 'budget-rv-check';
    const pastBox = document.createElement('input');
    pastBox.type = 'checkbox';
    const pastText = document.createElement('span');
    pastText.textContent = 'Also change the past ones';
    pastLabel.append(pastBox, pastText);
    card.appendChild(pastLabel);

    let lastDry = null;
    let timer = null;
    function schedule() { clearTimeout(timer); timer = setTimeout(() => void runDry(), 200); }
    async function runDry() {
      const pattern = patternInp.value.trim();
      const categoryId = catSel.value || null;
      dry.replaceChildren();
      const head = document.createElement('div'); head.className = 'budget-ov-label'; head.textContent = 'Before you save';
      dry.appendChild(head);
      const line = document.createElement('div');
      dry.appendChild(line);
      if (!pattern) { line.className = 'budget-ov-faint'; line.textContent = 'Type the merchant text to see what it would match.'; lastDry = null; pastLabel.hidden = true; return; }
      if (matchType === 'regex') { try { new RegExp(pattern, 'i'); } catch { line.className = 'budget-ov-bad'; line.textContent = 'That pattern is not valid.'; lastDry = null; pastLabel.hidden = true; return; } }
      const result = ruleDryRun({ pattern, match_type: matchType }, await pastPurchases(), categoryId);
      if (!alive) return;
      lastDry = result;
      line.className = '';
      line.textContent = result.matched === 0
        ? 'It matches nothing in the ledger yet. It will apply to new imports.'
        : !categoryId ? `It matches ${result.matched} past purchase${result.matched === 1 ? '' : 's'}. Choose a category to see what would change.`
        : `It matches ${result.matched} past purchase${result.matched === 1 ? '' : 's'}; ${result.changing} would change category.`
          + (result.keptManual ? ` ${result.keptManual} you set by hand stay as they are.` : '');
      for (const c of categoryId ? result.changes.slice(0, 6) : []) {
        const row = document.createElement('div');
        row.className = 'budget-ru-change';
        const m = document.createElement('span'); m.className = 'budget-ov-grow'; m.textContent = c.merchant;
        const t = document.createElement('span'); t.className = 'budget-ov-muted'; t.textContent = `${catName(c.fromId)} → ${catName(categoryId)}`;
        const n = document.createElement('span'); n.className = 'budget-num budget-ov-faint'; n.textContent = String(c.n);
        row.append(m, t, n);
        dry.appendChild(row);
      }
      if (categoryId && result.changes.length > 6) {
        const more = document.createElement('div'); more.className = 'budget-ov-faint';
        more.textContent = `And ${result.changes.length - 6} more merchants.`;
        dry.appendChild(more);
      }
      pastLabel.hidden = !(categoryId && result.changing > 0);
      pastText.textContent = `Also change the past ${result.changing === 1 ? 'one' : result.changing}`;
    }
    patternInp.addEventListener('input', schedule);

    const acts = document.createElement('div');
    acts.className = 'budget-ru-acts';
    api.ui.createButton(acts, { label: 'Cancel', onClick: () => editorWrap.replaceChildren() });
    api.ui.createButton(acts, { label: 'Save Rule', kind: 'primary', onClick: () => void save() });
    card.appendChild(acts);
    editorWrap.appendChild(card);
    void runDry();
    patternInp.focus();

    async function save() {
      const pattern = patternInp.value.trim();
      const categoryId = catSel.value || null;
      if (!pattern || !categoryId) { await api.window?.showWarningMessage?.('A rule needs the merchant text and a category.'); return; }
      if (matchType === 'regex') { try { new RegExp(pattern, 'i'); } catch { await api.window?.showWarningMessage?.('That pattern is not valid.'); return; } }
      const now = new Date().toISOString();
      let id = rule ? rule.id : crypto.randomUUID();
      try {
        if (rule) {
          // Saving a learned rule makes it yours: it no longer gives way.
          await db.run(`UPDATE categorization_rules SET pattern=?, match_type=?, category_id=?, priority=100, auto_created=0, updated_at=? WHERE id=?`,
            [pattern, matchType, categoryId, now, rule.id]);
        } else {
          await db.run(`INSERT INTO categorization_rules (id, pattern, match_type, category_id, priority, auto_created, active, created_at, updated_at)
                        VALUES (?,?,?,?,100,0,1,?,?)`, [id, pattern, matchType, categoryId, now, now]);
        }
        let changed = 0;
        if (!pastLabel.hidden && pastBox.checked) {
          const rows = await db.all(`SELECT id, merchant, category_id, categorization_source FROM transactions
                                      WHERE status='confirmed' AND tx_type='purchase' AND merchant IS NOT NULL`);
          const probe = { pattern, match_type: matchType };
          for (const r of rows) {
            if (!ruleMatchesMerchant(probe, r.merchant) || r.category_id === categoryId || r.categorization_source === 'manual') continue;
            await db.run(`UPDATE transactions SET category_id=?, categorization_source='rule', matched_rule_id=?, updated_at=? WHERE id=?`,
              [categoryId, id, now, r.id]);
            changed++;
          }
        }
        editorWrap.replaceChildren();
        notifyLedgerChanged();
        if (changed) await api.window?.showInformationMessage?.(`Rule saved. ${changed} past purchase${changed === 1 ? '' : 's'} moved to ${catName(categoryId)}.`);
      } catch (e) {
        await api.window?.showErrorMessage?.('The rule was not saved: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  }

  function head(host, title, hint) {
    const h = document.createElement('div');
    h.className = 'budget-ru-head';
    const t = document.createElement('div'); t.className = 'budget-pl-title'; t.textContent = title;
    h.appendChild(t);
    if (hint) { const s = document.createElement('div'); s.className = 'budget-ov-faint'; s.textContent = hint; h.appendChild(s); }
    host.appendChild(h);
  }

  function cols(host, labels) {
    const r = document.createElement('div');
    r.className = 'budget-ru-row budget-ru-cols';
    for (const l of labels) { const s = document.createElement('span'); s.textContent = l; r.appendChild(s); }
    host.appendChild(r);
  }

  async function refresh() {
    if (!alive) return;
    categories = await db.all('SELECT id, name, color, kind FROM categories WHERE archived=0 ORDER BY kind, sort_order, name').catch(() => []);
    const rules = await db.all(`
      SELECT r.*, c.name AS category_name, c.color AS category_color,
             (SELECT COUNT(*) FROM transactions t WHERE t.matched_rule_id = r.id) AS matches
        FROM categorization_rules r LEFT JOIN categories c ON c.id = r.category_id
       ORDER BY r.active DESC, r.auto_created ASC, r.priority DESC, r.pattern COLLATE NOCASE`).catch(() => []);
    const aiRows = await db.all(`
      SELECT t.merchant, t.category_id, COUNT(*) AS n
        FROM transactions t
       WHERE t.status='confirmed' AND t.tx_type='purchase' AND t.categorization_source='ai' AND t.merchant IS NOT NULL
       GROUP BY LOWER(t.merchant), t.category_id`).catch(() => []);
    if (!alive) return;

    rulesWrap.replaceChildren();
    head(rulesWrap, 'Rules', rules.length ? '' : 'None yet. Make one here, or let Review and repeated AI answers teach them.');
    if (rules.length) {
      cols(rulesWrap, ['Merchant', 'Category', 'Used', 'Made by', '']);
      for (const r of rules) {
        const row = document.createElement('div');
        row.className = 'budget-ru-row' + (r.active ? '' : ' is-off');
        const who = document.createElement('span');
        who.className = 'budget-ru-who';
        const p = document.createElement('span'); p.className = 'budget-ov-grow'; p.textContent = r.pattern;
        const m = document.createElement('span'); m.className = 'budget-ov-faint';
        m.textContent = `${RULE_MATCH_LABELS[r.match_type] || r.match_type}${r.active ? '' : ' · turned off'}`;
        who.append(p, m);
        const cat = document.createElement('span');
        cat.className = 'budget-tx-cat';
        const dot = document.createElement('span'); dot.className = 'budget-dot'; dot.style.background = r.category_color || 'var(--px-text-faint)';
        const cn = document.createElement('span'); cn.className = 'budget-ov-grow'; cn.textContent = r.category_name || 'Category deleted';
        cat.append(dot, cn);
        const used = document.createElement('span');
        used.className = 'budget-num budget-ov-muted';
        used.textContent = String(Number(r.matches) || 0);
        used.title = `${Number(r.matches) || 0} transactions carry this rule; it fired ${Number(r.hits) || 0} times during syncs`;
        const by = document.createElement('span'); by.className = 'budget-ov-muted'; by.textContent = ruleMadeBy(r);
        const more = document.createElement('span');
        more.className = 'budget-ru-more';
        const btn = api.ui.createIconButton(more, { icon: 'ellipsis', title: 'Rule Actions' });
        btn.addEventListener('click', () => api.ui.showContextMenu(btn, [
          { label: 'Edit…', onSelect: () => showEditor(r) },
          { label: r.active ? 'Turn Off' : 'Turn On', onSelect: async () => {
            await db.run('UPDATE categorization_rules SET active=?, updated_at=? WHERE id=?', [r.active ? 0 : 1, new Date().toISOString(), r.id]);
            notifyLedgerChanged();
          } },
          { separator: true },
          { label: 'Delete…', danger: true, onSelect: async () => {
            const ok = await api.window.showConfirmModal({
              message: `Delete the rule “${r.pattern}”?`,
              detail: 'Past transactions keep their category. New imports go back to the AI.',
              confirmLabel: 'Delete Rule', danger: true,
            });
            if (!ok) return;
            await db.run('DELETE FROM categorization_rules WHERE id=?', [r.id]);
            notifyLedgerChanged();
          } },
        ]));
        row.append(who, cat, used, by, more);
        rulesWrap.appendChild(row);
      }
    }

    // Merchants still left to the AI: no active rule matches them.
    const active = rules.filter(r => r.active);
    const byMerchant = new Map();
    for (const x of aiRows) {
      if (reviewRuleFor(active, x.merchant)) continue;
      const key = String(x.merchant).toLowerCase();
      const g = byMerchant.get(key) || { merchant: x.merchant, n: 0, cats: new Map() };
      g.n += Number(x.n) || 0;
      g.cats.set(x.category_id, (g.cats.get(x.category_id) || 0) + (Number(x.n) || 0));
      byMerchant.set(key, g);
    }
    const left = [...byMerchant.values()].sort((a, b) => b.n - a.n);
    aiWrap.replaceChildren();
    head(aiWrap, 'Left to the AI', left.length ? 'Each import asks the AI again. A rule makes it certain and free.' : 'Every merchant the AI has sorted is covered by a rule.');
    if (left.length) {
      cols(aiWrap, ['Merchant', 'The AI said', 'Times', '', '']);
      for (const g of left.slice(0, 60)) {
        const [topCat] = [...g.cats.entries()].sort((a, b) => b[1] - a[1])[0];
        const row = document.createElement('div');
        row.className = 'budget-ru-row';
        const who = document.createElement('span'); who.className = 'budget-ru-who';
        const p = document.createElement('span'); p.className = 'budget-ov-grow'; p.textContent = g.merchant;
        who.appendChild(p);
        if (g.cats.size > 1) { const m = document.createElement('span'); m.className = 'budget-ov-faint'; m.textContent = `${g.cats.size} different categories`; who.appendChild(m); }
        const cat = document.createElement('span'); cat.className = 'budget-ov-muted budget-ov-grow'; cat.textContent = catName(topCat);
        const n = document.createElement('span'); n.className = 'budget-num budget-ov-muted'; n.textContent = String(g.n);
        const blank = document.createElement('span');
        const act = document.createElement('span');
        act.className = 'budget-ru-more';
        linkButton(act, 'Make a Rule…', () => showEditor(null, { pattern: g.merchant, matchType: 'exact', categoryId: topCat }));
        row.append(who, cat, n, blank, act);
        aiWrap.appendChild(row);
      }
    }
  }

  refresh = serialRefresh(refresh);
  void refresh();
  const offLedger = onLedgerChanged(() => void refresh());
  const offSync = onSyncEvent((e) => { if (e.kind === 'complete') void refresh(); });
  return () => { alive = false; offLedger(); offSync(); };
}

// ─── Section: Reconcile ────────────────────────────────────────────────────

function renderReconcileSection(body, api) {
  let selectedAccountId = null;

  const toolbar = document.createElement('div'); toolbar.className = 'budget-toolbar';
  const acctSlot = document.createElement('span'); acctSlot.className = 'budget-dd-slot';
  toolbar.appendChild(acctSlot);
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  body.appendChild(toolbar);

  const summary = document.createElement('div'); summary.className = 'budget-cards'; body.appendChild(summary);
  const formWrap = document.createElement('div'); formWrap.className = 'budget-section'; body.appendChild(formWrap);
  const historyWrap = document.createElement('div'); historyWrap.className = 'budget-section'; body.appendChild(historyWrap);

  let alive = true;

  async function loadAccounts() {
    const accounts = await db.all('SELECT id, last_four, kind, display_name FROM accounts WHERE archived=0 ORDER BY kind, last_four');
    acctSlot.innerHTML = '';
    if (accounts.length === 0) {
      acctSlot.appendChild(makeDropdown([{ value: '', label: 'No Accounts' }], ''));
      return [];
    }
    selectedAccountId = selectedAccountId && accounts.find(a => a.id === selectedAccountId) ? selectedAccountId : accounts[0].id;
    acctSlot.appendChild(makeDropdown(
      accounts.map(a => ({ value: a.id, label: a.display_name || defaultAccountName(a.kind, a.last_four) })),
      selectedAccountId,
      (v) => { selectedAccountId = v; void refresh(); }));
    return accounts;
  }

  async function refresh() {
    if (!alive) return;
    summary.innerHTML = ''; formWrap.innerHTML = ''; historyWrap.innerHTML = '';

    const accounts = await loadAccounts();
    if (accounts.length === 0) {
      formWrap.appendChild(emptyState('No accounts to reconcile yet. Sync first.'));
      return;
    }

    const acct = accounts.find(a => a.id === selectedAccountId);
    if (!acct) return;

    // Latest snapshot for this account
    const latestSnap = await db.get(
      `SELECT balance_cents, snapshot_date FROM balance_snapshots WHERE account_id=? ORDER BY snapshot_date DESC, created_at DESC LIMIT 1`,
      [selectedAccountId],
    );
    // Last reconciliation
    const lastRecon = await db.get(
      `SELECT reconciled_at, statement_balance_cents, derived_balance_cents, diff_cents FROM reconciliations WHERE account_id=? ORDER BY reconciled_at DESC LIMIT 1`,
      [selectedAccountId],
    );

    // Derived balance = sum of transactions on this account since last reconciliation (or all time)
    // Convention: amount_cents > 0 = money out. So derived = base - SUM(amount).
    const baseDate = lastRecon ? lastRecon.reconciled_at : '1970-01-01';
    const baseBalance = lastRecon ? Number(lastRecon.statement_balance_cents) || 0 : 0;
    const flow = await db.get(
      `SELECT COALESCE(SUM(amount_cents), 0) AS net_out
         FROM transactions
        WHERE account_id=? AND status='confirmed' AND transaction_date > ?`,
      [selectedAccountId, baseDate],
    ) || { net_out: 0 };
    const derived = baseBalance - (Number(flow.net_out) || 0);

    summary.appendChild(makeCard('Latest snapshot', latestSnap ? fmtMoney(latestSnap.balance_cents) : '—', latestSnap ? `As of ${shortDate(latestSnap.snapshot_date)}` : 'No snapshots yet'));
    summary.appendChild(makeCard('Derived balance', fmtMoney(derived), lastRecon ? `Since ${shortDate(lastRecon.reconciled_at)}` : 'All time'));
    if (latestSnap) {
      const off = Number(latestSnap.balance_cents) - derived;
      summary.appendChild(makeCard('Snapshot vs derived', fmtMoney(off), Math.abs(off) < 100 ? 'Within $1' : 'Worth a look'));
    }

    // Form
    const h = document.createElement('h3'); h.textContent = 'Mark Reconciled'; formWrap.appendChild(h);
    const form = document.createElement('div'); form.style.display = 'flex'; form.style.gap = '8px'; form.style.alignItems = 'center'; form.style.flexWrap = 'wrap';
    const dateInp = document.createElement('input'); dateInp.type = 'date'; dateInp.className = 'budget-input'; dateInp.value = todayYmd();
    const balInp = document.createElement('input'); balInp.type = 'number'; balInp.step = '0.01'; balInp.placeholder = 'Statement Balance ($)'; balInp.className = 'budget-input'; balInp.style.width = '180px';
    if (latestSnap) balInp.value = (Number(latestSnap.balance_cents) / 100).toFixed(2);
    const noteInp = document.createElement('input'); noteInp.type = 'text'; noteInp.placeholder = 'Note (optional)'; noteInp.className = 'budget-input'; noteInp.style.flex = '1'; noteInp.style.minWidth = '160px';
    const saveBtn = makeButton('Reconcile', {
      primary: true,
      onClick: async () => {
        const stmtCents = Math.round(parseFloat(balInp.value || '0') * 100);
        if (!Number.isFinite(stmtCents)) { await api.window?.showWarningMessage?.('Enter a valid balance.'); return; }
        const diff = stmtCents - derived;
        try {
          await db.run(
            `INSERT INTO reconciliations (id, account_id, reconciled_at, statement_balance_cents, derived_balance_cents, diff_cents, note)
             VALUES (?,?,?,?,?,?,?)`,
            [crypto.randomUUID(), selectedAccountId, dateInp.value || todayYmd(), stmtCents, derived, diff, noteInp.value || null],
          );
          await refresh();
        } catch (e) {
          await api.window?.showErrorMessage?.('Reconcile failed: ' + (e instanceof Error ? e.message : String(e)));
        }
      },
    });
    form.appendChild(dateInp); form.appendChild(balInp); form.appendChild(noteInp); form.appendChild(saveBtn);
    formWrap.appendChild(form);

    // History
    const h2 = document.createElement('h3'); h2.textContent = 'History'; historyWrap.appendChild(h2);
    const history = await db.all('SELECT * FROM reconciliations WHERE account_id=? ORDER BY reconciled_at DESC LIMIT 25', [selectedAccountId]);
    if (history.length === 0) {
      historyWrap.appendChild(emptyState('No reconciliations yet.'));
    } else {
      const table = document.createElement('table'); table.className = 'budget-table';
      table.innerHTML = `<thead><tr><th>Date</th><th style="text-align:right">Statement</th><th style="text-align:right">Derived</th><th style="text-align:right">Diff</th><th>Note</th></tr></thead>`;
      const tb = document.createElement('tbody');
      for (const h of history) {
        const tr = document.createElement('tr');
        const off = Number(h.diff_cents) || 0;
        tr.innerHTML = `
          <td>${escHtml(h.reconciled_at)}</td>
          <td class="budget-amount">${escHtml(fmtMoney(h.statement_balance_cents))}</td>
          <td class="budget-amount">${escHtml(fmtMoney(h.derived_balance_cents))}</td>
          <td class="budget-amount ${Math.abs(off) > 100 ? 'negative' : ''}">${escHtml(fmtMoney(off))}</td>
          <td>${escHtml(h.note || '')}</td>`;
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      historyWrap.appendChild(table);
    }
  }

  refresh = serialRefresh(refresh);
  void refresh();
  const offLedger = onLedgerChanged(() => void refresh());
  return () => { alive = false; offLedger(); };
}

// ─── Section: Import / Export ──────────────────────────────────────────────
//
// Replaces the broken `showInputBox`-driven CSV paste (which is single-line by
// design and silently strips newlines). This section gives users a real
// multi-line textarea, a live row preview, and a one-click export that writes
// to the workspace via api.workspace.fs.writeFile (the previous
// `writeWorkspaceFile` call referenced an API that does not exist).
function renderImportExportSection(body, api) {
  // Top-level blurb — matches the look of the editor-pane subtitle used
  // elsewhere (descriptionForeground, ~13px, line-height 1.55).
  const blurb = document.createElement('p');
  blurb.className = 'budget-editor-blurb';
  blurb.textContent = 'Move ledger data in and out without leaving Parallx. Imports dedupe against your CSV history; exports include both confirmed transactions and the review queue.';
  body.appendChild(blurb);

  // ── Import section ────────────────────────────────────────────────
  const importWrap = document.createElement('div');
  importWrap.className = 'budget-section';
  body.appendChild(importWrap);

  const importHdr = document.createElement('h3');
  importHdr.textContent = 'Import CSV';
  importWrap.appendChild(importHdr);

  const importHelp = document.createElement('div');
  importHelp.style.fontSize = 'var(--px-text-xs, 11px)';
  importHelp.style.color = 'var(--vscode-descriptionForeground, #888)';
  importHelp.style.lineHeight = '1.5';
  importHelp.innerHTML =
    'Header row required: <code>date,merchant,amount</code> (and optional <code>type, category, account, last_four, notes</code>). Amounts are positive for expenses, negative for refund / deposit. Duplicates within prior CSV imports (same date, merchant, and amount) are skipped automatically.';
  importWrap.appendChild(importHelp);

  const ta = document.createElement('textarea');
  ta.className = 'budget-input';
  ta.placeholder = 'date,merchant,amount,category,account,last_four,notes\n2026-05-01,Starbucks,4.75,Dining,Chase Checking,1234,';
  ta.rows = 10;
  ta.spellcheck = false;
  ta.style.width = '100%';
  ta.style.boxSizing = 'border-box';
  ta.style.fontFamily = 'var(--vscode-editor-font-family, ui-monospace, Consolas, monospace)';
  ta.style.fontSize = 'var(--px-text-xs, 11px)';
  ta.style.lineHeight = '1.5';
  ta.style.resize = 'vertical';
  ta.style.minHeight = '160px';
  importWrap.appendChild(ta);

  // Toolbar: actions on the left, live preview on the right.
  const importBar = document.createElement('div');
  importBar.className = 'budget-toolbar';
  importWrap.appendChild(importBar);

  const importBtn = makeButton('Import', { primary: true, onClick: doImport });
  const clearBtn = makeButton('Clear', { onClick: () => { ta.value = ''; updatePreview(); status.textContent = ''; status.dataset.tone = ''; } });
  importBar.appendChild(importBtn);
  importBar.appendChild(clearBtn);

  const spacer = document.createElement('div'); spacer.className = 'spacer';
  importBar.appendChild(spacer);

  const preview = document.createElement('div');
  preview.style.fontSize = 'var(--px-text-xs, 11px)';
  preview.style.color = 'var(--vscode-descriptionForeground, #888)';
  preview.style.fontVariantNumeric = 'tabular-nums';
  importBar.appendChild(preview);

  const status = document.createElement('div');
  status.style.fontSize = 'var(--px-text-xs, 11px)';
  status.style.color = 'var(--vscode-descriptionForeground, #888)';
  status.style.minHeight = '1.4em';
  importWrap.appendChild(status);

  function updatePreview() {
    const lines = ta.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) { preview.textContent = ''; return; }
    const dataRows = Math.max(0, lines.length - 1); // assume first row is header
    preview.textContent = `${dataRows} row${dataRows === 1 ? '' : 's'} ready`;
  }
  ta.addEventListener('input', updatePreview);
  updatePreview();

  function setStatus(text, tone) {
    status.textContent = text;
    status.dataset.tone = tone || '';
    if (tone === 'error') status.style.color = 'var(--vscode-errorForeground, #f87171)';
    else if (tone === 'success') status.style.color = 'var(--vscode-charts-green, #6ec77a)';
    else status.style.color = 'var(--vscode-descriptionForeground, #888)';
  }

  async function doImport() {
    const text = ta.value.trim();
    if (!text) { setStatus('Paste a CSV first.', 'error'); return; }
    importBtn.setAttribute('disabled', 'true');
    clearBtn.setAttribute('disabled', 'true');
    setStatus('Importing…');
    try {
      const r = await importCsvText(text);
      if (r.inserted) notifyLedgerChanged();
      const parts = [`Imported ${r.inserted} row${r.inserted === 1 ? '' : 's'}`];
      if (r.skipped) parts.push(`${r.skipped} skipped (duplicates)`);
      if (r.errors)  parts.push(`${r.errors} error${r.errors === 1 ? '' : 's'}`);
      setStatus(parts.join(' • '), r.errors ? 'error' : 'success');
    } catch (e) {
      setStatus('Import failed: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      importBtn.removeAttribute('disabled');
      clearBtn.removeAttribute('disabled');
    }
  }

  // ── Export section ────────────────────────────────────────────────
  const exportWrap = document.createElement('div');
  exportWrap.className = 'budget-section';
  body.appendChild(exportWrap);

  const exportHdr = document.createElement('h3');
  exportHdr.textContent = 'Export CSV';
  exportWrap.appendChild(exportHdr);

  const exportHelp = document.createElement('div');
  exportHelp.style.fontSize = 'var(--px-text-xs, 11px)';
  exportHelp.style.color = 'var(--vscode-descriptionForeground, #888)';
  exportHelp.style.lineHeight = '1.5';
  exportHelp.innerHTML = 'Writes <code>budget-export-YYYY-MM-DD.csv</code> to your workspace root, including every confirmed and review-queue row. Falls back to your clipboard if no workspace folder is open.';
  exportWrap.appendChild(exportHelp);

  const exportBar = document.createElement('div');
  exportBar.className = 'budget-toolbar';
  exportWrap.appendChild(exportBar);

  const exportStatus = document.createElement('div');
  exportStatus.style.fontSize = 'var(--px-text-xs, 11px)';
  exportStatus.style.color = 'var(--vscode-descriptionForeground, #888)';
  exportStatus.style.minHeight = '1.4em';

  const exportBtn = makeButton('Export Now', {
    primary: true,
    onClick: async () => {
      exportBtn.setAttribute('disabled', 'true');
      exportStatus.textContent = 'Exporting…';
      exportStatus.style.color = 'var(--vscode-descriptionForeground, #888)';
      try {
        const r = await runCsvExport(api);
        exportStatus.textContent = r.writtenTo
          ? `Wrote ${r.count} row${r.count === 1 ? '' : 's'} to ${r.writtenTo}.`
          : `Copied ${r.count} row${r.count === 1 ? '' : 's'} to clipboard (${r.reason || 'no workspace folder'}).`;
        exportStatus.style.color = 'var(--vscode-charts-green, #6ec77a)';
      } catch (e) {
        exportStatus.textContent = 'Export failed: ' + (e instanceof Error ? e.message : String(e));
        exportStatus.style.color = 'var(--vscode-errorForeground, #f87171)';
      } finally {
        exportBtn.removeAttribute('disabled');
      }
    },
  });
  exportBar.appendChild(exportBtn);
  exportWrap.appendChild(exportStatus);

  return () => {};
}

// Build the CSV string for export. Pure-ish — only depends on the db helper.
async function buildExportCsv() {
  const rows = await db.all(`
    SELECT t.transaction_date, t.merchant, t.amount_cents, t.tx_type, t.status,
           c.name AS category, t.card_last_four, a.display_name AS account, t.notes
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a   ON a.id = t.account_id
     WHERE t.status IN ('confirmed','review')
     ORDER BY t.transaction_date DESC, t.created_at DESC`);
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = ['date,merchant,amount,type,status,category,account,last_four,notes'];
  for (const r of rows) {
    lines.push([
      r.transaction_date, esc(r.merchant), (Number(r.amount_cents) / 100).toFixed(2),
      r.tx_type || '', r.status || '', esc(r.category || ''), esc(r.account || ''),
      r.card_last_four || '', esc(r.notes || ''),
    ].join(','));
  }
  return { csv: lines.join('\n'), count: rows.length };
}

// Run the export side-effect: write to workspace fs, or fall back to clipboard.
async function runCsvExport(api) {
  const { csv, count } = await buildExportCsv();
  const fname = `budget-export-${todayYmd()}.csv`;
  const folders = api.workspace && api.workspace.workspaceFolders;
  const fs = api.requestCapability ? api.requestCapability('fs', { scope: 'workspace-files', modes: ['read', 'write'] }) : null;
  if (folders && folders.length > 0 && fs && typeof fs.writeFile === 'function') {
    const folderUri = folders[0].uri;
    // Build child URI by string concatenation — workspaceBoundary verifies it.
    const sep = folderUri.endsWith('/') ? '' : '/';
    const targetUri = folderUri + sep + fname;
    await fs.writeFile(targetUri, csv);
    return { count, writtenTo: fname };
  }
  // Fallback: clipboard.
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(csv);
    return { count, writtenTo: null, reason: 'no workspace folder' };
  }
  throw new Error('No workspace folder open and clipboard unavailable.');
}

// Inline SVG donut. No external libs. `slices` is [{name,color,spend}] with
// spend > 0; total is the sum of those spends.
function buildDonut(slices, total) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const size = 180;
  const cx = size / 2, cy = size / 2;
  const rOuter = 78, rInner = 50;

  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.style.flex = '0 0 auto';
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

  // Edge case: only one slice -> draw a full ring.
  if (slices.length === 1) {
    const ring = document.createElementNS(SVG_NS, 'path');
    const d = `M ${cx - rOuter} ${cy} A ${rOuter} ${rOuter} 0 1 0 ${cx + rOuter} ${cy} A ${rOuter} ${rOuter} 0 1 0 ${cx - rOuter} ${cy} Z ` +
              `M ${cx - rInner} ${cy} A ${rInner} ${rInner} 0 1 1 ${cx + rInner} ${cy} A ${rInner} ${rInner} 0 1 1 ${cx - rInner} ${cy} Z`;
    ring.setAttribute('d', d);
    ring.setAttribute('fill-rule', 'evenodd');
    ring.setAttribute('fill', slices[0].color || '#888');
    const t = document.createElementNS(SVG_NS, 'title');
    t.textContent = `${slices[0].name}: ${fmtMoney(slices[0].spend)}`;
    ring.appendChild(t);
    svg.appendChild(ring);
  } else {
    let acc = 0;
    for (const s of slices) {
      const value = Number(s.spend) || 0;
      if (value <= 0) continue;
      const startAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
      acc += value;
      const endAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
      const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
      const x1 = cx + rOuter * Math.cos(startAngle);
      const y1 = cy + rOuter * Math.sin(startAngle);
      const x2 = cx + rOuter * Math.cos(endAngle);
      const y2 = cy + rOuter * Math.sin(endAngle);
      const x3 = cx + rInner * Math.cos(endAngle);
      const y3 = cy + rInner * Math.sin(endAngle);
      const x4 = cx + rInner * Math.cos(startAngle);
      const y4 = cy + rInner * Math.sin(startAngle);
      const d = [
        `M ${x1} ${y1}`,
        `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2}`,
        `L ${x3} ${y3}`,
        `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4}`,
        'Z',
      ].join(' ');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', s.color || '#888');
      const t = document.createElementNS(SVG_NS, 'title');
      const pct = Math.round((value / total) * 100);
      t.textContent = `${s.name}: ${fmtMoney(value)} (${pct}%)`;
      path.appendChild(t);
      svg.appendChild(path);
    }
  }

  wrap.appendChild(svg);

  // Center label
  const center = document.createElement('div');
  center.style.position = 'absolute';
  center.style.inset = '0';
  center.style.display = 'flex';
  center.style.flexDirection = 'column';
  center.style.alignItems = 'center';
  center.style.justifyContent = 'center';
  center.style.pointerEvents = 'none';
  const label = document.createElement('div');
  label.className = 'budget-card-label';
  label.textContent = 'Total';
  const value = document.createElement('div');
  value.style.fontSize = '15px';
  value.style.fontWeight = '600';
  value.style.fontVariantNumeric = 'tabular-nums';
  value.textContent = fmtMoney(total);
  center.appendChild(label);
  center.appendChild(value);
  wrap.appendChild(center);

  return wrap;
}

// Vertical bar chart. `series` is [{label, values:[{name,value,color}]}],
// where each entry is one X position rendering one or more grouped bars.
// Use single bar per group by passing `[{name,value,color}]` of length 1.
function buildBar(groups, opts) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const width = (opts && opts.width) || 540;
  const height = (opts && opts.height) || 200;
  const padL = 40, padR = 10, padT = 10, padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.maxWidth = '100%';

  let maxV = 0;
  for (const g of groups) for (const v of (g.values || [])) maxV = Math.max(maxV, Number(v.value) || 0);
  if (maxV <= 0) maxV = 1;
  // Round up axis to a "nice" number for readability.
  const niceMax = niceCeil(maxV);

  // Y gridlines + labels (4 horizontal lines).
  for (let i = 0; i <= 4; i++) {
    const y = padT + (innerH * (1 - i / 4));
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(padL));
    line.setAttribute('x2', String(padL + innerW));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('class', 'budget-chart-grid');
    svg.appendChild(line);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(padL - 4));
    label.setAttribute('y', String(y + 3));
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('class', 'budget-chart-axis');
    label.textContent = fmtMoneyShort((niceMax * i) / 4 * 100);
    svg.appendChild(label);
  }

  if (groups.length === 0) return svg;

  const valuesPerGroup = Math.max(1, ...groups.map(g => (g.values || []).length));
  const groupW = innerW / groups.length;
  const barW = Math.max(2, (groupW * 0.7) / valuesPerGroup);
  const groupGap = (groupW - barW * valuesPerGroup) / 2;

  groups.forEach((g, gi) => {
    const xBase = padL + gi * groupW + groupGap;
    (g.values || []).forEach((v, vi) => {
      const value = Number(v.value) || 0;
      const h = (value / niceMax) * innerH;
      const x = xBase + vi * barW;
      const y = padT + innerH - h;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(Math.max(1, barW - 1)));
      rect.setAttribute('height', String(Math.max(0, h)));
      rect.setAttribute('fill', v.color || '#94a3b8');
      rect.setAttribute('rx', '2');
      rect.setAttribute('class', 'budget-chart-bar');
      const t = document.createElementNS(SVG_NS, 'title');
      t.textContent = `${g.label} • ${v.name}: ${fmtMoney(value)}`;
      rect.appendChild(t);
      if (opts && typeof opts.onClick === 'function') {
        rect.addEventListener('click', () => opts.onClick(g, v));
      }
      svg.appendChild(rect);
    });
    const xLabel = document.createElementNS(SVG_NS, 'text');
    xLabel.setAttribute('x', String(padL + gi * groupW + groupW / 2));
    xLabel.setAttribute('y', String(padT + innerH + 14));
    xLabel.setAttribute('text-anchor', 'middle');
    xLabel.setAttribute('class', 'budget-chart-axis');
    xLabel.textContent = g.label;
    svg.appendChild(xLabel);
  });

  return svg;
}

// Line chart over a series of {label, value} points.
function buildLine(points, opts) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const width = (opts && opts.width) || 540;
  const height = (opts && opts.height) || 140;
  const padL = 40, padR = 10, padT = 10, padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const stroke = (opts && opts.color) || 'var(--px-accent)';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.maxWidth = '100%';

  if (points.length === 0) return svg;

  const values = points.map(p => Number(p.value) || 0);
  const maxV = Math.max(...values, 0);
  const minV = Math.min(...values, 0);
  const span = (maxV - minV) || 1;
  const niceMaxC = niceCeil(maxV);
  const niceMinC = minV < 0 ? -niceCeil(-minV) : 0;
  const niceSpan = (niceMaxC - niceMinC) || 1;

  // Zero baseline if data crosses zero.
  if (niceMinC < 0) {
    const y0 = padT + innerH * (1 - (-niceMinC) / niceSpan);
    const base = document.createElementNS(SVG_NS, 'line');
    base.setAttribute('x1', String(padL));
    base.setAttribute('x2', String(padL + innerW));
    base.setAttribute('y1', String(y0));
    base.setAttribute('y2', String(y0));
    base.setAttribute('class', 'budget-chart-grid');
    svg.appendChild(base);
  }

  const xStep = points.length > 1 ? innerW / (points.length - 1) : 0;
  const path = document.createElementNS(SVG_NS, 'path');
  let d = '';
  points.forEach((p, i) => {
    const v = Number(p.value) || 0;
    const x = padL + i * xStep;
    const y = padT + innerH * (1 - (v - niceMinC) / niceSpan);
    d += (i === 0 ? 'M ' : ' L ') + x.toFixed(1) + ' ' + y.toFixed(1);
  });
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', stroke);
  path.setAttribute('stroke-width', '2');
  svg.appendChild(path);

  // Dots + tooltips.
  points.forEach((p, i) => {
    const v = Number(p.value) || 0;
    const x = padL + i * xStep;
    const y = padT + innerH * (1 - (v - niceMinC) / niceSpan);
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', stroke);
    const t = document.createElementNS(SVG_NS, 'title');
    t.textContent = `${p.label}: ${fmtMoney(v)}`;
    dot.appendChild(t);
    svg.appendChild(dot);

    if (i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) {
      const xLabel = document.createElementNS(SVG_NS, 'text');
      xLabel.setAttribute('x', String(x));
      xLabel.setAttribute('y', String(padT + innerH + 14));
      xLabel.setAttribute('text-anchor', 'middle');
      xLabel.setAttribute('class', 'budget-chart-axis');
      xLabel.textContent = p.label;
      svg.appendChild(xLabel);
    }
  });

  return svg;
}

// "Nice" axis ceiling for a value (in dollars). Rounds up to 1/2/5/10 × 10^k.
function niceCeil(v) {
  if (v <= 0) return 1;
  const cents = Math.ceil(Number(v));
  const exp = Math.floor(Math.log10(cents));
  const base = Math.pow(10, exp);
  const m = cents / base;
  let nice;
  if (m <= 1) nice = 1;
  else if (m <= 2) nice = 2;
  else if (m <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

function fmtMoneyShort(cents) {
  const n = Math.abs(Number(cents) || 0);
  if (n >= 100000000) return '$' + Math.round(n / 100000000) + 'M';
  if (n >= 100000) return '$' + Math.round(n / 100000) + 'K';
  return fmtMoney(cents);
}

async function loadActiveRules() {
  try {
    return await db.all(
      `SELECT id, pattern, match_type, category_id, priority
         FROM categorization_rules
        WHERE active = 1
        ORDER BY priority DESC, length(pattern) DESC, created_at ASC`,
    );
  } catch { return []; }
}

// Payee text as the bank prints it carries a processor prefix, a store
// number and a city: "SQ *COFFEE SHOP 0042 DENVER CO". A rule is matched
// against this normalised form as well as the raw text, so one rule covers
// a chain and its store numbers.
function normalizeMerchant(text) {
  let m = String(text || '').toLowerCase();
  m = m.replace(/^(sq|tst|pp|paypal|py|amzn mktp|amazon\.com|sp|dd|ig|ppl)\s*\*\s*/, '');
  m = m.replace(/\s*#\s*\d+\b/g, ' ').replace(/\b\d{3,}\b/g, ' ');
  m = m.replace(/[^a-z0-9&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = m.split(' ');
  if (parts.length >= 3 && /^[a-z]{2}$/.test(parts[parts.length - 1])) parts.pop();
  return parts.join(' ').trim();
}

function ruleMatchesMerchant(rule, merchant) {
  if (!merchant || !rule || !rule.pattern) return false;
  const m = String(merchant).toLowerCase();
  const p = String(rule.pattern).toLowerCase();
  const mn = normalizeMerchant(merchant);
  const pn = normalizeMerchant(rule.pattern);
  if (rule.match_type === 'exact')    return m === p;
  if (rule.match_type === 'contains') return m.indexOf(p) >= 0 || (!!pn && mn.indexOf(pn) >= 0);
  if (rule.match_type === 'regex') {
    try { return new RegExp(rule.pattern, 'i').test(merchant); }
    catch { return false; }
  }
  return false;
}

async function applyRules(merchant, rules) {
  if (!merchant) return null;
  for (const r of rules) {
    if (ruleMatchesMerchant(r, merchant)) {
      // Bump hit counter (best-effort; failures don't block sync).
      try {
        await db.run(
          `UPDATE categorization_rules SET hits = hits + 1, last_hit_at = ? WHERE id = ?`,
          [new Date().toISOString(), r.id],
        );
      } catch { /* best-effort */ }
      return { categoryId: r.category_id, ruleId: r.id };
    }
  }
  return null;
}

// Called when the user re-categorizes a transaction. Creates an auto-rule
// (or strengthens an existing one) so future imports for the same merchant
// land in the chosen category without an LLM call.
async function learnRuleFromOverride(merchant, categoryId) {
  if (!merchant || !categoryId) return null;
  const cleanMerchant = String(merchant).trim();
  if (cleanMerchant.length < 2) return null;

  // Look for an existing exact-match auto rule for this merchant.
  const existing = await db.get(
    `SELECT id, category_id FROM categorization_rules
      WHERE LOWER(pattern) = LOWER(?) AND match_type='exact' AND auto_created=1
      LIMIT 1`,
    [cleanMerchant],
  );
  const now = new Date().toISOString();
  if (existing) {
    if (existing.category_id !== categoryId) {
      // User changed their mind; redirect the auto rule.
      const prev = await db.get('SELECT category_id, hits, updated_at FROM categorization_rules WHERE id = ?', [existing.id]);
      await db.run(
        `UPDATE categorization_rules SET category_id = ?, updated_at = ?, hits = 0 WHERE id = ?`,
        [categoryId, now, existing.id],
      );
      return { ruleId: existing.id, created: false, prev };
    }
    return null;
  }
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO categorization_rules (id, pattern, match_type, category_id, priority, auto_created, active, created_at, updated_at)
     VALUES (?, ?, 'exact', ?, 50, 1, 1, ?, ?)`,
    [id, cleanMerchant, categoryId, now, now],
  );
  return { ruleId: id, created: true, prev: null };
}

// Puts a rule back the way learnRuleFromOverride found it.
async function undoLearnedRule(change) {
  if (!change) return;
  if (change.created) {
    await db.run('DELETE FROM categorization_rules WHERE id = ?', [change.ruleId]);
  } else if (change.prev) {
    await db.run('UPDATE categorization_rules SET category_id = ?, hits = ?, updated_at = ? WHERE id = ?',
      [change.prev.category_id, change.prev.hits, change.prev.updated_at, change.ruleId]);
  }
}

// Auto-promotion: if the AI has independently labeled the same merchant with
// the same category 3+ times AND the user hasn't overridden any of them, the
// pattern is stable enough to commit to a deterministic rule. Future syncs
// match by rule (free, fast, transparent in the Rules section) instead of
// re-running the LLM categorizer for the same merchant every time.
//
//   priority = 50  → user-authored rules (priority 100) still win.
//   auto_created = 1 → user can spot and disable from the Rules section.
//
// Returns the number of new rules created.
async function promoteAiCategorizationsToRules(runId) {
  let created = 0;
  let candidates;
  try {
    candidates = await db.all(`
      SELECT LOWER(merchant) AS merchant_key,
             merchant,
             category_id,
             COUNT(*) AS n
        FROM transactions
       WHERE categorization_source = 'ai'
         AND status = 'confirmed'
         AND user_overridden = 0
         AND merchant IS NOT NULL
         AND category_id IS NOT NULL
       GROUP BY LOWER(merchant), category_id
      HAVING COUNT(*) >= 3
    `);
  } catch { return 0; }

  if (!candidates || candidates.length === 0) return 0;

  for (const c of candidates) {
    try {
      // Only promote if the AI's vote is unanimous for this merchant — i.e.
      // there isn't another candidate row with a different category_id for
      // the same merchant_key. Mixed signals = not stable enough.
      // A rule is not learned over a disagreement: another AI answer for
      // the merchant, or a category the user set by hand.
      const conflict = await db.get(
        `SELECT 1 AS x FROM transactions
          WHERE LOWER(merchant) = ? AND category_id IS NOT NULL
            AND category_id != ?
            AND (categorization_source IN ('ai', 'manual') OR user_overridden = 1)
          LIMIT 1`,
        [c.merchant_key, c.category_id],
      );
      if (conflict) continue;

      // Skip if a rule already covers this merchant.
      const dup = await db.get(
        `SELECT 1 AS x FROM categorization_rules
          WHERE LOWER(pattern) = ? AND active = 1 LIMIT 1`,
        [c.merchant_key],
      );
      if (dup) continue;

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.run(
        `INSERT INTO categorization_rules
           (id, pattern, match_type, category_id, priority, auto_created, active, created_at, updated_at)
         VALUES (?, ?, 'contains', ?, 50, 1, 1, ?, ?)`,
        [id, c.merchant, c.category_id, now, now],
      );
      // Backfill: tag the existing AI-labeled rows with this rule so the
      // Transactions UI shows them as 'rule' next time and the Rules section
      // "Matches" count is non-zero immediately.
      await db.run(
        `UPDATE transactions
            SET matched_rule_id = ?
          WHERE LOWER(merchant) = ? AND category_id = ?
            AND categorization_source = 'ai' AND user_overridden = 0`,
        [id, c.merchant_key, c.category_id],
      );
      created++;
      try {
        await syncLog(runId, 'info', 'promote', `Learned rule: "${c.merchant}" → category ${c.category_id} (n=${c.n})`);
      } catch { /* best-effort */ }
    } catch { /* per-rule failures don't abort the rest */ }
  }
  return created;
}

// ─── Recurring / subscription detection ─────────────────────────────────────
//
// Detection runs at the END of each sync. For every merchant with ≥3
// purchase rows in the last 180 days, we measure the median day-gap between
// occurrences and the amount stability. If the gap and amount cluster tightly,
// we infer a cadence and create / update a recurring_series row.
//
// Confidence:
//   high   — ≥4 occurrences AND amount CV < 0.15 AND gap CV < 0.20
//   medium — ≥3 occurrences AND amount CV < 0.30 AND gap CV < 0.35
//   low    — anything below that bar (we still surface for the user to confirm).

function median(nums) {
  if (!nums || nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function coefficientOfVariation(nums) {
  if (!nums || nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (mean === 0) return 0;
  const variance = nums.reduce((acc, v) => acc + (v - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function gapDays(d1, d2) {
  // Both YYYY-MM-DD; returns positive number of days from d1 to d2.
  const a = new Date(d1 + 'T00:00:00Z').getTime();
  const b = new Date(d2 + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function inferCadence(medianGapDays) {
  if (medianGapDays >= 5 && medianGapDays <= 9)   return 'weekly';
  if (medianGapDays >= 12 && medianGapDays <= 16) return 'biweekly';
  if (medianGapDays >= 26 && medianGapDays <= 35) return 'monthly';
  if (medianGapDays >= 80 && medianGapDays <= 100) return 'quarterly';
  if (medianGapDays >= 350 && medianGapDays <= 380) return 'yearly';
  return null;
}

function addDays(ymd, days) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function detectRecurring(api) {
  // Suppress unused-arg lint (kept for future progress notifications).
  void api;

  // Pull last 180 days of confirmed purchases grouped by merchant. We
  // case-fold the GROUP BY so "STARBUCKS", "Starbucks", and "starbucks"
  // count as one series. We pick the most common original casing as the
  // canonical pattern when upserting.
  const since = isoNDaysAgo(180);
  const candidates = await db.all(
    `SELECT LOWER(merchant) AS merchant_key, COUNT(*) AS n
       FROM transactions
      WHERE status='confirmed' AND tx_type='purchase' AND merchant IS NOT NULL
        AND transaction_date >= ?
      GROUP BY LOWER(merchant)
      HAVING n >= 3
      ORDER BY n DESC`,
    [since],
  );

  let detected = 0;
  for (const c of candidates) {
    const rows = await db.all(
      `SELECT id, transaction_date, amount_cents, category_id, merchant
         FROM transactions
        WHERE status='confirmed' AND tx_type='purchase' AND LOWER(merchant) = ?
          AND transaction_date >= ?
        ORDER BY transaction_date ASC`,
      [c.merchant_key, since],
    );
    if (rows.length < 3) continue;

    // Canonical merchant string: the most-recently-seen original casing.
    const canonical = rows[rows.length - 1].merchant;

    const dates = rows.map(r => r.transaction_date);
    const amounts = rows.map(r => Math.abs(Number(r.amount_cents) || 0));
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push(gapDays(dates[i - 1], dates[i]));
    const medGap = median(gaps);
    const cadence = inferCadence(medGap);
    if (!cadence) continue;

    const amtCv = coefficientOfVariation(amounts);
    const gapCv = coefficientOfVariation(gaps);
    let confidence = 'low';
    if (rows.length >= 4 && amtCv < 0.15 && gapCv < 0.20) confidence = 'high';
    else if (rows.length >= 3 && amtCv < 0.30 && gapCv < 0.35) confidence = 'medium';

    const avgAmt = Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
    const lastSeen = dates[dates.length - 1];
    const lastAmt = Number(rows[rows.length - 1].amount_cents) || 0;
    const nextDue = addDays(lastSeen, Math.max(1, Math.round(medGap)));
    const guessedCategoryId = rows[rows.length - 1].category_id;

    // Upsert by exact-merchant pattern (case-insensitive).
    const now = new Date().toISOString();
    const existing = await db.get(
      `SELECT id, user_confirmed, cancelled FROM recurring_series WHERE LOWER(merchant_pattern) = ? LIMIT 1`,
      [c.merchant_key],
    );
    let seriesId;
    if (existing) {
      if (existing.cancelled) continue; // user cancelled — don't resurrect
      seriesId = existing.id;
      await db.run(
        `UPDATE recurring_series
            SET cadence = ?, avg_amount_cents = ?, last_amount_cents = ?, last_seen_date = ?,
                next_due_date = ?, occurrence_count = ?, detection_confidence = ?,
                category_id = COALESCE(category_id, ?), updated_at = ?
          WHERE id = ?`,
        [cadence, avgAmt, lastAmt, lastSeen, nextDue, rows.length, confidence, guessedCategoryId, now, seriesId],
      );
    } else {
      seriesId = crypto.randomUUID();
      await db.run(
        `INSERT INTO recurring_series (id, merchant_pattern, display_name, category_id, cadence,
                                       avg_amount_cents, last_amount_cents, last_seen_date, next_due_date,
                                       occurrence_count, detection_confidence, user_confirmed, cancelled,
                                       created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
        [seriesId, canonical, canonical, guessedCategoryId, cadence,
         avgAmt, lastAmt, lastSeen, nextDue, rows.length, confidence, now, now],
      );
      detected++;
    }
    // Link occurrences (PK is composite; INSERT OR IGNORE).
    for (const r of rows) {
      await db.run(
        `INSERT OR IGNORE INTO recurring_occurrences (series_id, transaction_id) VALUES (?, ?)`,
        [seriesId, r.id],
      ).catch(() => {});
    }
  }
  return detected;
}

// ─── Reprocess history ──────────────────────────────────────────────────────
//
// Two passes, both safe to re-run:
//
//   1. Backfill `tx_type` and `account_id` for legacy rows imported before
//      migration 002 (those columns were NULL).
//   2. Apply the current rules engine to any confirmed purchase/refund row
//      with a NULL category. This is the part users actually want — once
//      they've taught the rules engine via the Rules section, hitting
//      "Reprocess" should propagate those decisions back through their
//      historical ledger. Rows with a non-NULL category are left untouched
//      (we never overwrite a human or AI categorization here).
// [tx_type, regex over LOWER(subject)], first match wins. The purchases that
// the word "payment" can disguise (a Zelle send, a bill payment to a payee)
// sit ABOVE the transfer patterns on purpose: "automatic payment" and "we
// received your payment" used to swallow them.
const BUDGET_SUBJECT_PATTERNS = [
  ['deposit',  /direct deposit posted/],
  ['deposit',  /direct deposit/],
  ['deposit',  /you got paid/],
  ['deposit',  /you received money with zelle/],
  ['deposit',  /payment received from/],
  ['purchase', /you sent (money|\$)/],
  ['purchase', /sent money with zelle/],
  ['purchase', /payment to (?!your )/],
  ['transfer', /payment to your /],
  ['transfer', /credit card payment is scheduled/],
  ['transfer', /we'?ve received your.*payment/],
  ['transfer', /we received your.*payment/],
  ['transfer', /automatic payment/],
  ['transfer', /mortgage payment/],
  ['transfer', /transfer to your.*account/],
  ['fee',      /overdraft fee|atm fee|late fee|service fee/],
  ['purchase', /you made a \$.*transaction with/],
  ['purchase', /you sent .* from account/],
  ['purchase', /debit card transaction of/],
  ['purchase', /transaction alert/],
  ['purchase', /card was used/],
];
/** The type a subject line says, or null when it says nothing. */
function classifySubjectTxType(subject) {
  const subj = String(subject || '').toLowerCase();
  for (const [t, re] of BUDGET_SUBJECT_PATTERNS) if (re.test(subj)) return t;
  return null;
}

async function reprocessHistory(api) {
  // Suppress unused-arg lint when api is not consumed (kept for future use
  // — e.g. surfacing a progress notification).
  void api;

  // ── Pass 1: tx_type / account_id backfill from cached email subjects ──
  // The Stage-1 classifier had this information at sync time; we recover it
  // from the cached subject in `email_imports`. We NEVER blanket-set rows
  // to 'purchase' — that would silently mis-type paychecks and credit-card
  // payments as spend.
  const subjectPatterns = BUDGET_SUBJECT_PATTERNS;

  const legacyRows = await db.all(`
    SELECT t.id, t.merchant, t.card_last_four, e.raw_subject
      FROM transactions t
      LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
     WHERE t.tx_type IS NULL
       AND t.user_overridden = 0
       AND t.gmail_message_id IS NOT NULL`);

  let updated = 0, errors = 0, ambiguous = 0;
  for (const r of legacyRows) {
    try {
      const subj = String(r.raw_subject || '').toLowerCase();
      void subjectPatterns;
      let txType = classifySubjectTxType(subj);
      // Hide daily-balance-summary rows that got extracted as transactions.
      const isDailySummary = /daily (account )?summary|account balance alert/.test(subj);

      let accountId = null;
      if (r.card_last_four) {
        const acct = await upsertAccount(r.card_last_four, 'other', null);
        accountId = acct ? acct.id : null;
      }

      if (isDailySummary) {
        await db.run(
          `UPDATE transactions
              SET status='hidden',
                  notes = COALESCE(notes,'') || ' [auto-hidden: daily summary]',
                  updated_at = ?
            WHERE id = ?`,
          [new Date().toISOString(), r.id],
        );
        updated++;
      } else if (txType) {
        await db.run(
          `UPDATE transactions
              SET tx_type = ?, tx_type_source = 'subject', account_id = COALESCE(account_id, ?), updated_at = ?
            WHERE id = ?`,
          [txType, accountId, new Date().toISOString(), r.id],
        );
        updated++;
      } else {
        // Honest about the gap — leave NULL for the Untyped card / LLM reclassify.
        ambiguous++;
        if (accountId) {
          await db.run(
            `UPDATE transactions SET account_id = COALESCE(account_id, ?), updated_at = ? WHERE id = ?`,
            [accountId, new Date().toISOString(), r.id],
          );
        }
      }
    } catch (e) { errors++; }
  }

  // ── Pass 2: apply rules to NULL-category purchase/refund rows ────────
  // We deliberately leave non-NULL rows untouched — both human overrides
  // and AI guesses survive. This pass is purely additive.
  const activeRules = await loadActiveRules();
  let categorized = 0;
  if (activeRules.length > 0) {
    const candidates = await db.all(`
      SELECT id, merchant FROM transactions
       WHERE category_id IS NULL AND status='confirmed'
         AND tx_type = 'purchase' AND merchant IS NOT NULL`);
    for (const r of candidates) {
      try {
        const matched = await applyRules(r.merchant, activeRules);
        if (matched && matched.categoryId) {
          await db.run(
            `UPDATE transactions
                SET category_id = ?, categorizer_model = ?,
                    categorization_source = 'rule', matched_rule_id = ?,
                    updated_at = ?
              WHERE id = ?`,
            [matched.categoryId, 'rule:' + matched.ruleId + ':reprocess', matched.ruleId, new Date().toISOString(), r.id],
          );
          categorized++;
        }
      } catch { errors++; }
    }
  }

  notifyLedgerChanged();
  return { updated, errors, total: legacyRows.length, categorized, ambiguous };
}

// ─── CSV import ────────────────────────────────────────────────────────────
//
// Parses paste-driven CSV and inserts confirmed transactions tagged source='csv'.
// Header row required. Recognized columns (case-insensitive):
//   date, merchant, amount, type, category, account, last_four, notes
// Convention: positive amount = spend (money out); negative = refund/deposit.
// Dedupe: skips rows with same (transaction_date, merchant, amount_cents, source='csv').
function _parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; } }
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') inQ = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

async function importCsvText(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return { inserted: 0, skipped: 0, errors: 0 };
  const header = _parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const idx = (name) => header.indexOf(name);
  const dateIdx = idx('date');
  const merchantIdx = idx('merchant');
  const amountIdx = idx('amount');
  if (dateIdx < 0 || merchantIdx < 0 || amountIdx < 0) {
    throw new Error('CSV must have at least date, merchant, amount columns.');
  }
  const typeIdx = idx('type');
  const catIdx = idx('category');
  const acctIdx = idx('account');
  const last4Idx = idx('last_four');
  const notesIdx = idx('notes');

  // Cache categories by lowercased name for O(1) lookup.
  const cats = await db.all('SELECT id, name FROM categories WHERE archived=0');
  const catByName = new Map(cats.map(c => [String(c.name).toLowerCase(), c.id]));

  // Pre-load active rules so CSV imports get categorized too.
  const activeRules = await loadActiveRules();

  let inserted = 0, skipped = 0, errors = 0;
  const now = new Date().toISOString();

  for (let i = 1; i < lines.length; i++) {
    try {
      const cols = _parseCsvLine(lines[i]);
      const date = cols[dateIdx]; if (!date) { errors++; continue; }
      const merchant = cols[merchantIdx] || ''; if (!merchant.trim()) { errors++; continue; }
      const amtRaw = (cols[amountIdx] || '').replace(/[$,\s]/g, '');
      const amtNum = parseFloat(amtRaw);
      if (!Number.isFinite(amtNum)) { errors++; continue; }
      const cents = Math.round(amtNum * 100);

      // CSV import: tx_type column is optional. Default to 'purchase' for any
      // row regardless of sign — refunds are negative-amount purchases.
      let txType = (typeIdx >= 0 ? (cols[typeIdx] || '').toLowerCase() : '') || 'purchase';
      // Collapse legacy values from older exports.
      if (txType === 'refund') txType = 'purchase';
      if (txType === 'cc_payment') txType = 'transfer';
      const last4 = last4Idx >= 0 ? (cols[last4Idx] || '').replace(/\D/g, '').slice(-4) : '';
      const acctName = acctIdx >= 0 ? cols[acctIdx] : '';
      const notes = notesIdx >= 0 ? cols[notesIdx] : '';

      // Dedupe within source='csv' on (date, LOWER(merchant), amount).
      const dup = await db.get(
        `SELECT id FROM transactions WHERE source='csv' AND transaction_date=? AND LOWER(merchant)=LOWER(?) AND amount_cents=? LIMIT 1`,
        [date, merchant, cents],
      );
      if (dup) { skipped++; continue; }

      // Resolve category: explicit > rule match > NULL.
      let categoryId = null;
      let categorizationSource = null;
      let matchedRuleId = null;
      if (catIdx >= 0 && cols[catIdx]) {
        categoryId = catByName.get(String(cols[catIdx]).toLowerCase()) || null;
        if (categoryId) categorizationSource = 'manual';
      }
      if (!categoryId && txType === 'purchase') {
        const ruleHit = await applyRules(merchant, activeRules);
        if (ruleHit) {
          categoryId = ruleHit.categoryId;
          categorizationSource = 'rule';
          matchedRuleId = ruleHit.ruleId;
        }
      }

      // Resolve account by last_four (if provided).
      let accountId = null;
      if (last4 && /^\d{4}$/.test(last4)) {
        const acct = await upsertAccount(last4, 'other', acctName || null);
        accountId = acct ? acct.id : null;
      }

      await db.run(
        `INSERT INTO transactions (
            id, gmail_message_id, transaction_date, merchant, amount_cents,
            tx_type, category_id, account_id, card_last_four, status, source,
            posted, notes, created_at, updated_at, categorizer_model,
            categorization_source, matched_rule_id, tx_type_source
         ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'csv', 1, ?, ?, ?, 'csv:import', ?, ?, 'csv')`,
        [crypto.randomUUID(), date, merchant, cents, txType, categoryId, accountId, last4 || null, notes || null, now, now, categorizationSource, matchedRuleId],
      );
      inserted++;
    } catch (e) {
      errors++;
    }
  }
  return { inserted, skipped, errors };
}

// ─── The month: what is left, with bills counted as committed ──────────────
//
// One model for the sidebar and Overview. Bills (active recurring series) are
// money already promised: a bill paid on the 1st is not "pace", and a bill not
// yet paid is not "left". So:
//   left            = limits − spent so far − bills still to come
//   everyday budget = limits − all of this month's bills (paid + to come)
//   everyday spent  = spent − bills paid
// Pace compares everyday spent with an even share of the everyday budget, and
// only says "projected" once a week of the month has passed.
function computeMonthPlan(m) {
  const limit = Math.max(0, m.limitCents | 0);
  const spent = Math.max(0, m.spentCents | 0);
  const billsPaid = Math.max(0, Math.min(spent, m.billsPaidCents | 0));
  const billsToCome = Math.max(0, m.billsToComeCents | 0);
  const days = Math.max(1, m.daysInMonth | 0);
  const day = Math.max(0, Math.min(days, m.dayOfMonth | 0));
  const everydayBudget = Math.max(0, limit - billsPaid - billsToCome);
  const everydaySpent = spent - billsPaid;
  const left = limit - spent - billsToCome;
  const evenByNow = Math.round(everydayBudget * (day / days));
  const projected = day >= 7 ? Math.round((everydaySpent / day) * days) : null;
  let pace = 'none';
  if (limit > 0 && day > 0) {
    if (everydaySpent > everydayBudget) pace = 'over';
    else if (projected !== null && projected > everydayBudget) pace = 'ahead';
    else if (everydaySpent <= evenByNow) pace = 'under';
    else pace = 'ahead';
  }
  return {
    limitCents: limit, spentCents: spent, billsPaidCents: billsPaid, billsToComeCents: billsToCome,
    everydayBudgetCents: everydayBudget, everydaySpentCents: everydaySpent, leftCents: left,
    evenByNowCents: evenByNow, projectedCents: projected, pace,
    daysLeft: Math.max(0, days - day), dayOfMonth: day, daysInMonth: days,
    usedPct: limit > 0 ? Math.round(((limit - left) / limit) * 100) : 0,
  };
}

// Active bills for a month: each with whether it was paid this month and its
// amount (what was paid, else its usual amount when it falls due this month).
// How many times a bill falls due inside a range, stepping from its next due
// date by its cadence. A month ahead of the current one is planned from this.
function billDueCount(nextDue, cadence, range) {
  if (!nextDue || !/^\d{4}-\d{2}-\d{2}$/.test(nextDue)) return 0;
  const step = { weekly: [0, 7], biweekly: [0, 14], monthly: [1, 0], quarterly: [3, 0], yearly: [12, 0] }[cadence];
  if (!step) return nextDue >= range.start && nextDue <= range.end ? 1 : 0;
  const [y, m, d] = nextDue.split('-').map(Number);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const dt = new Date(y, m - 1 + step[0] * i, d + step[1] * i);
    // A month that has no such day (the 31st) falls on its last day.
    if (step[0] && dt.getDate() !== d) dt.setDate(0);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    if (iso > range.end) break;
    if (iso >= range.start) n++;
  }
  return n;
}

// What a bill was paid in a month: the purchases and fees linked to it, or
// whose merchant contains its pattern (any case). Same rule the per-bill
// query used, read from rows already in memory.
function billPaidIn(series, rows, linkedIds) {
  const pat = String(series.merchant_pattern || '').toLowerCase();
  let cents = 0;
  let last = null;
  for (const t of rows) {
    const hit = (linkedIds && linkedIds.has(t.id)) || (pat !== '' && String(t.merchant || '').toLowerCase().includes(pat));
    if (!hit) continue;
    cents += Number(t.amount_cents) || 0;
    if (!last || t.transaction_date > last) last = t.transaction_date;
  }
  return { cents, last };
}

async function readMonthBills(range, todayIso) {
  const series = await db.all(
    `SELECT id, merchant_pattern, display_name, category_id, cadence, avg_amount_cents, last_amount_cents, next_due_date, detection_confidence
       FROM recurring_series WHERE cancelled = 0`);
  // Two reads for every bill, not one per bill: the month's purchases and
  // fees, and which of them were linked to which bill.
  const rows = series.length ? await db.all(
    `SELECT id, merchant, amount_cents, transaction_date FROM transactions
      WHERE status='confirmed' AND tx_type IN ('purchase','fee')
        AND transaction_date >= ? AND transaction_date <= ?`, [range.start, range.end]) : [];
  const links = series.length ? await db.all(
    `SELECT o.series_id, o.transaction_id FROM recurring_occurrences o
       JOIN transactions t ON t.id = o.transaction_id
      WHERE t.transaction_date >= ? AND t.transaction_date <= ?`, [range.start, range.end]).catch(() => []) : [];
  const linked = new Map();
  for (const l of links) {
    if (!linked.has(l.series_id)) linked.set(l.series_id, new Set());
    linked.get(l.series_id).add(l.transaction_id);
  }
  const out = [];
  for (const s of series) {
    const paid = billPaidIn(s, rows, linked.get(s.id));
    const paidCents = paid.cents;
    const usual = Number(s.last_amount_cents) || Number(s.avg_amount_cents) || 0;
    const due = s.next_due_date || null;
    const dueThisMonth = !!due && due >= range.start && due <= range.end;
    // A month still ahead: every time the bill falls due in it is to come.
    const ahead = range.start > localYmd(new Date());
    const aheadCount = ahead ? billDueCount(due, s.cadence, range) : 0;
    out.push({
      id: s.id,
      name: s.display_name || s.merchant_pattern,
      categoryId: s.category_id,
      paid: paidCents > 0,
      paidCents,
      paidOn: paid.last,
      dueDate: due,
      toComeCents: ahead ? usual * aheadCount
        : paidCents > 0 || !dueThisMonth || (todayIso && due < todayIso) ? 0 : usual,
      usualCents: usual,
      unsure: s.detection_confidence === 'low',
    });
  }
  return out;
}

// What the month's plan is measured on. Only categories with a limit are
// planned: spending and bills in a category without one are not counted
// against the limits (a mortgage in an unlimited Housing must not put the
// month "over plan"). Totals across every category are kept beside them for
// what the pages report as spent and paid.
function planScope(statuses, bills, allSpentCents) {
  const limited = new Set(statuses.filter(r => (Number(r.effective_limit_cents) || 0) > 0).map(r => r.id));
  const inPlan = bills.filter(b => limited.has(b.categoryId));
  const sum = (xs, f) => xs.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const limitCents = sum(statuses.filter(r => limited.has(r.id)), r => r.effective_limit_cents);
  const spentCents = sum(statuses.filter(r => limited.has(r.id)), r => r.spent_cents);
  return {
    limitCents,
    spentCents,
    billsPaidCents: sum(inPlan, b => b.paidCents),
    billsToComeCents: sum(inPlan, b => b.toComeCents),
    allSpentCents: Math.max(0, Number(allSpentCents) || 0),
    unplannedSpentCents: Math.max(0, (Number(allSpentCents) || 0) - spentCents),
    allBillsPaidCents: sum(bills, b => b.paidCents),
    allBillsToComeCents: sum(bills, b => b.toComeCents),
  };
}

async function readMonthPlan(monthKey) {
  const range = monthRange(monthKey);
  const now = ctParts(new Date());
  const nowKey = `${now.y}-${String(now.m).padStart(2, '0')}`;
  const daysInMonth = Number(range.end.slice(8, 10));
  const day = range.key === nowKey ? now.d : range.key < nowKey ? daysInMonth : 0;
  const todayIso = range.key === nowKey ? `${nowKey}-${String(now.d).padStart(2, '0')}` : null;
  const statuses = await evalBudgetStatus(range.key);
  const spentRow = await db.get(
    `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM transactions
      WHERE status='confirmed' AND tx_type IN ('purchase','fee') AND transaction_date >= ? AND transaction_date <= ?`,
    [range.start, range.end]);
  const bills = await readMonthBills(range, todayIso);
  const scope = planScope(statuses, bills, Number(spentRow?.cents) || 0);
  const plan = computeMonthPlan({ ...scope, daysInMonth, dayOfMonth: day });
  return { ...plan, ...scope, range, categories: statuses, bills };
}

async function readMonthGlance() {
  const p = await readMonthPlan();
  return { ...p, monthName: new Date(p.range.year, p.range.month0, 1).toLocaleString('en-US', { month: 'long' }) };
}

// ─── Budget alert helper ────────────────────────────────────────────────────
//
// Returns per-category status for a given month.
//   status: 'ok' | 'near' (≥80%) | 'over' (>100%)
async function evalBudgetStatus(monthKey) {
  const range = monthRange(monthKey);
  const rows = await db.all(`
    SELECT c.id, c.name, c.color,
           COALESCE(b.limit_cents, c.monthly_limit_cents, 0) AS limit_cents,
           COALESCE(b.rollover_cents, 0) AS rollover_cents,
           COALESCE(SUM(t.amount_cents), 0) AS spend_cents
      FROM categories c
      LEFT JOIN budgets b ON b.category_id = c.id AND b.month_key = ?
      LEFT JOIN transactions t ON t.category_id = c.id AND t.status='confirmed'
        AND t.tx_type IN ('purchase','fee')
        AND t.transaction_date >= ? AND t.transaction_date <= ?
     WHERE c.archived = 0 AND c.kind = 'expense'
     GROUP BY c.id, b.limit_cents, b.rollover_cents
     ORDER BY c.sort_order ASC, c.name ASC`,
    [monthKey, range.start, range.end],
  );
  return rows.map(r => {
    const eff = (Number(r.limit_cents) || 0) + (Number(r.rollover_cents) || 0);
    const spent = Number(r.spend_cents) || 0;
    const pct = eff > 0 ? (spent / eff) : 0;
    let status = 'ok';
    if (eff > 0 && pct > 1.0) status = 'over';
    else if (eff > 0 && pct >= 0.8) status = 'near';
    return { ...r, effective_limit_cents: eff, spent_cents: spent, pct, status };
  });
}

// ─── M82: deterministic AI pipeline (restored) ───────────────────────────
//
// M80 deleted the 4-stage classify/extract/categorize/snapshot pipeline in
// favour of a skill that orchestrated thin `budget.*` chat tools per email.
// On local models (Ollama) that multi-step orchestration proved unreliable —
// the model dropped steps, mis-ordered tool calls, and frequently failed to
// advance the cursor. We restore the proven in-process loop here: ONE small,
// focused LLM call per stage per email, driven by deterministic JS. It is
// exposed as the single `budget.runSync` chat tool and is what the dashboard
// "Run First Sync" / "Sync Now" buttons invoke. The model used is the same
// model the chat is on (api.lm.getActiveModel()), so there is one AI surface.

// These run on the user's chat model, which may be a "thinking" model
// (qwen3, DeepSeek-R1, etc.) that spends tokens reasoning before emitting the
// JSON answer. We do NOT suppress thinking and we do NOT cap output tokens —
// a tight num_predict cap truncates the model mid-thought so it never reaches
// the JSON. num_ctx is generous so the prompt + reasoning + answer all fit.
const BUDGET_LM_NUM_CTX = 16384;
const BUDGET_GMAIL_HARD_PAGE_LIMIT = 50;
const BUDGET_DEFAULT_GMAIL_QUERY = 'from:chase.com';
// Captured raw output of the first parse failure per run so we can surface
// actionable diagnostics instead of silently classifying as "other".
let _lastMalformedSample = null;

function budgetLmOptions(_stage) {
  // No maxTokens — let the model think and answer to completion.
  return {
    temperature: 0,
    format: 'json',
    numCtx: BUDGET_LM_NUM_CTX,
  };
}

function tryParseModelJson(raw) {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return undefined;
}

// ─── LM stall watchdog ───────────────────────────────────────────────────────
// The extension-facing LM API has no AbortSignal and no timeout, so a hung
// Ollama socket used to freeze budgetSync mid-run FOREVER: the dashboard
// banner sat at "77 of 98" and the cursor never advanced (observed
// 2026-08-18 — three runs with a fetch line and no commit, no error, no
// per-email log rows). This consumer re-arms a timer per chunk and throws
// once the stream goes quiet. It cannot abort the underlying request
// (nothing to abort with) — abandoning the iterator is enough to unwedge
// the sync loop.
//
// Deliberately DUPLICATED from the flashcards extension's equivalent:
// extensions stay self-contained, so neither can break the other.

/** Between-chunk quiet limit once the model is streaming. */
const BUDGET_LM_STALL_MS = 90_000;
/** First-chunk limit. Cold-loading a 17-20GB model behind a busy GPU can
 *  take minutes; declaring a stall during the load would fail healthy
 *  emails, so the first chunk gets a longer leash than the rest. */
const BUDGET_LM_FIRST_CHUNK_MS = 240_000;

/**
 * Thrown when the model stream goes quiet. `isLmStall` lets budgetSync
 * distinguish an infra stall (leave the email unrecorded — retry next run)
 * from malformed model output (permanent, recorded).
 */
class BudgetLmStallError extends Error {
  constructor(seconds) {
    super(`The model stopped responding (no output for ${Math.round(seconds)}s). Check that the model backend is running and not out of memory.`);
    this.name = 'BudgetLmStallError';
    this.isLmStall = true;
  }
}

/**
 * Consume an LM stream with the stall watchdog. `onChunk` may return `true`
 * to stop early (the done-chunk contract of the previous bare loop).
 */
async function budgetStreamWithStall(stream, onChunk, { stallMs = BUDGET_LM_STALL_MS, firstChunkMs = BUDGET_LM_FIRST_CHUNK_MS } = {}) {
  const it = stream[Symbol.asyncIterator]();
  let sawChunk = false;
  for (;;) {
    const limit = sawChunk ? stallMs : firstChunkMs;
    let timer;
    const stall = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new BudgetLmStallError(limit / 1000)), limit);
    });
    // Keep a handle on the pending next() so a stall doesn't orphan it into
    // an unhandled rejection, and close the generator so its cleanup runs.
    const next = it.next();
    next.catch(() => { /* orphaned after a stall; already surfaced */ });
    let step;
    try {
      step = await Promise.race([next, stall]);
    } catch (err) {
      try { void it.return?.(); } catch { /* generator cleanup is best-effort */ }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (step.done) return;
    sawChunk = true;
    if (onChunk(step.value) === true) {
      try { void it.return?.(); } catch { /* generator cleanup is best-effort */ }
      return;
    }
  }
}

async function lmRunJson(api, modelId, systemPrompt, userPrompt, stage = 'default') {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt   },
  ];
  const opts = budgetLmOptions(stage);
  const collect = async (msgs) => {
    let out = '';
    await budgetStreamWithStall(api.lm.sendChatRequest(modelId, msgs, opts), (chunk) => {
      if (chunk && typeof chunk.content === 'string') out += chunk.content;
      return !!(chunk && chunk.done);
    });
    return out;
  };
  let raw = await collect(messages);
  let parsed = tryParseModelJson(raw);
  if (parsed !== undefined) return parsed;
  const retryMessages = messages.concat([
    { role: 'assistant', content: raw },
    { role: 'user', content: 'Respond ONLY with the JSON object — no prose, no markdown.' },
  ]);
  raw = await collect(retryMessages);
  parsed = tryParseModelJson(raw);
  if (parsed === undefined && _lastMalformedSample === null) {
    // Capture the first failure so we can surface a real diagnostic instead
    // of silently classifying as "other". Trimmed to avoid log bloat.
    _lastMalformedSample = {
      stage,
      modelId,
      rawHead: typeof raw === 'string' ? raw.slice(0, 400) : '<non-string>',
      rawLen: typeof raw === 'string' ? raw.length : 0,
    };
  }
  return parsed; // may still be undefined — caller treats as malformed
}

async function aiStage1(api, modelId, msg) {
  const sys = 'You classify bank and credit-card emails. Respond with a single JSON object and nothing else.';
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${truncateBody(msg.body)}\n\n` +
    `Classify the email as exactly one of these event types:\n` +
    `  • "purchase"        — a real charge on a debit or credit card (gas, restaurant, subscription) OR a return/credit on a card. Refunds are purchases with a negative amount; do NOT use a separate refund type.\n` +
    `  • "deposit"         — money INTO a bank account from outside (paycheck, direct deposit, external transfer-IN).\n` +
    `  • "transfer"        — INTERNAL movement between this user's own accounts ONLY: checking to savings, or paying THIS user's credit card from checking. Both ends must be the user's own accounts.\n` +
    `                        NOT a transfer: money sent to a person (Zelle, Venmo, "You sent $X to NAME"), a bill payment to a company or utility ("payment to <payee>", autopay to an insurer or utility), or any charge. Those are "purchase" even when the email says "payment".\n` +
    `  • "fee"             — bank fee, overdraft, ATM fee, late fee.\n` +
    `  • "balance_summary" — daily / periodic summary that lists ACCOUNT BALANCES (typical subjects: "Your daily account summary", "Account balance alert").\n` +
    `  • "other"           — statement-ready notice, marketing, security alerts, password resets, etc. (no money moved).\n\n` +
    `Account-kind hint should reflect which kind of account the event hits (use the body text — credit-card emails usually mention "Visa", "Mastercard", or a card name; bank emails mention "Total Checking", "Savings").\n\n` +
    `Return:\n{\n  "event_type":         <one of the strings above>,\n  "account_kind_hint":  <"checking" | "savings" | "credit_card" | "other">\n}`;
  const r = await lmRunJson(api, modelId, sys, usr, 'classify');
  if (!r || typeof r !== 'object') return { event_type: 'other', account_kind_hint: 'other', malformed: true };
  let eventType = typeof r.event_type === 'string' ? r.event_type.trim().toLowerCase() : 'other';
  // Defensive normalization — if the model emits the old labels we collapse
  // them to their canonical type. Refunds become purchases (negative amount
  // tells the story). CC payments are transfers between the user's own accounts.
  if (eventType === 'refund') eventType = 'purchase';
  if (eventType === 'cc_payment') eventType = 'transfer';
  const valid = new Set([...TX_TYPE_VALUES, 'balance_summary', 'other']);
  return {
    event_type: valid.has(eventType) ? eventType : 'other',
    account_kind_hint: normalizeAccountKind(r.account_kind_hint),
    // Backwards-compat: callers previously used these booleans.
    is_transaction: TX_TYPE_VALUES.includes(eventType),
    is_balance:     eventType === 'balance_summary',
    malformed: false,
  };
}

async function aiStage2(api, modelId, msg) {
  const sys = 'You extract financial transaction data from emails. Respond with a single JSON object and nothing else. Money is reported in dollars; if you see cents, divide by 100. If multiple transactions are mentioned, return them in the "items" array.';
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${truncateBody(msg.body)}\n\n` +
    `Return:\n{\n  "items": [\n    {\n      "merchant":          <string or null — the payee for purchases, or "Checking" / "Savings" / "Visa" for transfers/payments/deposits>,\n      "amount":            <number — positive for spend/charge/transfer-out, negative for refund/credit/deposit-in>,\n      "card_last_four":    <string of 4 digits or null — the account or card last four digits this hit>,\n      "account_kind_hint": <"checking" | "savings" | "credit_card" | "other">,\n      "transaction_date":  <"YYYY-MM-DD">,\n      "confidence":        <"high" | "medium" | "low">\n    }\n  ]\n}`;
  const r = await lmRunJson(api, modelId, sys, usr, 'extract');
  if (!r || !Array.isArray(r.items)) return { items: [], malformed: !r };
  const items = [];
  for (const raw of r.items) {
    if (!raw || typeof raw !== 'object') continue;
    const amt = typeof raw.amount === 'number' ? raw.amount : Number(raw.amount);
    if (!Number.isFinite(amt)) continue;
    const date = typeof raw.transaction_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.transaction_date)
      ? raw.transaction_date
      : isoLocalDate(msg.receivedAt);
    const confidence = (raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low')
      ? raw.confidence : 'low';
    items.push({
      merchant:          typeof raw.merchant === 'string' ? raw.merchant : null,
      amount:            amt,
      card_last_four:    typeof raw.card_last_four === 'string' && /^\d{4}$/.test(raw.card_last_four) ? raw.card_last_four : null,
      account_kind_hint: normalizeAccountKind(raw.account_kind_hint),
      transaction_date:  date,
      confidence,
    });
  }
  return { items, malformed: false };
}

async function aiStage3(api, modelId, tx, categoryNames) {
  const sys = 'You pick the best-fitting budget category for a transaction. Respond with a single JSON object and nothing else. The category MUST be one of the listed names (case-insensitive); if none fits, pick "Other".';
  const usr = `Merchant: ${tx.merchant ?? ''}\nAmount:   ${tx.amount} USD\nCategories: ${categoryNames.join(', ')}\n\nReturn:\n{ "category": <one of the listed category names> }`;
  const r = await lmRunJson(api, modelId, sys, usr, 'categorize');
  if (!r || typeof r.category !== 'string') return null;
  return r.category.trim();
}

async function aiStage1bExtract(api, modelId, msg) {
  const sys = 'You extract account balance data from a daily account summary email. The email may list MULTIPLE accounts (Total Checking, Savings, Credit Card, etc.). Respond with a single JSON object and nothing else.';
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${truncateBody(msg.body)}\n\n` +
    `Return:\n{\n  "snapshot_date": <"YYYY-MM-DD">,\n  "accounts": [\n    {\n      "account_kind":      <"checking" | "savings" | "credit_card" | "other">,\n      "account_last_four": <string of 4 digits or null>,\n      "balance":           <number, in dollars — POSITIVE for cash on hand, NEGATIVE for credit card amount owed>\n    }\n  ]\n}`;
  const r = await lmRunJson(api, modelId, sys, usr, 'snapshot');
  if (!r || typeof r !== 'object') return null;
  const date = typeof r.snapshot_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.snapshot_date)
    ? r.snapshot_date
    : isoLocalDate(msg.receivedAt);
  const out = [];
  const list = Array.isArray(r.accounts) ? r.accounts : [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const bal = typeof raw.balance === 'number' ? raw.balance : Number(raw.balance);
    if (!Number.isFinite(bal)) continue;
    out.push({
      account_kind:      normalizeAccountKind(raw.account_kind),
      account_last_four: typeof raw.account_last_four === 'string' && /^\d{4}$/.test(raw.account_last_four) ? raw.account_last_four : null,
      balance:           bal,
    });
  }
  if (out.length === 0) return null;
  return { snapshot_date: date, accounts: out };
}

function truncateBody(body) {
  // The MCP returns up to 8 KB. We further trim and strip soft hyphens / zwnj
  // before feeding the LLM so prompt budget stays under ~3 KB.
  if (typeof body !== 'string' || !body) return '';
  const cleaned = body
    .replace(/&zwnj;|\u200c/gi, '')
    .replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length > 3000 ? cleaned.slice(0, 3000) : cleaned;
}

// ─── Sync helpers ──────────────────────────────────────────────────────────

/** A transfer's payee should be one of the user's own accounts (Checking, Savings, a card), never an outside party. */
function looksLikeAccountName(merchant) {
  const m = String(merchant || '').trim().toLowerCase();
  if (!m) return true;
  return /\b(checking|savings|visa|mastercard|amex|discover|credit card|card|account|acct|freedom|sapphire|slate|ink)\b/.test(m)
    || /(\.{2,}|x{2,}|\*{2,}|ending in|ending)\s*\d{3,4}\b/.test(m);
}

function dollarsToCents(n) {
  // Math.round avoids 0.1+0.2 binary drift; we already store as INTEGER.
  return Math.round(Number(n) * 100);
}

function isoLocalDate(isoTs) {
  // Convert an ISO-8601 UTC timestamp to local YYYY-MM-DD per D4.
  if (!isoTs) return todayYmd();
  try {
    const d = new Date(isoTs);
    return localYmd(d);
  } catch {
    return todayYmd();
  }
}

function isoNDaysAgo(n) {
  const t = Date.now() - (Math.max(1, n | 0) * 24 * 60 * 60 * 1000);
  return new Date(t).toISOString();
}

// First-sync window floor. An explicit `budget.syncStartDate` (YYYY-MM-DD)
// pins the exact "import everything from here" point and wins over the
// relative `budget.syncStartDays` window. Falls back to N-days-ago when no
// valid absolute date is set.
function firstSyncSinceIso(cfg) {
  const raw = cfg && typeof cfg.get === 'function' ? cfg.get('syncStartDate', '') : '';
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    const d = new Date(raw.trim() + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return isoNDaysAgo(cfg && typeof cfg.get === 'function' ? cfg.get('syncStartDays', 90) : 90);
}

function isValidYmdParts(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y
    && dt.getUTCMonth() === m - 1
    && dt.getUTCDate() === d;
}

function normalizeSyncCursorDate(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return null;

  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!isValidYmdParts(y, m, d)) return null;

  if (raw.length === 10) {
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)).toISOString();
  }

  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

// Clamp one Gmail page/batch to Gmail's 1..500 API range; default 100.
function clampSyncMax(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 100;
  return Math.max(1, Math.min(500, v));
}

function readToolText(result) {
  if (typeof result?.content === 'string') return result.content;
  if (Array.isArray(result?.content)) {
    const first = result.content[0];
    if (typeof first?.text === 'string') return first.text;
  }
  return '{"messages":[]}';
}

function parseGmailListResult(result) {
  const payload = readToolText(result);
  let parsed;
  try { parsed = JSON.parse(payload); } catch (e) {
    throw new Error('Gmail MCP returned non-JSON payload: ' + (e instanceof Error ? e.message : String(e)));
  }
  const messages = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed?.messages) ? parsed.messages : []);
  return {
    messages,
    nextPageToken: (typeof parsed?.nextPageToken === 'string' && parsed.nextPageToken)
      ? parsed.nextPageToken
      : null,
  };
}

async function fetchBudgetGmailMessages(api, toolName, baseArgs, opts = {}) {
  const pageSize = clampSyncMax(baseArgs?.max ?? 100);
  const hardPageLimit = Math.max(1, Math.min(200, Number(opts.hardPageLimit) || BUDGET_GMAIL_HARD_PAGE_LIMIT));
  const messages = [];
  const seenIds = new Set();
  let nextPageToken = null;
  let pageCount = 0;

  while (pageCount < hardPageLimit) {
    pageCount++;
    const pageArgs = { ...baseArgs, max: pageSize };
    if (nextPageToken) pageArgs.page_token = nextPageToken;

    const result = await api.mcp.invokeTool(toolName, pageArgs);
    if (result && result.isError) {
      throw new Error(`Gmail MCP error: ${readToolText(result) || 'unknown'}`);
    }

    const page = parseGmailListResult(result);
    let newInPage = 0;
    for (const msg of page.messages) {
      if (!msg || !msg.id || seenIds.has(msg.id)) continue;
      seenIds.add(msg.id);
      messages.push(msg);
      newInPage++;
    }

    nextPageToken = page.nextPageToken;
    if (!nextPageToken || page.messages.length === 0 || newInPage === 0) break;
  }

  messages.sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')));
  return {
    messages,
    pageCount,
    pageSize,
    hitSafetyBelt: Boolean(nextPageToken) && pageCount >= hardPageLimit,
  };
}

async function syncLog(runId, level, stage, message, msgId) {
  try {
    await db.run(
      `INSERT INTO sync_log (run_id, ts, level, msg_id, stage, message) VALUES (?,?,?,?,?,?)`,
      [runId, new Date().toISOString(), level, msgId || null, stage || null, String(message)],
    );
  } catch { /* logging is best-effort */ }
}

async function getSyncStateValue(key) {
  const row = await db.get('SELECT value FROM sync_state WHERE key=?', [key]);
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}

// The sync cursor (`last_synced_at`) is DERIVED from durable state, never from
// what was merely *seen* or from a caller-supplied date. `email_imports` holds
// exactly one row per Gmail message we have durably handled — recorded as a
// transaction, a balance snapshot, classified non-financial, or parked as
// malformed — in BOTH the deterministic loop and the AI-orchestrated tools.
// Its MAX(received_at) is therefore a safe, monotonic high-water mark: every
// message at or before it is captured (and dedup-protected via the
// gmail_message_id check), while anything after it has not been handled and
// must stay fetchable. A message that was fetched but never recorded does not
// appear here, so it cannot raise the cursor — it remains in the next fetch
// window. Returns null when nothing has been recorded yet (don't move the
// cursor).
async function computeSettledCursor() {
  const row = await db.get('SELECT MAX(received_at) AS m FROM email_imports');
  return row && typeof row.m === 'string' && row.m ? row.m : null;
}

// Pick the model for the sync. M82: budget shares the chat model rather than a
// separate `preferredModelId` (dropped in M80) so there is one AI surface and
// no second Ollama slot contending with chat. Falls back to the first installed
// model when the chat hasn't selected one yet.
async function pickModelId(api) {
  const active = (api.lm && typeof api.lm.getActiveModel === 'function')
    ? api.lm.getActiveModel()
    : undefined;
  if (active) return active;
  const models = await api.lm.getModels();
  if (!models || models.length === 0) {
    throw new Error('No language models available. Install or start Ollama first.');
  }
  return models[0].id;
}

// ─── Sync engine — M82 deterministic in-process loop ─────────────────────────
//
// Restored from the pre-M80 pipeline. Runs entirely in JS with one focused LLM
// call per stage per email, so it is reliable on local models. Invoked by the
// `budget.runSync` chat tool and by the dashboard "Run First Sync" / "Sync Now"
// buttons (via triggerSyncFromUI). Returns the run counts.
async function budgetSync(api) {
  const runId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  const startedAt = new Date().toISOString();
  await syncLog(runId, 'info', 'fetch', 'Sync started');

  // Persist the run timestamp BEFORE we start so a crash mid-sync still leaves
  // a "we attempted at X" footprint, and the Dashboard "Last sync" card reflects
  // the actual run — not the email-cursor — so it always advances.
  try {
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_run_at', ?)`,
      [JSON.stringify(startedAt)],
    );
  } catch { /* sync_state table missing on first ever run is fine */ }

  _emitSync({ kind: 'start', runId, startedAt });
  _lastMalformedSample = null;

  const counts = { confirmed: 0, review: 0, snapshot: 0, skipped: 0, errors: 0, malformed: 0, classifiedOther: 0, stalled: 0, duplicates: 0 };
  // Stall circuit breaker: one stalled email is an anomaly worth skipping;
  // three IN A ROW means the model backend is down and every remaining email
  // would burn its own multi-minute timeout — abort the run instead. Stalled
  // emails are left unrecorded so the next sync retries them.
  let consecutiveStalls = 0;
  const stalledReceivedAts = [];
  const stallAbort = () => {
    if (consecutiveStalls >= 3) {
      throw new Error(
        'Sync aborted: the model stalled on 3 consecutive emails. The model backend looks unresponsive '
        + '(crashed, out of memory, or stuck loading a model). Completed work is saved and will be skipped; '
        + 'run Sync Now again once the backend recovers.',
      );
    }
  };
  try {
    const cfg = api.workspace.getConfiguration('budget');
    const serverId = cfg.get('gmailMcpServerId', 'gmail');
    // M81 rename: list_unread → list_emails. Prefer the new name; fall back to
    // the legacy name when the server hasn't been rebuilt yet.
    const newToolName = `mcp__${serverId}__list_emails`;
    const legacyToolName = `mcp__${serverId}__list_unread`;
    const available = await api.mcp.listTools();
    const has = (n) => Array.isArray(available) && available.some(t => t.name === n);
    const toolName = has(newToolName) ? newToolName : (has(legacyToolName) ? legacyToolName : null);
    if (!toolName) {
      throw new Error(`Gmail MCP tool '${newToolName}' is not connected. Open Settings → MCP Servers and connect '${serverId}'.`);
    }

    const lastSyncedAt = await getSyncStateValue('last_synced_at');
    // First-sync window floor: an explicit start date wins over the relative
    // syncStartDays window so users can pin an exact "import from here" point.
    const sinceIso = (typeof lastSyncedAt === 'string' && lastSyncedAt)
      ? lastSyncedAt
      : firstSyncSinceIso(cfg);

    const modelId = await pickModelId(api);
    await syncLog(runId, 'info', 'model', `Using ${modelId} with numCtx=${BUDGET_LM_NUM_CTX}`);

    // Issuer query is configurable so users can plug in additional banks/cards
    // without editing the extension. Keep the default narrow to avoid pulling
    // unrelated financial mail.
    const gmailQuery = cfg.get('gmailQuery', BUDGET_DEFAULT_GMAIL_QUERY);
    // Gmail's `max` is per page (Gmail API ceiling: 500). The sync follows
    // nextPageToken until Gmail is exhausted, so the default 100 is a batch
    // size, not a per-run cap.
    const pageSize = clampSyncMax(cfg.get('syncMaxEmails', 100));

    const fetched = await fetchBudgetGmailMessages(api, toolName, {
      since: sinceIso,
      max: pageSize,
      read_state: 'all',
      query: gmailQuery,
      include_body: true,
    });
    const messages = fetched.messages;
    await syncLog(
      runId,
      fetched.hitSafetyBelt ? 'warn' : 'info',
      'fetch',
      `Fetched ${messages.length} email(s) across ${fetched.pageCount} Gmail page(s), pageSize=${fetched.pageSize}` +
        (fetched.hitSafetyBelt ? `; stopped at safety cap ${BUDGET_GMAIL_HARD_PAGE_LIMIT}` : ''),
    );

    // Fetched signal — the long part starts here. The dashboard banner can
    // now switch from "starting…" to "classifying N emails…" so the user
    // knows what's actually happening during the LLM phase.
    _emitSync({
      kind: 'progress',
      runId,
      stage: 'fetched',
      detail: { totalMessages: messages.length },
    });

    // Cache active expense category names for Stage 3
    const categoryRows = await db.all(
      `SELECT id, name FROM categories WHERE archived=0 AND kind='expense' ORDER BY sort_order`,
    );
    const categoryNames = categoryRows.map(r => r.name);
    const categoryByName = new Map(categoryRows.map(r => [String(r.name).toLowerCase(), r.id]));

    // Cache active rules — applied BEFORE AI categorization (deterministic > probabilistic).
    const activeRules = await loadActiveRules();

    let newestSeenIso = sinceIso;
    let newestSeenId = null;

    let processedCount = 0;
    const totalMessages = messages.length;

    for (const msg of messages) {
      processedCount++;
      if (!msg || !msg.id) { counts.skipped++; continue; }
      if (msg.receivedAt && msg.receivedAt > newestSeenIso) {
        newestSeenIso = msg.receivedAt;
        newestSeenId = msg.id;
      }
      const already = await db.get('SELECT 1 AS x FROM email_imports WHERE gmail_message_id=?', [msg.id]);
      if (already) {
        counts.skipped++;
        _emitSync({
          kind: 'progress',
          runId,
          stage: 'skip',
          detail: { processed: processedCount, total: totalMessages, ...counts },
        });
        continue;
      }
      _emitSync({
        kind: 'progress',
        runId,
        stage: 'classify',
        detail: { processed: processedCount, total: totalMessages, ...counts },
      });

      // Stage 1 — classify
      let cls;
      try {
        cls = await aiStage1(api, modelId, msg);
        consecutiveStalls = 0; // the backend answered — reset the breaker
      } catch (e) {
        if (e && e.isLmStall) {
          // Infra stall, not bad content: leave the email UNRECORDED so the
          // next sync retries it instead of tombstoning it as malformed.
          counts.stalled++;
          consecutiveStalls++;
          stalledReceivedAts.push(msg.receivedAt || null);
          await syncLog(runId, 'warn', 'stage1', 'Stall: ' + e.message + ' Email left unrecorded; the next sync retries it.', msg.id);
          stallAbort();
          continue;
        }
        await syncLog(runId, 'warn', 'stage1', 'Classify error: ' + (e instanceof Error ? e.message : String(e)), msg.id);
        cls = { is_transaction: false, is_balance: false, malformed: true };
        counts.errors++;
      }
      if (cls.malformed) counts.malformed++;
      else if (!cls.is_transaction && !cls.is_balance) counts.classifiedOther++;

      await db.run(
        `INSERT INTO email_imports (gmail_message_id, received_at, raw_subject, raw_snippet, is_transaction, is_balance, classifier_model, processed_at, malformed)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [msg.id, msg.receivedAt || new Date().toISOString(), msg.subject || null, msg.snippet || null,
         cls.is_transaction ? 1 : 0, cls.is_balance ? 1 : 0, modelId, new Date().toISOString(),
         cls.malformed ? 1 : 0],
      );

      // Stage 2 — extract transaction(s)
      if (cls.is_transaction) {
        let extracted;
        try {
          extracted = await aiStage2(api, modelId, msg);
          consecutiveStalls = 0;
        } catch (e) {
          if (e && e.isLmStall) {
            counts.stalled++;
            consecutiveStalls++;
            stalledReceivedAts.push(msg.receivedAt || null);
            // The email_imports row above already recorded this email —
            // remove it so the retry redoes classify + extract from scratch.
            await db.run('DELETE FROM email_imports WHERE gmail_message_id=?', [msg.id]);
            await syncLog(runId, 'warn', 'stage2', 'Stall: ' + e.message + ' Email left unrecorded; the next sync retries it.', msg.id);
            stallAbort();
            continue;
          }
          await syncLog(runId, 'warn', 'stage2', 'Extract error: ' + (e instanceof Error ? e.message : String(e)), msg.id);
          extracted = { items: [], malformed: true };
        }
        const evt = cls.event_type;
        const txType = (evt === 'purchase' || evt === 'deposit'
                     || evt === 'transfer' || evt === 'fee') ? evt : 'other';

        if (extracted.malformed || extracted.items.length === 0) {
          // Synthetic review row so user can manually triage.
          await db.run(
            `INSERT INTO transactions (id, gmail_message_id, amount_cents, transaction_date, ai_confidence, status, extractor_model, tx_type)
             VALUES (?,?,?,?,?,?,?,?)`,
            [crypto.randomUUID(), msg.id, 0, isoLocalDate(msg.receivedAt), 'low', 'review', modelId, txType],
          );
          counts.review++;
        } else {
          for (const item of extracted.items) {
            // Account inference: prefer item-level kind hint, fall back to message-level.
            const kindForUpsert = item.account_kind_hint && item.account_kind_hint !== 'other'
              ? item.account_kind_hint
              : (cls.account_kind_hint || 'other');
            let accountId = null;
            if (item.card_last_four) {
              const acct = await upsertAccount(item.card_last_four, kindForUpsert, null);
              accountId = acct ? acct.id : null;
            }

            // Categorize only purchases (including their refund counterparts).
            let categoryId = null;
            let categorizerModel = null;
            let categorizationSource = null;
            let matchedRuleId = null;
            if (txType === 'purchase') {
              // 1) Deterministic rules first.
              const matched = await applyRules(item.merchant, activeRules);
              if (matched) {
                categoryId = matched.categoryId;
                categorizerModel = 'rule:' + matched.ruleId;
                categorizationSource = 'rule';
                matchedRuleId = matched.ruleId;
              } else if (item.confidence !== 'low' && categoryNames.length > 0) {
                // 2) AI fallback.
                try {
                  const picked = await aiStage3(api, modelId, item, categoryNames);
                  consecutiveStalls = 0;
                  if (picked) {
                    categoryId = categoryByName.get(picked.toLowerCase()) || null;
                    categorizerModel = modelId;
                    if (categoryId) categorizationSource = 'ai';
                  }
                } catch (e) {
                  if (e && e.isLmStall) {
                    // Extraction already succeeded — a categorize stall costs
                    // the category, never the transaction. Breaker still
                    // counts it: a dead backend stalls here on every purchase.
                    counts.stalled++;
                    consecutiveStalls++;
                    await syncLog(runId, 'warn', 'stage3', 'Stall during categorize: ' + e.message + ' Transaction recorded without a category.', msg.id);
                    if (consecutiveStalls >= 3) {
                      // Roll this email back before aborting: its imports row
                      // is written but its transactions are incomplete, and a
                      // recorded email is skipped forever on the next run.
                      await db.run('DELETE FROM transactions WHERE gmail_message_id=?', [msg.id]);
                      await db.run('DELETE FROM email_imports WHERE gmail_message_id=?', [msg.id]);
                      stallAbort();
                    }
                  } else {
                    await syncLog(runId, 'warn', 'stage3', 'Categorize error: ' + (e instanceof Error ? e.message : String(e)), msg.id);
                  }
                }
              }
            }
            // Stage 1 ↔ Stage 2 cross-check. Catch silent contradictions
            // before they enter the ledger.
            const cents = dollarsToCents(item.amount);
            // A transfer whose payee reads as an outside party (a person, a
            // utility) is the classifier over-reaching on the word "payment":
            // it lands in review with the reason on it, never silently confirmed.
            const externalTransfer = txType === 'transfer' && !!item.merchant && !looksLikeAccountName(item.merchant);
            const crossFail = (
              (txType === 'deposit'  && cents > 0) ||
              (txType === 'purchase' && !item.merchant) ||
              (txType === 'fee'      && !item.merchant) ||
              (txType === 'transfer' && !item.merchant) ||
              externalTransfer
            );
            // The same charge can arrive in two emails (an alert, then a
            // posting; a payment scheduled, then received). A match on amount,
            // payee and a two-day window goes to review as a possible duplicate
            // instead of counting twice.
            const dupe = item.merchant ? await db.get(
              `SELECT id FROM transactions WHERE amount_cents=? AND LOWER(merchant)=LOWER(?) AND status IN ('confirmed','review')
                 AND ABS(julianday(transaction_date) - julianday(?)) <= 2 AND gmail_message_id != ? LIMIT 1`,
              [cents, item.merchant, item.transaction_date, msg.id],
            ).catch(() => null) : null;
            if (dupe) counts.duplicates++;
            const insertStatus = (item.confidence === 'low' || crossFail || dupe) ? 'review' : 'confirmed';
            const reasons = [];
            if (crossFail) {
              reasons.push('[cross-check: tx_type=' + txType + ', merchant=' + (item.merchant || 'NULL')
                + ', amount=' + (cents/100).toFixed(2) + (externalTransfer ? ', payee looks external' : '') + ']');
            }
            if (dupe) reasons.push('[possible duplicate of ' + dupe.id + ']');
            const crossNote = reasons.length ? reasons.join(' ') : null;
            await db.run(
              `INSERT INTO transactions (id, gmail_message_id, merchant, amount_cents, card_last_four, transaction_date,
                                         category_id, account_id, tx_type, ai_confidence,
                                         extractor_model, categorizer_model, status,
                                         categorization_source, matched_rule_id, notes, tx_type_source)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [
                crypto.randomUUID(), msg.id, item.merchant, cents,
                item.card_last_four, item.transaction_date, categoryId, accountId, txType,
                item.confidence, modelId, categorizerModel,
                insertStatus,
                categorizationSource, matchedRuleId, crossNote, 'ai',
              ],
            );
            if (insertStatus === 'review') counts.review++; else counts.confirmed++;
          }
        }
      }

      // Stage 1b — balance snapshot (may emit multiple rows from one summary email)
      if (cls.is_balance) {
        try {
          const snap = await aiStage1bExtract(api, modelId, msg);
          consecutiveStalls = 0;
          if (snap && Array.isArray(snap.accounts) && snap.accounts.length > 0) {
            for (const a of snap.accounts) {
              let accountId = null;
              if (a.account_last_four) {
                const acct = await upsertAccount(a.account_last_four, a.account_kind, null, { trustedKind: true });
                accountId = acct ? acct.id : null;
              }
              await db.run(
                `INSERT INTO balance_snapshots (id, gmail_message_id, account_id, account_last_four, kind, balance_cents, snapshot_date)
                 VALUES (?,?,?,?,?,?,?)`,
                [crypto.randomUUID(), msg.id, accountId, a.account_last_four, a.account_kind, dollarsToCents(a.balance), snap.snapshot_date],
              );
              counts.snapshot++;
            }
          } else {
            await syncLog(runId, 'warn', 'snapshot', 'Balance parse failed', msg.id);
            counts.errors++;
          }
        } catch (e) {
          if (e && e.isLmStall) {
            counts.stalled++;
            consecutiveStalls++;
            stalledReceivedAts.push(msg.receivedAt || null);
            // Remove the imports row written above so the retry redoes the
            // whole email (a recorded email is never revisited).
            await db.run('DELETE FROM email_imports WHERE gmail_message_id=?', [msg.id]);
            await syncLog(runId, 'warn', 'snapshot', 'Stall: ' + e.message + ' Email left unrecorded; the next sync retries it.', msg.id);
            stallAbort();
            continue;
          }
          await syncLog(runId, 'warn', 'snapshot', 'Snapshot error: ' + (e instanceof Error ? e.message : String(e)), msg.id);
          counts.errors++;
        }
      }

    }

    // Recurring detection — runs after every sync; cheap (no LLM).
    try {
      const detected = await detectRecurring(api);
      if (detected > 0) await syncLog(runId, 'info', 'recurring', `Detected ${detected} new recurring series`);
    } catch (e) {
      await syncLog(runId, 'warn', 'recurring', 'Recurring detection error: ' + (e instanceof Error ? e.message : String(e)));
    }

    try {
      const repaired = await reconcileAccountKindsFromSnapshots();
      if (repaired > 0) await syncLog(runId, 'info', 'accounts', `Corrected ${repaired} account kind(s) from balance snapshots`);
    } catch (e) {
      await syncLog(runId, 'warn', 'accounts', 'Account repair error: ' + (e instanceof Error ? e.message : String(e)));
    }

    // Cursor write — last step (no transaction wrapper needed; KV upserts).
    // The cursor is derived from durable committed state (email_imports), not
    // from the newest message merely *seen* this run. A throw before this point
    // leaves the cursor untouched (the next run re-fetches and dedup skips the
    // rows already recorded), and a message that was fetched but failed to be
    // recorded cannot advance the cursor past itself. computeSettledCursor() is
    // a global, monotonic high-water mark; fall back to the per-run seen value
    // only when the table is still empty (e.g. a first run that matched nothing).
    let settledCursor = (await computeSettledCursor()) || newestSeenIso;
    // Stall-skipped emails are unrecorded ON PURPOSE (the next run retries
    // them) — but computeSettledCursor() is MAX(received_at) over recorded
    // rows, which would leap the cursor straight past a skipped email and
    // lose it forever. Cap the cursor just below the oldest stalled email so
    // the next fetch window still contains it; dedup makes the wider window
    // cheap.
    const oldestStalled = stalledReceivedAts.filter(Boolean).sort()[0];
    if (oldestStalled && settledCursor && oldestStalled <= settledCursor) {
      settledCursor = new Date(Date.parse(oldestStalled) - 1000).toISOString();
    }
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_gmail_message_id', ?)`,
      [JSON.stringify(newestSeenId)],
    );
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_synced_at', ?)`,
      [JSON.stringify(settledCursor)],
    );
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_run_status', ?)`,
      [JSON.stringify({ ok: true, ...counts })],
    );
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_run_at', ?)`,
      [JSON.stringify(new Date().toISOString())],
    );
    await syncLog(runId, 'info', 'commit', `Sync complete: ${JSON.stringify(counts)}`);
    if (_lastMalformedSample) {
      await syncLog(runId, 'warn', 'parse',
        `Model returned unparseable output for stage='${_lastMalformedSample.stage}' (len=${_lastMalformedSample.rawLen}). ` +
        `Head: ${JSON.stringify(_lastMalformedSample.rawHead)}`);
    }

    // Auto-promote stable AI categorizations into deterministic rules.
    try {
      const promoted = await promoteAiCategorizationsToRules(runId);
      if (promoted > 0) {
        counts.rulesLearned = promoted;
        // The run status was saved before promotion; record what it learned.
        await db.run(`INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_run_status', ?)`, [JSON.stringify({ ok: true, ...counts })]);
      }
    } catch (e) {
      await syncLog(runId, 'warn', 'promote', 'Rule promotion failed: ' + (e instanceof Error ? e.message : String(e)));
    }

    _emitSync({ kind: 'complete', runId, counts });
    // The run in the app's activity language, so the awareness loop and a
    // scheduled sync (an Automation over budget.sync) leave the same line.
    try {
      api.activity?.note?.('synced', 'the budget ledger from Gmail',
        `${counts.confirmed} confirmed, ${counts.review} for review, ${counts.duplicates} possible duplicates, ${counts.snapshot} balances, ${counts.rulesLearned || 0} rules learned`);
    } catch { /* the journal is optional */ }
    return counts;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await syncLog(runId, 'error', 'fetch', message);
    try {
      await db.run(
        `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_run_status', ?)`,
        [JSON.stringify({ ok: false, error: message, ...counts })],
      );
    } catch { /* best-effort */ }
    _emitSync({ kind: 'error', runId, message, counts });
    throw err;
  }
}

// M80: seed the bundled budget-sync skill into the workspace at .parallx/skills/.
// Idempotent — only writes if the skill file is missing. Best-effort.
async function _seedBudgetSyncSkill(api) {
  try {
    const fsApi = api.requestCapability && api.requestCapability('fs', { scope: 'workspace-files', modes: ['read', 'write'] });
    const folders = api.workspace && api.workspace.workspaceFolders;
    if (!fsApi || !folders || folders.length === 0) return;
    // The fs capability takes file:// URIs under the workspace, not relative paths.
    const root = String(folders[0].uri);
    const at = (rel) => root + (root.endsWith('/') ? '' : '/') + rel;

    const skillRel = '.parallx/skills/budget-sync/SKILL.md';
    if (typeof fsApi.exists === 'function') {
      const present = await fsApi.exists(at(skillRel)).catch(() => false);
      if (present) return;
    }
    if (typeof fsApi.mkdir === 'function') {
      for (const dir of ['.parallx', '.parallx/skills', '.parallx/skills/budget-sync']) {
        try { await fsApi.mkdir(at(dir)); } catch { /* already there */ }
      }
    }
    await fsApi.writeFile(at(skillRel), BUDGET_SYNC_SKILL);
  } catch (err) {
    console.warn('[Budget] skill seed failed:', err && err.message);
  }
}

// ─── M80 chat-tool helpers (data primitives) ──────────────────────────────
//
// These are the dumb data-layer wrappers the budget-sync skill orchestrates.
// Every helper returns a MCP-shaped `{ content: [{ type:'text', text }] }`
// result so the chat agent can read it directly. Read tools never write;
// write tools never read more than they need. The AI does all the
// reasoning — these just persist its decisions.

// Parallx tool results use `{ content: string, isError: boolean }`. MCP's
// `{ content: [{ type, text }], isError }` shape is for outbound MCP servers,
// NOT for tools registered via `api.chat.registerTool`. Returning the MCP
// shape here previously caused Ollama HTTP 400 ("cannot unmarshal array into
// Go struct field ChatRequest.messages.content of type string") when a tool
// result reached the model's message history.
function _toolOk(payload) {
  return { content: JSON.stringify(payload), isError: false };
}
function _toolErr(message) {
  return { content: String(message), isError: true };
}
// A chat tool changed the ledger: the open Budget views redraw.
function afterLedgerWrite(result) {
  if (result && !result.isError) notifyLedgerChanged();
  return result;
}

async function budgetToolGetLastSyncCursor() {
  const lastSyncedAt = await getSyncStateValue('last_synced_at');
  const lastRunAt    = await getSyncStateValue('last_run_at');
  const lastRunStatus = await getSyncStateValue('last_run_status');
  const lastMessageId = await getSyncStateValue('last_gmail_message_id');
  const cfg = api_ref?.workspace?.getConfiguration?.('budget');
  const fallback = cfg ? firstSyncSinceIso(cfg) : isoNDaysAgo(90);
  return _toolOk({
    lastSyncedDate: (typeof lastSyncedAt === 'string' && lastSyncedAt) ? lastSyncedAt : fallback,
    lastMessageId: lastMessageId || null,
    lastRunAt: lastRunAt || null,
    lastRunStatus: lastRunStatus || null,
  });
}

async function budgetToolListAccounts() {
  const rows = await db.all(
    `SELECT id, last_four, kind, display_name, primary_owner, archived
       FROM accounts WHERE archived=0 ORDER BY kind, last_four`,
  );
  return _toolOk({ accounts: rows });
}

async function budgetToolListCategories() {
  const rows = await db.all(
    `SELECT id, name, kind, sort_order, archived
       FROM categories WHERE archived=0 ORDER BY kind, sort_order, name`,
  );
  return _toolOk({ categories: rows });
}

async function budgetToolListCategorizationRules() {
  const rows = await db.all(
    `SELECT r.id, r.pattern, r.match_type, r.category_id, c.name AS category_name,
            r.priority, r.auto_created, r.active
       FROM categorization_rules r
       LEFT JOIN categories c ON c.id = r.category_id
      WHERE r.active = 1
      ORDER BY r.priority DESC, r.pattern`,
  );
  return _toolOk({ rules: rows });
}

async function budgetToolListRecurringSeries() {
  const rows = await db.all(
    `SELECT id, merchant_pattern, typical_amount_cents, period_days,
            category_id, sample_count, last_seen, active
       FROM recurring_series WHERE active=1 ORDER BY last_seen DESC`,
  ).catch(() => []);
  return _toolOk({ series: rows });
}

// The tool functions below read the argument names their schemas DECLARE
// (from, to, merchant, category by name). Several used to read other names
// only (startDate, merchantContains, categoryId), so a filter the model set
// was dropped and the call ran unfiltered, or failed on a "missing" argument
// it had been given (2026-09-28). The older names still work for callers that
// use them.
async function _categoryIdFromArgs(args, idKey, nameKey) {
  if (args[idKey] && typeof args[idKey] === 'string') return { id: args[idKey] };
  const name = args[nameKey];
  if (typeof name !== 'string' || !name.trim()) return { id: null };
  const found = await resolveCategoryByName(name);
  return found ? { id: found.id } : { error: `Unknown category: "${name}". Call budget.listCategories first.` };
}

async function budgetToolQueryTransactions(args = {}) {
  const where = [];
  const params = [];
  const merchant = args.merchant ?? args.merchantContains;
  if (merchant) {
    where.push('LOWER(merchant) LIKE LOWER(?)');
    params.push('%' + String(merchant) + '%');
  }
  const from = args.from ?? args.startDate;
  if (from && isYmd(from)) {
    where.push('transaction_date >= ?'); params.push(from);
  }
  const to = args.to ?? args.endDate;
  if (to && isYmd(to)) {
    where.push('transaction_date <= ?'); params.push(to);
  }
  const category = await _categoryIdFromArgs(args, 'categoryId', 'category');
  if (category.error) return _toolErr(category.error);
  if (category.id) { where.push('category_id = ?'); params.push(category.id); }
  if (args.accountId)  { where.push('account_id = ?');  params.push(args.accountId); }
  // 'all' is the schema's word for "no status filter", not a status.
  if (args.status && args.status !== 'all') { where.push('status = ?'); params.push(args.status); }
  if (args.txType)     { where.push('tx_type = ?');     params.push(args.txType); }
  const limit = Math.max(1, Math.min(500, Number(args.limit) || 100));
  const sql = `SELECT t.id, t.gmail_message_id, t.merchant, t.amount_cents, t.currency,
                      t.card_last_four, t.transaction_date, t.category_id,
                      c.name AS category_name, t.account_id, t.tx_type, t.status,
                      t.ai_confidence, t.notes
                 FROM transactions t
                 LEFT JOIN categories c ON c.id = t.category_id
                ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                ORDER BY t.transaction_date DESC, t.id DESC
                LIMIT ?`;
  const rows = await db.all(sql, [...params, limit]);
  return _toolOk({ transactions: rows, count: rows.length });
}

async function budgetToolGetTransaction(args = {}) {
  const id = args.id;
  if (!id || typeof id !== 'string') return _toolErr('id is required');
  const row = await db.get(
    `SELECT t.*, c.name AS category_name
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.id = ? LIMIT 1`,
    [id],
  );
  if (!row) return _toolErr('Transaction not found: ' + id);
  return _toolOk({ transaction: row });
}

async function budgetToolListPendingReview(args = {}) {
  const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
  const includeResolved = Boolean(args.includeResolved);
  const txRows = await db.all(
    `SELECT t.id, t.gmail_message_id, t.merchant, t.amount_cents, t.currency,
            t.card_last_four, t.transaction_date, t.category_id,
            c.name AS category_name, t.account_id, t.tx_type, t.status,
            t.ai_confidence, t.notes, e.raw_subject, e.raw_snippet
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
      WHERE t.status = 'review'
      ORDER BY t.transaction_date DESC, t.created_at DESC
      LIMIT ?`,
    [limit],
  ).catch(() => []);

  const remaining = Math.max(0, limit - txRows.length);
  const sql = includeResolved
    ? `SELECT * FROM pending_review ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM pending_review WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT ?`;
  const rows = remaining > 0 ? await db.all(sql, [remaining]).catch(() => []) : [];
  const pending = [
    ...txRows.map(r => ({
      kind: 'transaction_review',
      id: r.id,
      reason: r.notes || r.ai_confidence || 'needs review',
      transaction: r,
      email: {
        id: r.gmail_message_id || null,
        subject: r.raw_subject || null,
        snippet: r.raw_snippet || null,
      },
    })),
    ...rows.map(r => ({
      kind: 'email_review',
      id: r.id,
      emailId: r.email_id,
      reason: r.reason,
      partialData: (() => { try { return r.partial_data_json ? JSON.parse(r.partial_data_json) : null; } catch { return null; } })(),
      createdAt: r.created_at,
      resolvedAt: r.resolved_at || null,
      resolution: r.resolution || null,
    })),
  ];
  return _toolOk({ pending, count: pending.length });
}

async function budgetToolListTrash(args = {}) {
  const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
  const rows = await db.all(
    `SELECT id, deleted_at, delete_reason, row_json
       FROM transactions_trash ORDER BY deleted_at DESC LIMIT ?`,
    [limit],
  );
  return _toolOk({
    trash: rows.map(r => {
      let row = null; try { row = JSON.parse(r.row_json); } catch {}
      return { id: r.id, deletedAt: r.deleted_at, reason: r.delete_reason, row };
    }),
    count: rows.length,
  });
}

async function budgetToolPullEmails(api, args = {}) {
  const cfg = api.workspace.getConfiguration('budget');
  const serverId = cfg.get('gmailMcpServerId', 'gmail');
  // M81 rename: list_unread → list_emails. The MCP server still accepts
  // the old name for one release, but prefer the new one so logs and
  // tool-discovery surfaces show the right thing. Falls back to the
  // legacy name if the server hasn't been rebuilt yet.
  const newToolName = `mcp__${serverId}__list_emails`;
  const legacyToolName = `mcp__${serverId}__list_unread`;
  const available = await api.mcp.listTools();
  const has = (n) => Array.isArray(available) && available.some(t => t.name === n);
  let toolName = has(newToolName) ? newToolName : (has(legacyToolName) ? legacyToolName : null);
  if (!toolName) {
    return _toolErr(`Gmail MCP tool '${newToolName}' is not connected. Open Settings → MCP Servers.`);
  }
  let sinceIso = typeof args.since === 'string' ? args.since : null;
  if (!sinceIso) {
    const cur = await getSyncStateValue('last_synced_at');
    sinceIso = (typeof cur === 'string' && cur) ? cur : firstSyncSinceIso(cfg);
  } else {
    sinceIso = normalizeSyncCursorDate(sinceIso) || sinceIso;
  }
  const maxResults = clampSyncMax(args.maxResults ?? args.max ?? 500);
  const pageToken = typeof args.page_token === 'string' && args.page_token
    ? args.page_token
    : (typeof args.pageToken === 'string' && args.pageToken ? args.pageToken : null);
  const gmailQuery = cfg.get('gmailQuery', BUDGET_DEFAULT_GMAIL_QUERY);
  const result = await api.mcp.invokeTool(toolName, {
    since: sinceIso,
    max: maxResults,
    read_state: 'all',
    query: gmailQuery,
    include_body: true,
    ...(pageToken ? { page_token: pageToken } : {}),
  });
  if (result && result.isError) {
    return _toolErr('Gmail MCP error: ' + (result.content?.[0]?.text ?? 'unknown'));
  }
  const payload = result?.content?.[0]?.text ?? '{"messages":[]}';
  let parsed; try { parsed = JSON.parse(payload); } catch (e) {
    return _toolErr('Gmail MCP returned non-JSON: ' + (e instanceof Error ? e.message : String(e)));
  }
  const batch = Array.isArray(parsed) ? parsed
    : (Array.isArray(parsed?.messages) ? parsed.messages : []);
  // Filter out emails we've already processed so the AI doesn't re-classify them.
  const out = [];
  for (const m of batch) {
    if (!m || !m.id) continue;
    const already = await db.get(
      'SELECT 1 AS x FROM email_imports WHERE gmail_message_id = ?', [m.id],
    );
    if (already) continue;
    out.push({
      id: m.id,
      subject: m.subject || '',
      snippet: m.snippet || '',
      body: typeof m.body === 'string' ? m.body : '',
      receivedAt: m.receivedAt || null,
      from: m.from || null,
    });
  }
  return _toolOk({
    emails: out,
    fetched: batch.length,
    newCount: out.length,
    nextPageToken: parsed?.nextPageToken || null,
    sinceUsed: sinceIso,
  });
}

async function budgetToolRecordTransaction(args = {}) {
  if (!args.emailId || typeof args.emailId !== 'string') return _toolErr('emailId is required');
  const txType = String(args.txType || 'purchase').toLowerCase();
  const validTypes = new Set([...TX_TYPE_VALUES, 'refund', 'other']);
  if (!validTypes.has(txType)) return _toolErr('txType must be one of: ' + Array.from(validTypes).join(', '));
  const amountDollars = Number(args.amount);
  if (!Number.isFinite(amountDollars)) return _toolErr('amount must be a number (dollars)');
  let cents = dollarsToCents(amountDollars);
  // Refund: negative purchase. Stored as tx_type='purchase' with negative cents.
  let storedType = txType;
  if (txType === 'refund') { storedType = 'purchase'; cents = -Math.abs(cents); }
  const txDate = isYmd(args.transactionDate) ? args.transactionDate
    : isoLocalDate(args.receivedAt || new Date().toISOString());
  const cardLastFour = (typeof args.cardLastFour === 'string' && /^\d{4}$/.test(args.cardLastFour))
    ? args.cardLastFour : null;

  // Account inference from card_last_four + accountKindHint.
  let accountId = null;
  if (cardLastFour) {
    const kindHint = args.accountKindHint || 'other';
    const acct = await upsertAccount(cardLastFour, kindHint, null);
    accountId = acct ? acct.id : null;
  }

  // Category resolution — caller may pass id directly OR name.
  let categoryId = args.categoryId || null;
  if (!categoryId && args.categoryName) {
    const c = await resolveCategoryByName(args.categoryName);
    if (!c) return _toolErr(`Unknown category: "${args.categoryName}". Call budget.listCategories first.`);
    categoryId = c.id;
  }

  // If caller supplied a ruleId, mark categorization_source as rule.
  let categorizationSource = null;
  let matchedRuleId = null;
  let categorizerModel = null;
  if (args.ruleId) {
    matchedRuleId = args.ruleId;
    categorizationSource = 'rule';
    categorizerModel = 'rule:' + args.ruleId;
  } else if (categoryId) {
    categorizationSource = 'ai';
    categorizerModel = api_ref?.lm?.getActiveModel?.() || 'ai';
  }

  // Ensure email_imports row exists so we never reprocess this id.
  await db.run(
    `INSERT OR IGNORE INTO email_imports
       (gmail_message_id, received_at, raw_subject, raw_snippet,
        is_transaction, is_balance, classifier_model, processed_at, malformed)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      args.emailId, args.receivedAt || new Date().toISOString(),
      args.emailSubject || null, args.emailSnippet || null,
      1, 0, api_ref?.lm?.getActiveModel?.() || 'ai',
      new Date().toISOString(), 0,
    ],
  );

  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO transactions (id, gmail_message_id, merchant, amount_cents, card_last_four,
                               transaction_date, category_id, account_id, tx_type,
                               ai_confidence, extractor_model, categorizer_model, status,
                               categorization_source, matched_rule_id, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, args.emailId, args.merchant || null, cents, cardLastFour,
      txDate, categoryId, accountId, storedType,
      args.confidence || 'high',
      api_ref?.lm?.getActiveModel?.() || 'ai', categorizerModel,
      args.status || 'confirmed',
      categorizationSource, matchedRuleId, args.notes || null,
    ],
  );
  return _toolOk({ id, txType: storedType, amountCents: cents, transactionDate: txDate, categoryId, accountId });
}

async function budgetToolRecordBalance(args = {}) {
  if (!args.emailId || typeof args.emailId !== 'string') return _toolErr('emailId is required');
  const balanceDollars = Number(args.balance);
  if (!Number.isFinite(balanceDollars)) return _toolErr('balance must be a number (dollars)');
  const cents = dollarsToCents(balanceDollars);
  const snapDate = isYmd(args.snapshotDate) ? args.snapshotDate
    : isoLocalDate(args.receivedAt || new Date().toISOString());
  const lastFour = (typeof args.accountLastFour === 'string' && /^\d{4}$/.test(args.accountLastFour))
    ? args.accountLastFour : null;
  const kind = normalizeAccountKind(args.accountKind);

  let accountId = null;
  if (lastFour) {
    const acct = await upsertAccount(lastFour, kind, null, { trustedKind: true });
    accountId = acct ? acct.id : null;
  }

  // Mark the source email so it isn't re-processed.
  await db.run(
    `INSERT OR IGNORE INTO email_imports
       (gmail_message_id, received_at, raw_subject, raw_snippet,
        is_transaction, is_balance, classifier_model, processed_at, malformed)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      args.emailId, args.receivedAt || new Date().toISOString(),
      args.emailSubject || null, args.emailSnippet || null,
      0, 1, api_ref?.lm?.getActiveModel?.() || 'ai',
      new Date().toISOString(), 0,
    ],
  );

  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO balance_snapshots
       (id, gmail_message_id, account_id, account_last_four, kind, balance_cents, snapshot_date)
     VALUES (?,?,?,?,?,?,?)`,
    [id, args.emailId, accountId, lastFour, kind, cents, snapDate],
  );
  return _toolOk({ id, accountId, kind, balanceCents: cents, snapshotDate: snapDate });
}

async function budgetToolFlagForReview(args = {}) {
  if (!args.emailId || typeof args.emailId !== 'string') return _toolErr('emailId is required');
  const reason = String(args.reason || 'ambiguous');
  // Mark the source email so we don't re-pull it.
  await db.run(
    `INSERT OR IGNORE INTO email_imports
       (gmail_message_id, received_at, raw_subject, raw_snippet,
        is_transaction, is_balance, classifier_model, processed_at, malformed)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      args.emailId, args.receivedAt || new Date().toISOString(),
      args.emailSubject || null, args.emailSnippet || null,
      0, 0, api_ref?.lm?.getActiveModel?.() || 'ai',
      new Date().toISOString(), 1,
    ],
  );
  const partial = args.partialData ? JSON.stringify(args.partialData) : null;
  const r = await db.run(
    `INSERT INTO pending_review (email_id, reason, partial_data_json, created_at)
     VALUES (?,?,?,?)`,
    [args.emailId, reason, partial, new Date().toISOString()],
  );
  return _toolOk({ id: r?.lastID ?? null, emailId: args.emailId, reason });
}

async function budgetToolMarkEmailProcessed(args = {}) {
  if (!args.emailId || typeof args.emailId !== 'string') return _toolErr('emailId is required');
  await db.run(
    `INSERT OR IGNORE INTO email_imports
       (gmail_message_id, received_at, raw_subject, raw_snippet,
        is_transaction, is_balance, classifier_model, processed_at, malformed)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      args.emailId, args.receivedAt || new Date().toISOString(),
      args.emailSubject || null, args.emailSnippet || null,
      0, 0, api_ref?.lm?.getActiveModel?.() || 'ai',
      new Date().toISOString(), 0,
    ],
  );
  return _toolOk({ emailId: args.emailId, reason: args.reason || 'non-financial' });
}

async function budgetToolSetSyncCursor(args = {}) {
  const rawDate = args.date ?? args.cursorDate ?? args.lastSyncedDate ?? args.last_synced_at;
  const nextCursor = normalizeSyncCursorDate(rawDate);
  if (!nextCursor) return _toolErr('date must be YYYY-MM-DD or a valid ISO timestamp');

  const previousCursor = await getSyncStateValue('last_synced_at');
  const lastMessageId = args.lastMessageId ?? args.last_gmail_message_id ?? null;

  await db.run(
    `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_synced_at', ?)`,
    [JSON.stringify(nextCursor)],
  );
  await db.run(
    `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_gmail_message_id', ?)`,
    [JSON.stringify(lastMessageId || null)],
  );

  const runId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `cursor-${Date.now()}`;
  const reason = typeof args.reason === 'string' && args.reason.trim()
    ? ` Reason: ${args.reason.trim().slice(0, 500)}`
    : '';
  await syncLog(
    runId,
    'warn',
    'cursor',
    `Manual sync cursor set from ${previousCursor || 'unset'} to ${nextCursor}.${reason}`,
  );

  return _toolOk({
    ok: true,
    previousLastSyncedAt: typeof previousCursor === 'string' ? previousCursor : null,
    lastSyncedAt: nextCursor,
    lastMessageId: lastMessageId || null,
  });
}

async function budgetToolUpdateSyncCursor(args = {}) {
  const lastMessageId = args.lastMessageId ?? args.last_gmail_message_id ?? null;
  const previousCursor = await getSyncStateValue('last_synced_at');
  const savedPrev = typeof previousCursor === 'string' ? previousCursor : null;

  // The cursor VALUE is derived from durable committed state (email_imports),
  // never from the agent-supplied date. Trusting the agent's date is what let a
  // failed/partial attempt "register" a cursor that skipped unrecorded emails.
  // We also only advance when the agent reports the batch fully settled (no
  // errors and no unprocessed remainder), so an out-of-order failure on an
  // older email can't be stepped over by a newer success — if anything failed
  // we hold the cursor and the failed emails are re-offered on the next pull
  // (dedup skips the ones already in email_imports).
  const counts = (args.counts && typeof args.counts === 'object') ? args.counts : null;
  const errorCount = counts ? Number(counts.errors || 0) : 0;
  const unprocessedCount = counts ? Number(counts.unprocessed || counts.pending || 0) : 0;
  const batchComplete = args.batchComplete === true || args.complete === true;
  const batchClean = batchComplete && errorCount === 0 && unprocessedCount === 0;

  let savedCursor = savedPrev;
  let advanced = false;
  let heldBecause = null;

  if (batchClean) {
    const settled = await computeSettledCursor();
    if (settled) {
      const previousMs = savedPrev ? Date.parse(savedPrev) : NaN;
      const nextMs = Date.parse(settled);
      if (!Number.isFinite(previousMs) || nextMs > previousMs) {
        savedCursor = settled;
        advanced = true;
      }
    }
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_synced_at', ?)`,
      [JSON.stringify(savedCursor)],
    );
  } else {
    // Hold the cursor. Surface why so the agent/sync log is honest about it.
    heldBecause = !batchComplete
      ? 'batch not reported complete'
      : `batch had ${errorCount} error(s) / ${unprocessedCount} unprocessed`;
  }

  await db.run(
    `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_gmail_message_id', ?)`,
    [JSON.stringify(lastMessageId)],
  );
  await db.run(
    `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_run_at', ?)`,
    [JSON.stringify(new Date().toISOString())],
  );
  if (counts) {
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_run_status', ?)`,
      [JSON.stringify({ ok: errorCount === 0, ...counts })],
    );
  }
  return _toolOk({ ok: true, lastSyncedDate: savedCursor, lastMessageId, advanced, heldBecause });
}

// The tool's schema speaks snake_case (category, tx_type, transaction_date),
// the way the skill and the model write it; the handler used to read camelCase
// only, so a category or a type the model sent was dropped while the reply
// still said "updated" (found 2026-09-21: rows the user's local model had
// "fixed" were still transfers). Every spelling is read, values are checked,
// and the reply says exactly what changed and whether a rule was learned.
async function budgetToolUpdateTransaction(args = {}) {
  if (!args.id || typeof args.id !== 'string') return _toolErr('id is required');
  const row = await db.get('SELECT id, merchant FROM transactions WHERE id=?', [args.id]);
  if (!row) return _toolErr('Transaction not found: ' + args.id);
  const sets = [];
  const params = [];
  const changed = {};
  if (typeof args.merchant === 'string' && args.merchant.trim()) {
    sets.push('merchant=?'); params.push(args.merchant.trim()); changed.merchant = args.merchant.trim();
  }
  if (args.amount !== undefined && Number.isFinite(Number(args.amount))) {
    sets.push('amount_cents=?'); params.push(dollarsToCents(Number(args.amount))); changed.amount = Number(args.amount);
  }
  // Category by name (the schema's field) or by id (older callers).
  let categoryId;
  if (typeof args.category === 'string' && args.category.trim()) {
    const cat = await resolveCategoryByName(args.category.trim());
    if (!cat) return _toolErr(`Unknown category: "${args.category}". Call budget.listCategories first.`);
    categoryId = cat.id;
  } else if (args.categoryId !== undefined) {
    categoryId = args.categoryId || null;
  }
  if (categoryId !== undefined) {
    sets.push('category_id=?', "categorization_source='manual'", 'matched_rule_id=NULL');
    params.push(categoryId);
    changed.category = categoryId;
  }
  if (args.accountId !== undefined) { sets.push('account_id=?'); params.push(args.accountId || null); changed.account = args.accountId || null; }
  const date = args.transaction_date ?? args.transactionDate;
  if (typeof date === 'string') {
    if (!isYmd(date)) return _toolErr('transaction_date must be YYYY-MM-DD');
    sets.push('transaction_date=?'); params.push(date); changed.transaction_date = date;
  }
  if (typeof args.status === 'string') {
    if (!['confirmed', 'review', 'hidden'].includes(args.status)) return _toolErr('status must be confirmed, review or hidden');
    sets.push('status=?'); params.push(args.status); changed.status = args.status;
  }
  const txType = args.tx_type ?? args.txType;
  if (typeof txType === 'string') {
    const t = txType.trim().toLowerCase();
    const allowed = [...TX_TYPE_VALUES, 'other'];
    if (!allowed.includes(t)) return _toolErr(`tx_type must be one of ${allowed.join(', ')}`);
    sets.push('tx_type=?', "tx_type_source='manual'"); params.push(t); changed.tx_type = t;
  }
  if (typeof args.notes === 'string') { sets.push('notes=?'); params.push(args.notes); changed.notes = true; }
  if (sets.length === 0) return _toolErr('no fields to update (merchant, amount, category, status, notes, tx_type, transaction_date)');
  sets.push('user_overridden=1', 'updated_at=?');
  params.push(new Date().toISOString(), args.id);
  await db.run(`UPDATE transactions SET ${sets.join(', ')} WHERE id=?`, params);
  // A category set by hand teaches the same exact-merchant rule the editor
  // drawer teaches, and the reply says so: nothing is learned in silence.
  let ruleLearned = false;
  const merchant = changed.merchant || row.merchant;
  if (categoryId && merchant) {
    try { await learnRuleFromOverride(merchant, categoryId); ruleLearned = true; } catch { /* best-effort */ }
  }
  return _toolOk({ id: args.id, changed, ruleLearned });
}

async function budgetToolDeleteTransaction(args = {}) {
  if (!args.id || typeof args.id !== 'string') return _toolErr('id is required');
  const row = await db.get('SELECT * FROM transactions WHERE id=?', [args.id]);
  if (!row) return _toolErr('Transaction not found: ' + args.id);
  await db.run(
    `INSERT OR REPLACE INTO transactions_trash (id, row_json, deleted_at, delete_reason)
     VALUES (?,?,?,?)`,
    [args.id, JSON.stringify(row), new Date().toISOString(), args.reason || null],
  );
  await db.run(`DELETE FROM transactions WHERE id=?`, [args.id]);
  return _toolOk({ id: args.id, trashed: true });
}

async function budgetToolRestoreTransaction(args = {}) {
  if (!args.id || typeof args.id !== 'string') return _toolErr('id is required');
  const t = await db.get('SELECT row_json FROM transactions_trash WHERE id=?', [args.id]);
  if (!t) return _toolErr('Not in trash: ' + args.id);
  let row; try { row = JSON.parse(t.row_json); } catch { return _toolErr('Trash row malformed'); }
  const cols = Object.keys(row);
  await db.run(
    `INSERT OR REPLACE INTO transactions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    cols.map(k => row[k]),
  );
  await db.run('DELETE FROM transactions_trash WHERE id=?', [args.id]);
  return _toolOk({ id: args.id, restored: true });
}

async function budgetToolResolveReview(args = {}) {
  if (!args.id) return _toolErr('id is required');
  const id = String(args.id);
  const tx = await db.get(`SELECT id FROM transactions WHERE id=? AND status='review'`, [id]).catch(() => null);
  if (tx) {
    const sets = [];
    const params = [];
    if (typeof args.merchant === 'string') { sets.push('merchant=?'); params.push(args.merchant); }
    if (Number.isFinite(Number(args.amount))) { sets.push('amount_cents=?'); params.push(dollarsToCents(Number(args.amount))); }
    if (typeof args.category === 'string' && args.category.trim()) {
      const cat = await resolveCategoryByName(args.category.trim());
      if (!cat) return _toolErr(`Unknown category: "${args.category}". Call budget.listCategories first.`);
      sets.push('category_id=?'); params.push(cat.id);
    } else if (typeof args.categoryId === 'string') {
      sets.push('category_id=?'); params.push(args.categoryId || null);
    }
    const txType = args.txType ?? args.tx_type;
    if (typeof txType === 'string') { sets.push('tx_type=?', "tx_type_source='manual'"); params.push(txType); }
    if (typeof args.notes === 'string') { sets.push('notes=?'); params.push(args.notes); }
    sets.push("status='confirmed'", 'user_overridden=1', 'updated_at=?');
    params.push(new Date().toISOString(), id);
    await db.run(`UPDATE transactions SET ${sets.join(', ')} WHERE id=?`, params);
    return _toolOk({ id, resolved: true, kind: 'transaction_review' });
  }
  await db.run(
    `UPDATE pending_review SET resolved_at=?, resolution=? WHERE id=?`,
    [new Date().toISOString(), args.resolution || 'resolved', id],
  );
  return _toolOk({ id, resolved: true, kind: 'email_review' });
}

async function budgetToolCreateCategory(args = {}) {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) return _toolErr('name is required');
  const kind = args.kind === 'income' ? 'income' : 'expense';
  const existing = await resolveCategoryByName(name);
  if (existing) return _toolOk({ id: existing.id, name: existing.name, alreadyExisted: true });
  const id = crypto.randomUUID();
  const maxRow = await db.get(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories WHERE kind=?`, [kind]);
  const sortOrder = (Number(maxRow?.m) || 0) + 1;
  await db.run(
    `INSERT INTO categories (id, name, kind, sort_order, archived) VALUES (?,?,?,?,0)`,
    [id, name, kind, sortOrder],
  );
  return _toolOk({ id, name, kind });
}

async function budgetToolRenameCategory(args = {}) {
  const category = await _categoryIdFromArgs(args, 'id', 'from');
  if (category.error) return _toolErr(category.error);
  if (!category.id) return _toolErr('from is required: the current name of the category');
  const newName = typeof args.to === 'string' && args.to.trim() ? args.to : args.newName;
  if (!newName || typeof newName !== 'string') return _toolErr('to is required: the new name');
  await db.run(`UPDATE categories SET name=? WHERE id=?`, [newName.trim(), category.id]);
  return _toolOk({ id: category.id, newName: newName.trim() });
}

async function budgetToolDeleteCategory(args = {}) {
  const category = await _categoryIdFromArgs(args, 'id', 'name');
  if (category.error) return _toolErr(category.error);
  if (!category.id) return _toolErr('name is required: the category to archive');
  // Soft-archive — transactions referencing this category still resolve.
  await db.run(`UPDATE categories SET archived=1 WHERE id=?`, [category.id]);
  return _toolOk({ id: category.id, archived: true });
}

async function budgetToolCreateCategorizationRule(input = {}) {
  const pattern = typeof input.merchant === 'string' && input.merchant.trim() ? input.merchant : input.pattern;
  if (!pattern || typeof pattern !== 'string') return _toolErr('merchant is required: the text the rule matches');
  const category = await _categoryIdFromArgs(input, 'categoryId', 'category');
  if (category.error) return _toolErr(category.error);
  if (!category.id) return _toolErr('category is required: the name of the category');
  const args = { ...input, pattern, categoryId: category.id };
  const matchType = ['exact','contains','regex'].includes(args.matchType) ? args.matchType : 'contains';
  const priority = Math.max(0, Math.min(1000, Number(args.priority) || 100));
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO categorization_rules
       (id, pattern, match_type, category_id, priority, auto_created, active, created_at)
     VALUES (?,?,?,?,?,?,1,?)`,
    [id, args.pattern, matchType, args.categoryId, priority, args.autoCreated ? 1 : 0, new Date().toISOString()],
  );
  return _toolOk({ id, pattern: args.pattern, matchType, categoryId: args.categoryId, priority });
}

async function budgetToolDeleteCategorizationRule(args = {}) {
  if (!args.id || typeof args.id !== 'string') return _toolErr('id is required');
  await db.run(`UPDATE categorization_rules SET active=0 WHERE id=?`, [args.id]);
  return _toolOk({ id: args.id, deactivated: true });
}

// Held inside the module so the data-only tool helpers above can access
// `api.lm.getActiveModel()` without threading `api` through every call site.
// Set in activate(). Reads tolerate it being null until then.
let api_ref = null;

// ─── Read-only chat-tool helpers ───────────────────────────────────────────

function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

async function resolveCategoryByName(name) {
  if (!name || typeof name !== 'string') return null;
  const row = await db.get(
    `SELECT id, name FROM categories WHERE LOWER(name) = LOWER(?) LIMIT 1`,
    [name.trim()],
  );
  return row || null;
}

async function budgetToolSummary(args) {
  const today = ctToday();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const from = isYmd(args.from) ? args.from : monthStart;
  const to = isYmd(args.to) ? args.to : todayStr;

  let categoryId = null, categoryName = null;
  if (args.category) {
    const cat = await resolveCategoryByName(args.category);
    if (!cat) return { ok: false, error: `Unknown category: ${args.category}`, from, to };
    categoryId = cat.id; categoryName = cat.name;
  }

  const where = [`status='confirmed'`, `transaction_date >= ?`, `transaction_date <= ?`,
                 `tx_type IN ('purchase','fee')`];
  const params = [from, to];
  if (categoryId) { where.push(`category_id = ?`); params.push(categoryId); }

  // Net spend uses signed amount_cents — refunds are negative-amount purchases
  // and naturally subtract. We also report spend (positive only) and refunds
  // (positive magnitude) so callers can show "$120 spend, $15 refunded".
  const totals = await db.get(
    `SELECT COALESCE(SUM(amount_cents),0) AS net_cents,
            COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END),0) AS spend_cents,
            COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END),0) AS refund_cents,
            COUNT(*) AS count
       FROM transactions WHERE ${where.join(' AND ')}`,
    params,
  ) || { net_cents: 0, spend_cents: 0, refund_cents: 0, count: 0 };

  const breakdown = await db.all(
    `SELECT COALESCE(c.name, 'Uncategorized') AS category,
            COALESCE(SUM(t.amount_cents), 0) AS net_cents,
            COUNT(*) AS count
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.status='confirmed' AND t.transaction_date >= ? AND t.transaction_date <= ?
        AND t.tx_type IN ('purchase','fee')
        ${categoryId ? 'AND t.category_id = ?' : ''}
      GROUP BY t.category_id
      ORDER BY net_cents DESC`,
    categoryId ? [from, to, categoryId] : [from, to],
  );

  const toDollars = (c) => Math.round(Number(c) || 0) / 100;
  return {
    ok: true,
    from, to,
    category: categoryName,
    spend: toDollars(totals.spend_cents),
    refunds: toDollars(totals.refund_cents),
    net: toDollars(totals.net_cents),
    transactionCount: Number(totals.count) || 0,
    byCategory: breakdown.map(r => ({
      category: r.category,
      spend: toDollars(r.net_cents),
      count: Number(r.count) || 0,
    })),
  };
}

// ─── M86: dashboard widget — Month-to-date spend ────────────────────────────
//
// The budget extension contributes a widget to the user's dashboards through
// `api.dashboard.registerWidgetType` — the reference example of an EXTERNAL
// extension contributing a widget (typeId namespaced under this extension's
// id; activation-order independent; placeholder-safe when budget is disabled).
// Data comes from the same query the `budget.summary` chat tool uses.

const BMTD_STYLE_ID = 'budget-mtd-widget-style';

function _ensureMtdWidgetStyle() {
  if (document.getElementById(BMTD_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = BMTD_STYLE_ID;
  style.textContent = `
    .bmtd { display: flex; flex-direction: column; gap: 8px; height: 100%; cursor: pointer; }
    .bmtd__net { font-size: 26px; font-weight: 700; line-height: 1.1; }
    .bmtd__sub { font-size: 11px; opacity: .75; }
    .bmtd__cats { display: flex; flex-direction: column; gap: 4px; margin-top: 2px; }
    .bmtd__cat { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; font-size: 12px; align-items: baseline; }
    .bmtd__catname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bmtd__catbar { grid-column: 1 / -1; height: 3px; border-radius: 2px; background: var(--px-accent, #7aa2f7); opacity: .55; }
    .bmtd__empty { font-size: 12px; opacity: .7; }
  `;
  document.head.appendChild(style);
  _disposables.push({ dispose() { style.remove(); } });
}

function buildMtdSpendWidget(api) {
  return {
    typeId: 'parallx.budget.mtd-spend',
    displayName: 'Budget: Month to date',
    description: 'Net spend so far this month with your top categories. Click through to the Budget overview.',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    category: 'query',
    defaultSize: { colSpan: 4, rowSpan: 3 },
    defaultConfig: { topCategories: 4 },
    configSchema: {
      fields: {
        topCategories: {
          type: 'number',
          label: 'Top Categories to Show',
          description: '0-8. Zero hides the breakdown.',
        },
      },
    },
    defaultRefreshPolicy: { kind: 'interval', ms: 30 * 60_000 },

    async refresh() {
      if (!db) throw new Error('Budget database not ready. Open the Budget tool once, then refresh.');
      const summary = await budgetToolSummary({});
      if (!summary.ok) throw new Error(summary.error || 'Budget summary failed.');
      return JSON.stringify(summary);
    },

    createWidget(container, ctx) {
      _ensureMtdWidgetStyle();
      container.classList.add('bmtd');
      container.title = 'Open Budget overview';
      container.addEventListener('click', () => {
        api.commands.executeCommand('budget.openDashboard').catch(() => {});
      });

      const fmtUsd = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

      function clampTop(n) {
        const v = Math.floor(Number(n));
        return Number.isFinite(v) ? Math.max(0, Math.min(8, v)) : 4;
      }

      function paintFrom(cached) {
        container.textContent = '';
        let s = null;
        if (cached) { try { s = JSON.parse(cached); } catch { /* malformed */ } }
        if (!s || !s.ok) {
          const empty = document.createElement('div');
          empty.className = 'bmtd__empty';
          empty.textContent = 'No budget data yet. Run a sync, then refresh.';
          container.appendChild(empty);
          return;
        }

        const net = document.createElement('div');
        net.className = 'bmtd__net';
        net.textContent = fmtUsd(s.net);
        container.appendChild(net);

        const sub = document.createElement('div');
        sub.className = 'bmtd__sub';
        const bits = [`${fmtUsd(s.spend)} spend`];
        if (s.refunds > 0) bits.push(`${fmtUsd(s.refunds)} refunded`);
        bits.push(`${s.transactionCount} transaction${s.transactionCount === 1 ? '' : 's'}`);
        sub.textContent = `${s.from} → ${s.to} · ` + bits.join(' · ');
        container.appendChild(sub);

        const top = clampTop(ctx.config && ctx.config.topCategories);
        const cats = Array.isArray(s.byCategory) ? s.byCategory.slice(0, top) : [];
        if (cats.length > 0) {
          const wrap = document.createElement('div');
          wrap.className = 'bmtd__cats';
          const maxSpend = Math.max(...cats.map((c) => Math.abs(c.spend)), 0.01);
          for (const c of cats) {
            const row = document.createElement('div');
            row.className = 'bmtd__cat';
            const name = document.createElement('span');
            name.className = 'bmtd__catname';
            name.textContent = c.category;
            row.appendChild(name);
            const amt = document.createElement('span');
            amt.textContent = fmtUsd(c.spend);
            row.appendChild(amt);
            const bar = document.createElement('span');
            bar.className = 'bmtd__catbar';
            bar.style.width = `${Math.max(4, Math.round((Math.abs(c.spend) / maxSpend) * 100))}%`;
            row.appendChild(bar);
            wrap.appendChild(row);
          }
          container.appendChild(wrap);
        }
      }

      paintFrom(ctx.cachedOutput);
      const sub = ctx.onDidChangeConfig(() => ctx.requestRefresh());
      // Refresh on mount — the ledger changes out-of-band (syncs, edits).
      ctx.requestRefresh();

      return {
        refreshFromCache(cached) { paintFrom(cached); },
        renderError(message) {
          if (!message) { paintFrom(ctx.cachedOutput); return; }
          container.textContent = '';
          const err = document.createElement('div');
          err.className = 'bmtd__empty';
          err.textContent = message;
          container.appendChild(err);
        },
        dispose() { sub.dispose(); },
      };
    },
  };
}

async function budgetToolSearch(args) {
  const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
  const where = [`t.status='confirmed'`];
  const params = [];
  if (typeof args.query === 'string' && args.query.trim()) {
    where.push(`LOWER(t.merchant) LIKE ?`);
    params.push(`%${args.query.trim().toLowerCase()}%`);
  }
  if (isYmd(args.from)) { where.push(`t.transaction_date >= ?`); params.push(args.from); }
  if (isYmd(args.to))   { where.push(`t.transaction_date <= ?`); params.push(args.to); }
  if (args.category) {
    const cat = await resolveCategoryByName(args.category);
    if (!cat) return { ok: false, error: `Unknown category: ${args.category}`, results: [] };
    where.push(`t.category_id = ?`); params.push(cat.id);
  }
  const rows = await db.all(
    `SELECT t.id, t.merchant, t.amount_cents, t.transaction_date, t.card_last_four, c.name AS category
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.transaction_date DESC, t.created_at DESC
      LIMIT ?`,
    [...params, limit],
  );
  return {
    ok: true,
    count: rows.length,
    results: rows.map(r => ({
      id: r.id,
      merchant: r.merchant,
      amount: Math.round(Number(r.amount_cents) || 0) / 100,
      date: r.transaction_date,
      cardLastFour: r.card_last_four,
      category: r.category,
    })),
  };
}

// ─── Chat-tool: set or change a monthly budget ────────────────────────────
//
// "Set my groceries budget to $400" / "increase dining budget by $50".
// The budgets table is keyed (category_id, month_key); we apply the change to
// the current month and let the user copy it forward via the Budgets UI if
// they want it to persist.
async function budgetToolSetBudget(args) {
  const categoryName = (args.category && String(args.category).trim()) || '';
  if (!categoryName) return { ok: false, error: 'category is required' };
  const cat = await resolveCategoryByName(categoryName);
  if (!cat) return { ok: false, error: `Unknown category: ${categoryName}` };

  const dollars = Number(args.amount);
  if (!Number.isFinite(dollars) || dollars < 0) {
    return { ok: false, error: 'amount must be a non-negative number (in dollars)' };
  }
  const cents = Math.round(dollars * 100);

  const monthKey = (typeof args.month === 'string' && /^\d{4}-\d{2}$/.test(args.month))
    ? args.month
    : monthRange().key;

  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO budgets (id, category_id, month_key, limit_cents, rollover_cents, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(category_id, month_key) DO UPDATE SET
       limit_cents = excluded.limit_cents,
       updated_at  = excluded.updated_at`,
    [crypto.randomUUID(), cat.id, monthKey, cents, now, now],
  );  return {
    ok: true,
    category: cat.name,
    month: monthKey,
    limit: dollars,
    message: `Set ${cat.name} budget to $${dollars.toFixed(2)} for ${monthKey}.`,
  };
}

// ─── Chat-tool: create or update a merchant→category rule ─────────────────
//
// "Categorize anything from Spotify as Subscriptions". Rules apply BEFORE
// the LLM categorizer on every future sync, so this is the right place to
// teach the system permanent merchant preferences.
async function budgetToolUpsertRule(args) {
  const merchant = (args.merchant && String(args.merchant).trim()) || '';
  if (!merchant) return { ok: false, error: 'merchant is required' };
  const categoryName = (args.category && String(args.category).trim()) || '';
  if (!categoryName) return { ok: false, error: 'category is required' };
  const cat = await resolveCategoryByName(categoryName);
  if (!cat) return { ok: false, error: `Unknown category: ${categoryName}` };

  const matchType = (args.matchType === 'exact' || args.matchType === 'regex') ? args.matchType : 'contains';
  const now = new Date().toISOString();

  // Reuse the same idempotent upsert path the override-learner uses, except
  // the user's intent is explicit so we mark it user-authored (auto_created=0).
  const existing = await db.get(
    `SELECT id FROM categorization_rules WHERE pattern = ? AND match_type = ? AND active = 1`,
    [merchant, matchType],
  );
  if (existing) {
    await db.run(
      `UPDATE categorization_rules
          SET category_id = ?, priority = 100, auto_created = 0, updated_at = ?
        WHERE id = ?`,
      [cat.id, now, existing.id],
    );
    return {
      ok: true,
      ruleId: existing.id,
      action: 'updated',
      merchant, matchType, category: cat.name,
      message: `Updated rule: "${merchant}" (${matchType}) → ${cat.name}.`,
    };
  }

  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO categorization_rules
       (id, pattern, match_type, category_id, priority, auto_created, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 100, 0, 1, ?, ?)`,
    [id, merchant, matchType, cat.id, now, now],
  );
  return {
    ok: true,
    ruleId: id,
    action: 'created',
    merchant, matchType, category: cat.name,
    message: `Created rule: "${merchant}" (${matchType}) → ${cat.name}.`,
  };
}

// ─── Plan ──────────────────────────────────────────────────────────────────
//
// One page with a switch between its views: the month's budgets, the bills
// (recurring), trends (cash flow and reports) and reconcile.
const PLAN_VIEWS = [
  { value: 'budgets',   label: 'Budgets' },
  { value: 'bills',     label: 'Bills' },
  { value: 'trends',    label: 'Trends' },
  { value: 'reconcile', label: 'Reconcile' },
];
function renderPlanSection(body, api, view) {
  let active = PLAN_VIEWS.some(v => v.value === view) ? view : 'budgets';
  const bar = document.createElement('div');
  bar.className = 'budget-plan-switch';
  const content = document.createElement('div');
  content.className = 'budget-plan-view';
  body.append(bar, content);
  let cleanup = null;
  function mount(v) {
    active = v;
    if (typeof cleanup === 'function') { try { cleanup(); } catch { /* best-effort */ } }
    cleanup = null;
    content.innerHTML = '';
    const parts = [];
    if (v === 'budgets') parts.push(renderBudgetsSection(content, api));
    else if (v === 'bills') parts.push(renderRecurringSection(content, api));
    else if (v === 'trends') {
      const a = document.createElement('div'); const b = document.createElement('div');
      content.append(a, b);
      parts.push(renderCashFlowSection(a, api), renderReportsSection(b, api));
    } else if (v === 'reconcile') parts.push(renderReconcileSection(content, api));
    cleanup = () => { for (const p of parts) if (typeof p === 'function') p(); };
  }
  api.ui.createSegmented(bar, { ariaLabel: 'Plan view', items: PLAN_VIEWS, value: active, onChange: mount });
  mount(active);
  return () => { if (typeof cleanup === 'function') cleanup(); };
}

// ─── activate() ────────────────────────────────────────────────────────────

export async function activate(api, context) {
  if (_activated) return;
  _activated = true;
  _api = api;
  api_ref = api; // M80: shared by the budget.* chat-tool helpers.
  _toolPath = api.env.toolPath;

  if (!api.database) {
    console.error('[Budget] Activation failed — api.database not available (external extension required).');
    return;
  }
  _dbBridge = api.database;

  const ok = await ensureDatabase(api);
  if (!ok) {
    console.error('[Budget] Activation failed — database not ready.');
    return;
  }

  // M80: trash purge — keep soft-deleted transactions 30 days, then drop.
  try {
    await db.run(`DELETE FROM transactions_trash WHERE deleted_at < datetime('now','-30 days')`);
  } catch { /* table may not exist yet on first migration; harmless */ }

  // M80: seed the budget-sync skill into this workspace (idempotent).
  try { await _seedBudgetSyncSkill(api); } catch { /* best-effort */ }

  try {
    await seedDefaultCategoriesIfEmpty();
    await reconcileAccountKindsFromSnapshots();
  } catch (err) {
    console.error('[Budget] Default category seed or account repair failed:', err);
    // Non-fatal: user can create categories manually.
  }

  // ── Per-workspace isolation ──────────────────────────────────────────
  // Each workspace has its own .parallx/data.db (managed by the platform).
  // When the user switches workspaces, the platform closes the old DB and
  // opens the new one — but our extension stays activated. So we must:
  //   1. Re-run migrations on the new workspace's DB.
  //   2. Re-seed defaults if its categories table is empty.
  //   3. Clear in-memory cross-view state so filters from workspace A don't
  //      leak into workspace B.
  if (api.workspace && typeof api.workspace.onDidChangeWorkspace === 'function') {
    _disposables.push(api.workspace.onDidChangeWorkspace(async () => {
      _navState.txFilter = null;
      try {
        const ok = await ensureDatabase(api);
        if (ok) {
          await seedDefaultCategoriesIfEmpty();
          await reconcileAccountKindsFromSnapshots();
          try { await _seedBudgetSyncSkill(api); } catch { /* best-effort */ }
        }
      } catch (err) {
        console.error('[Budget] Workspace switch re-init failed:', err);
      }
    }));
  }

  // ── Sidebar nav view ─────────────────────────────────────────────────
  _disposables.push(api.views.registerViewProvider('budget.nav', {
    createView(container) { return renderSidebarNav(container, api); },
  }));

  // ── Editor provider (single, instanceId-routed) ──────────────────────
  _disposables.push(api.editors.registerEditorProvider('budget.editor', {
    createEditorPane(container, input) { return renderEditorPane(container, api, input); },
  }));

  // ── M86: dashboard widget contribution ───────────────────────────────
  // Month-to-date spend card. Guarded so the extension still loads on
  // shells that predate the `parallx.dashboard` namespace.
  if (api.dashboard && typeof api.dashboard.registerWidgetType === 'function') {
    try {
      _disposables.push(api.dashboard.registerWidgetType(buildMtdSpendWidget(api)));
    } catch (err) {
      console.error('[Budget] Dashboard widget registration failed:', err);
    }
  }

  // ── "Open <section>" commands: all into the one Budget editor ────────
  for (const [commandId, route] of Object.entries(COMMAND_ROUTES)) {
    _disposables.push(api.commands.registerCommand(commandId, () => openBudgetSection(api, route[0], route[1])));
  }
  // Tabs restored from before Budget became one tab ('budget:dashboard', …)
  // close; the one that was in front opens its section in the Budget tab.
  setTimeout(async () => {
    try {
      const old = (api.editors.openEditors || []).filter(e => /:budget\.editor:budget:(?!main$)[\w]+$/.test(e.id));
      if (!old.length) return;
      const front = old.find(e => e.isActive);
      if (front) {
        const [sid, view] = routeForInstanceId(front.id);
        await openBudgetSection(api, sid, view);
      }
      for (const e of old) await api.editors.closeEditor(e.id);
    } catch (err) { console.warn('[Budget] could not fold old tabs into Budget:', err); }
  }, 1500);

  // Budget's own settings live in the app's Settings.
  _disposables.push(api.commands.registerCommand('budget.openSettings', () => api.commands.executeCommand('settings.open', 'schema:Budget')));

  // ── Sync entry-points ────────────────────────────────────────────────
  // Three surfaces share one deterministic engine (budgetSync):
  //   1. `budget.sync` command   — toolbar / "Sync now" / "Run First Sync" buttons.
  //   2. `budget.runSync` chat tool — the single tool the assistant calls when
  //      the user says "sync my budget".
  //   3. Both call triggerSyncFromUI → budgetSync directly (no cron hand-off).

  // 1) Direct command — bypasses the agent for impatient users.
  _disposables.push(api.commands.registerCommand('budget.sync', async () => {
    if (!api.mcp || !api.lm) {
      const missing = [!api.mcp && 'api.mcp', !api.lm && 'api.lm'].filter(Boolean).join(', ');
      await api.window?.showWarningMessage?.(
        `Budget sync requires capabilities not available: ${missing}.`,
      );
      return;
    }
    await triggerSyncFromUI(api);
  }));

  // 1b) Reprocess history — backfill tx_type / account_id on legacy rows.
  _disposables.push(api.commands.registerCommand('budget.reprocessHistory', async () => {
    // The "…" promises a dialog: say what it changes before it changes it.
    const ok = await api.window.showConfirmModal({
      message: 'Reprocess the whole history?',
      detail: 'Rows with no type get one from their email, and rows with no category get one from your rules. Types and categories you set yourself stay as they are.',
      confirmLabel: 'Reprocess',
    });
    if (!ok) return;
    try {
      const r = await reprocessHistory(api);
      const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      const parts = [`${n(r.updated, 'row typed', 'rows typed')}`, `${n(r.categorized, 'row categorized by your rules', 'rows categorized by your rules')}`];
      if (r.errors) parts.push(`${n(r.errors, 'error', 'errors')}`);
      const msg = `Reprocessed: ${parts.join(', ')}.`;
      if (r.ambiguous) {
        const pick = await api.window?.showInformationMessage?.(
          `${msg} ${n(r.ambiguous, 'row still has', 'rows still have')} no type.`, { title: 'Ask the AI' });
        if (pick?.title === 'Ask the AI') await api.commands.executeCommand('budget.reclassifyUntyped');
      } else {
        await api.window?.showInformationMessage?.(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await api.window?.showErrorMessage?.(`Reprocess failed: ${msg}`);
    }
  }));

  // 1b2) Reclassify untyped — dispatch an agent turn that uses the
  // budget.queryTransactions + budget.updateTransaction tools to fill in
  // missing tx_type values. Replaces the bespoke Stage-1 LLM loop deleted
  // in M80; classification now goes through the same skill+tools path as
  // the main sync flow.
  _disposables.push(api.commands.registerCommand('budget.reclassifyUntyped', async () => {
    // One background agent turn, now. (This used to go through the job
    // scheduler with fields it does not accept and no schedule, so it
    // never ran.) The run shows up in Agents › History.
    const text = 'Use budget.queryTransactions with status=confirmed to find transactions whose tx_type is missing (null). For each row, look up the originating email if needed and call budget.updateTransaction to set tx_type to purchase, deposit, transfer, fee, or other. Skip rows where you cannot determine the type with confidence and leave them untyped. Cap the run at 200 rows.';
    try {
      void api.commands.executeCommand('chat.runBackgroundPrompt', { text, origin: 'agent' })
        .catch(async (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          await api.window?.showErrorMessage?.(`Reclassify failed: ${msg}`);
        });
      await api.window?.showInformationMessage?.('Reclassifying untyped transactions in the background. Follow it in Agents › History.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await api.window?.showErrorMessage?.(`Could not start reclassify: ${msg}`);
    }
  }));

  // 1c) CSV export — write all confirmed + review-queue transactions to a file.
  // Uses api.workspace.fs.writeFile directly. The previous version called a
  // non-existent `writeWorkspaceFile`, so it always silently fell through to
  // clipboard.
  _disposables.push(api.commands.registerCommand('budget.exportCsv', async () => {
    try {
      const r = await runCsvExport(api);
      await api.window?.showInformationMessage?.(
        r.writtenTo
          ? `Exported ${r.count} rows to ${r.writtenTo} in your workspace.`
          : `Exported ${r.count} rows to clipboard (${r.reason || 'no workspace folder'}).`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await api.window?.showErrorMessage?.(`CSV export failed: ${msg}`);
    }
  }));

  // 1d) CSV import — opens the Import / Export section. The previous version
  // called showInputBox (which is single-line by design) so any pasted CSV
  // beyond the first row was silently dropped.
  _disposables.push(api.commands.registerCommand('budget.importCsv', async () => {
    await api.commands.executeCommand('budget.openImportExport');
  }));

  // 2) Chat tool — the single deterministic sync entry point for the assistant.
  if (api.chat && typeof api.chat.registerTool === 'function') {
    try {
      _disposables.push(api.chat.registerTool('budget.runSync', {
        description: 'Run a full budget sync: pull recent bank/credit-card emails from Gmail (since the last cursor, or the last 90 days on first run), classify each one, extract and categorize transactions, record balance snapshots, flag ambiguous items for review, and advance the sync cursor. This is a single deterministic operation — do NOT try to orchestrate it with budget.pullEmails / budget.recordTransaction yourself; just call this tool once. Returns the run counts.',
        parameters: { type: 'object', properties: {} },
        requiresConfirmation: false,
        handler: async () => {
          if (_syncInFlight) {
            return { content: 'A budget sync is already running. Wait for it to finish.', isError: true };
          }
          if (!api.mcp || !api.lm) {
            return { content: 'Budget sync needs the language-model and MCP APIs. Connect the Gmail MCP server in Settings → MCP Servers.', isError: true };
          }
          _syncInFlight = true;
          try {
            const counts = await budgetSync(api);
            return {
              content: JSON.stringify({
                ok: true,
                recorded: counts.confirmed,
                flaggedForReview: counts.review,
                balanceSnapshots: counts.snapshot,
                alreadyImported: counts.skipped,
                errors: counts.errors,
                rulesLearned: counts.rulesLearned || 0,
              }),
            };
          } catch (err) {
            return { content: 'Budget sync failed: ' + (err instanceof Error ? err.message : String(err)), isError: true };
          } finally {
            _syncInFlight = false;
          }
        },
      }));

      // Read-only query tools so the chat agent can answer
      // "how much did I spend on dining last month?" style questions.
      _disposables.push(api.chat.registerTool('budget.summary', {
        description: 'Summarise budget totals over a date range, optionally narrowed to one category. Returns spend, refunds, net, and per-category breakdown.',
        parameters: {
          type: 'object',
          properties: {
            from:     { type: 'string', description: 'Start date YYYY-MM-DD (inclusive). Default: first of current month.' },
            to:       { type: 'string', description: 'End date YYYY-MM-DD (inclusive). Default: today.' },
            category: { type: 'string', description: 'Optional category name (case-insensitive).' },
          },
        },
        requiresConfirmation: false,
        handler: async (args) => {
          try {
            const out = await budgetToolSummary(args || {});
            return { content: JSON.stringify(out) };
          } catch (err) {
            return { content: err instanceof Error ? err.message : String(err), isError: true };
          }
        },
      }));

      _disposables.push(api.chat.registerTool('budget.search', {
        description: 'Search confirmed transactions by merchant substring, optional category, and date range. Returns up to 50 matching rows.',
        parameters: {
          type: 'object',
          properties: {
            query:    { type: 'string', description: 'Merchant substring (case-insensitive).' },
            category: { type: 'string', description: 'Optional category name (case-insensitive).' },
            from:     { type: 'string', description: 'Start date YYYY-MM-DD inclusive.' },
            to:       { type: 'string', description: 'End date YYYY-MM-DD inclusive.' },
            limit:    { type: 'integer', description: 'Max rows (default 50, max 200).' },
          },
        },
        requiresConfirmation: false,
        handler: async (args) => {
          try {
            const out = await budgetToolSearch(args || {});
            return { content: JSON.stringify(out) };
          } catch (err) {
            return { content: err instanceof Error ? err.message : String(err), isError: true };
          }
        },
      }));

      // budget.setBudget — "Set my groceries budget to $400"
      _disposables.push(api.chat.registerTool('budget.setBudget', {
        description: 'Set the monthly spending limit (in dollars) for a category. Applies to the current month unless a specific YYYY-MM month is given.',
        parameters: {
          type: 'object',
          required: ['category', 'amount'],
          properties: {
            category: { type: 'string', description: 'Category name (case-insensitive).' },
            amount:   { type: 'number', description: 'Monthly limit in dollars (e.g. 400 for $400).' },
            month:    { type: 'string', description: 'Optional month key YYYY-MM. Defaults to current month.' },
          },
        },
        requiresConfirmation: true,
        handler: async (args) => {
          try {
            const out = await budgetToolSetBudget(args || {});
            notifyLedgerChanged();
            return { content: JSON.stringify(out) };
          } catch (err) {
            return { content: err instanceof Error ? err.message : String(err), isError: true };
          }
        },
      }));

      // budget.addRule — "Always categorize Spotify as Subscriptions"
      _disposables.push(api.chat.registerTool('budget.addRule', {
        description: 'Create or update a rule that automatically assigns transactions matching a merchant pattern to a category. Rules apply on every future sync, before the LLM categorizer.',
        parameters: {
          type: 'object',
          required: ['merchant', 'category'],
          properties: {
            merchant:  { type: 'string', description: 'Merchant text to match (case-insensitive).' },
            category:  { type: 'string', description: 'Target category name.' },
            matchType: { type: 'string', enum: ['contains', 'exact', 'regex'], description: 'Match strategy. Defaults to "contains".' },
          },
        },
        requiresConfirmation: true,
        handler: async (args) => {
          try {
            const out = await budgetToolUpsertRule(args || {});
            notifyLedgerChanged();
            return { content: JSON.stringify(out) };
          } catch (err) {
            return { content: err instanceof Error ? err.message : String(err), isError: true };
          }
        },
      }));

      // ─── M80 budget.* skill tools ────────────────────────────────────
      // Thin data primitives orchestrated by the budget-sync skill. Each
      // handler delegates to a `budgetToolXxx` helper that already returns
      // an MCP-shaped result (`_toolOk` / `_toolErr`).

      // Read tools — no confirmation, no writes.
      _disposables.push(api.chat.registerTool('budget.queryTransactions', {
        description: 'Query the transactions ledger with optional filters: from, to (YYYY-MM-DD), merchant substring, category name, status, tx_type, limit.',
        parameters: {
          type: 'object',
          properties: {
            from:     { type: 'string' },
            to:       { type: 'string' },
            merchant: { type: 'string' },
            category: { type: 'string' },
            status:   { type: 'string', enum: ['confirmed', 'review', 'all'] },
            txType:   { type: 'string', enum: [...TX_TYPE_VALUES, 'other'] },
            limit:    { type: 'integer' },
          },
        },
        requiresConfirmation: false,
        handler: async (args) => budgetToolQueryTransactions(args || {}),
      }));
      _disposables.push(api.chat.registerTool('budget.getTransaction', {
        description: 'Fetch one transaction by id (full row including notes, account, gmail_message_id). Read-only.',
        parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        requiresConfirmation: false,
        handler: async (args) => budgetToolGetTransaction(args || {}),
      }));
      _disposables.push(api.chat.registerTool('budget.listPendingReview', {
        description: 'List transactions awaiting user review (low-confidence, missing merchant, ambiguous category). Read-only.',
        parameters: { type: 'object', properties: { limit: { type: 'integer' } } },
        requiresConfirmation: false,
        handler: async (args) => budgetToolListPendingReview(args || {}),
      }));
      _disposables.push(api.chat.registerTool('budget.listTrash', {
        description: 'List soft-deleted transactions (recoverable for 30 days). Read-only.',
        parameters: { type: 'object', properties: { limit: { type: 'integer' } } },
        requiresConfirmation: false,
        handler: async (args) => budgetToolListTrash(args || {}),
      }));
      _disposables.push(api.chat.registerTool('budget.listCategories', {
        description: 'List active expense + income categories (id, name, kind, sort_order). Read-only.',
        parameters: { type: 'object', properties: {} },
        requiresConfirmation: false,
        handler: async () => budgetToolListCategories(),
      }));
      _disposables.push(api.chat.registerTool('budget.setSyncCursor', {
        description: 'Set or rewind the Gmail budget sync cursor to a specific date/time so the next budget.runSync starts from that point. Use this when the user explicitly wants to go back and re-pull skipped emails. Date-only values start at 00:00:00 UTC for that day.',
        parameters: {
          type: 'object',
          required: ['date'],
          properties: {
            date:                  { type: 'string', description: 'YYYY-MM-DD or ISO timestamp to store as last_synced_at.' },
            reason:                { type: 'string', description: 'Optional short reason recorded in sync_log.' },
            last_gmail_message_id: { type: 'string', description: 'Optional matching Gmail message id. Usually omit when rewinding by date.' },
          },
        },
        requiresConfirmation: true,
        handler: async (args) => budgetToolSetSyncCursor(args || {}),
      }));
      // Edit / delete (write) — soft-deletes to transactions_trash, recoverable.
      _disposables.push(api.chat.registerTool('budget.updateTransaction', {
        description: 'Edit fields on a transaction (merchant, amount, category, status, notes, tx_type, transaction_date).',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id:               { type: 'string' },
            merchant:         { type: 'string' },
            amount:           { type: 'number' },
            category:         { type: 'string' },
            status:           { type: 'string' },
            notes:            { type: 'string' },
            tx_type:          { type: 'string' },
            transaction_date: { type: 'string' },
          },
        },
        requiresConfirmation: true,
        handler: async (args) => afterLedgerWrite(await budgetToolUpdateTransaction(args || {})),
      }));
      _disposables.push(api.chat.registerTool('budget.deleteTransaction', {
        description: 'Soft-delete a transaction (moves it to transactions_trash for 30 days, then auto-purges). Recoverable via budget.restoreTransaction.',
        parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        requiresConfirmation: true,
        handler: async (args) => afterLedgerWrite(await budgetToolDeleteTransaction(args || {})),
      }));
      _disposables.push(api.chat.registerTool('budget.restoreTransaction', {
        description: 'Restore a soft-deleted transaction from trash back to the ledger.',
        parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        requiresConfirmation: true,
        handler: async (args) => afterLedgerWrite(await budgetToolRestoreTransaction(args || {})),
      }));
      _disposables.push(api.chat.registerTool('budget.resolveReview', {
        description: 'Resolve a pending-review row: mark the original transaction confirmed (optionally with edits) and clear it from pending_review.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id:       { type: 'string' },
            merchant: { type: 'string' },
            amount:   { type: 'number' },
            category: { type: 'string' },
            tx_type:  { type: 'string' },
            notes:    { type: 'string' },
          },
        },
        requiresConfirmation: true,
        handler: async (args) => afterLedgerWrite(await budgetToolResolveReview(args || {})),
      }));

      // Taxonomy management — categories and categorization rules.
      _disposables.push(api.chat.registerTool('budget.createCategory', {
        description: 'Create a new expense or income category.',
        parameters: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            kind: { type: 'string', enum: ['expense', 'income'] },
          },
        },
        requiresConfirmation: true,
        handler: async (args) => afterLedgerWrite(await budgetToolCreateCategory(args || {})),
      }));
      _disposables.push(api.chat.registerTool('budget.renameCategory', {
        description: 'Rename a category (existing transactions keep their category_id, just the display name changes).',
        parameters: {
          type: 'object',
          required: ['from', 'to'],
          properties: { from: { type: 'string' }, to: { type: 'string' } },
        },
        requiresConfirmation: true,
        handler: async (args) => afterLedgerWrite(await budgetToolRenameCategory(args || {})),
      }));
      _disposables.push(api.chat.registerTool('budget.deleteCategory', {
        description: 'Archive a category. Transactions previously assigned to it keep their category_id (the category row remains, archived=1). No data is lost.',
        parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        requiresConfirmation: true,
        handler: async (args) => afterLedgerWrite(await budgetToolDeleteCategory(args || {})),
      }));
      _disposables.push(api.chat.registerTool('budget.createCategorizationRule', {
        description: 'Create a merchant→category rule. The agent should add a rule whenever it categorizes a recurring/obvious merchant, so the next sync skips the LLM call and the user does not have to confirm again.',
        parameters: {
          type: 'object',
          required: ['merchant', 'category'],
          properties: {
            merchant:  { type: 'string' },
            category:  { type: 'string' },
            matchType: { type: 'string', enum: ['contains', 'exact', 'regex'] },
          },
        },
        requiresConfirmation: true,
        handler: async (args) => afterLedgerWrite(await budgetToolCreateCategorizationRule(args || {})),
      }));
      _disposables.push(api.chat.registerTool('budget.deleteCategorizationRule', {
        description: 'Delete a categorization rule by id.',
        parameters: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        requiresConfirmation: true,
        handler: async (args) => afterLedgerWrite(await budgetToolDeleteCategorizationRule(args || {})),
      }));
    } catch (e) {
      console.warn('[Budget] chat tool registration failed:', e);
    }
  }

  // 3) Background scheduler — REMOVED in M80. Sync is now skill-driven and
  //    must be user-initiated (the agent prompts for confirmation on writes).
  //    We still clean up the legacy `budget.sync.scheduled` cron job from
  //    earlier versions so nothing keeps firing in the background.
  if (api.cron && typeof api.cron.removeJob === 'function') {
    try { await api.cron.removeJob('budget.sync.scheduled'); } catch { /* ignore — job may not exist */ }
  }

  // 4) M66 link contract — makes `parallx://budget/...` clickable everywhere.
  _registerBudgetLinkContract(api);
}

// ─── M66 link contract ─────────────────────────────────────────────────────

function _registerBudgetLinkContract(api) {
  if (!api.links || typeof api.links.register !== 'function') return;
  _disposables.push(api.links.register({
    segment: 'budget',
    displayName: 'Budget',
    kinds: {
      account: {
        uriTemplate: 'parallx://budget/account/<accountId>',
        description: 'Open the budget Accounts view, scrolled to the given account id.',
        examples: ['parallx://budget/account/42'],
        async open(parsed) {
          const id = parsed.pathSegments[1];
          if (!id) return false;
          try {
            await api.commands.executeCommand('budget.openAccounts');
            return true;
          } catch { return false; }
        },
        async resolveMetadata(parsed) {
          const id = parsed.pathSegments[1];
          return id ? { title: 'Account #' + id, icon: 'credit-card' } : null;
        },
      },
      transaction: {
        uriTemplate: 'parallx://budget/transaction/<txnId>',
        description: 'Open the budget Transactions view, scrolled to the given transaction id.',
        examples: ['parallx://budget/transaction/9001'],
        async open(parsed) {
          const id = parsed.pathSegments[1];
          if (!id) return false;
          try {
            await api.commands.executeCommand('budget.openTransactions');
            return true;
          } catch { return false; }
        },
        async resolveMetadata(parsed) {
          const id = parsed.pathSegments[1];
          return id ? { title: 'Transaction #' + id, icon: 'receipt' } : null;
        },
      },
    },
  }));

  // ── Workspace graph provider ──────────────────────────────────────────
  // Contributes accounts, categories, and a budget root to the workspace
  // graph. Categories edge back to the budget root; accounts edge to the
  // root too — making budget data a single coherent cluster.
  if (api.workspaceGraph && typeof api.workspaceGraph.registerProvider === 'function') {
    _disposables.push(api.workspaceGraph.registerProvider({
      id: 'budget',
      displayName: 'Budget',
      async snapshot() {
        try {
          const rootId = 'budget:root';
          const nodes = [{
            id: rootId,
            label: 'Budget',
            domain: 'budget',
            icon: 'wallet',
            weight: 6,
            meta: { type: 'budget-root' },
          }];
          const edges = [];

          let accounts = [];
          try { accounts = await db.all('SELECT id, last_four, kind, display_name FROM accounts WHERE archived=0'); } catch { accounts = []; }
          for (const a of accounts) {
            const id = 'budget:account:' + a.id;
            nodes.push({
              id,
              label: a.display_name || (a.kind + ' ••' + (a.last_four || '----')),
              domain: 'budget',
              icon: a.kind === 'credit_card' ? 'credit-card' : 'landmark',
              weight: 4,
              meta: { type: 'budget-account', accountId: a.id, kind: a.kind },
            });
            edges.push({ source: rootId, target: id, kind: 'contains' });
          }

          let categories = [];
          try { categories = await db.all('SELECT id, name, color, kind FROM categories WHERE archived=0'); } catch { categories = []; }
          for (const c of categories) {
            const id = 'budget:category:' + c.id;
            nodes.push({
              id,
              label: c.name,
              domain: 'budget',
              color: c.color || undefined,
              weight: 3,
              meta: { type: 'budget-category', categoryId: c.id, kind: c.kind },
            });
            edges.push({ source: rootId, target: id, kind: 'contains' });
          }

          return { nodes, edges };
        } catch (err) {
          console.warn('[Budget] graph snapshot failed:', err);
          return { nodes: [], edges: [] };
        }
      },
    }));
  }
}

// ─── deactivate() ──────────────────────────────────────────────────────────

export async function deactivate() {
  for (const d of _disposables) {
    try { d.dispose(); } catch { /* best-effort */ }
  }
  _disposables.length = 0;
  if (_dbBridge) {
    try { await _dbBridge.close(); } catch { /* best-effort */ }
  }
  _dbBridge = null;
  _api = null;
  _activated = false;
}

// ─── Named exports for unit tests ──────────────────────────────────────────
//
// Pure helpers (no api/db/DOM dependency) are re-exported so they can be
// imported by vitest. The blob-URL loader ignores extra named exports.
export const __testables = {
  computeMonthPlan,
  planScope,
  reviewReason,
  reviewDefaultVerdict,
  reviewRuleFor,
  reviewTypeSource,
  txViewFor,
  txAmountView,
  splitTxNotes,
  txOrigin,
  billDueCount,
  billPaidIn,
  serialRefresh,
  ruleDryRun,
  goalMonthlyNeed,
  computeAllocation,
  budgetStreamWithStall,
  BudgetLmStallError,
  median,
  coefficientOfVariation,
  gapDays,
  addDays,
  inferCadence,
  normalizeSyncCursorDate,
  fetchBudgetGmailMessages,
  parseCsvLine: _parseCsvLine,
  ruleMatchesMerchant,
  looksLikeAccountName,
  classifySubjectTxType,
  normalizeMerchant,
  tryParseModelJson,
  makeDropdown,
  categoryOptions,
  scopedCategoryOptions,
  /**
   * Test seam: inject the host api. activate() sets `_api` in real use, and
   * running the whole activation (database, Gmail, sync) just to exercise a
   * dropdown is not a trade worth making.
   */
  __setApi: (api) => { _api = api; },
  /** Test seam: the database bridge, so a tool function runs against a fake. */
  __setDbBridge: (bridge) => { _dbBridge = bridge; },
  budgetToolQueryTransactions,
  budgetToolRenameCategory,
  budgetToolDeleteCategory,
  budgetToolCreateCategorizationRule,
};
