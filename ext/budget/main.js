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

// ─── Sidebar nav view ──────────────────────────────────────────────────────
function renderSidebarNav(container, api) {
  const root = document.createElement('div');
  root.className = 'budget-nav';
  root.style.cssText = 'display:flex;flex-direction:column;padding:6px 0;font-family:var(--font-family);';

  for (const section of SECTIONS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'budget-nav-row';
    row.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:6px 12px',
      'border:none',
      'background:transparent',
      'color:var(--foreground)',
      'font-size:13px',
      'text-align:left',
      'cursor:pointer',
      'border-radius:0',
    ].join(';');
    row.addEventListener('mouseenter', () => { row.style.background = 'var(--list-hoverBackground, rgba(255,255,255,0.06))'; });
    row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

    if (api.icons && typeof api.icons.createIconHtml === 'function' && api.icons.hasIcon(section.icon)) {
      const iconWrap = document.createElement('span');
      iconWrap.style.cssText = 'display:inline-flex;width:16px;height:16px;flex:0 0 16px;color:var(--description-foreground);';
      iconWrap.innerHTML = api.icons.createIconHtml(section.icon, 16);
      row.appendChild(iconWrap);
    }

    const label = document.createElement('span');
    label.textContent = section.title;
    label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    row.appendChild(label);

    row.addEventListener('click', () => {
      api.commands.executeCommand(section.commandId).catch(err => {
        console.error('[Budget] open section failed:', err);
      });
    });

    root.appendChild(row);
  }

  // Footer: Sync action
  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:8px;padding:6px 12px;border-top:1px solid var(--panel-border, rgba(255,255,255,0.08));';
  const syncBtn = document.createElement('button');
  syncBtn.type = 'button';
  syncBtn.textContent = 'Sync now';
  syncBtn.style.cssText = [
    'width:100%',
    'padding:6px 8px',
    'background:var(--button-secondaryBackground, rgba(255,255,255,0.06))',
    'color:var(--foreground)',
    'border:1px solid var(--panel-border, rgba(255,255,255,0.12))',
    'border-radius:4px',
    'font-size:12px',
    'cursor:pointer',
  ].join(';');
  syncBtn.addEventListener('click', () => {
    api.commands.executeCommand('budget.sync').catch(err => {
      console.error('[Budget] sync failed:', err);
    });
  });
  footer.appendChild(syncBtn);
  root.appendChild(footer);

  container.appendChild(root);

  return {
    dispose() {
      try { container.removeChild(root); } catch { /* container already gone */ }
    },
  };
}

// ─── Editor pane — placeholder shell ───────────────────────────────────────
//
// Single editor provider. Routes by instanceId 'budget:<sectionId>'.
// Each section will be replaced by a real renderer in P2+.
function renderEditorPane(container, api, input) {
  const section = sectionByEditorInstanceId(input && input.id);

  const el = document.createElement('div');
  el.className = 'budget-editor';
  el.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:12px',
    'padding:24px 32px',
    'height:100%',
    'overflow:auto',
    'color:var(--foreground)',
    'font-family:var(--font-family)',
    'box-sizing:border-box',
  ].join(';');

  const heading = document.createElement('h2');
  heading.textContent = section ? section.title : 'Budget';
  heading.style.cssText = 'margin:0;font-size:20px;font-weight:600;';
  el.appendChild(heading);

  if (section) {
    const blurb = document.createElement('p');
    blurb.textContent = section.blurb;
    blurb.style.cssText = 'margin:0;font-size:13px;color:var(--description-foreground);line-height:1.5;max-width:680px;';
    el.appendChild(blurb);
  }

  const tag = document.createElement('div');
  tag.textContent = 'Scaffold — populated by Milestone 63 P2.';
  tag.style.cssText = 'margin-top:8px;font-size:12px;color:var(--description-foreground);font-style:italic;';
  el.appendChild(tag);

  container.appendChild(el);
  return {
    dispose() {
      try { container.removeChild(el); } catch { /* container already gone */ }
    },
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
