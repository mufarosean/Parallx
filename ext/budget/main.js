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
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\n\nReturn:\n{\n  "is_transaction": <true if this email reports a single bank or card transaction (charge, payment, refund, transfer); false otherwise>,\n  "is_balance":     <true if this email reports an account balance (statement, daily balance alert); false otherwise>\n}`;
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
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\n\nReturn:\n{\n  "items": [\n    {\n      "merchant":         <string or null>,\n      "amount":           <number — positive for spend/charge, negative for refund/credit>,\n      "card_last_four":   <string of 4 digits or null>,\n      "transaction_date": <"YYYY-MM-DD">,\n      "confidence":       <"high" | "medium" | "low">\n    }\n  ]\n}`;
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
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\n\nReturn:\n{\n  "account_last_four": <string of 4 digits or null>,\n  "balance":           <number, in dollars>,\n  "snapshot_date":     <"YYYY-MM-DD">\n}`;
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
    const serverId = cfg.get('gmailMcpServerId', 'parallx-gmail-mcp');
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
    });
    if (result && result.isError) {
      throw new Error(`Gmail MCP error: ${result.content?.[0]?.text ?? 'unknown'}`);
    }
    const payload = result?.content?.[0]?.text ?? '[]';
    let messages;
    try { messages = JSON.parse(payload); } catch (e) {
      throw new Error('Gmail MCP returned non-JSON payload: ' + (e instanceof Error ? e.message : String(e)));
    }
    if (!Array.isArray(messages)) messages = [];

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
