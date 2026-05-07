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

  if (section) {
    const blurb = document.createElement('p');
    blurb.className = 'budget-editor-blurb';
    blurb.textContent = section.blurb;
    body.appendChild(blurb);
  }

  const tag = document.createElement('div');
  tag.className = 'budget-editor-tag';
  tag.textContent = 'Scaffold — populated by Milestone 63 P2.';
  body.appendChild(tag);

  el.appendChild(body);

  container.appendChild(el);
  return {
    dispose() { try { container.removeChild(el); } catch { /* container already gone */ } },
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

  // ── Sync command ─────────────────────────────────────────────────────
  _disposables.push(api.commands.registerCommand('budget.sync', async () => {
    // P0 dependencies: api.mcp.invokeTool + api.cron.upsertJob.
    // Until they land, surface a clear notification rather than failing silently.
    if (!api.mcp || !api.cron || !api.chat || !api.lm) {
      const missing = [
        !api.mcp && 'api.mcp',
        !api.cron && 'api.cron',
        !api.chat && 'api.chat',
        !api.lm && 'api.lm',
      ].filter(Boolean).join(', ');
      await api.window.showWarningMessage(
        `Budget sync requires P0 capabilities not yet landed: ${missing}. See Milestone 63 plan.`,
      );
      return;
    }
    // Sync engine arrives in P2 — wired through api.chat.registerTool('budget.sync', ...).
    await api.window.showInformationMessage('Budget sync engine ships in M63 P2.');
  }));
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
