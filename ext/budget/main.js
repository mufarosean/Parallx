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
  { id: 'dashboard',    title: 'Dashboard',    icon: 'layout-dashboard', commandId: 'budget.openDashboard',    blurb: 'Month-to-date spend, category breakdown, and balance reconciliation.' },
  { id: 'transactions', title: 'Transactions', icon: 'list',             commandId: 'budget.openTransactions', blurb: 'Searchable, filterable ledger of every imported transaction.' },
  { id: 'reviewQueue',  title: 'Review Queue', icon: 'inbox',            commandId: 'budget.openReviewQueue',  blurb: 'AI-flagged low-confidence imports awaiting your confirmation.' },
  { id: 'syncLog',      title: 'Sync Log',     icon: 'scroll-text',      commandId: 'budget.openSyncLog',      blurb: 'Per-message trace of the last few sync runs — including AI stage outcomes.' },
  { id: 'categories',   title: 'Categories',   icon: 'tag',              commandId: 'budget.openCategories',   blurb: 'Manage your category list — colour, icon, kind, and monthly limits.' },
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
  else if (sectionId === 'transactions')  cleanup = renderTransactionsSection(body, api);
  else if (sectionId === 'reviewQueue')   cleanup = renderReviewQueueSection(body, api);
  else if (sectionId === 'syncLog')       cleanup = renderSyncLogSection(body, api);
  else if (sectionId === 'categories')    cleanup = renderCategoriesSection(body, api);
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

// ─── Section: Transactions ─────────────────────────────────────────────────

function renderTransactionsSection(body, api) {
  let statusFilter = 'all'; // all|confirmed|review|hidden
  let search = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'budget-toolbar';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'budget-input';
  searchInput.placeholder = 'Search merchant…';
  searchInput.style.minWidth = '180px';
  searchInput.addEventListener('input', () => { search = searchInput.value; void refresh(); });

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

  const refreshBtn = makeButton('Refresh', {
    iconHtml: makeIcon(api, 'refresh-cw', 12),
    onClick: () => void refresh(),
  });
  const syncBtn = makeButton('Sync now', {
    primary: true,
    iconHtml: makeIcon(api, 'refresh-cw', 12),
    onClick: () => api.commands.executeCommand('budget.sync').finally(() => refresh()),
  });

  toolbar.appendChild(searchInput);
  toolbar.appendChild(statusFilters);
  const spacer = document.createElement('div'); spacer.className = 'spacer';
  toolbar.appendChild(spacer);
  toolbar.appendChild(refreshBtn);
  toolbar.appendChild(syncBtn);
  body.appendChild(toolbar);

  const tableWrap = document.createElement('div');
  body.appendChild(tableWrap);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    tableWrap.innerHTML = '';
    const where = [];
    const params = [];
    if (statusFilter !== 'all') { where.push('t.status = ?'); params.push(statusFilter); }
    else { where.push("t.status IN ('confirmed','review','hidden')"); }
    if (search.trim()) { where.push('LOWER(t.merchant) LIKE ?'); params.push(`%${search.trim().toLowerCase()}%`); }
    const sql = `
      SELECT t.id, t.merchant, t.amount_cents, t.transaction_date, t.status, t.ai_confidence,
             t.card_last_four, c.name AS category_name, c.color AS category_color
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.transaction_date DESC, t.created_at DESC
       LIMIT 500`;
    let rows;
    try { rows = await db.all(sql, params); }
    catch (e) { tableWrap.appendChild(emptyState('Query error: ' + (e instanceof Error ? e.message : String(e)))); return; }
    if (!rows || rows.length === 0) { tableWrap.appendChild(emptyState('No transactions yet — run a sync.')); return; }

    // Cache active expense categories for the per-row dropdown.
    let categoriesList = [];
    try { categoriesList = await db.all(`SELECT id, name, color FROM categories WHERE archived=0 ORDER BY sort_order, name`); }
    catch { categoriesList = []; }

    const table = document.createElement('table');
    table.className = 'budget-table';
    table.innerHTML = `
      <thead><tr>
        <th>Date</th><th>Merchant</th><th>Category</th>
        <th style="text-align:right">Amount</th>
        <th>Status</th><th>Conf</th><th>Card</th>
      </tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      const cents = Number(r.amount_cents) || 0;
      const amtCls = cents < 0 ? 'positive' : (cents > 0 ? 'negative' : '');

      const tdDate = document.createElement('td'); tdDate.textContent = fmtDate(r.transaction_date);
      const tdMerch = document.createElement('td'); tdMerch.textContent = r.merchant || '—';
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
      const tdCard = document.createElement('td');
      tdCard.textContent = r.card_last_four ? '••' + r.card_last_four : '';

      tr.appendChild(tdDate); tr.appendChild(tdMerch); tr.appendChild(tdCat);
      tr.appendChild(tdAmt); tr.appendChild(tdStatus); tr.appendChild(tdConf); tr.appendChild(tdCard);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }
  void refresh();
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
  body.appendChild(toolbar);

  const cards = document.createElement('div');
  cards.className = 'budget-cards';
  body.appendChild(cards);

  const catSection = document.createElement('div');
  catSection.className = 'budget-section';
  body.appendChild(catSection);

  const recoSection = document.createElement('div');
  recoSection.className = 'budget-section';
  body.appendChild(recoSection);

  let alive = true;
  async function refresh() {
    if (!alive) return;
    cards.innerHTML = '';
    catSection.innerHTML = '';
    recoSection.innerHTML = '';

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

    // ── Headline cards ────────────────────────────────────────
    const sumRow = await db.get(
      `SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END),0) AS spend,
              COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END),0) AS refunds,
              COUNT(*) AS n
         FROM transactions
        WHERE status='confirmed' AND transaction_date >= ?`,
      [monthStart],
    ) || { spend: 0, refunds: 0, n: 0 };

    const reviewCnt = (await db.get(`SELECT COUNT(*) AS n FROM transactions WHERE status='review'`)) || { n: 0 };
    const lastSyncedAt = await getSyncStateValue('last_synced_at');

    cards.appendChild(makeCard('Spend (MTD)', fmtMoney(sumRow.spend), `${sumRow.n} transactions`));
    cards.appendChild(makeCard('Refunds (MTD)', fmtMoney(sumRow.refunds), ''));
    cards.appendChild(makeCard('Review queue', String(reviewCnt.n || 0), reviewCnt.n ? 'Items awaiting confirmation' : 'All clear'));
    cards.appendChild(makeCard('Last sync', lastSyncedAt ? fmtDate(lastSyncedAt) + ' ' + String(lastSyncedAt).slice(11,16) : 'Never', ''));

    // ── Category breakdown ────────────────────────────────────
    const catHeader = document.createElement('h3'); catHeader.textContent = 'Spend by category (this month)';
    catSection.appendChild(catHeader);
    let catRows;
    try {
      catRows = await db.all(`
        SELECT c.id, c.name, c.color, c.monthly_limit_cents,
               COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS spend
          FROM categories c
          LEFT JOIN transactions t
            ON t.category_id = c.id AND t.status='confirmed' AND t.transaction_date >= ?
         WHERE c.archived = 0 AND c.kind='expense'
         GROUP BY c.id
         ORDER BY spend DESC, c.sort_order ASC`,
        [monthStart],
      );
    } catch { catRows = []; }
    if (!catRows || catRows.length === 0) {
      catSection.appendChild(emptyState('No category data yet.'));
    } else {
      const totalSpend = catRows.reduce((acc, r) => acc + (Number(r.spend) || 0), 0);

      // Donut + bars side by side when room allows; CSS already wraps.
      const layout = document.createElement('div');
      layout.style.display = 'flex';
      layout.style.gap = '20px';
      layout.style.flexWrap = 'wrap';
      layout.style.alignItems = 'flex-start';

      // Donut (only when there's at least one non-zero slice).
      if (totalSpend > 0) {
        layout.appendChild(buildDonut(catRows.filter(r => (Number(r.spend) || 0) > 0), totalSpend));
      }

      const bars = document.createElement('div');
      bars.style.flex = '1 1 320px';
      bars.style.minWidth = '280px';
      const max = Math.max(1, ...catRows.map(r => Number(r.spend) || 0));
      for (const r of catRows) {
        const spend = Number(r.spend) || 0;
        const pct = Math.round((spend / max) * 100);
        const limit = Number(r.monthly_limit_cents) || 0;
        const overLimit = limit > 0 && spend > limit;
        const row = document.createElement('div');
        row.className = 'budget-cat-bar';
        row.innerHTML = `
          <div><span class="budget-cat-swatch" style="background:${escHtml(r.color || '#888')}"></span>${escHtml(r.name)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${escHtml(overLimit ? '#ef4444' : (r.color || '#888'))}"></div></div>
          <div class="amt">${escHtml(fmtMoney(spend))}${limit ? ' / ' + escHtml(fmtMoney(limit)) : ''}</div>`;
        bars.appendChild(row);
      }
      layout.appendChild(bars);
      catSection.appendChild(layout);
    }

    // ── Reconciliation: latest snapshot vs. derived ───────────
    const recoHeader = document.createElement('h3'); recoHeader.textContent = 'Reconciliation';
    recoSection.appendChild(recoHeader);
    let snap;
    try { snap = await db.get(`SELECT account_last_four, balance_cents, snapshot_date FROM balance_snapshots ORDER BY snapshot_date DESC, created_at DESC LIMIT 1`); }
    catch { snap = null; }
    if (!snap) {
      recoSection.appendChild(emptyState('No balance snapshots yet — sync to reconcile.'));
    } else {
      const card = document.createElement('div'); card.className = 'budget-card'; card.style.maxWidth = '520px';
      card.innerHTML = `
        <div class="budget-card-label">Latest snapshot${snap.account_last_four ? ' • ••' + escHtml(snap.account_last_four) : ''}</div>
        <div class="budget-card-value">${escHtml(fmtMoney(snap.balance_cents))}</div>
        <div class="budget-card-sub">As of ${escHtml(fmtDate(snap.snapshot_date))}</div>`;
      recoSection.appendChild(card);
    }
  }
  void refresh();
  return () => { alive = false; };
}

function makeCard(label, value, sub) {
  const c = document.createElement('div'); c.className = 'budget-card';
  const l = document.createElement('div'); l.className = 'budget-card-label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'budget-card-value'; v.textContent = value;
  c.appendChild(l); c.appendChild(v);
  if (sub) { const s = document.createElement('div'); s.className = 'budget-card-sub'; s.textContent = sub; c.appendChild(s); }
  return c;
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
  const sys = 'You classify emails. Respond with a single JSON object and nothing else.';
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${truncateBody(msg.body)}\n\nReturn:\n{\n  "is_transaction": <true if this email reports a single bank or card transaction (charge, payment, refund, transfer, deposit); false otherwise>,\n  "is_balance":     <true if this email reports an account balance (statement, daily balance alert); false otherwise>\n}`;
  const r = await lmRunJson(api, modelId, sys, usr);
  if (!r || typeof r !== 'object') return { is_transaction: false, is_balance: false, malformed: true };
  return {
    is_transaction: r.is_transaction === true,
    is_balance:     r.is_balance === true,
    malformed:      false,
  };
}

async function aiStage2(api, modelId, msg) {
  const sys = 'You extract financial transaction data from emails. Respond with a single JSON object and nothing else. Money is reported in dollars; if you see cents, divide by 100. If multiple transactions are mentioned, return them in the "items" array.';
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${truncateBody(msg.body)}\n\nReturn:\n{\n  "items": [\n    {\n      "merchant":         <string or null>,\n      "amount":           <number — positive for spend/charge, negative for refund/credit>,\n      "card_last_four":   <string of 4 digits or null>,\n      "transaction_date": <"YYYY-MM-DD">,\n      "confidence":       <"high" | "medium" | "low">\n    }\n  ]\n}`;
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
      merchant:         typeof raw.merchant === 'string' ? raw.merchant : null,
      amount:           amt,
      card_last_four:   typeof raw.card_last_four === 'string' && /^\d{4}$/.test(raw.card_last_four) ? raw.card_last_four : null,
      transaction_date: date,
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
  const sys = 'You extract account balance information from emails. Respond with a single JSON object and nothing else.';
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${truncateBody(msg.body)}\n\nReturn:\n{\n  "account_last_four": <string of 4 digits or null>,\n  "balance":           <number, in dollars>,\n  "snapshot_date":     <"YYYY-MM-DD">\n}`;
  const r = await lmRunJson(api, modelId, sys, usr);
  if (!r || typeof r !== 'object') return null;
  const bal = typeof r.balance === 'number' ? r.balance : Number(r.balance);
  if (!Number.isFinite(bal)) return null;
  const date = typeof r.snapshot_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.snapshot_date)
    ? r.snapshot_date
    : isoLocalDate(msg.receivedAt);
  return {
    account_last_four: typeof r.account_last_four === 'string' && /^\d{4}$/.test(r.account_last_four) ? r.account_last_four : null,
    balance:           bal,
    snapshot_date:     date,
  };
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
        if (extracted.malformed || extracted.items.length === 0) {
          // Synthetic review row so user can manually triage.
          await db.run(
            `INSERT INTO transactions (id, gmail_message_id, amount_cents, transaction_date, ai_confidence, status, extractor_model)
             VALUES (?,?,?,?,?,?,?)`,
            [crypto.randomUUID(), msg.id, 0, isoLocalDate(msg.receivedAt), 'low', 'review', modelId],
          );
          counts.review++;
        } else {
          for (const item of extracted.items) {
            let categoryId = null;
            if (item.confidence !== 'low' && categoryNames.length > 0) {
              try {
                const picked = await aiStage3(api, modelId, item, categoryNames);
                if (picked) categoryId = categoryByName.get(picked.toLowerCase()) || null;
              } catch (e) {
                await syncLog(runId, 'warn', 'stage3', 'Categorize error: ' + (e instanceof Error ? e.message : String(e)), msg.id);
              }
            }
            await db.run(
              `INSERT INTO transactions (id, gmail_message_id, merchant, amount_cents, card_last_four, transaction_date, category_id, ai_confidence, extractor_model, categorizer_model, status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
              [
                crypto.randomUUID(), msg.id, item.merchant, dollarsToCents(item.amount),
                item.card_last_four, item.transaction_date, categoryId,
                item.confidence, modelId, modelId,
                item.confidence === 'low' ? 'review' : 'confirmed',
              ],
            );
            if (item.confidence === 'low') counts.review++; else counts.confirmed++;
          }
        }
      }

      // Stage 1b — balance snapshot
      if (cls.is_balance) {
        try {
          const snap = await aiStage1bExtract(api, modelId, msg);
          if (snap) {
            await db.run(
              `INSERT INTO balance_snapshots (id, gmail_message_id, account_last_four, balance_cents, snapshot_date)
               VALUES (?,?,?,?,?)`,
              [crypto.randomUUID(), msg.id, snap.account_last_four, dollarsToCents(snap.balance), snap.snapshot_date],
            );
            counts.snapshot++;
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

  const where = [`status='confirmed'`, `transaction_date >= ?`, `transaction_date <= ?`];
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
