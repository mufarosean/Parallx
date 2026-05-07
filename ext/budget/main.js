// Budget extension — main.js (M63 P1 scaffold)
//
// Per the Milestone 63 plan (docs/Parallx_Milestone_63.md):
//   • Single bundled module, no runtime build step.
//   • Per-extension SQLite via api.database. Migrations under ./db/migrations.
//   • Money is INTEGER cents (D3). Dates are 'YYYY-MM-DD' local (D4).
//   • Sync (chat tool) + scheduled cron upsert require api.mcp + api.cron
//     which arrive in P0. This scaffold soft-guards both so the extension
//     boots and the views render today; the sync command surfaces a clear
//     "P0 not landed" notification until then.
//
// Extension contract: external unpacked tool. Loaded by ToolLoader as ESM.

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

// ─── View provider — placeholder shell ─────────────────────────────────────
//
// Every view contributes a card explaining its eventual purpose plus a
// "scaffold" note. This keeps the activity bar entry meaningful while P2+
// features land. Disposing the view tears down our DOM; we hold no
// per-view subscriptions yet.
function makePlaceholderProvider(viewLabel, blurb) {
  return {
    createView(container) {
      const el = document.createElement('div');
      el.className = 'budget-view-placeholder';
      el.style.cssText = 'padding:20px;display:flex;flex-direction:column;gap:8px;color:var(--foreground);font-family:var(--font-family);';
      const h = document.createElement('h3');
      h.textContent = viewLabel;
      h.style.cssText = 'margin:0 0 4px 0;font-size:14px;font-weight:600;';
      const p = document.createElement('p');
      p.textContent = blurb;
      p.style.cssText = 'margin:0;font-size:12px;color:var(--description-foreground);line-height:1.5;';
      const tag = document.createElement('div');
      tag.textContent = 'Scaffold — populated by Milestone 63 P2.';
      tag.style.cssText = 'margin-top:12px;font-size:11px;color:var(--description-foreground);font-style:italic;';
      el.appendChild(h);
      el.appendChild(p);
      el.appendChild(tag);
      container.appendChild(el);
      return {
        dispose() {
          try { container.removeChild(el); } catch { /* container already gone */ }
        },
      };
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

  // ── Views ────────────────────────────────────────────────────────────
  _disposables.push(api.views.registerViewProvider('budget.dashboard',
    makePlaceholderProvider('Dashboard',
      'Month-to-date spend, category breakdown, and balance reconciliation.'),
  ));
  _disposables.push(api.views.registerViewProvider('budget.transactions',
    makePlaceholderProvider('Transactions',
      'Searchable, filterable ledger of every imported transaction.'),
  ));
  _disposables.push(api.views.registerViewProvider('budget.reviewQueue',
    makePlaceholderProvider('Review Queue',
      'AI-flagged low-confidence imports awaiting your confirmation.'),
  ));
  _disposables.push(api.views.registerViewProvider('budget.syncLog',
    makePlaceholderProvider('Sync Log',
      'Per-message trace of the last few sync runs — including AI stage outcomes.'),
  ));
  _disposables.push(api.views.registerViewProvider('budget.categories',
    makePlaceholderProvider('Categories',
      'Manage your category list — colour, icon, kind, and monthly limits.'),
  ));

  // ── Commands ─────────────────────────────────────────────────────────
  _disposables.push(api.commands.registerCommand('budget.openDashboard', async () => {
    await api.commands.executeCommand('workbench.view.show', 'budget.dashboard');
  }));

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
