// Budget extension — main.js (M63 P1 scaffold)
//
// Per the Milestone 63 plan (docs/Parallx_Milestone_63.md):
//   • Single bundled module, no runtime build step.
//   • Per-extension SQLite via api.database. Migrations under ./db/migrations.
//   • Money is INTEGER cents (D3). Dates are 'YYYY-MM-DD' local (D4).
//
// UX shape (matches media-organizer):
//   • Sidebar contributes one nav view ('budget.nav') — a list of sections
//     (Dashboard, Transactions, Review Queue, Sync Log, Categories).
//   • Each section opens as an editor tab via a single editor provider
//     ('budget.editor'), routed by instanceId 'budget:<section>'.
//   • Sync is a command. Until P0 (api.mcp + api.cron) lands, it surfaces a
//     clear notification rather than firing.

// ─── Module-level state ────────────────────────────────────────────────────
let _activated = false;
let _api = null;
let _dbBridge = null;
let _toolPath = '';
const _disposables = [];

// Cross-view nav state — Dashboard sets this when the user clicks a category
// slice; Transactions reads & clears it on next render. Cleared after consumption.
const _navState = { txFilter: null };

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
const DEFAULT_CATEGORIES = [
  { name: 'Groceries',     color: '#22c55e', icon: 'shopping-cart',     kind: 'expense',  sort: 10 },
  { name: 'Dining',        color: '#f97316', icon: 'utensils',          kind: 'expense',  sort: 20 },
  { name: 'Transport',     color: '#3b82f6', icon: 'car',               kind: 'expense',  sort: 30 },
  { name: 'Utilities',     color: '#eab308', icon: 'zap',               kind: 'expense',  sort: 40 },
  { name: 'Shopping',      color: '#ec4899', icon: 'shopping-bag',      kind: 'expense',  sort: 50 },
  { name: 'Health',        color: '#ef4444', icon: 'heart-pulse',       kind: 'expense',  sort: 60 },
  { name: 'Entertainment', color: '#a855f7', icon: 'film',              kind: 'expense',  sort: 70 },
  { name: 'Subscriptions', color: '#06b6d4', icon: 'repeat',            kind: 'expense',  sort: 80 },
  { name: 'Travel',        color: '#0ea5e9', icon: 'plane',             kind: 'expense',  sort: 90 },
  { name: 'Other',         color: '#94a3b8', icon: 'circle-help',       kind: 'expense',  sort: 100 },
  { name: 'Income',        color: '#16a34a', icon: 'banknote-arrow-up', kind: 'income',   sort: 110 },
  { name: 'Transfer',      color: '#64748b', icon: 'arrow-right-left',  kind: 'transfer', sort: 120 },
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

// ─── Section registry ──────────────────────────────────────────────────────
//
// One source of truth for: sidebar nav items, editor routing, and command IDs.
const SECTIONS = [
  { id: 'dashboard',    title: 'Dashboard',    icon: 'layout-dashboard', commandId: 'budget.openDashboard',    blurb: 'Net worth, month-to-date spend & income, top categories.' },
  { id: 'accounts',     title: 'Accounts',     icon: 'wallet',           commandId: 'budget.openAccounts',     blurb: 'Every checking, savings, and credit-card account with its current balance.' },
  { id: 'transactions', title: 'Transactions', icon: 'list',             commandId: 'budget.openTransactions', blurb: 'Searchable, filterable ledger of every imported transaction.' },
  { id: 'budgets',      title: 'Budgets',      icon: 'target',           commandId: 'budget.openBudgets',      blurb: 'Per-category monthly limits with alerts and rollover.' },
  { id: 'recurring',    title: 'Recurring',    icon: 'repeat',           commandId: 'budget.openRecurring',    blurb: 'Detected subscriptions and recurring bills with upcoming-due dates.' },
  { id: 'cashflow',     title: 'Cash Flow',    icon: 'trending-up',      commandId: 'budget.openCashFlow',     blurb: 'Monthly income vs spend with savings rate over time.' },
  { id: 'reports',      title: 'Reports',      icon: 'pie-chart',        commandId: 'budget.openReports',      blurb: 'Top merchants, category breakdown, and trends over a selected window.' },
  { id: 'rules',        title: 'Rules',        icon: 'filter',           commandId: 'budget.openRules',        blurb: 'Merchant→category rules. Auto-learned from your overrides; manually editable.' },
  { id: 'reconcile',    title: 'Reconcile',    icon: 'check-circle',     commandId: 'budget.openReconcile',    blurb: 'Compare your real statement balance against derived activity.' },
  { id: 'categories',   title: 'Categories',   icon: 'tag',              commandId: 'budget.openCategories',   blurb: 'Manage your category list — colour, kind, and monthly limits.' },
  { id: 'reviewQueue',  title: 'Review Queue', icon: 'inbox',            commandId: 'budget.openReviewQueue',  blurb: 'AI-flagged low-confidence imports awaiting your confirmation.' },
  { id: 'syncLog',      title: 'Sync Log',     icon: 'scroll-text',      commandId: 'budget.openSyncLog',      blurb: 'Per-message trace of the last few sync runs.' },
  { id: 'importExport', title: 'Import / Export', icon: 'arrow-up-down',  commandId: 'budget.openImportExport', blurb: 'Paste a CSV to import, or export your full ledger as CSV.' },
];

function sectionByEditorInstanceId(instanceId) {
  // Editor instanceId convention: 'budget:<sectionId>'.
  const idx = (instanceId || '').indexOf(':');
  const sectionId = idx >= 0 ? instanceId.slice(idx + 1) : instanceId || '';
  return SECTIONS.find(s => s.id === sectionId) || null;
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
/* ═══ Sidebar nav ═══ */
.budget-nav {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  color: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground));
  font-family: var(--parallx-fontFamily-ui, system-ui, sans-serif);
  font-size: var(--parallx-fontSize-md, 13px);
  overflow: hidden;
}
.budget-nav-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.budget-nav-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 12px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.budget-nav-row:hover {
  background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
}
.budget-nav-row:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #9333ea);
  outline-offset: -1px;
}
.budget-nav-row .budget-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  color: var(--vscode-icon-foreground, #cccccc);
}
.budget-nav-row .budget-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.budget-nav-footer {
  flex-shrink: 0;
  padding: 8px 10px;
  border-top: 1px solid var(--vscode-panel-border, #2a2a2a);
}
.budget-sync-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  background: var(--vscode-button-secondaryBackground, #3a3a3a);
  color: var(--vscode-button-secondaryForeground, #ccc);
  border: 1px solid var(--vscode-panel-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  font-family: inherit;
  font-size: var(--parallx-fontSize-sm, 11px);
  cursor: pointer;
}
.budget-sync-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground, #4a4a4a);
}
.budget-sync-btn:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #9333ea);
  outline-offset: -1px;
}
.budget-sync-btn .budget-icon { width: 14px; height: 14px; flex: 0 0 14px; }

/* ═══ Editor pane ═══ */
.budget-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: var(--parallx-fontFamily-ui, system-ui, sans-serif);
  font-size: var(--parallx-fontSize-md, 13px);
  box-sizing: border-box;
}
.budget-editor-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 24px 12px 24px;
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
}
.budget-editor-header .budget-icon {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  color: var(--vscode-icon-foreground, #cccccc);
}
.budget-editor-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.2px;
}
.budget-editor-body {
  flex: 1;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.budget-editor-blurb {
  margin: 0;
  font-size: var(--parallx-fontSize-md, 13px);
  color: var(--vscode-descriptionForeground, #888);
  line-height: 1.55;
  max-width: 680px;
}
.budget-editor-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--vscode-input-background, rgba(255,255,255,0.04));
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
  border-radius: var(--parallx-radius-sm, 3px);
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground, #888);
  width: fit-content;
}

/* ═══ Section toolbar + content ═══ */
.budget-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.budget-toolbar .spacer { flex: 1; }
.budget-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--vscode-button-secondaryBackground, #3a3a3a);
  color: var(--vscode-button-secondaryForeground, #ccc);
  border: 1px solid var(--vscode-panel-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  font-family: inherit;
  font-size: var(--parallx-fontSize-sm, 11px);
  cursor: pointer;
}
.budget-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #4a4a4a); }
.budget-btn[aria-pressed="true"] {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border-color: transparent;
}
.budget-btn:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #9333ea);
  outline-offset: -1px;
}
.budget-btn-primary {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border-color: transparent;
}
.budget-btn-primary:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
.budget-btn .budget-icon { width: 12px; height: 12px; flex: 0 0 12px; }

.budget-input, .budget-select {
  background: var(--vscode-input-background, rgba(255,255,255,0.04));
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #555));
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 4px 8px;
  font: inherit;
  font-size: var(--parallx-fontSize-sm, 11px);
}
.budget-input:focus, .budget-select:focus {
  outline: 1px solid var(--vscode-focusBorder, #9333ea);
  outline-offset: -1px;
}

.budget-empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--vscode-descriptionForeground, #888);
  font-size: var(--parallx-fontSize-sm, 11px);
}

/* Tables */
.budget-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--parallx-fontSize-sm, 11px);
}
.budget-table th, .budget-table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
  vertical-align: middle;
}
.budget-table thead th {
  position: sticky;
  top: 0;
  background: var(--vscode-editor-background);
  font-weight: 600;
  color: var(--vscode-descriptionForeground, #aaa);
  font-size: 10px;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}
.budget-table tbody tr:hover {
  background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
}
.budget-amount { font-variant-numeric: tabular-nums; text-align: right; }
.budget-amount.negative { color: var(--vscode-charts-red, #f87171); }
.budget-amount.positive { color: var(--vscode-charts-green, #4ade80); }

.budget-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  background: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #fff);
}
.budget-pill.review  { background: #b45309; color: #fff; }
.budget-pill.confirmed { background: #166534; color: #fff; }
.budget-pill.hidden  { background: #4b5563; color: #ddd; }
.budget-pill.deleted { background: #7f1d1d; color: #fff; }
.budget-pill.low    { background: #b45309; color: #fff; }
.budget-pill.medium { background: #4d6b80; color: #fff; }
.budget-pill.high   { background: #166534; color: #fff; }

.budget-cat-swatch {
  display: inline-block;
  width: 10px; height: 10px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}

/* Dashboard cards */
.budget-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.budget-card {
  padding: 12px 14px;
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
  border-radius: var(--parallx-radius-md, 4px);
  background: var(--vscode-input-background, rgba(255,255,255,0.02));
}
.budget-card-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--vscode-descriptionForeground, #888);
}
.budget-card-value {
  font-size: 20px;
  font-weight: 600;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.budget-card-sub {
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #888);
  margin-top: 2px;
}

.budget-cat-bar {
  display: grid;
  grid-template-columns: 110px 1fr 70px;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  font-size: var(--parallx-fontSize-sm, 11px);
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
  gap: 10px;
}
.budget-section h3 {
  margin: 0;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--vscode-descriptionForeground, #888);
  font-weight: 600;
}

.budget-log-row {
  font-family: var(--parallx-fontFamily-mono, ui-monospace, Consolas, monospace);
  font-size: 11px;
}
.budget-log-row.warn  td { color: #f59e0b; }
.budget-log-row.error td { color: #f87171; }

/* ═══ Month picker ═══ */
.budget-month-picker {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  background: var(--vscode-input-background, rgba(255,255,255,0.04));
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
  border-radius: var(--parallx-radius-sm, 3px);
  font-size: var(--parallx-fontSize-sm, 11px);
}
.budget-month-picker .label {
  min-width: 110px;
  text-align: center;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.budget-month-picker button {
  background: transparent;
  border: none;
  color: var(--vscode-icon-foreground, #ccc);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 2px;
  font: inherit;
}
.budget-month-picker button:hover {
  background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
}
.budget-month-picker button:disabled { opacity: .35; cursor: default; }

/* ═══ Account card ═══ */
.budget-account-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--vscode-panel-border, #2a2a2a);
  border-radius: var(--parallx-radius-md, 4px);
  background: var(--vscode-input-background, rgba(255,255,255,0.02));
  min-width: 200px;
  flex: 1 1 220px;
}
.budget-account-card .acct-kind {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--vscode-descriptionForeground, #888);
}
.budget-account-card .acct-name {
  font-size: 13px;
  font-weight: 600;
}
.budget-account-card .acct-balance {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  margin-top: 4px;
}
.budget-account-card .acct-balance.credit { color: var(--vscode-charts-orange, #fb923c); }
.budget-account-card .acct-meta {
  font-size: 10px;
  color: var(--vscode-descriptionForeground, #888);
}
.budget-accounts-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

/* ═══ SVG chart accents ═══ */
.budget-chart-bar { cursor: pointer; transition: opacity 0.12s; }
.budget-chart-bar:hover { opacity: .82; }
.budget-chart-grid { stroke: var(--vscode-panel-border, #2a2a2a); stroke-width: 1; opacity: .4; }
.budget-chart-axis { fill: var(--vscode-descriptionForeground, #888); font-size: 10px; }
.budget-chart-legend {
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #aaa);
  margin-top: 6px;
}
.budget-chart-legend .swatch {
  display: inline-block;
  width: 10px; height: 10px;
  border-radius: 2px;
  margin-right: 5px;
  vertical-align: middle;
}

`;
  document.head.appendChild(style);
}

function makeIcon(api, name, size) {
  if (!api.icons || typeof api.icons.createIconHtml !== 'function' || !api.icons.hasIcon(name)) return '';
  return api.icons.createIconHtml(name, size || 16);
}

// ─── Sidebar nav view ──────────────────────────────────────────────────────
function renderSidebarNav(container, api) {
  injectStyles();

  const root = document.createElement('div');
  root.className = 'budget-nav';

  const list = document.createElement('div');
  list.className = 'budget-nav-list';
  root.appendChild(list);

  for (const section of SECTIONS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'budget-nav-row';
    row.title = section.title;

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

    row.addEventListener('click', () => {
      api.commands.executeCommand(section.commandId).catch(err => {
        console.error('[Budget] open section failed:', err);
      });
    });

    list.appendChild(row);
  }

  // Footer: Sync now
  const footer = document.createElement('div');
  footer.className = 'budget-nav-footer';
  const syncBtn = document.createElement('button');
  syncBtn.type = 'button';
  syncBtn.className = 'budget-sync-btn';
  const syncIconHtml = makeIcon(api, 'refresh-cw', 14);
  if (syncIconHtml) {
    const ic = document.createElement('span');
    ic.className = 'budget-icon';
    ic.innerHTML = syncIconHtml;
    syncBtn.appendChild(ic);
  }
  const syncLabel = document.createElement('span');
  syncLabel.textContent = 'Sync now';
  syncBtn.appendChild(syncLabel);
  syncBtn.addEventListener('click', () => {
    api.commands.executeCommand('budget.sync').catch(err => {
      console.error('[Budget] sync failed:', err);
    });
  });
  footer.appendChild(syncBtn);
  root.appendChild(footer);

  container.appendChild(root);
  return {
    dispose() { try { container.removeChild(root); } catch { /* container already gone */ } },
  };
}

// ─── Editor pane — placeholder shell ───────────────────────────────────────
//
// Single editor provider. Routes by instanceId 'budget:<sectionId>'.
// Each section will be replaced by a real renderer in P2+.
function renderEditorPane(container, api, input) {
  injectStyles();
  const section = sectionByEditorInstanceId(input && input.id);

  const el = document.createElement('div');
  el.className = 'budget-editor';

  // Header
  const header = document.createElement('div');
  header.className = 'budget-editor-header';
  const headerIconHtml = makeIcon(api, section ? section.icon : 'wallet', 20);
  if (headerIconHtml) {
    const ic = document.createElement('span');
    ic.className = 'budget-icon';
    ic.innerHTML = headerIconHtml;
    header.appendChild(ic);
  }
  const heading = document.createElement('h2');
  heading.className = 'budget-editor-title';
  heading.textContent = section ? section.title : 'Budget';
  header.appendChild(heading);
  el.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'budget-editor-body';

  // Per-section renderer. Each returns nothing; mutates `body` directly.
  // When a section is unknown we fall back to a tiny placeholder.
  const sectionId = section ? section.id : '';
  let cleanup = null;
  if (sectionId === 'dashboard')          cleanup = renderDashboardSection(body, api);
  else if (sectionId === 'accounts')      cleanup = renderAccountsSection(body, api);
  else if (sectionId === 'transactions')  cleanup = renderTransactionsSection(body, api);
  else if (sectionId === 'budgets')       cleanup = renderBudgetsSection(body, api);
  else if (sectionId === 'recurring')     cleanup = renderRecurringSection(body, api);
  else if (sectionId === 'cashflow')      cleanup = renderCashFlowSection(body, api);
  else if (sectionId === 'reports')       cleanup = renderReportsSection(body, api);
  else if (sectionId === 'rules')         cleanup = renderRulesSection(body, api);
  else if (sectionId === 'reconcile')     cleanup = renderReconcileSection(body, api);
  else if (sectionId === 'categories')    cleanup = renderCategoriesSection(body, api);
  else if (sectionId === 'reviewQueue')   cleanup = renderReviewQueueSection(body, api);
  else if (sectionId === 'syncLog')       cleanup = renderSyncLogSection(body, api);
  else if (sectionId === 'importExport')  cleanup = renderImportExportSection(body, api);
  else {
    const tag = document.createElement('div');
    tag.className = 'budget-editor-tag';
    tag.textContent = 'Unknown section';
    body.appendChild(tag);
  }

  el.appendChild(body);

  container.appendChild(el);
  return {
    dispose() {
      try { if (typeof cleanup === 'function') cleanup(); } catch { /* best-effort */ }
      try { container.removeChild(el); } catch { /* container already gone */ }
    },
  };
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

function makeButton(label, opts) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'budget-btn' + (opts && opts.primary ? ' budget-btn-primary' : '');
  if (opts && opts.iconHtml) {
    const ic = document.createElement('span');
    ic.className = 'budget-icon';
    ic.innerHTML = opts.iconHtml;
    b.appendChild(ic);
  }
  const span = document.createElement('span');
  span.textContent = label;
  b.appendChild(span);
  if (opts && typeof opts.onClick === 'function') b.addEventListener('click', opts.onClick);
  return b;
}

function emptyState(msg) {
  const div = document.createElement('div');
  div.className = 'budget-empty';
  div.textContent = msg;
  return div;
}

// ─── Month / date math ─────────────────────────────────────────────────────

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Returns {start, end, label, year, month0} for a YYYY-MM key.
// Defaults to the current local month when called with no arg.
function monthRange(yearMonth) {
  let y, m0;
  if (yearMonth && /^\d{4}-\d{2}$/.test(yearMonth)) {
    y = Number(yearMonth.slice(0, 4));
    m0 = Number(yearMonth.slice(5, 7)) - 1;
  } else {
    const d = new Date();
    y = d.getFullYear();
    m0 = d.getMonth();
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
  const today = new Date();
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

// Idempotent upsert by last_four (which is UNIQUE in the schema).
// Returns the account row { id, last_four, kind, display_name }.
async function upsertAccount(last4, kindHint, displayHint) {
  if (!last4 || !/^\d{4}$/.test(String(last4))) return null;
  const kind = normalizeAccountKind(kindHint);
  const existing = await db.get('SELECT id, last_four, kind, display_name FROM accounts WHERE last_four=?', [last4]);
  if (existing) {
    // Promote 'other' to a known kind once we learn it; never overwrite a known kind.
    if (existing.kind === 'other' && kind !== 'other') {
      await db.run('UPDATE accounts SET kind=?, updated_at=? WHERE id=?',
        [kind, new Date().toISOString(), existing.id]);
      existing.kind = kind;
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

function renderTransactionsSection(body, api) {
  // Pop any nav-state that Dashboard may have set so this view filters
  // immediately on open. Cleared after first read.
  const incoming = _navState.txFilter;
  _navState.txFilter = null;

  let statusFilter = 'all';                    // all | confirmed | review | hidden
  let typeFilter   = (incoming && incoming.type) || 'spend'; // spend | all | purchase | refund | deposit | transfer | cc_payment | fee
  let monthKey     = (incoming && incoming.monthKey) || monthRange().key;
  let categoryId   = (incoming && incoming.categoryId) || null;
  let accountId    = (incoming && incoming.accountId)  || null;
  let search       = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'budget-toolbar';

  // Month picker
  const picker = makeMonthPicker(monthKey, (k) => { monthKey = k; void refresh(); });
  toolbar.appendChild(picker.el);

  // Search
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'budget-input';
  searchInput.placeholder = 'Search merchant…';
  searchInput.style.minWidth = '160px';
  searchInput.addEventListener('input', () => { search = searchInput.value; void refresh(); });
  toolbar.appendChild(searchInput);

  // Type filter
  const typeSel = document.createElement('select');
  typeSel.className = 'budget-select';
  for (const [v, lbl] of [
    ['spend', 'Spend (purchases + refunds + fees)'],
    ['all', 'All types'],
    ['purchase', 'Purchases'],
    ['refund', 'Refunds'],
    ['deposit', 'Deposits'],
    ['transfer', 'Transfers'],
    ['cc_payment', 'CC payments'],
    ['fee', 'Fees'],
  ]) {
    const o = document.createElement('option'); o.value = v; o.textContent = lbl;
    if (v === typeFilter) o.selected = true;
    typeSel.appendChild(o);
  }
  typeSel.addEventListener('change', () => { typeFilter = typeSel.value; void refresh(); });
  toolbar.appendChild(typeSel);

  // Account filter (populated async)
  const acctSel = document.createElement('select');
  acctSel.className = 'budget-select';
  toolbar.appendChild(acctSel);

  // Status filter buttons
  const statusFilters = document.createElement('div');
  statusFilters.style.display = 'flex';
  statusFilters.style.gap = '4px';
  for (const f of [['all','All'],['confirmed','Confirmed'],['review','Review'],['hidden','Hidden']]) {
    const b = makeButton(f[1], { onClick: () => { statusFilter = f[0]; updatePressed(); void refresh(); } });
    b.dataset.filter = f[0];
    statusFilters.appendChild(b);
  }
  function updatePressed() {
    statusFilters.querySelectorAll('button').forEach(btn => {
      btn.setAttribute('aria-pressed', btn.dataset.filter === statusFilter ? 'true' : 'false');
    });
  }
  updatePressed();

  toolbar.appendChild(statusFilters);
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  toolbar.appendChild(makeButton('Refresh', {
    iconHtml: makeIcon(api, 'refresh-cw', 12),
    onClick: () => void refresh(),
  }));
  toolbar.appendChild(makeButton('Sync now', {
    primary: true,
    iconHtml: makeIcon(api, 'refresh-cw', 12),
    onClick: () => api.commands.executeCommand('budget.sync').finally(() => refresh()),
  }));
  body.appendChild(toolbar);

  // Active-filter pills (e.g. category came from Dashboard click)
  const pillsBar = document.createElement('div');
  pillsBar.style.display = 'flex'; pillsBar.style.gap = '6px'; pillsBar.style.flexWrap = 'wrap';
  body.appendChild(pillsBar);

  const tableWrap = document.createElement('div');
  body.appendChild(tableWrap);

  let alive = true;
  let categoriesList = [];
  let accountsList = [];

  async function populateAccountSelect() {
    accountsList = await db.all('SELECT id, last_four, kind, display_name FROM accounts WHERE archived=0 ORDER BY kind, last_four').catch(() => []);
    acctSel.innerHTML = '';
    const allOpt = document.createElement('option'); allOpt.value = ''; allOpt.textContent = 'All accounts';
    acctSel.appendChild(allOpt);
    for (const a of accountsList) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = (a.display_name || defaultAccountName(a.kind, a.last_four));
      if (accountId === a.id) o.selected = true;
      acctSel.appendChild(o);
    }
    acctSel.value = accountId || '';
    acctSel.onchange = () => { accountId = acctSel.value || null; void refresh(); };
  }

  function rebuildPills() {
    pillsBar.innerHTML = '';
    if (categoryId) {
      const cat = categoriesList.find(c => c.id === categoryId);
      const pill = document.createElement('span'); pill.className = 'budget-pill';
      pill.style.background = (cat && cat.color) || '#666';
      pill.style.cursor = 'pointer';
      pill.title = 'Click to clear category filter';
      pill.textContent = (cat ? cat.name : 'category') + ' ✕';
      pill.addEventListener('click', () => { categoryId = null; rebuildPills(); void refresh(); });
      pillsBar.appendChild(pill);
    }
  }

  async function refresh() {
    if (!alive) return;
    tableWrap.innerHTML = '';
    const range = monthRange(monthKey);
    const where = [];
    const params = [];

    where.push('t.transaction_date >= ?'); params.push(range.start);
    where.push('t.transaction_date <= ?'); params.push(range.end);

    if (statusFilter !== 'all') { where.push('t.status = ?'); params.push(statusFilter); }
    else { where.push("t.status IN ('confirmed','review','hidden')"); }

    if (typeFilter === 'spend') {
      where.push("(t.tx_type IS NULL OR t.tx_type IN ('purchase','refund','fee'))");
    } else if (typeFilter !== 'all') {
      where.push('t.tx_type = ?'); params.push(typeFilter);
    }

    if (categoryId) { where.push('t.category_id = ?'); params.push(categoryId); }
    if (accountId)  { where.push('t.account_id = ?'); params.push(accountId); }
    if (search.trim()) { where.push('LOWER(t.merchant) LIKE ?'); params.push(`%${search.trim().toLowerCase()}%`); }

    const sql = `
      SELECT t.id, t.merchant, t.amount_cents, t.transaction_date, t.status, t.ai_confidence,
             t.card_last_four, t.tx_type, t.category_id, t.account_id,
             c.name AS category_name, c.color AS category_color,
             a.kind AS account_kind, a.display_name AS account_name, a.last_four AS account_last_four
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN accounts   a ON a.id = t.account_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.transaction_date DESC, t.created_at DESC
       LIMIT 500`;
    let rows;
    try { rows = await db.all(sql, params); }
    catch (e) { tableWrap.appendChild(emptyState('Query error: ' + (e instanceof Error ? e.message : String(e)))); return; }

    // Cache categories for the per-row dropdown.
    try { categoriesList = await db.all(`SELECT id, name, color FROM categories WHERE archived=0 ORDER BY sort_order, name`); }
    catch { categoriesList = []; }
    rebuildPills();

    if (!rows || rows.length === 0) { tableWrap.appendChild(emptyState('No transactions in this view.')); return; }

    const table = document.createElement('table');
    table.className = 'budget-table';
    table.innerHTML = `
      <thead><tr>
        <th>Date</th><th>Merchant</th><th>Type</th><th>Account</th><th>Category</th>
        <th style="text-align:right">Amount</th>
        <th>Status</th><th>Conf</th>
      </tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      const cents = Number(r.amount_cents) || 0;
      const amtCls = cents < 0 ? 'positive' : (cents > 0 ? 'negative' : '');

      const tdDate = document.createElement('td'); tdDate.textContent = fmtDate(r.transaction_date);
      const tdMerch = document.createElement('td'); tdMerch.textContent = r.merchant || '—';
      const tdType = document.createElement('td');
      tdType.innerHTML = r.tx_type ? `<span class="budget-pill">${escHtml(r.tx_type)}</span>` : '<span class="budget-pill hidden">—</span>';
      const tdAcct = document.createElement('td');
      tdAcct.textContent = r.account_name || (r.account_last_four ? '••' + r.account_last_four : (r.card_last_four ? '••' + r.card_last_four : '—'));
      tdAcct.style.fontSize = '11px';
      tdAcct.style.color = 'var(--vscode-descriptionForeground, #aaa)';

      const tdCat = document.createElement('td');
      const sel = document.createElement('select'); sel.className = 'budget-select';
      const blank = document.createElement('option'); blank.value = ''; blank.textContent = '— uncategorized —';
      sel.appendChild(blank);
      for (const c of categoriesList) {
        const o = document.createElement('option'); o.value = c.id; o.textContent = c.name;
        if (r.category_id === c.id) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', async () => {
        try {
          await db.run(
            `UPDATE transactions SET category_id=?, user_overridden=1, updated_at=? WHERE id=?`,
            [sel.value || null, new Date().toISOString(), r.id],
          );
          // Learn from override: future imports for this merchant skip the LLM.
          if (sel.value && r.merchant) {
            try { await learnRuleFromOverride(r.merchant, sel.value); } catch { /* best-effort */ }
          }
        } catch (e) {
          await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e)));
          await refresh();
        }
      });
      tdCat.appendChild(sel);

      const tdAmt = document.createElement('td');
      tdAmt.className = 'budget-amount ' + amtCls;
      tdAmt.textContent = fmtMoney(cents);
      const tdStatus = document.createElement('td');
      tdStatus.innerHTML = `<span class="budget-pill ${escHtml(r.status)}">${escHtml(r.status)}</span>`;
      const tdConf = document.createElement('td');
      tdConf.innerHTML = r.ai_confidence ? `<span class="budget-pill ${escHtml(r.ai_confidence)}">${escHtml(r.ai_confidence)}</span>` : '';

      tr.appendChild(tdDate); tr.appendChild(tdMerch); tr.appendChild(tdType); tr.appendChild(tdAcct);
      tr.appendChild(tdCat); tr.appendChild(tdAmt); tr.appendChild(tdStatus); tr.appendChild(tdConf);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  void populateAccountSelect().then(refresh);
  return () => { alive = false; };
}

// ─── Section: Review Queue ─────────────────────────────────────────────────

function renderReviewQueueSection(body, api) {
  const toolbar = document.createElement('div');
  toolbar.className = 'budget-toolbar';
  const refreshBtn = makeButton('Refresh', {
    iconHtml: makeIcon(api, 'refresh-cw', 12),
    onClick: () => void refresh(),
  });
  toolbar.appendChild(refreshBtn);
  body.appendChild(toolbar);

  const tableWrap = document.createElement('div');
  body.appendChild(tableWrap);

  let alive = true;
  let categories = [];

  async function refresh() {
    if (!alive) return;
    tableWrap.innerHTML = '';
    try {
      categories = await db.all(
        `SELECT id, name, color FROM categories WHERE archived=0 AND kind='expense' ORDER BY sort_order`,
      );
    } catch { categories = []; }

    let rows;
    try {
      rows = await db.all(`
        SELECT t.id, t.merchant, t.amount_cents, t.transaction_date, t.ai_confidence, t.category_id,
               t.card_last_four, e.raw_subject, e.raw_snippet
          FROM transactions t
          LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
         WHERE t.status = 'review'
         ORDER BY t.transaction_date DESC, t.created_at DESC
         LIMIT 200`);
    } catch (e) {
      tableWrap.appendChild(emptyState('Query error: ' + (e instanceof Error ? e.message : String(e))));
      return;
    }
    if (!rows || rows.length === 0) {
      tableWrap.appendChild(emptyState('Nothing to review — review-queue is empty.'));
      return;
    }

    const table = document.createElement('table');
    table.className = 'budget-table';
    table.innerHTML = `
      <thead><tr>
        <th>Date</th><th>Merchant / Email</th>
        <th style="text-align:right">Amount</th>
        <th>Category</th><th>Actions</th>
      </tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      const tdDate = document.createElement('td'); tdDate.textContent = fmtDate(r.transaction_date); tr.appendChild(tdDate);
      const tdMerch = document.createElement('td');
      const mTitle = document.createElement('div'); mTitle.textContent = r.merchant || '— (parse failed)'; tdMerch.appendChild(mTitle);
      if (r.raw_subject) {
        const sub = document.createElement('div');
        sub.style.fontSize = '10px';
        sub.style.color = 'var(--vscode-descriptionForeground, #888)';
        sub.textContent = r.raw_subject;
        tdMerch.appendChild(sub);
      }
      tr.appendChild(tdMerch);
      const tdAmt = document.createElement('td'); tdAmt.className = 'budget-amount';
      tdAmt.textContent = fmtMoney(r.amount_cents);
      tr.appendChild(tdAmt);

      const tdCat = document.createElement('td');
      const sel = document.createElement('select');
      sel.className = 'budget-select';
      const blank = document.createElement('option'); blank.value = ''; blank.textContent = '— pick category —';
      sel.appendChild(blank);
      for (const c of categories) {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.name;
        if (r.category_id === c.id) o.selected = true;
        sel.appendChild(o);
      }
      tdCat.appendChild(sel);
      tr.appendChild(tdCat);

      const tdAct = document.createElement('td');
      tdAct.style.display = 'flex'; tdAct.style.gap = '4px';
      const confirmBtn = makeButton('Confirm', {
        primary: true,
        onClick: async () => {
          try {
            await db.run(
              `UPDATE transactions SET status='confirmed', user_overridden=1, category_id=?, updated_at=? WHERE id=?`,
              [sel.value || null, new Date().toISOString(), r.id],
            );
            if (sel.value && r.merchant) {
              try { await learnRuleFromOverride(r.merchant, sel.value); } catch { /* best-effort */ }
            }
            await refresh();
          } catch (e) {
            await api.window?.showErrorMessage?.('Confirm failed: ' + (e instanceof Error ? e.message : String(e)));
          }
        },
      });
      const hideBtn = makeButton('Hide', {
        onClick: async () => {
          try {
            await db.run(
              `UPDATE transactions SET status='hidden', user_overridden=1, updated_at=? WHERE id=?`,
              [new Date().toISOString(), r.id],
            );
            await refresh();
          } catch (e) {
            await api.window?.showErrorMessage?.('Hide failed: ' + (e instanceof Error ? e.message : String(e)));
          }
        },
      });
      tdAct.appendChild(confirmBtn);
      tdAct.appendChild(hideBtn);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }
  void refresh();
  return () => { alive = false; };
}

// ─── Section: Sync Log ─────────────────────────────────────────────────────

function renderSyncLogSection(body, api) {
  const toolbar = document.createElement('div');
  toolbar.className = 'budget-toolbar';
  toolbar.appendChild(makeButton('Refresh', {
    iconHtml: makeIcon(api, 'refresh-cw', 12),
    onClick: () => void refresh(),
  }));
  toolbar.appendChild(makeButton('Sync now', {
    primary: true,
    iconHtml: makeIcon(api, 'refresh-cw', 12),
    onClick: () => api.commands.executeCommand('budget.sync').finally(() => refresh()),
  }));
  toolbar.appendChild(makeButton('Reprocess history', {
    onClick: () => api.commands.executeCommand('budget.reprocessHistory').finally(() => refresh()),
  }));
  toolbar.appendChild(makeButton('Export CSV', {
    onClick: () => api.commands.executeCommand('budget.exportCsv'),
  }));
  toolbar.appendChild(makeButton('Import CSV', {
    onClick: () => api.commands.executeCommand('budget.importCsv').finally(() => refresh()),
  }));
  body.appendChild(toolbar);

  const statusEl = document.createElement('div');
  statusEl.className = 'budget-card';
  statusEl.style.maxWidth = '520px';
  body.appendChild(statusEl);

  const tableWrap = document.createElement('div');
  body.appendChild(tableWrap);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    statusEl.innerHTML = '';
    let last;
    try { last = await getSyncStateValue('last_run_status'); } catch { last = null; }
    const lastSyncedAt = await getSyncStateValue('last_synced_at');
    const lab = document.createElement('div'); lab.className = 'budget-card-label'; lab.textContent = 'Last run';
    const val = document.createElement('div'); val.className = 'budget-card-value';
    val.style.fontSize = '13px';
    if (last && typeof last === 'object') {
      if (last.ok) {
        val.textContent = `OK — confirmed ${last.confirmed||0}, review ${last.review||0}, snapshots ${last.snapshot||0}`;
      } else {
        val.textContent = 'Failed: ' + (last.error || 'unknown');
        val.style.color = 'var(--vscode-charts-red, #f87171)';
      }
    } else {
      val.textContent = 'No sync recorded yet';
    }
    const sub = document.createElement('div'); sub.className = 'budget-card-sub';
    sub.textContent = lastSyncedAt ? `Cursor: ${lastSyncedAt}` : 'No cursor — first sync will fetch the configured window.';
    statusEl.appendChild(lab); statusEl.appendChild(val); statusEl.appendChild(sub);

    tableWrap.innerHTML = '';
    let rows;
    try {
      rows = await db.all(`SELECT id, run_id, ts, level, msg_id, stage, message FROM sync_log ORDER BY id DESC LIMIT 200`);
    } catch (e) {
      tableWrap.appendChild(emptyState('Query error: ' + (e instanceof Error ? e.message : String(e))));
      return;
    }
    if (!rows || rows.length === 0) { tableWrap.appendChild(emptyState('Sync log is empty.')); return; }
    const table = document.createElement('table');
    table.className = 'budget-table';
    table.innerHTML = `<thead><tr><th>Time</th><th>Level</th><th>Stage</th><th>Message</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.className = 'budget-log-row ' + (r.level || 'info');
      tr.innerHTML = `
        <td>${escHtml(String(r.ts).slice(11, 19))}</td>
        <td>${escHtml(r.level)}</td>
        <td>${escHtml(r.stage || '')}</td>
        <td>${escHtml(r.message)}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }
  void refresh();
  return () => { alive = false; };
}

// ─── Section: Categories ───────────────────────────────────────────────────

function renderCategoriesSection(body, api) {
  const toolbar = document.createElement('div');
  toolbar.className = 'budget-toolbar';
  toolbar.appendChild(makeButton('Refresh', {
    iconHtml: makeIcon(api, 'refresh-cw', 12),
    onClick: () => void refresh(),
  }));
  toolbar.appendChild(makeButton('Add category', {
    primary: true,
    iconHtml: makeIcon(api, 'plus', 12),
    onClick: async () => {
      const name = (await api.window?.showInputBox?.({ prompt: 'Category name', placeHolder: 'e.g. Pets' }) || '').trim();
      if (!name) return;
      try {
        const lastSort = (await db.get('SELECT MAX(sort_order) AS m FROM categories'))?.m ?? 0;
        await db.run(
          `INSERT INTO categories (id, name, color, icon, kind, sort_order) VALUES (?,?,?,?,?,?)`,
          [crypto.randomUUID(), name, '#94a3b8', 'circle', 'expense', Number(lastSort) + 10],
        );
        await refresh();
      } catch (e) {
        await api.window?.showErrorMessage?.('Add failed: ' + (e instanceof Error ? e.message : String(e)));
      }
    },
  }));
  body.appendChild(toolbar);

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
        <th>Name</th><th>Color</th><th>Kind</th>
        <th style="text-align:right">Monthly limit</th>
        <th style="text-align:right">Tx</th><th>Status</th><th>Actions</th>
      </tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');

      // Name (click to rename)
      const tdName = document.createElement('td');
      const swatch = document.createElement('span'); swatch.className = 'budget-cat-swatch'; swatch.style.background = r.color || '#888';
      const nameSpan = document.createElement('span'); nameSpan.textContent = r.name;
      tdName.appendChild(swatch); tdName.appendChild(nameSpan);
      tr.appendChild(tdName);

      // Color
      const tdColor = document.createElement('td');
      const colorInput = document.createElement('input');
      colorInput.type = 'color'; colorInput.value = r.color || '#94a3b8';
      colorInput.style.width = '32px'; colorInput.style.height = '20px'; colorInput.style.border = 'none'; colorInput.style.background = 'transparent'; colorInput.style.cursor = 'pointer';
      colorInput.addEventListener('change', async () => {
        try { await db.run(`UPDATE categories SET color=? WHERE id=?`, [colorInput.value, r.id]); swatch.style.background = colorInput.value; }
        catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
      });
      tdColor.appendChild(colorInput);
      tr.appendChild(tdColor);

      // Kind
      const tdKind = document.createElement('td');
      const kindSel = document.createElement('select'); kindSel.className = 'budget-select';
      for (const k of ['expense','income','transfer']) {
        const o = document.createElement('option'); o.value = k; o.textContent = k;
        if (r.kind === k) o.selected = true;
        kindSel.appendChild(o);
      }
      kindSel.addEventListener('change', async () => {
        try { await db.run(`UPDATE categories SET kind=? WHERE id=?`, [kindSel.value, r.id]); }
        catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
      });
      tdKind.appendChild(kindSel);
      tr.appendChild(tdKind);

      // Monthly limit (editable)
      const tdLimit = document.createElement('td'); tdLimit.className = 'budget-amount';
      const limitInput = document.createElement('input');
      limitInput.type = 'number'; limitInput.step = '1'; limitInput.min = '0';
      limitInput.className = 'budget-input';
      limitInput.style.width = '90px'; limitInput.style.textAlign = 'right';
      limitInput.placeholder = '—';
      limitInput.value = r.monthly_limit_cents != null ? String(Math.round(r.monthly_limit_cents) / 100) : '';
      limitInput.addEventListener('change', async () => {
        const v = limitInput.value.trim();
        const cents = v === '' ? null : Math.round(Number(v) * 100);
        if (cents !== null && !Number.isFinite(cents)) { limitInput.value = r.monthly_limit_cents != null ? String(r.monthly_limit_cents/100) : ''; return; }
        try { await db.run(`UPDATE categories SET monthly_limit_cents=? WHERE id=?`, [cents, r.id]); }
        catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
      });
      tdLimit.appendChild(limitInput);
      tr.appendChild(tdLimit);

      // Tx count
      const tdTx = document.createElement('td'); tdTx.className = 'budget-amount'; tdTx.textContent = String(r.tx_count || 0);
      tr.appendChild(tdTx);

      // Status pill
      const tdStat = document.createElement('td');
      tdStat.innerHTML = r.archived ? '<span class="budget-pill hidden">archived</span>' : '<span class="budget-pill confirmed">active</span>';
      tr.appendChild(tdStat);

      // Actions
      const tdAct = document.createElement('td'); tdAct.style.display = 'flex'; tdAct.style.gap = '4px';
      tdAct.appendChild(makeButton('Rename', {
        onClick: async () => {
          const next = (await api.window?.showInputBox?.({ prompt: 'New name', value: r.name }) || '').trim();
          if (!next || next === r.name) return;
          try { await db.run(`UPDATE categories SET name=? WHERE id=?`, [next, r.id]); await refresh(); }
          catch (e) { await api.window?.showErrorMessage?.('Rename failed: ' + (e instanceof Error ? e.message : String(e))); }
        },
      }));
      tdAct.appendChild(makeButton(r.archived ? 'Unarchive' : 'Archive', {
        onClick: async () => {
          try { await db.run(`UPDATE categories SET archived=? WHERE id=?`, [r.archived ? 0 : 1, r.id]); await refresh(); }
          catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
        },
      }));
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }
  void refresh();
  return () => { alive = false; };
}

// ─── Section: Dashboard ────────────────────────────────────────────────────

function renderDashboardSection(body, api) {
  let monthKey = monthRange().key;

  const toolbar = document.createElement('div');
  toolbar.className = 'budget-toolbar';
  const picker = makeMonthPicker(monthKey, (k) => { monthKey = k; void refresh(); });
  toolbar.appendChild(picker.el);
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  toolbar.appendChild(makeButton('Refresh', {
    iconHtml: makeIcon(api, 'refresh-cw', 12),
    onClick: () => void refresh(),
  }));
  toolbar.appendChild(makeButton('Sync now', {
    primary: true,
    iconHtml: makeIcon(api, 'refresh-cw', 12),
    onClick: () => api.commands.executeCommand('budget.sync').finally(() => refresh()),
  }));
  body.appendChild(toolbar);

  const cards = document.createElement('div'); cards.className = 'budget-cards'; body.appendChild(cards);
  const accountsRow = document.createElement('div'); accountsRow.className = 'budget-accounts-row'; body.appendChild(accountsRow);
  const catSection = document.createElement('div'); catSection.className = 'budget-section'; body.appendChild(catSection);
  const recentSection = document.createElement('div'); recentSection.className = 'budget-section'; body.appendChild(recentSection);

  // Onboarding banner — shown only on first run, before any sync.
  const onboardingWrap = document.createElement('div');
  body.insertBefore(onboardingWrap, cards);

  async function renderOnboarding() {
    onboardingWrap.innerHTML = '';
    // Skip if user has any confirmed transactions OR has run a sync.
    const txCount = await db.get(`SELECT COUNT(*) AS n FROM transactions`).catch(() => ({ n: 0 }));
    const lastSync = await getSyncStateValue('last_synced_at');
    if ((Number(txCount?.n) || 0) > 0 || lastSync) return;

    const card = document.createElement('div');
    card.className = 'budget-card';
    card.style.maxWidth = '720px';
    card.style.padding = '16px';
    card.style.background = 'var(--vscode-textBlockQuote-background, rgba(127,127,127,0.08))';
    card.innerHTML = `
      <div class="budget-card-label" style="font-size:13px;text-transform:uppercase;letter-spacing:0.05em;">Welcome to Budget</div>
      <div class="budget-card-value" style="font-size:18px;margin-top:4px;">Let's get you set up in 3 steps.</div>
      <ol style="margin:12px 0 0 20px;padding:0;line-height:1.7;">
        <li><b>Connect Gmail</b> — make sure the <code>gmail-mcp-server</code> tool is enabled in Settings → MCP Servers.</li>
        <li><b>Run your first sync</b> — pull transaction emails and let the AI categorize them.</li>
        <li><b>Set budgets</b> — give yourself monthly limits per category in the Budgets tab.</li>
      </ol>
      <div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;"></div>`;
    const actions = card.lastElementChild;
    const syncBtn = makeButton('Run first sync', {
      primary: true,
      onClick: async () => {
        syncBtn.setAttribute('disabled', 'true');
        try {
          await api.commands.executeCommand('budget.sync');
        } finally {
          await refresh();
        }
      },
    });
    actions.appendChild(syncBtn);
    actions.appendChild(makeButton('Open budgets', {
      onClick: () => api.commands.executeCommand('budget.openBudgets'),
    }));
    actions.appendChild(makeButton('Dismiss', {
      onClick: async () => {
        // Mark dismissed by writing a sync_state flag — uses the existing per-workspace store.
        try {
          await db.run(
            `INSERT INTO sync_state (key, value, updated_at) VALUES ('onboarding_dismissed', '1', ?)
             ON CONFLICT(key) DO UPDATE SET value='1', updated_at=excluded.updated_at`,
            [new Date().toISOString()],
          );
        } catch { /* table may not exist on first ever run; ignore */ }
        onboardingWrap.innerHTML = '';
      },
    }));
    // Honour dismissed flag.
    const dismissed = await getSyncStateValue('onboarding_dismissed').catch(() => null);
    if (dismissed) return;
    onboardingWrap.appendChild(card);
  }

  let alive = true;
  async function refresh() {
    if (!alive) return;
    cards.innerHTML = ''; accountsRow.innerHTML = ''; catSection.innerHTML = ''; recentSection.innerHTML = '';
    await renderOnboarding();

    const range = monthRange(monthKey);

    // ── Net worth: latest balance per account; sum cash, credit shows -owed.
    let acctRows = [];
    try { acctRows = await db.all('SELECT * FROM v_account_latest_balance ORDER BY kind, last_four'); } catch { acctRows = []; }
    let cash = 0, credit = 0; // credit balance is negative (amount owed)
    for (const a of acctRows) {
      const bal = Number(a.latest_balance_cents) || 0;
      if (a.kind === 'credit_card') credit += bal;
      else cash += bal;
    }
    const netWorth = cash + credit;

    // ── MTD totals (filtered to the month picker)
    const sumRow = await db.get(
      `SELECT COALESCE(SUM(CASE WHEN tx_type='purchase' AND amount_cents > 0 THEN amount_cents ELSE 0 END),0) AS spend,
              COALESCE(SUM(CASE WHEN tx_type='refund'   AND amount_cents < 0 THEN -amount_cents ELSE 0 END),0) AS refunds,
              COALESCE(SUM(CASE WHEN tx_type='fee'      AND amount_cents > 0 THEN amount_cents ELSE 0 END),0) AS fees,
              COALESCE(SUM(CASE WHEN tx_type='deposit'                          THEN ABS(amount_cents) ELSE 0 END),0) AS income,
              COUNT(*) AS n
         FROM transactions
        WHERE status='confirmed' AND transaction_date >= ? AND transaction_date <= ?`,
      [range.start, range.end],
    ) || { spend: 0, refunds: 0, fees: 0, income: 0, n: 0 };

    const totalSpend = (Number(sumRow.spend) || 0) - (Number(sumRow.refunds) || 0) + (Number(sumRow.fees) || 0);
    const totalIncome = Number(sumRow.income) || 0;
    const savings = totalIncome - totalSpend;
    const savingsRate = totalIncome > 0 ? Math.round((savings / totalIncome) * 100) : 0;

    const reviewCnt = (await db.get(`SELECT COUNT(*) AS n FROM transactions WHERE status='review'`)) || { n: 0 };
    const lastSyncedAt = await getSyncStateValue('last_synced_at');

    cards.appendChild(makeCard('Net worth', fmtMoney(netWorth),
      acctRows.length ? `${acctRows.length} accounts` : 'No accounts yet'));
    cards.appendChild(makeCard('Spend (' + range.label + ')', fmtMoney(totalSpend), `${sumRow.n} confirmed transactions`));
    cards.appendChild(makeCard('Income (' + range.label + ')', fmtMoney(totalIncome), ''));
    cards.appendChild(makeCard('Savings rate', totalIncome > 0 ? `${savingsRate}%` : '—',
      totalIncome > 0 ? `Saved ${fmtMoney(savings)}` : 'Sync to see income'));
    cards.appendChild(makeCard('Review queue', String(reviewCnt.n || 0),
      reviewCnt.n ? 'Items awaiting confirmation' : 'All clear'));
    cards.appendChild(makeCard('Last sync',
      lastSyncedAt ? fmtDate(lastSyncedAt) + ' ' + String(lastSyncedAt).slice(11,16) : 'Never', ''));

    // ── Account strip (compact account cards)
    if (acctRows.length > 0) {
      const h = document.createElement('h3'); h.textContent = 'Accounts'; accountsRow.appendChild(h);
      const strip = document.createElement('div'); strip.className = 'budget-accounts-row'; strip.style.marginTop = '4px';
      for (const a of acctRows) {
        strip.appendChild(buildAccountCard(a, api));
      }
      accountsRow.appendChild(strip);
    }

    // ── Spend by category (interactive donut + bar list)
    const catHeader = document.createElement('h3'); catHeader.textContent = 'Spend by category'; catSection.appendChild(catHeader);
    let catRows;
    try {
      catRows = await db.all(`
        SELECT c.id, c.name, c.color, c.monthly_limit_cents,
               COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS spend
          FROM categories c
          LEFT JOIN transactions t
            ON t.category_id = c.id AND t.status='confirmed'
           AND t.tx_type IN ('purchase','fee')
           AND t.transaction_date >= ? AND t.transaction_date <= ?
         WHERE c.archived = 0 AND c.kind='expense'
         GROUP BY c.id
         ORDER BY spend DESC, c.sort_order ASC`,
        [range.start, range.end],
      );
    } catch { catRows = []; }

    if (!catRows || catRows.length === 0) {
      catSection.appendChild(emptyState('No category data yet.'));
    } else {
      const totalCatSpend = catRows.reduce((acc, r) => acc + (Number(r.spend) || 0), 0);
      const layout = document.createElement('div');
      layout.style.display = 'flex'; layout.style.gap = '20px'; layout.style.flexWrap = 'wrap'; layout.style.alignItems = 'flex-start';

      if (totalCatSpend > 0) {
        const slices = catRows.filter(r => (Number(r.spend) || 0) > 0);
        const donut = buildDonut(slices, totalCatSpend);
        layout.appendChild(donut);
        bindDonutClicks(donut, slices, (slice) => {
          _navState.txFilter = { categoryId: slice.id, monthKey, type: 'spend' };
          api.commands.executeCommand('budget.openTransactions').catch(() => {});
        });
      }

      const bars = document.createElement('div');
      bars.style.flex = '1 1 320px'; bars.style.minWidth = '280px';
      const max = Math.max(1, ...catRows.map(r => Number(r.spend) || 0));
      for (const r of catRows) {
        const spend = Number(r.spend) || 0;
        const pct = Math.round((spend / max) * 100);
        const limit = Number(r.monthly_limit_cents) || 0;
        const overLimit = limit > 0 && spend > limit;
        const row = document.createElement('div');
        row.className = 'budget-cat-bar';
        row.style.cursor = 'pointer';
        row.title = 'Click to view transactions in ' + r.name;
        row.innerHTML = `
          <div><span class="budget-cat-swatch" style="background:${escHtml(r.color || '#888')}"></span>${escHtml(r.name)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${escHtml(overLimit ? '#ef4444' : (r.color || '#888'))}"></div></div>
          <div class="amt">${escHtml(fmtMoney(spend))}${limit ? ' / ' + escHtml(fmtMoney(limit)) : ''}</div>`;
        row.addEventListener('click', () => {
          _navState.txFilter = { categoryId: r.id, monthKey, type: 'spend' };
          api.commands.executeCommand('budget.openTransactions').catch(() => {});
        });
        bars.appendChild(row);
      }
      layout.appendChild(bars);
      catSection.appendChild(layout);
    }

    // ── Recent activity (latest 8 transactions)
    const recHeader = document.createElement('h3'); recHeader.textContent = 'Recent activity'; recentSection.appendChild(recHeader);
    let recent;
    try {
      recent = await db.all(`
        SELECT t.id, t.merchant, t.amount_cents, t.transaction_date, t.tx_type, t.card_last_four,
               c.name AS category_name, c.color AS category_color
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.status='confirmed'
         ORDER BY t.transaction_date DESC, t.created_at DESC
         LIMIT 8`);
    } catch { recent = []; }
    if (!recent || recent.length === 0) {
      recentSection.appendChild(emptyState('No transactions yet — run a sync.'));
    } else {
      const tbl = document.createElement('table'); tbl.className = 'budget-table';
      tbl.innerHTML = `<thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th style="text-align:right">Amount</th></tr></thead>`;
      const tb = document.createElement('tbody');
      for (const r of recent) {
        const tr = document.createElement('tr');
        const cents = Number(r.amount_cents) || 0;
        const amtCls = cents < 0 ? 'positive' : (cents > 0 ? 'negative' : '');
        tr.innerHTML = `
          <td>${escHtml(fmtDate(r.transaction_date))}</td>
          <td>${escHtml(r.merchant || '—')}</td>
          <td>${r.category_name ? `<span class="budget-cat-swatch" style="background:${escHtml(r.category_color || '#888')}"></span>${escHtml(r.category_name)}` : '<span style="color:var(--vscode-descriptionForeground,#888)">—</span>'}</td>
          <td class="budget-amount ${amtCls}">${escHtml(fmtMoney(cents))}</td>`;
        tb.appendChild(tr);
      }
      tbl.appendChild(tb);
      recentSection.appendChild(tbl);
    }
  }
  void refresh();
  return () => { alive = false; };
}

function buildAccountCard(a, api) {
  const card = document.createElement('div'); card.className = 'budget-account-card';
  const kind = document.createElement('div'); kind.className = 'acct-kind';
  kind.textContent = a.kind === 'credit_card' ? 'Credit card' : (a.kind === 'checking' ? 'Checking' : (a.kind === 'savings' ? 'Savings' : 'Account'));
  const name = document.createElement('div'); name.className = 'acct-name';
  name.textContent = a.display_name || defaultAccountName(a.kind, a.last_four);
  const bal = document.createElement('div'); bal.className = 'acct-balance';
  if (a.kind === 'credit_card') bal.classList.add('credit');
  bal.textContent = a.latest_balance_cents != null ? fmtMoney(a.latest_balance_cents) : '—';
  const meta = document.createElement('div'); meta.className = 'acct-meta';
  meta.textContent = a.latest_balance_date ? `As of ${a.latest_balance_date}` : 'No balance reported yet';
  card.appendChild(kind); card.appendChild(name); card.appendChild(bal); card.appendChild(meta);
  card.style.cursor = 'pointer';
  card.title = 'Click to view transactions on this account';
  card.addEventListener('click', () => {
    _navState.txFilter = { accountId: a.account_id || a.id, monthKey: monthRange().key, type: 'all' };
    api.commands.executeCommand('budget.openTransactions').catch(() => {});
  });
  return card;
}

function makeCard(label, value, sub) {
  const c = document.createElement('div'); c.className = 'budget-card';
  const l = document.createElement('div'); l.className = 'budget-card-label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'budget-card-value'; v.textContent = value;
  c.appendChild(l); c.appendChild(v);
  if (sub) { const s = document.createElement('div'); s.className = 'budget-card-sub'; s.textContent = sub; c.appendChild(s); }
  return c;
}

// ─── Section: Accounts ─────────────────────────────────────────────────────

function renderAccountsSection(body, api) {
  const toolbar = document.createElement('div'); toolbar.className = 'budget-toolbar';
  toolbar.appendChild(makeButton('Refresh', { iconHtml: makeIcon(api, 'refresh-cw', 12), onClick: () => void refresh() }));
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  toolbar.appendChild(makeButton('Sync now', {
    primary: true,
    iconHtml: makeIcon(api, 'refresh-cw', 12),
    onClick: () => api.commands.executeCommand('budget.sync').finally(() => refresh()),
  }));
  body.appendChild(toolbar);

  const summaryRow = document.createElement('div'); summaryRow.className = 'budget-cards'; body.appendChild(summaryRow);
  const cardsRow = document.createElement('div'); cardsRow.className = 'budget-accounts-row'; body.appendChild(cardsRow);
  const tableWrap = document.createElement('div'); body.appendChild(tableWrap);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    summaryRow.innerHTML = ''; cardsRow.innerHTML = ''; tableWrap.innerHTML = '';

    let acctRows = [];
    try { acctRows = await db.all('SELECT * FROM v_account_latest_balance ORDER BY kind, last_four'); } catch { acctRows = []; }

    if (acctRows.length === 0) {
      tableWrap.appendChild(emptyState('No accounts detected yet — run a sync to import balances from your daily account summary emails.'));
      return;
    }

    let cash = 0, credit = 0;
    for (const a of acctRows) {
      const bal = Number(a.latest_balance_cents) || 0;
      if (a.kind === 'credit_card') credit += bal; else cash += bal;
    }
    summaryRow.appendChild(makeCard('Net worth', fmtMoney(cash + credit), `${acctRows.length} accounts`));
    summaryRow.appendChild(makeCard('Cash', fmtMoney(cash), 'Checking + savings'));
    summaryRow.appendChild(makeCard('Credit balance', fmtMoney(credit), credit < 0 ? 'Owed' : 'No balance'));

    for (const a of acctRows) cardsRow.appendChild(buildAccountCard(a, api));

    // Detail table — also lets the user rename / archive an account.
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

    const table = document.createElement('table'); table.className = 'budget-table';
    table.innerHTML = `<thead><tr><th>Name</th><th>Kind</th><th>Last 4</th><th>Tx</th><th style="text-align:right">Latest balance</th><th>As of</th><th>Actions</th></tr></thead>`;
    const tb = document.createElement('tbody');
    for (const a of allRows) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      const inp = document.createElement('input'); inp.type = 'text'; inp.value = a.display_name || ''; inp.className = 'budget-input';
      inp.style.width = '160px';
      inp.addEventListener('change', async () => {
        try { await db.run('UPDATE accounts SET display_name=?, updated_at=? WHERE id=?', [inp.value || null, new Date().toISOString(), a.id]); }
        catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
      });
      tdName.appendChild(inp);
      tr.appendChild(tdName);

      const tdKind = document.createElement('td');
      const kindSel = document.createElement('select'); kindSel.className = 'budget-select';
      for (const k of ACCOUNT_KINDS) {
        const o = document.createElement('option'); o.value = k; o.textContent = k;
        if (a.kind === k) o.selected = true; kindSel.appendChild(o);
      }
      kindSel.addEventListener('change', async () => {
        try { await db.run('UPDATE accounts SET kind=?, updated_at=? WHERE id=?', [kindSel.value, new Date().toISOString(), a.id]); await refresh(); }
        catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
      });
      tdKind.appendChild(kindSel);
      tr.appendChild(tdKind);

      const td4 = document.createElement('td'); td4.textContent = a.last_four ? '••' + a.last_four : '—'; tr.appendChild(td4);
      const tdTx = document.createElement('td'); tdTx.className = 'budget-amount'; tdTx.textContent = String(a.tx_count || 0); tr.appendChild(tdTx);
      const tdBal = document.createElement('td'); tdBal.className = 'budget-amount';
      tdBal.textContent = a.bal != null ? fmtMoney(a.bal) : '—'; tr.appendChild(tdBal);
      const tdDate = document.createElement('td'); tdDate.textContent = a.bal_date || '—'; tr.appendChild(tdDate);
      const tdAct = document.createElement('td'); tdAct.style.display = 'flex'; tdAct.style.gap = '4px';
      tdAct.appendChild(makeButton(a.archived ? 'Unarchive' : 'Archive', {
        onClick: async () => {
          try { await db.run('UPDATE accounts SET archived=?, updated_at=? WHERE id=?', [a.archived ? 0 : 1, new Date().toISOString(), a.id]); await refresh(); }
          catch (e) { await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e))); }
        },
      }));
      tr.appendChild(tdAct);
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    tableWrap.appendChild(table);
  }
  void refresh();
  return () => { alive = false; };
}

// ─── Section: Cash Flow ────────────────────────────────────────────────────

function renderCashFlowSection(body, api) {
  let monthsBackN = 6;

  const toolbar = document.createElement('div'); toolbar.className = 'budget-toolbar';
  const rangeSel = document.createElement('select'); rangeSel.className = 'budget-select';
  for (const [v, lbl] of [[3,'Last 3 months'],[6,'Last 6 months'],[12,'Last 12 months']]) {
    const o = document.createElement('option'); o.value = String(v); o.textContent = lbl;
    if (v === monthsBackN) o.selected = true; rangeSel.appendChild(o);
  }
  rangeSel.addEventListener('change', () => { monthsBackN = Number(rangeSel.value) || 6; void refresh(); });
  toolbar.appendChild(rangeSel);
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  toolbar.appendChild(makeButton('Refresh', { iconHtml: makeIcon(api, 'refresh-cw', 12), onClick: () => void refresh() }));
  body.appendChild(toolbar);

  const cards = document.createElement('div'); cards.className = 'budget-cards'; body.appendChild(cards);
  const chartWrap = document.createElement('div'); chartWrap.className = 'budget-section'; body.appendChild(chartWrap);
  const savingsWrap = document.createElement('div'); savingsWrap.className = 'budget-section'; body.appendChild(savingsWrap);
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
        `SELECT COALESCE(SUM(CASE WHEN tx_type='purchase' AND amount_cents > 0 THEN amount_cents ELSE 0 END),0) AS spend,
                COALESCE(SUM(CASE WHEN tx_type='refund'   AND amount_cents < 0 THEN -amount_cents ELSE 0 END),0) AS refunds,
                COALESCE(SUM(CASE WHEN tx_type='fee'      AND amount_cents > 0 THEN amount_cents ELSE 0 END),0) AS fees,
                COALESCE(SUM(CASE WHEN tx_type='deposit'                          THEN ABS(amount_cents) ELSE 0 END),0) AS income
           FROM transactions
          WHERE status='confirmed' AND transaction_date >= ? AND transaction_date <= ?`,
        [m.start, m.end],
      ) || { spend: 0, refunds: 0, fees: 0, income: 0 };
      const spend = (Number(r.spend) || 0) - (Number(r.refunds) || 0) + (Number(r.fees) || 0);
      const income = Number(r.income) || 0;
      totalIn += income; totalOut += spend;
      groups.push({
        label: m.label.split(' ')[0].slice(0, 3) + ' ' + String(m.year).slice(2),
        values: [
          { name: 'Income', value: income / 100, color: '#22c55e' },
          { name: 'Spend',  value: spend / 100, color: '#ef4444' },
        ],
        meta: { monthKey: m.key, income, spend },
      });
      savingsPoints.push({ label: m.label.split(' ')[0].slice(0, 3), value: (income - spend) / 100 });
    }

    cards.appendChild(makeCard(`Total income (${monthsBackN} mo)`, fmtMoney(totalIn), ''));
    cards.appendChild(makeCard(`Total spend (${monthsBackN} mo)`, fmtMoney(totalOut), ''));
    cards.appendChild(makeCard(`Avg savings rate`, totalIn > 0 ? `${Math.round(((totalIn - totalOut) / totalIn) * 100)}%` : '—',
      totalIn > 0 ? `Net ${fmtMoney(totalIn - totalOut)}` : ''));

    const h1 = document.createElement('h3'); h1.textContent = 'Income vs Spend'; chartWrap.appendChild(h1);
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
    legend.innerHTML = `<span><span class="swatch" style="background:#22c55e"></span>Income</span><span><span class="swatch" style="background:#ef4444"></span>Spend</span>`;
    chartWrap.appendChild(legend);

    const h2 = document.createElement('h3'); h2.textContent = 'Net savings'; savingsWrap.appendChild(h2);
    savingsWrap.appendChild(buildLine(savingsPoints, { width: 720, height: 140 }));

    // Table
    const table = document.createElement('table'); table.className = 'budget-table';
    table.innerHTML = `<thead><tr><th>Month</th><th style="text-align:right">Income</th><th style="text-align:right">Spend</th><th style="text-align:right">Savings</th><th style="text-align:right">Rate</th></tr></thead>`;
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
  void refresh();
  return () => { alive = false; };
}

// ─── Section: Reports ──────────────────────────────────────────────────────

function renderReportsSection(body, api) {
  let monthsBackN = 3;

  const toolbar = document.createElement('div'); toolbar.className = 'budget-toolbar';
  const rangeSel = document.createElement('select'); rangeSel.className = 'budget-select';
  for (const [v, lbl] of [[1,'This month'],[3,'Last 3 months'],[6,'Last 6 months'],[12,'Last 12 months']]) {
    const o = document.createElement('option'); o.value = String(v); o.textContent = lbl;
    if (v === monthsBackN) o.selected = true; rangeSel.appendChild(o);
  }
  rangeSel.addEventListener('change', () => { monthsBackN = Number(rangeSel.value) || 3; void refresh(); });
  toolbar.appendChild(rangeSel);
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  toolbar.appendChild(makeButton('Refresh', { iconHtml: makeIcon(api, 'refresh-cw', 12), onClick: () => void refresh() }));
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
    const h1 = document.createElement('h3'); h1.textContent = `Top merchants (${monthsBackN} mo)`; merchSection.appendChild(h1);
    let merchants = [];
    try {
      merchants = await db.all(`
        SELECT COALESCE(merchant, '— unknown —') AS merchant,
               SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS spend,
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
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:#9333ea"></div></div>
          <div class="amt">${escHtml(fmtMoney(r.spend))}</div>`;
        merchSection.appendChild(row);
      }
    }

    // Category breakdown over window
    const h2 = document.createElement('h3'); h2.textContent = `Spend by category (${monthsBackN} mo)`; catSection.appendChild(h2);
    let cats = [];
    try {
      cats = await db.all(`
        SELECT COALESCE(c.name, '— uncategorized —') AS name,
               COALESCE(c.color, '#94a3b8') AS color,
               COALESCE(c.id, '') AS id,
               SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END) AS spend
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

    // Spend trend over months
    const h3 = document.createElement('h3'); h3.textContent = 'Monthly spend trend'; trendSection.appendChild(h3);
    const points = [];
    for (const m of months) {
      const r = await db.get(
        `SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS spend
           FROM transactions
          WHERE status='confirmed' AND tx_type IN ('purchase','fee')
            AND transaction_date >= ? AND transaction_date <= ?`,
        [m.start, m.end]);
      points.push({ label: m.label.split(' ')[0].slice(0, 3), value: (Number(r?.spend) || 0) / 100 });
    }
    trendSection.appendChild(buildLine(points, { width: 720, height: 160, color: '#ef4444' }));
  }
  void refresh();
  return () => { alive = false; };
}

// ─── Section: Budgets ──────────────────────────────────────────────────────

function renderBudgetsSection(body, api) {
  let monthKey = monthRange().key;

  const toolbar = document.createElement('div'); toolbar.className = 'budget-toolbar';
  const picker = makeMonthPicker(monthKey, (k) => { monthKey = k; void refresh(); });
  toolbar.appendChild(picker.el);
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  toolbar.appendChild(makeButton('Copy from previous month', {
    onClick: async () => {
      const prev = monthShift(monthKey, -1);
      const prevRows = await db.all('SELECT category_id, limit_cents FROM budgets WHERE month_key=?', [prev]);
      if (!prevRows || prevRows.length === 0) {
        await api.window?.showInformationMessage?.('No budgets in ' + prev + ' to copy.');
        return;
      }
      const now = new Date().toISOString();
      for (const p of prevRows) {
        await db.run(
          `INSERT OR REPLACE INTO budgets (id, category_id, month_key, limit_cents, rollover_cents, created_at, updated_at)
           VALUES (COALESCE((SELECT id FROM budgets WHERE category_id=? AND month_key=?), ?), ?, ?, ?, 0, ?, ?)`,
          [p.category_id, monthKey, crypto.randomUUID(), p.category_id, monthKey, p.limit_cents, now, now],
        );
      }
      await refresh();
    },
  }));
  toolbar.appendChild(makeButton('Refresh', { iconHtml: makeIcon(api, 'refresh-cw', 12), onClick: () => void refresh() }));
  body.appendChild(toolbar);

  const summary = document.createElement('div'); summary.className = 'budget-cards'; body.appendChild(summary);
  const tableWrap = document.createElement('div'); body.appendChild(tableWrap);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    summary.innerHTML = ''; tableWrap.innerHTML = '';

    const rows = await evalBudgetStatus(monthKey);

    let totalLimit = 0, totalSpent = 0, overCount = 0, nearCount = 0;
    for (const r of rows) {
      totalLimit += Number(r.effective_limit_cents) || 0;
      totalSpent += Number(r.spent_cents) || 0;
      if (r.status === 'over') overCount++;
      else if (r.status === 'near') nearCount++;
    }
    const remaining = totalLimit - totalSpent;
    summary.appendChild(makeCard('Budget total', fmtMoney(totalLimit), `${rows.filter(r => r.effective_limit_cents > 0).length} categories with a limit`));
    summary.appendChild(makeCard('Spent so far', fmtMoney(totalSpent), totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) + '% of budget' : ''));
    summary.appendChild(makeCard('Remaining', fmtMoney(remaining), remaining < 0 ? 'Over budget' : ''));
    summary.appendChild(makeCard('Alerts', String(overCount + nearCount), `${overCount} over, ${nearCount} near`));

    const table = document.createElement('table'); table.className = 'budget-table';
    table.innerHTML = `<thead><tr><th>Category</th><th style="text-align:right">Limit</th><th style="text-align:right">Spent</th><th>Progress</th><th style="text-align:right">Remaining</th><th>Status</th></tr></thead>`;
    const tb = document.createElement('tbody');

    for (const r of rows) {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      tdName.innerHTML = `<span class="budget-cat-swatch" style="background:${escHtml(r.color || '#888')}"></span>${escHtml(r.name)}`;
      tdName.style.cursor = 'pointer';
      tdName.title = 'View transactions in ' + r.name;
      tdName.addEventListener('click', () => {
        _navState.txFilter = { categoryId: r.id, monthKey, type: 'spend' };
        api.commands.executeCommand('budget.openTransactions').catch(() => {});
      });
      tr.appendChild(tdName);

      const tdLimit = document.createElement('td'); tdLimit.style.textAlign = 'right';
      const limitInput = document.createElement('input');
      limitInput.type = 'number'; limitInput.step = '1'; limitInput.min = '0';
      limitInput.className = 'budget-input'; limitInput.style.width = '100px'; limitInput.style.textAlign = 'right';
      limitInput.value = r.effective_limit_cents > 0 ? (r.effective_limit_cents / 100).toFixed(2) : '';
      limitInput.placeholder = '—';
      limitInput.addEventListener('change', async () => {
        const cents = Math.round(parseFloat(limitInput.value || '0') * 100) || 0;
        const now = new Date().toISOString();
        try {
          if (cents > 0) {
            const existing = await db.get('SELECT id FROM budgets WHERE category_id=? AND month_key=?', [r.id, monthKey]);
            if (existing) {
              await db.run('UPDATE budgets SET limit_cents=?, updated_at=? WHERE id=?', [cents, now, existing.id]);
            } else {
              await db.run(
                `INSERT INTO budgets (id, category_id, month_key, limit_cents, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
                [crypto.randomUUID(), r.id, monthKey, cents, now, now],
              );
            }
          } else {
            await db.run('DELETE FROM budgets WHERE category_id=? AND month_key=?', [r.id, monthKey]);
          }
          await refresh();
        } catch (e) {
          await api.window?.showErrorMessage?.('Update failed: ' + (e instanceof Error ? e.message : String(e)));
        }
      });
      tdLimit.appendChild(limitInput);
      tr.appendChild(tdLimit);

      const tdSpent = document.createElement('td'); tdSpent.className = 'budget-amount'; tdSpent.style.textAlign = 'right';
      tdSpent.textContent = fmtMoney(r.spent_cents); tr.appendChild(tdSpent);

      const tdProg = document.createElement('td');
      const track = document.createElement('div'); track.className = 'bar-track'; track.style.minWidth = '160px';
      const fill = document.createElement('div'); fill.className = 'bar-fill';
      const eff = Number(r.effective_limit_cents) || 0;
      const pct = eff > 0 ? Math.min(100, Math.round(r.pct * 100)) : 0;
      fill.style.width = pct + '%';
      fill.style.background = r.status === 'over' ? '#ef4444' : (r.status === 'near' ? '#f59e0b' : (r.color || '#22c55e'));
      track.appendChild(fill); tdProg.appendChild(track);
      tr.appendChild(tdProg);

      const tdRem = document.createElement('td'); tdRem.style.textAlign = 'right';
      tdRem.className = 'budget-amount';
      const rem = (Number(r.effective_limit_cents) || 0) - (Number(r.spent_cents) || 0);
      tdRem.textContent = eff > 0 ? fmtMoney(rem) : '—';
      if (rem < 0) tdRem.classList.add('negative');
      tr.appendChild(tdRem);

      const tdStatus = document.createElement('td');
      const cls = r.status === 'over' ? 'review' : (r.status === 'near' ? 'low' : 'confirmed');
      tdStatus.innerHTML = eff > 0 ? `<span class="budget-pill ${cls}">${escHtml(r.status)}</span>` : '<span style="color:var(--vscode-descriptionForeground,#888)">no limit</span>';
      tr.appendChild(tdStatus);

      tb.appendChild(tr);
    }
    table.appendChild(tb);
    tableWrap.appendChild(table);
  }
  void refresh();
  return () => { alive = false; };
}

// ─── Section: Recurring ────────────────────────────────────────────────────

function renderRecurringSection(body, api) {
  let showCancelled = false;

  const toolbar = document.createElement('div'); toolbar.className = 'budget-toolbar';
  toolbar.appendChild(makeButton('Detect now', {
    primary: true,
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
  const cancelToggle = makeButton('Show cancelled', { onClick: () => { showCancelled = !showCancelled; cancelToggle.setAttribute('aria-pressed', String(showCancelled)); void refresh(); } });
  cancelToggle.setAttribute('aria-pressed', 'false');
  toolbar.appendChild(cancelToggle);
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  toolbar.appendChild(makeButton('Refresh', { iconHtml: makeIcon(api, 'refresh-cw', 12), onClick: () => void refresh() }));
  body.appendChild(toolbar);

  const summary = document.createElement('div'); summary.className = 'budget-cards'; body.appendChild(summary);
  const upcomingWrap = document.createElement('div'); upcomingWrap.className = 'budget-section'; body.appendChild(upcomingWrap);
  const tableWrap = document.createElement('div'); body.appendChild(tableWrap);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    summary.innerHTML = ''; upcomingWrap.innerHTML = ''; tableWrap.innerHTML = '';

    const all = await db.all(`
      SELECT r.*, c.name AS category_name, c.color AS category_color
        FROM recurring_series r
        LEFT JOIN categories c ON c.id = r.category_id
       ${showCancelled ? '' : 'WHERE r.cancelled = 0'}
       ORDER BY r.cancelled ASC, r.next_due_date ASC, r.merchant_pattern ASC`);

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

    summary.appendChild(makeCard('Active subscriptions', String(active.length), ''));
    summary.appendChild(makeCard('Estimated monthly burn', fmtMoney(Math.round(totalMonthly)), 'Sum of avg/cadence-normalized'));
    summary.appendChild(makeCard('Due in next 30 days', String(next30.length), ''));

    if (next30.length > 0) {
      const h = document.createElement('h3'); h.textContent = 'Upcoming'; upcomingWrap.appendChild(h);
      const ul = document.createElement('div');
      for (const r of next30) {
        const card = document.createElement('div'); card.className = 'budget-card';
        card.style.maxWidth = '320px'; card.style.display = 'inline-block'; card.style.marginRight = '8px'; card.style.marginBottom = '8px';
        card.innerHTML = `
          <div class="budget-card-label">${escHtml(r.next_due_date || '?')} • ${escHtml(r.cadence)}</div>
          <div class="budget-card-value">${escHtml(r.display_name || r.merchant_pattern)}</div>
          <div class="budget-card-sub">~${escHtml(fmtMoney(r.avg_amount_cents))} ${r.category_name ? '• ' + escHtml(r.category_name) : ''}</div>`;
        ul.appendChild(card);
      }
      upcomingWrap.appendChild(ul);
    }

    if (all.length === 0) {
      tableWrap.appendChild(emptyState('No recurring series detected yet — sync more transactions, then click Detect now.'));
      return;
    }

    const table = document.createElement('table'); table.className = 'budget-table';
    table.innerHTML = `<thead><tr><th>Merchant</th><th>Cadence</th><th>Avg</th><th>Last seen</th><th>Next due</th><th>Hits</th><th>Conf.</th><th>Actions</th></tr></thead>`;
    const tb = document.createElement('tbody');
    for (const r of all) {
      const tr = document.createElement('tr');
      if (r.cancelled) tr.style.opacity = '0.5';
      tr.innerHTML = `
        <td>${escHtml(r.display_name || r.merchant_pattern)}</td>
        <td><span class="budget-pill">${escHtml(r.cadence)}</span></td>
        <td class="budget-amount">${escHtml(fmtMoney(r.avg_amount_cents))}</td>
        <td>${escHtml(r.last_seen_date || '—')}</td>
        <td>${escHtml(r.next_due_date || '—')}</td>
        <td class="budget-amount">${r.occurrence_count}</td>
        <td>${r.detection_confidence ? `<span class="budget-pill ${escHtml(r.detection_confidence)}">${escHtml(r.detection_confidence)}</span>` : ''}</td>
      `;
      const tdAct = document.createElement('td'); tdAct.style.display = 'flex'; tdAct.style.gap = '4px';
      tdAct.appendChild(makeButton(r.cancelled ? 'Reactivate' : 'Cancel', {
        onClick: async () => {
          await db.run('UPDATE recurring_series SET cancelled=?, updated_at=? WHERE id=?', [r.cancelled ? 0 : 1, new Date().toISOString(), r.id]);
          await refresh();
        },
      }));
      if (!r.cancelled) {
        tdAct.appendChild(makeButton(r.user_confirmed ? 'Confirmed' : 'Confirm', {
          primary: !r.user_confirmed,
          onClick: async () => {
            await db.run('UPDATE recurring_series SET user_confirmed=1, updated_at=? WHERE id=?', [new Date().toISOString(), r.id]);
            await refresh();
          },
        }));
      }
      tr.appendChild(tdAct);
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    tableWrap.appendChild(table);
  }
  void refresh();
  return () => { alive = false; };
}

// ─── Section: Rules ────────────────────────────────────────────────────────

function renderRulesSection(body, api) {
  const toolbar = document.createElement('div'); toolbar.className = 'budget-toolbar';
  toolbar.appendChild(makeButton('+ New rule', {
    primary: true,
    onClick: () => { showEditor(null); },
  }));
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  toolbar.appendChild(makeButton('Refresh', { iconHtml: makeIcon(api, 'refresh-cw', 12), onClick: () => void refresh() }));
  body.appendChild(toolbar);

  const help = document.createElement('div');
  help.style.fontSize = '12px'; help.style.color = 'var(--vscode-descriptionForeground,#888)'; help.style.marginBottom = '8px';
  help.textContent = 'Rules apply BEFORE the AI categorizer. Higher priority wins. Auto-rules (priority 50) come from your overrides.';
  body.appendChild(help);

  const editorWrap = document.createElement('div'); body.appendChild(editorWrap);
  const tableWrap = document.createElement('div'); body.appendChild(tableWrap);

  let alive = true;
  let categoriesList = [];

  function showEditor(rule) {
    editorWrap.innerHTML = '';
    const form = document.createElement('div');
    form.style.padding = '12px'; form.style.border = '1px solid var(--vscode-panel-border, #444)'; form.style.marginBottom = '12px';
    form.style.display = 'grid'; form.style.gridTemplateColumns = 'auto 1fr'; form.style.gap = '6px 10px'; form.style.maxWidth = '640px';

    const patternInp = document.createElement('input'); patternInp.className = 'budget-input'; patternInp.placeholder = 'STARBUCKS';
    patternInp.value = rule ? rule.pattern : '';

    const matchSel = document.createElement('select'); matchSel.className = 'budget-select';
    for (const v of ['contains','exact','regex']) {
      const o = document.createElement('option'); o.value = v; o.textContent = v;
      if (rule && rule.match_type === v) o.selected = true;
      matchSel.appendChild(o);
    }
    if (!rule) matchSel.value = 'contains';

    const catSel = document.createElement('select'); catSel.className = 'budget-select';
    const blank = document.createElement('option'); blank.value = ''; blank.textContent = '— pick category —'; catSel.appendChild(blank);
    for (const c of categoriesList) {
      const o = document.createElement('option'); o.value = c.id; o.textContent = c.name;
      if (rule && rule.category_id === c.id) o.selected = true;
      catSel.appendChild(o);
    }

    const prioInp = document.createElement('input'); prioInp.type = 'number'; prioInp.className = 'budget-input';
    prioInp.value = rule ? String(rule.priority) : '100';

    form.appendChild(Object.assign(document.createElement('label'), { textContent: 'Pattern' })); form.appendChild(patternInp);
    form.appendChild(Object.assign(document.createElement('label'), { textContent: 'Match type' })); form.appendChild(matchSel);
    form.appendChild(Object.assign(document.createElement('label'), { textContent: 'Category' })); form.appendChild(catSel);
    form.appendChild(Object.assign(document.createElement('label'), { textContent: 'Priority' })); form.appendChild(prioInp);

    const actions = document.createElement('div'); actions.style.gridColumn = '1 / -1'; actions.style.display = 'flex'; actions.style.gap = '6px'; actions.style.marginTop = '4px';
    const saveBtn = makeButton(rule ? 'Save' : 'Create', {
      primary: true,
      onClick: async () => {
        const pattern = patternInp.value.trim();
        const categoryId = catSel.value;
        if (!pattern) { await api.window?.showWarningMessage?.('Pattern required.'); return; }
        if (!categoryId) { await api.window?.showWarningMessage?.('Category required.'); return; }
        const now = new Date().toISOString();
        try {
          if (rule) {
            await db.run(
              `UPDATE categorization_rules SET pattern=?, match_type=?, category_id=?, priority=?, updated_at=? WHERE id=?`,
              [pattern, matchSel.value, categoryId, parseInt(prioInp.value, 10) || 100, now, rule.id],
            );
          } else {
            await db.run(
              `INSERT INTO categorization_rules (id, pattern, match_type, category_id, priority, auto_created, active, created_at, updated_at)
               VALUES (?,?,?,?,?,0,1,?,?)`,
              [crypto.randomUUID(), pattern, matchSel.value, categoryId, parseInt(prioInp.value, 10) || 100, now, now],
            );
          }
          editorWrap.innerHTML = '';
          await refresh();
        } catch (e) {
          await api.window?.showErrorMessage?.('Save failed: ' + (e instanceof Error ? e.message : String(e)));
        }
      },
    });
    const cancelBtn = makeButton('Cancel', { onClick: () => { editorWrap.innerHTML = ''; } });
    actions.appendChild(saveBtn); actions.appendChild(cancelBtn);
    form.appendChild(actions);
    editorWrap.appendChild(form);
  }

  async function refresh() {
    if (!alive) return;
    tableWrap.innerHTML = '';
    categoriesList = await db.all('SELECT id, name, color FROM categories WHERE archived=0 ORDER BY sort_order, name');

    const rules = await db.all(`
      SELECT r.*, c.name AS category_name, c.color AS category_color
        FROM categorization_rules r
        LEFT JOIN categories c ON c.id = r.category_id
       ORDER BY r.active DESC, r.priority DESC, r.hits DESC`);

    if (rules.length === 0) {
      tableWrap.appendChild(emptyState('No rules yet. Click "+ New rule" or override a transaction\'s category to learn one automatically.'));
      return;
    }

    const table = document.createElement('table'); table.className = 'budget-table';
    table.innerHTML = `<thead><tr><th>Pattern</th><th>Match</th><th>Category</th><th>Priority</th><th>Source</th><th>Hits</th><th>Active</th><th>Actions</th></tr></thead>`;
    const tb = document.createElement('tbody');
    for (const r of rules) {
      const tr = document.createElement('tr');
      if (!r.active) tr.style.opacity = '0.5';
      tr.innerHTML = `
        <td><code>${escHtml(r.pattern)}</code></td>
        <td><span class="budget-pill">${escHtml(r.match_type)}</span></td>
        <td>${r.category_name ? `<span class="budget-cat-swatch" style="background:${escHtml(r.category_color || '#888')}"></span>${escHtml(r.category_name)}` : '<em>missing</em>'}</td>
        <td class="budget-amount">${r.priority}</td>
        <td>${r.auto_created ? '<span class="budget-pill">auto</span>' : '<span class="budget-pill">manual</span>'}</td>
        <td class="budget-amount">${r.hits}</td>
        <td>${r.active ? '✓' : '—'}</td>`;
      const tdAct = document.createElement('td'); tdAct.style.display = 'flex'; tdAct.style.gap = '4px';
      tdAct.appendChild(makeButton('Edit', { onClick: () => showEditor(r) }));
      tdAct.appendChild(makeButton(r.active ? 'Disable' : 'Enable', {
        onClick: async () => {
          await db.run('UPDATE categorization_rules SET active=?, updated_at=? WHERE id=?', [r.active ? 0 : 1, new Date().toISOString(), r.id]);
          await refresh();
        },
      }));
      tdAct.appendChild(makeButton('Delete', {
        onClick: async () => {
          await db.run('DELETE FROM categorization_rules WHERE id=?', [r.id]);
          await refresh();
        },
      }));
      tr.appendChild(tdAct);
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    tableWrap.appendChild(table);
  }
  void refresh();
  return () => { alive = false; };
}

// ─── Section: Reconcile ────────────────────────────────────────────────────

function renderReconcileSection(body, api) {
  let selectedAccountId = null;

  const toolbar = document.createElement('div'); toolbar.className = 'budget-toolbar';
  const acctSel = document.createElement('select'); acctSel.className = 'budget-select';
  toolbar.appendChild(acctSel);
  const spacer = document.createElement('div'); spacer.className = 'spacer'; toolbar.appendChild(spacer);
  toolbar.appendChild(makeButton('Refresh', { iconHtml: makeIcon(api, 'refresh-cw', 12), onClick: () => void refresh() }));
  body.appendChild(toolbar);

  const summary = document.createElement('div'); summary.className = 'budget-cards'; body.appendChild(summary);
  const formWrap = document.createElement('div'); formWrap.className = 'budget-section'; body.appendChild(formWrap);
  const historyWrap = document.createElement('div'); historyWrap.className = 'budget-section'; body.appendChild(historyWrap);

  let alive = true;

  async function loadAccounts() {
    const accounts = await db.all('SELECT id, last_four, kind, display_name FROM accounts WHERE archived=0 ORDER BY kind, last_four');
    acctSel.innerHTML = '';
    if (accounts.length === 0) {
      const o = document.createElement('option'); o.textContent = '— no accounts —'; acctSel.appendChild(o);
      return [];
    }
    for (const a of accounts) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = (a.display_name || defaultAccountName(a.kind, a.last_four));
      acctSel.appendChild(o);
    }
    selectedAccountId = selectedAccountId && accounts.find(a => a.id === selectedAccountId) ? selectedAccountId : accounts[0].id;
    acctSel.value = selectedAccountId;
    acctSel.onchange = () => { selectedAccountId = acctSel.value; void refresh(); };
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

    summary.appendChild(makeCard('Latest snapshot', latestSnap ? fmtMoney(latestSnap.balance_cents) : '—', latestSnap ? `As of ${latestSnap.snapshot_date}` : 'No snapshots'));
    summary.appendChild(makeCard('Derived balance', fmtMoney(derived), lastRecon ? `Since ${lastRecon.reconciled_at}` : 'All time'));
    if (latestSnap) {
      const off = Number(latestSnap.balance_cents) - derived;
      summary.appendChild(makeCard('Snapshot vs derived', fmtMoney(off), Math.abs(off) < 100 ? 'Within $1' : 'Investigate'));
    }

    // Form
    const h = document.createElement('h3'); h.textContent = 'Mark reconciled'; formWrap.appendChild(h);
    const form = document.createElement('div'); form.style.display = 'flex'; form.style.gap = '8px'; form.style.alignItems = 'center'; form.style.flexWrap = 'wrap';
    const dateInp = document.createElement('input'); dateInp.type = 'date'; dateInp.className = 'budget-input'; dateInp.value = todayYmd();
    const balInp = document.createElement('input'); balInp.type = 'number'; balInp.step = '0.01'; balInp.placeholder = 'Statement balance ($)'; balInp.className = 'budget-input'; balInp.style.width = '180px';
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

  void refresh();
  return () => { alive = false; };
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
  importHelp.style.fontSize = 'var(--parallx-fontSize-sm, 11px)';
  importHelp.style.color = 'var(--vscode-descriptionForeground, #888)';
  importHelp.style.lineHeight = '1.5';
  importHelp.innerHTML =
    'Header row required: <code>date,merchant,amount</code> (and optional <code>type, category, account, last_four, notes</code>). Amounts are positive for spend, negative for refund / deposit. Duplicates within prior CSV imports — same date, merchant, and amount — are skipped automatically.';
  importWrap.appendChild(importHelp);

  const ta = document.createElement('textarea');
  ta.className = 'budget-input';
  ta.placeholder = 'date,merchant,amount,category,account,last_four,notes\n2026-05-01,Starbucks,4.75,Dining,Chase Checking,1234,';
  ta.rows = 10;
  ta.spellcheck = false;
  ta.style.width = '100%';
  ta.style.boxSizing = 'border-box';
  ta.style.fontFamily = 'var(--parallx-fontFamily-mono, ui-monospace, Consolas, monospace)';
  ta.style.fontSize = 'var(--parallx-fontSize-sm, 11px)';
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
  preview.style.fontSize = 'var(--parallx-fontSize-sm, 11px)';
  preview.style.color = 'var(--vscode-descriptionForeground, #888)';
  preview.style.fontVariantNumeric = 'tabular-nums';
  importBar.appendChild(preview);

  const status = document.createElement('div');
  status.style.fontSize = 'var(--parallx-fontSize-sm, 11px)';
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
  exportHelp.style.fontSize = 'var(--parallx-fontSize-sm, 11px)';
  exportHelp.style.color = 'var(--vscode-descriptionForeground, #888)';
  exportHelp.style.lineHeight = '1.5';
  exportHelp.innerHTML = 'Writes <code>budget-export-YYYY-MM-DD.csv</code> to your workspace root, including every confirmed and review-queue row. Falls back to your clipboard if no workspace folder is open.';
  exportWrap.appendChild(exportHelp);

  const exportBar = document.createElement('div');
  exportBar.className = 'budget-toolbar';
  exportWrap.appendChild(exportBar);

  const exportStatus = document.createElement('div');
  exportStatus.style.fontSize = 'var(--parallx-fontSize-sm, 11px)';
  exportStatus.style.color = 'var(--vscode-descriptionForeground, #888)';
  exportStatus.style.minHeight = '1.4em';

  const exportBtn = makeButton('Export now', {
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
  const fs = api.workspace && api.workspace.fs;
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

// Optional onSliceClick adds an interactive cursor and fires when a slice is hit.
function bindDonutClicks(donutEl, slices, onSliceClick) {
  if (typeof onSliceClick !== 'function') return;
  const paths = donutEl.querySelectorAll('path');
  paths.forEach((path, i) => {
    if (!slices[i]) return;
    path.style.cursor = 'pointer';
    path.addEventListener('click', () => onSliceClick(slices[i]));
  });
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
  const stroke = (opts && opts.color) || 'var(--parallx-color-accent, #9333ea)';

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

// Month picker — returns {el, getKey, setKey} where key is "YYYY-MM".
function makeMonthPicker(initialKey, onChange) {
  const el = document.createElement('div');
  el.className = 'budget-month-picker';
  const back = document.createElement('button'); back.type = 'button'; back.title = 'Previous month'; back.textContent = '◀';
  const label = document.createElement('div'); label.className = 'label';
  const fwd = document.createElement('button'); fwd.type = 'button'; fwd.title = 'Next month'; fwd.textContent = '▶';
  el.appendChild(back); el.appendChild(label); el.appendChild(fwd);

  let key = initialKey || monthRange().key;
  const todayKey = monthRange().key;

  function update() {
    label.textContent = monthRange(key).label;
    fwd.disabled = key >= todayKey;
  }
  back.addEventListener('click', () => { key = monthShift(key, -1); update(); onChange && onChange(key); });
  fwd.addEventListener('click', () => { if (key < todayKey) { key = monthShift(key, +1); update(); onChange && onChange(key); } });
  update();

  return { el, getKey: () => key, setKey: (k) => { key = k; update(); } };
}

// ─── Categorization rules engine ────────────────────────────────────────────
//
// Strategy:
//   • On every override (user changes a category) we record / strengthen a rule
//     for that merchant→category pair (auto-learned, low priority).
//   • On every sync, BEFORE asking the AI, we apply rules in priority order.
//     Match wins. Hits get incremented for transparency.
//   • User can edit rules manually in the Rules view. Manual rules default to
//     priority 100 so they always beat auto-learned (priority 50) suggestions.
//
// Match types: 'exact' (LOWER==), 'contains' (LIKE), 'regex' (JS-side).
// All matches are case-insensitive.

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

function ruleMatchesMerchant(rule, merchant) {
  if (!merchant || !rule || !rule.pattern) return false;
  const m = String(merchant).toLowerCase();
  const p = String(rule.pattern).toLowerCase();
  if (rule.match_type === 'exact')    return m === p;
  if (rule.match_type === 'contains') return m.indexOf(p) >= 0;
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
  if (!merchant || !categoryId) return;
  const cleanMerchant = String(merchant).trim();
  if (cleanMerchant.length < 2) return;

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
      await db.run(
        `UPDATE categorization_rules SET category_id = ?, updated_at = ?, hits = 0 WHERE id = ?`,
        [categoryId, now, existing.id],
      );
    }
    return;
  }
  await db.run(
    `INSERT INTO categorization_rules (id, pattern, match_type, category_id, priority, auto_created, active, created_at, updated_at)
     VALUES (?, ?, 'exact', ?, 50, 1, 1, ?, ?)`,
    [crypto.randomUUID(), cleanMerchant, categoryId, now, now],
  );
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
async function reprocessHistory(api) {
  // Suppress unused-arg lint when api is not consumed (kept for future use
  // — e.g. surfacing a progress notification).
  void api;

  // ── Pass 1: tx_type / account_id backfill ────────────────────────────
  const legacyRows = await db.all(`
    SELECT t.id, t.merchant, t.amount_cents, t.card_last_four
      FROM transactions t
     WHERE t.tx_type IS NULL AND t.gmail_message_id IS NOT NULL`);

  let updated = 0, errors = 0;
  for (const r of legacyRows) {
    try {
      const cents = Number(r.amount_cents) || 0;
      // Cheap heuristic backfill: most legacy rows are purchases. Refunds
      // were originally stored as negative cents.
      const tx_type = cents < 0 ? 'refund' : 'purchase';
      let accountId = null;
      if (r.card_last_four) {
        const acct = await upsertAccount(r.card_last_four, 'other', null);
        accountId = acct ? acct.id : null;
      }
      await db.run(
        `UPDATE transactions SET tx_type = ?, account_id = COALESCE(account_id, ?), updated_at = ? WHERE id = ?`,
        [tx_type, accountId, new Date().toISOString(), r.id],
      );
      updated++;
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
         AND tx_type IN ('purchase','refund') AND merchant IS NOT NULL`);
    for (const r of candidates) {
      try {
        const matched = await applyRules(r.merchant, activeRules);
        if (matched && matched.categoryId) {
          await db.run(
            `UPDATE transactions SET category_id = ?, categorizer_model = ?, updated_at = ? WHERE id = ?`,
            [matched.categoryId, 'rule:' + matched.ruleId + ':reprocess', new Date().toISOString(), r.id],
          );
          categorized++;
        }
      } catch { errors++; }
    }
  }

  return { updated, errors, total: legacyRows.length, categorized };
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

      let txType = (typeIdx >= 0 ? (cols[typeIdx] || '').toLowerCase() : '') || (cents >= 0 ? 'purchase' : 'refund');
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
      if (catIdx >= 0 && cols[catIdx]) {
        categoryId = catByName.get(String(cols[catIdx]).toLowerCase()) || null;
      }
      if (!categoryId && (txType === 'purchase' || txType === 'refund')) {
        const ruleHit = await applyRules(merchant, activeRules);
        if (ruleHit) categoryId = ruleHit.categoryId;
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
            posted, notes, created_at, updated_at, categorizer_model
         ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'csv', 1, ?, ?, ?, 'csv:import')`,
        [crypto.randomUUID(), date, merchant, cents, txType, categoryId, accountId, last4 || null, notes || null, now, now],
      );
      inserted++;
    } catch (e) {
      errors++;
    }
  }
  return { inserted, skipped, errors };
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
           COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS spend_cents
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

// ─── AI pipeline (Stage 1 / 1b / 2 / 3) ────────────────────────────────────
//
// Every stage is a single LLM call with `temperature:0, format:'json'`. We
// stream chunks until done and JSON.parse the concatenation. On parse fail,
// retry ONCE with a stricter follow-up turn before treating as malformed.
// All prompts are literal templates from docs/Parallx_Milestone_63.md §AI Pipeline.

async function lmRunJson(api, modelId, systemPrompt, userPrompt) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt   },
  ];
  const opts = { temperature: 0, format: 'json' };
  const collect = async (msgs) => {
    let out = '';
    for await (const chunk of api.lm.sendChatRequest(modelId, msgs, opts)) {
      if (chunk && typeof chunk.content === 'string') out += chunk.content;
      if (chunk && chunk.done) break;
    }
    return out;
  };
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
  let raw = await collect(messages);
  let parsed = tryParse(raw);
  if (parsed !== undefined) return parsed;
  const retryMessages = messages.concat([
    { role: 'assistant', content: raw },
    { role: 'user', content: 'Respond ONLY with the JSON object — no prose, no markdown.' },
  ]);
  raw = await collect(retryMessages);
  parsed = tryParse(raw);
  return parsed; // may still be undefined — caller treats as malformed
}

async function aiStage1(api, modelId, msg) {
  const sys = 'You classify Chase bank emails. Respond with a single JSON object and nothing else.';
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${truncateBody(msg.body)}\n\n` +
    `Classify the email as exactly one of these event types:\n` +
    `  • "purchase"        — a real charge on a debit or credit card (gas, restaurant, online order, subscription).\n` +
    `  • "refund"          — a return / credit on a card (negative purchase).\n` +
    `  • "deposit"         — money INTO a bank account (paycheck, direct deposit, transfer-IN from outside).\n` +
    `  • "transfer"        — INTERNAL movement between this user's own accounts (savings ↔ checking).\n` +
    `  • "cc_payment"      — a payment FROM a checking account TO a credit card balance.\n` +
    `  • "fee"             — bank fee, overdraft, ATM fee, late fee.\n` +
    `  • "balance_summary" — daily / periodic summary that lists ACCOUNT BALANCES (typical subjects: "Your daily account summary", "Account balance alert").\n` +
    `  • "other"           — statement-ready notice, marketing, security alerts, password resets, etc. (no money moved).\n\n` +
    `Account-kind hint should reflect which kind of account the event hits (use the body text — credit-card emails usually mention "Visa", "Mastercard", or a card name; bank emails mention "Total Checking", "Savings").\n\n` +
    `Return:\n{\n  "event_type":         <one of the strings above>,\n  "account_kind_hint":  <"checking" | "savings" | "credit_card" | "other">\n}`;
  const r = await lmRunJson(api, modelId, sys, usr);
  if (!r || typeof r !== 'object') return { event_type: 'other', account_kind_hint: 'other', malformed: true };
  const eventType = typeof r.event_type === 'string' ? r.event_type.trim().toLowerCase() : 'other';
  const valid = new Set(['purchase','refund','deposit','transfer','cc_payment','fee','balance_summary','other']);
  return {
    event_type: valid.has(eventType) ? eventType : 'other',
    account_kind_hint: normalizeAccountKind(r.account_kind_hint),
    // Backwards-compat: callers previously used these booleans.
    is_transaction: ['purchase','refund','deposit','transfer','cc_payment','fee'].includes(eventType),
    is_balance:     eventType === 'balance_summary',
    malformed: false,
  };
}

async function aiStage2(api, modelId, msg) {
  const sys = 'You extract financial transaction data from emails. Respond with a single JSON object and nothing else. Money is reported in dollars; if you see cents, divide by 100. If multiple transactions are mentioned, return them in the "items" array.';
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${truncateBody(msg.body)}\n\n` +
    `Return:\n{\n  "items": [\n    {\n      "merchant":          <string or null — the payee for purchases, or "Chase Checking" / "Chase Savings" / "Chase Visa" for transfers/payments/deposits>,\n      "amount":            <number — positive for spend/charge/transfer-out, negative for refund/credit/deposit-in>,\n      "card_last_four":    <string of 4 digits or null — the account or card last four digits this hit>,\n      "account_kind_hint": <"checking" | "savings" | "credit_card" | "other">,\n      "transaction_date":  <"YYYY-MM-DD">,\n      "confidence":        <"high" | "medium" | "low">\n    }\n  ]\n}`;
  const r = await lmRunJson(api, modelId, sys, usr);
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
  const r = await lmRunJson(api, modelId, sys, usr);
  if (!r || typeof r.category !== 'string') return null;
  return r.category.trim();
}

async function aiStage1bExtract(api, modelId, msg) {
  const sys = 'You extract account balance data from a Chase daily account summary email. The email may list MULTIPLE accounts (Total Checking, Savings, Credit Card, etc.). Respond with a single JSON object and nothing else.';
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${truncateBody(msg.body)}\n\n` +
    `Return:\n{\n  "snapshot_date": <"YYYY-MM-DD">,\n  "accounts": [\n    {\n      "account_kind":      <"checking" | "savings" | "credit_card" | "other">,\n      "account_last_four": <string of 4 digits or null>,\n      "balance":           <number, in dollars — POSITIVE for cash on hand, NEGATIVE for credit card amount owed>\n    }\n  ]\n}`;
  const r = await lmRunJson(api, modelId, sys, usr);
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

// ─── Sync helpers ──────────────────────────────────────────────────────────

function dollarsToCents(n) {
  // Math.round avoids 0.1+0.2 binary drift; we already store as INTEGER.
  return Math.round(Number(n) * 100);
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

function isoLocalDate(isoTs) {
  // Convert an ISO-8601 UTC timestamp to local YYYY-MM-DD per D4.
  if (!isoTs) return new Date().toISOString().slice(0, 10);
  try {
    const d = new Date(isoTs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function isoNDaysAgo(n) {
  const t = Date.now() - (Math.max(1, n | 0) * 24 * 60 * 60 * 1000);
  return new Date(t).toISOString();
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

async function pickModelId(api) {
  const cfg = api.workspace.getConfiguration('budget');
  const preferred = cfg.get('preferredModelId', '') || '';
  const models = await api.lm.getModels();
  if (!models || models.length === 0) {
    throw new Error('No language models available — install/start Ollama first.');
  }
  if (preferred) {
    const hit = models.find(m => m.id === preferred);
    if (hit) return hit.id;
  }
  return models[0].id;
}

// ─── Sync engine ───────────────────────────────────────────────────────────

async function budgetSync(api) {
  const runId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  await syncLog(runId, 'info', 'fetch', 'Sync started');

  const counts = { confirmed: 0, review: 0, snapshot: 0, skipped: 0, errors: 0 };
  try {
    const cfg = api.workspace.getConfiguration('budget');
    const serverId = cfg.get('gmailMcpServerId', 'gmail');
    const toolName = `mcp__${serverId}__list_unread`;

    const available = await api.mcp.listTools();
    if (!available || !available.some(t => t.name === toolName)) {
      throw new Error(`Gmail MCP tool '${toolName}' is not connected. Open Settings → MCP Servers and connect '${serverId}'.`);
    }

    const lastSyncedAt = await getSyncStateValue('last_synced_at');
    const sinceIso = (typeof lastSyncedAt === 'string' && lastSyncedAt)
      ? lastSyncedAt
      : isoNDaysAgo(cfg.get('syncStartDays', 90));

    const modelId = await pickModelId(api);

    const result = await api.mcp.invokeTool(toolName, {
      since: sinceIso,
      max: 100,
      read_state: 'all',
      query: 'from:chase.com',
      include_body: true,
    });
    if (result && result.isError) {
      throw new Error(`Gmail MCP error: ${result.content?.[0]?.text ?? 'unknown'}`);
    }
    const payload = result?.content?.[0]?.text ?? '{"messages":[]}';
    let parsed;
    try { parsed = JSON.parse(payload); } catch (e) {
      throw new Error('Gmail MCP returned non-JSON payload: ' + (e instanceof Error ? e.message : String(e)));
    }
    // Tool envelope is { messages: [...] }; fall back to bare array for compat.
    let messages = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.messages) ? parsed.messages : []);

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

    for (const msg of messages) {
      if (!msg || !msg.id) { counts.skipped++; continue; }
      const already = await db.get('SELECT 1 AS x FROM email_imports WHERE gmail_message_id=?', [msg.id]);
      if (already) { counts.skipped++; continue; }

      // Stage 1 — classify
      let cls;
      try { cls = await aiStage1(api, modelId, msg); }
      catch (e) {
        await syncLog(runId, 'warn', 'stage1', 'Classify error: ' + (e instanceof Error ? e.message : String(e)), msg.id);
        cls = { is_transaction: false, is_balance: false, malformed: true };
        counts.errors++;
      }

      await db.run(
        `INSERT INTO email_imports (gmail_message_id, received_at, raw_subject, raw_snippet, is_transaction, is_balance, classifier_model, processed_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [msg.id, msg.receivedAt || new Date().toISOString(), msg.subject || null, msg.snippet || null,
         cls.is_transaction ? 1 : 0, cls.is_balance ? 1 : 0, modelId, new Date().toISOString()],
      );

      // Stage 2 — extract transaction(s)
      if (cls.is_transaction) {
        let extracted;
        try { extracted = await aiStage2(api, modelId, msg); }
        catch (e) {
          await syncLog(runId, 'warn', 'stage2', 'Extract error: ' + (e instanceof Error ? e.message : String(e)), msg.id);
          extracted = { items: [], malformed: true };
        }
        // Map Stage-1 event_type → tx_type column. Refunds get the canonical
        // negative-amount convention; transfers/cc_payments are EXCLUDED from
        // spend totals downstream (filtered by tx_type IN ('purchase','refund','fee')).
        const evt = cls.event_type;
        const txType = (evt === 'purchase' || evt === 'refund' || evt === 'deposit'
                     || evt === 'transfer' || evt === 'cc_payment' || evt === 'fee') ? evt : 'other';

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

            // Categorize only for purchase/refund — transfers/payments/deposits/fees
            // do not consume an expense category.
            let categoryId = null;
            let categorizerModel = null;
            if (txType === 'purchase' || txType === 'refund') {
              // 1) Deterministic rules first.
              const matched = await applyRules(item.merchant, activeRules);
              if (matched) {
                categoryId = matched.categoryId;
                categorizerModel = 'rule:' + matched.ruleId;
              } else if (item.confidence !== 'low' && categoryNames.length > 0) {
                // 2) AI fallback.
                try {
                  const picked = await aiStage3(api, modelId, item, categoryNames);
                  if (picked) {
                    categoryId = categoryByName.get(picked.toLowerCase()) || null;
                    categorizerModel = modelId;
                  }
                } catch (e) {
                  await syncLog(runId, 'warn', 'stage3', 'Categorize error: ' + (e instanceof Error ? e.message : String(e)), msg.id);
                }
              }
            }
            await db.run(
              `INSERT INTO transactions (id, gmail_message_id, merchant, amount_cents, card_last_four, transaction_date,
                                         category_id, account_id, tx_type, ai_confidence,
                                         extractor_model, categorizer_model, status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [
                crypto.randomUUID(), msg.id, item.merchant, dollarsToCents(item.amount),
                item.card_last_four, item.transaction_date, categoryId, accountId, txType,
                item.confidence, modelId, categorizerModel,
                item.confidence === 'low' ? 'review' : 'confirmed',
              ],
            );
            if (item.confidence === 'low') counts.review++; else counts.confirmed++;
          }
        }
      }

      // Stage 1b — balance snapshot (may emit multiple rows from one summary email)
      if (cls.is_balance) {
        try {
          const snap = await aiStage1bExtract(api, modelId, msg);
          if (snap && Array.isArray(snap.accounts) && snap.accounts.length > 0) {
            for (const a of snap.accounts) {
              let accountId = null;
              if (a.account_last_four) {
                const acct = await upsertAccount(a.account_last_four, a.account_kind, null);
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
          await syncLog(runId, 'warn', 'snapshot', 'Snapshot error: ' + (e instanceof Error ? e.message : String(e)), msg.id);
          counts.errors++;
        }
      }

      if (msg.receivedAt && msg.receivedAt > newestSeenIso) {
        newestSeenIso = msg.receivedAt;
        newestSeenId = msg.id;
      }
    }

    // Recurring detection — runs after every sync; cheap (no LLM).
    try {
      const detected = await detectRecurring(api);
      if (detected > 0) await syncLog(runId, 'info', 'recurring', `Detected ${detected} new recurring series`);
    } catch (e) {
      await syncLog(runId, 'warn', 'recurring', 'Recurring detection error: ' + (e instanceof Error ? e.message : String(e)));
    }

    // Cursor write — last step (no transaction wrapper needed; three KV upserts).
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_gmail_message_id', ?)`,
      [JSON.stringify(newestSeenId)],
    );
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_synced_at', ?)`,
      [JSON.stringify(newestSeenIso)],
    );
    await db.run(
      `INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_run_status', ?)`,
      [JSON.stringify({ ok: true, ...counts })],
    );
    await syncLog(runId, 'info', 'commit', `Sync complete: ${JSON.stringify(counts)}`);
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
    throw err;
  }
}

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
  const today = new Date();
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
                 `(tx_type IS NULL OR tx_type IN ('purchase','refund','fee'))`];
  const params = [from, to];
  if (categoryId) { where.push(`category_id = ?`); params.push(categoryId); }

  const totals = await db.get(
    `SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END),0) AS spend_cents,
            COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END),0) AS refund_cents,
            COUNT(*) AS count
       FROM transactions WHERE ${where.join(' AND ')}`,
    params,
  ) || { spend_cents: 0, refund_cents: 0, count: 0 };

  const breakdown = await db.all(
    `SELECT COALESCE(c.name, '— uncategorized —') AS category,
            COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS spend_cents,
            COUNT(*) AS count
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.status='confirmed' AND t.transaction_date >= ? AND t.transaction_date <= ?
        AND (t.tx_type IS NULL OR t.tx_type IN ('purchase','refund','fee'))
        ${categoryId ? 'AND t.category_id = ?' : ''}
      GROUP BY t.category_id
      ORDER BY spend_cents DESC`,
    categoryId ? [from, to, categoryId] : [from, to],
  );

  const toDollars = (c) => Math.round(Number(c) || 0) / 100;
  return {
    ok: true,
    from, to,
    category: categoryName,
    spend: toDollars(totals.spend_cents),
    refunds: toDollars(totals.refund_cents),
    net: toDollars((Number(totals.spend_cents) || 0) - (Number(totals.refund_cents) || 0)),
    transactionCount: Number(totals.count) || 0,
    byCategory: breakdown.map(r => ({
      category: r.category,
      spend: toDollars(r.spend_cents),
      count: Number(r.count) || 0,
    })),
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

// ─── activate() ────────────────────────────────────────────────────────────

export async function activate(api, context) {
  if (_activated) return;
  _activated = true;
  _api = api;
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

  try {
    await seedDefaultCategoriesIfEmpty();
  } catch (err) {
    console.error('[Budget] Default category seed failed:', err);
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

  // ── "Open <section>" commands ────────────────────────────────────────
  for (const section of SECTIONS) {
    const sectionId = section.id;
    const title = section.title;
    const icon = section.icon;
    _disposables.push(api.commands.registerCommand(section.commandId, async () => {
      await api.editors.openEditor({
        typeId: 'budget.editor',
        title,
        icon,
        instanceId: 'budget:' + sectionId,
      });
    }));
  }

  // ── Sync entry-points ────────────────────────────────────────────────
  // Three surfaces share one engine:
  //   1. `budget.sync` command   — toolbar / "Sync now" button (direct call).
  //   2. `budget.sync` chat tool — invoked by the cron job's isolated turn.
  //   3. The cron job itself     — registered idempotently via api.cron.upsertJob.

  // 1) Direct command — bypasses the agent for impatient users.
  _disposables.push(api.commands.registerCommand('budget.sync', async () => {
    if (!api.mcp || !api.lm) {
      const missing = [!api.mcp && 'api.mcp', !api.lm && 'api.lm'].filter(Boolean).join(', ');
      await api.window?.showWarningMessage?.(
        `Budget sync requires capabilities not available: ${missing}.`,
      );
      return;
    }
    try {
      const counts = await budgetSync(api);
      await api.window?.showInformationMessage?.(
        `Budget sync complete — confirmed: ${counts.confirmed}, review: ${counts.review}, snapshots: ${counts.snapshot}, skipped: ${counts.skipped}.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await api.window?.showErrorMessage?.(`Budget sync failed: ${msg}`);
    }
  }));

  // 1b) Reprocess history — backfill tx_type / account_id on legacy rows.
  _disposables.push(api.commands.registerCommand('budget.reprocessHistory', async () => {
    try {
      const r = await reprocessHistory(api);
      await api.window?.showInformationMessage?.(
        `Reprocessed ${r.updated} legacy row(s); rules categorized ${r.categorized} previously-uncategorized row(s). Errors: ${r.errors}.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await api.window?.showErrorMessage?.(`Reprocess failed: ${msg}`);
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

  // 2) Chat tool — same handler, MCP-shaped result so the agent can read it.
  if (api.chat && typeof api.chat.registerTool === 'function') {
    try {
      _disposables.push(api.chat.registerTool('budget.sync', {
        description: 'Pull new transaction emails from Gmail and run them through the Budget AI pipeline. Returns counts of confirmed, review-queue, and snapshot rows inserted.',
        parameters: { type: 'object', properties: {} },
        requiresConfirmation: false,
        handler: async () => {
          if (!api.mcp || !api.lm) {
            return { content: 'Budget sync unavailable — api.mcp or api.lm missing.', isError: true };
          }
          try {
            const counts = await budgetSync(api);
            return { content: JSON.stringify(counts) };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { content: msg, isError: true };
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
    } catch (e) {
      console.warn('[Budget] chat tool registration failed:', e);
    }
  }

  // 3) Cron job — idempotent upsert; preserves user-edited fields on rerun.
  if (api.cron && typeof api.cron.upsertJob === 'function') {
    try {
      const intervalMin = api.workspace.getConfiguration('budget').get('syncIntervalMinutes', 30);
      await api.cron.upsertJob({
        id: 'budget.sync.scheduled',
        description: 'Pulls new transaction emails and runs them through the Budget AI pipeline.',
        schedule: { every: `${intervalMin}m` },
        payload: { agentTurn: 'Run a budget sync now using the budget.sync tool. Report the count of confirmed, review-queue, and snapshot items in two short sentences.' },
        wakeMode: 'next-heartbeat',
        contextMessages: 0,
        enabled: true,
      });
    } catch (e) {
      console.warn('[Budget] cron upsert failed:', e);
    }
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
  median,
  coefficientOfVariation,
  gapDays,
  addDays,
  inferCadence,
  parseCsvLine: _parseCsvLine,
  ruleMatchesMerchant,
};
