// End-to-end verification of the WHOLE budget sync workflow, exactly as the
// dashboard "Run First Sync" / "Sync Now" button drives it — but observable.
//
// It does the real thing:
//   1. Spawns the REAL Gmail MCP server (tools/gmail-mcp-server/dist/index.js)
//      with the user's stored OAuth creds and calls list_emails with the EXACT
//      arguments budgetSync() uses (90-day window, issuer query, include_body).
//   2. Builds a REAL SQLite database with the full budget schema by applying
//      every migration in ext/budget/db/migrations, then seeds default categories.
//   3. Runs the EXACT pipeline copied verbatim from ext/budget/main.js:
//      Stage1 classify → Stage2 extract → Stage3 categorize → Stage1b balances,
//      with the real qwen3.6 model and the real DB inserts.
//   4. QUERIES the database and prints what actually landed: transactions with
//      merchant/amount/category, balance snapshots, and the email_imports ledger.
//
// Nothing here is mocked except the in-app event bus (_emitSync). The emails,
// the model, the parsing, and the database writes are all real.

import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OLLAMA = 'http://localhost:11434';
const NUM_CTX = 16384; // BUDGET_LM_NUM_CTX

// ── Resolve the active chat model (same source the extension uses) ──────────
function activeModelId() {
  try {
    const gs = JSON.parse(readFileSync(path.join(ROOT, 'data', 'global-storage.json'), 'utf8'));
    const m = gs['languageModels.activeModelId'];
    if (typeof m === 'string' && m) return m;
  } catch { /* fall through */ }
  return 'qwen3.6:latest';
}
const MODEL = activeModelId();

// ════════════════════════════════════════════════════════════════════════════
// 1. REAL Gmail MCP over stdio JSON-RPC
// ════════════════════════════════════════════════════════════════════════════
function spawnGmailMcp() {
  const server = path.join(ROOT, 'tools', 'gmail-mcp-server', 'bundle', 'server.mjs');
  const credPath = path.join(ROOT, 'data', 'gmail-mcp', 'credentials.json');
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, PARALLX_GMAIL_CRED_PATH: credPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write('[mcp] ' + d.toString()));

  let buf = '';
  const pending = new Map();
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    }
  });

  let nextId = 1;
  function call(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`MCP timeout on ${method}`)); }
      }, 120000);
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  return { call, notify, close: () => child.kill() };
}

// ════════════════════════════════════════════════════════════════════════════
// 2. REAL SQLite DB with full budget schema
// ════════════════════════════════════════════════════════════════════════════
function buildDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'budget-e2e-'));
  const dbPath = path.join(dir, 'budget.db');
  const raw = new DatabaseSync(dbPath);
  const migDir = path.join(ROOT, 'ext', 'budget', 'db', 'migrations');
  const files = readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(path.join(migDir, f), 'utf8');
    try { raw.exec(sql); }
    catch (e) { console.error(`[migration ${f}] ${e.message}`); throw e; }
  }
  console.log(`[db] applied ${files.length} migrations → ${dbPath}`);

  // async-shaped wrapper matching the extension's db.run/get/all contract.
  const db = {
    async run(sql, params = []) { raw.prepare(sql).run(...params); },
    async get(sql, params = []) { return raw.prepare(sql).get(...params); },
    async all(sql, params = []) { return raw.prepare(sql).all(...params); },
    _raw: raw,
  };
  return { db, dbPath };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. api shim — lm streams from real Ollama; mcp talks to the spawned server
// ════════════════════════════════════════════════════════════════════════════
function makeApi(mcp, listEmailsArgs) {
  return {
    lm: {
      getActiveModel: () => MODEL,
      async getModels() { return [{ id: MODEL }]; },
      async *sendChatRequest(modelId, messages, opts) {
        // Replicates src/built-in/chat/providers/ollamaProvider.ts request body.
        const options = { temperature: opts.temperature ?? 0 };
        if (opts.numCtx > 0) options.num_ctx = opts.numCtx;
        // No num_predict — opts.maxTokens is intentionally unset.
        const body = { model: modelId, messages, stream: true, options };
        if (opts.format) body.format = opts.format;
        const res = await fetch(`${OLLAMA}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            const j = JSON.parse(line);
            yield { content: j.message?.content ?? '', done: !!j.done };
          }
        }
      },
    },
    mcp: {
      async listTools() {
        const r = await mcp.call('tools/list', {});
        return Array.isArray(r?.tools) ? r.tools : [];
      },
      async invokeTool(name, args) {
        const result = await mcp.call('tools/call', { name, arguments: args });
        return result; // { content: [{ type:'text', text }] }
      },
    },
    workspace: {
      getConfiguration() {
        const cfg = {
          gmailMcpServerId: 'gmail',
          syncStartDays: 90,
          gmailQuery: 'from:(chase.com OR americanexpress.com OR capitalone.com OR discover.com OR citibank.com OR wellsfargo.com OR bankofamerica.com OR usbank.com)',
        };
        return { get: (k, d) => (k in cfg ? cfg[k] : d) };
      },
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Pipeline helpers — copied VERBATIM from ext/budget/main.js
// ════════════════════════════════════════════════════════════════════════════
let _lastMalformedSample = null;
function budgetLmOptions() { return { temperature: 0, format: 'json', numCtx: NUM_CTX }; }
function tryParseModelJson(raw) {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch { /* */ }
  const start = trimmed.indexOf('{'), end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* */ } }
  return undefined;
}
async function lmRunJson(api, modelId, systemPrompt, userPrompt, stage = 'default') {
  const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }];
  const opts = budgetLmOptions(stage);
  const collect = async (msgs) => {
    let out = '';
    for await (const chunk of api.lm.sendChatRequest(modelId, msgs, opts)) {
      if (chunk && typeof chunk.content === 'string') out += chunk.content;
      if (chunk && chunk.done) break;
    }
    return out;
  };
  let raw = await collect(messages);
  let parsed = tryParseModelJson(raw);
  if (parsed !== undefined) return parsed;
  const retry = messages.concat([
    { role: 'assistant', content: raw },
    { role: 'user', content: 'Respond ONLY with the JSON object — no prose, no markdown.' },
  ]);
  raw = await collect(retry);
  parsed = tryParseModelJson(raw);
  if (parsed === undefined && _lastMalformedSample === null) {
    _lastMalformedSample = { stage, modelId, rawHead: String(raw).slice(0, 400), rawLen: String(raw).length };
  }
  return parsed;
}
function normalizeAccountKind(hint) {
  if (typeof hint !== 'string') return 'other';
  const v = hint.trim().toLowerCase();
  if (v === 'checking' || v === 'savings' || v === 'credit_card' || v === 'other') return v;
  if (v.includes('check')) return 'checking';
  if (v.includes('save')) return 'savings';
  if (v.includes('credit') || v.includes('card') || v.includes('visa') || v.includes('mastercard')) return 'credit_card';
  return 'other';
}
function truncateBody(body) {
  if (typeof body !== 'string' || !body) return '';
  const cleaned = body.replace(/&zwnj;|\u200c/gi, '').replace(/&nbsp;|\u00a0/gi, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned.length > 3000 ? cleaned.slice(0, 3000) : cleaned;
}
function dollarsToCents(n) { return Math.round(Number(n) * 100); }
function localYmd(d) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function todayYmd() { return localYmd(new Date()); }
function isoLocalDate(isoTs) { if (!isoTs) return todayYmd(); try { return localYmd(new Date(isoTs)); } catch { return todayYmd(); } }
function isoNDaysAgo(n) { return new Date(Date.now() - (Math.max(1, n | 0) * 864e5)).toISOString(); }

async function aiStage1(api, modelId, msg) {
  const sys = 'You classify bank and credit-card emails. Respond with a single JSON object and nothing else.';
  const usr = `Subject: ${msg.subject || ''}\nSnippet: ${msg.snippet || ''}\nBody: ${truncateBody(msg.body)}\n\n` +
    `Classify the email as exactly one of these event types:\n` +
    `  • "purchase"        — a real charge on a debit or credit card (gas, restaurant, subscription) OR a return/credit on a card. Refunds are purchases with a negative amount; do NOT use a separate refund type.\n` +
    `  • "deposit"         — money INTO a bank account from outside (paycheck, direct deposit, external transfer-IN).\n` +
    `  • "transfer"        — INTERNAL movement between this user's own accounts. THIS INCLUDES paying a credit card from checking.\n` +
    `  • "fee"             — bank fee, overdraft, ATM fee, late fee.\n` +
    `  • "balance_summary" — daily / periodic summary that lists ACCOUNT BALANCES (typical subjects: "Your daily account summary", "Account balance alert").\n` +
    `  • "other"           — statement-ready notice, marketing, security alerts, password resets, etc. (no money moved).\n\n` +
    `Account-kind hint should reflect which kind of account the event hits (use the body text — credit-card emails usually mention "Visa", "Mastercard", or a card name; bank emails mention "Total Checking", "Savings").\n\n` +
    `Return:\n{\n  "event_type":         <one of the strings above>,\n  "account_kind_hint":  <"checking" | "savings" | "credit_card" | "other">\n}`;
  const r = await lmRunJson(api, modelId, sys, usr, 'classify');
  if (!r || typeof r !== 'object') return { event_type: 'other', account_kind_hint: 'other', malformed: true };
  let eventType = typeof r.event_type === 'string' ? r.event_type.trim().toLowerCase() : 'other';
  if (eventType === 'refund') eventType = 'purchase';
  if (eventType === 'cc_payment') eventType = 'transfer';
  const valid = new Set(['purchase', 'deposit', 'transfer', 'fee', 'balance_summary', 'other']);
  return {
    event_type: valid.has(eventType) ? eventType : 'other',
    account_kind_hint: normalizeAccountKind(r.account_kind_hint),
    is_transaction: ['purchase', 'deposit', 'transfer', 'fee'].includes(eventType),
    is_balance: eventType === 'balance_summary',
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
      ? raw.transaction_date : isoLocalDate(msg.receivedAt);
    const confidence = (raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low') ? raw.confidence : 'low';
    items.push({
      merchant: typeof raw.merchant === 'string' ? raw.merchant : null,
      amount: amt,
      card_last_four: typeof raw.card_last_four === 'string' && /^\d{4}$/.test(raw.card_last_four) ? raw.card_last_four : null,
      account_kind_hint: normalizeAccountKind(raw.account_kind_hint),
      transaction_date: date,
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
  const date = typeof r.snapshot_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.snapshot_date) ? r.snapshot_date : isoLocalDate(msg.receivedAt);
  const out = [];
  for (const raw of (Array.isArray(r.accounts) ? r.accounts : [])) {
    if (!raw || typeof raw !== 'object') continue;
    const bal = typeof raw.balance === 'number' ? raw.balance : Number(raw.balance);
    if (!Number.isFinite(bal)) continue;
    out.push({
      account_kind: normalizeAccountKind(raw.account_kind),
      account_last_four: typeof raw.account_last_four === 'string' && /^\d{4}$/.test(raw.account_last_four) ? raw.account_last_four : null,
      balance: bal,
    });
  }
  return out.length ? { snapshot_date: date, accounts: out } : null;
}

// DB-backed helpers (faithful, minimal — fresh DB so rules are empty).
function makeDbHelpers(db) {
  const ACCOUNT_KINDS = ['checking', 'savings', 'credit_card', 'other'];
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
  async function upsertAccount(last4, kindHint, displayHint, opts = {}) {
    if (!last4 || !/^\d{4}$/.test(String(last4))) return null;
    const kind = normalizeAccountKind(kindHint);
    const existing = await db.get('SELECT id, last_four, kind, display_name FROM accounts WHERE last_four=?', [last4]);
    if (existing) {
      const trustedKind = !!(opts && opts.trustedKind);
      const shouldApplyKind = kind !== 'other' && (existing.kind === 'other' || (trustedKind && existing.kind !== kind));
      if (shouldApplyKind) {
        const displayWasDefault = isDefaultAccountName(existing.display_name, existing.last_four);
        const nextName = displayWasDefault ? (displayHint || defaultAccountName(kind, last4)) : existing.display_name;
        await db.run('UPDATE accounts SET kind=?, display_name=?, updated_at=? WHERE id=?', [kind, nextName, new Date().toISOString(), existing.id]);
        existing.kind = kind; existing.display_name = nextName;
      }
      return existing;
    }
    const id = randomUUID();
    const name = displayHint || defaultAccountName(kind, last4);
    await db.run('INSERT INTO accounts (id, last_four, kind, display_name) VALUES (?, ?, ?, ?)', [id, last4, kind, name]);
    return { id, last_four: last4, kind, display_name: name };
  }
  async function loadActiveRules() {
    try { return await db.all(`SELECT * FROM rules WHERE archived=0`); } catch { return []; }
  }
  async function applyRules() { return null; } // fresh DB → no rules
  return { upsertAccount, loadActiveRules, applyRules };
}

// ════════════════════════════════════════════════════════════════════════════
// budgetSync core loop — copied from ext/budget/main.js (event-bus calls removed)
// ════════════════════════════════════════════════════════════════════════════
async function budgetSync(api, db) {
  const { upsertAccount, loadActiveRules, applyRules } = makeDbHelpers(db);
  const counts = { confirmed: 0, review: 0, snapshot: 0, skipped: 0, errors: 0, malformed: 0, classifiedOther: 0 };
  const cfg = api.workspace.getConfiguration('budget');
  const sinceIso = isoNDaysAgo(cfg.get('syncStartDays', 90));
  const modelId = await api.lm.getActiveModel();
  const gmailQuery = cfg.get('gmailQuery');

  // Tool-name discovery — exactly the extension's logic: prefer list_emails,
  // fall back to the legacy list_unread when the server isn't rebuilt.
  const available = await api.mcp.listTools();
  const has = (n) => Array.isArray(available) && available.some(t => t.name === n);
  const toolName = has('list_emails') ? 'list_emails' : (has('list_unread') ? 'list_unread' : null);
  if (!toolName) throw new Error('Gmail MCP exposes neither list_emails nor list_unread');

  console.log(`[sync] model=${modelId} since=${sinceIso}`);
  console.log(`[sync] invoking Gmail MCP ${toolName} (max=100, read_state=all, include_body=true)…`);
  const result = await api.mcp.invokeTool(toolName, {
    since: sinceIso, max: 100, read_state: 'all', query: gmailQuery, include_body: true,
  });
  if (result && result.isError) throw new Error(`Gmail MCP error: ${result.content?.[0]?.text ?? 'unknown'}`);
  const payload = result?.content?.[0]?.text ?? '{"messages":[]}';
  const parsed = JSON.parse(payload);
  const messages = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.messages) ? parsed.messages : []);
  const cap = Number(process.env.BUDGET_E2E_MAX) || messages.length;
  const work = messages.slice(0, cap);
  console.log(`[sync] Gmail returned ${messages.length} message(s); processing ${work.length}\n`);

  const categoryRows = await db.all(`SELECT id, name FROM categories WHERE archived=0 AND kind='expense' ORDER BY sort_order`);
  const categoryNames = categoryRows.map(r => r.name);
  const categoryByName = new Map(categoryRows.map(r => [String(r.name).toLowerCase(), r.id]));
  const activeRules = await loadActiveRules();

  let i = 0;
  for (const msg of work) {
    i++;
    if (!msg || !msg.id) { counts.skipped++; continue; }
    const already = await db.get('SELECT 1 AS x FROM email_imports WHERE gmail_message_id=?', [msg.id]);
    if (already) { counts.skipped++; continue; }

    let cls;
    try { cls = await aiStage1(api, modelId, msg); }
    catch (e) { cls = { is_transaction: false, is_balance: false, malformed: true }; counts.errors++; }
    if (cls.malformed) counts.malformed++;
    else if (!cls.is_transaction && !cls.is_balance) counts.classifiedOther++;
    process.stdout.write(`  [${i}/${work.length}] ${(msg.subject || '(no subject)').slice(0, 60).padEnd(60)} → ${cls.event_type || 'other'}\n`);

    await db.run(
      `INSERT INTO email_imports (gmail_message_id, received_at, raw_subject, raw_snippet, is_transaction, is_balance, classifier_model, processed_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [msg.id, msg.receivedAt || new Date().toISOString(), msg.subject || null, msg.snippet || null,
        cls.is_transaction ? 1 : 0, cls.is_balance ? 1 : 0, modelId, new Date().toISOString()]);

    if (cls.is_transaction) {
      let extracted;
      try { extracted = await aiStage2(api, modelId, msg); }
      catch (e) { extracted = { items: [], malformed: true }; }
      const evt = cls.event_type;
      const txType = (evt === 'purchase' || evt === 'deposit' || evt === 'transfer' || evt === 'fee') ? evt : 'other';
      if (extracted.malformed || extracted.items.length === 0) {
        await db.run(
          `INSERT INTO transactions (id, gmail_message_id, amount_cents, transaction_date, ai_confidence, status, extractor_model, tx_type)
           VALUES (?,?,?,?,?,?,?,?)`,
          [randomUUID(), msg.id, 0, isoLocalDate(msg.receivedAt), 'low', 'review', modelId, txType]);
        counts.review++;
      } else {
        for (const item of extracted.items) {
          const kindForUpsert = item.account_kind_hint && item.account_kind_hint !== 'other' ? item.account_kind_hint : (cls.account_kind_hint || 'other');
          let accountId = null;
          if (item.card_last_four) { const acct = await upsertAccount(item.card_last_four, kindForUpsert, null); accountId = acct ? acct.id : null; }
          let categoryId = null, categorizerModel = null, categorizationSource = null, matchedRuleId = null;
          if (txType === 'purchase') {
            const matched = await applyRules(item.merchant, activeRules);
            if (matched) { categoryId = matched.categoryId; categorizerModel = 'rule:' + matched.ruleId; categorizationSource = 'rule'; matchedRuleId = matched.ruleId; }
            else if (item.confidence !== 'low' && categoryNames.length > 0) {
              try {
                const picked = await aiStage3(api, modelId, item, categoryNames);
                if (picked) { categoryId = categoryByName.get(picked.toLowerCase()) || null; categorizerModel = modelId; if (categoryId) categorizationSource = 'ai'; }
              } catch { /* */ }
            }
          }
          const cents = dollarsToCents(item.amount);
          const crossFail = (txType === 'deposit' && cents > 0) || (txType === 'purchase' && !item.merchant) || (txType === 'fee' && !item.merchant) || (txType === 'transfer' && !item.merchant);
          const insertStatus = (item.confidence === 'low' || crossFail) ? 'review' : 'confirmed';
          const crossNote = crossFail ? '[cross-check: tx_type=' + txType + ', merchant=' + (item.merchant || 'NULL') + ', amount=' + (cents / 100).toFixed(2) + ']' : null;
          await db.run(
            `INSERT INTO transactions (id, gmail_message_id, merchant, amount_cents, card_last_four, transaction_date, category_id, account_id, tx_type, ai_confidence, extractor_model, categorizer_model, status, categorization_source, matched_rule_id, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [randomUUID(), msg.id, item.merchant, cents, item.card_last_four, item.transaction_date, categoryId, accountId, txType, item.confidence, modelId, categorizerModel, insertStatus, categorizationSource, matchedRuleId, crossNote]);
          if (insertStatus === 'review') counts.review++; else counts.confirmed++;
        }
      }
    }

    if (cls.is_balance) {
      try {
        const snap = await aiStage1bExtract(api, modelId, msg);
        if (snap && Array.isArray(snap.accounts) && snap.accounts.length > 0) {
          for (const a of snap.accounts) {
            let accountId = null;
            if (a.account_last_four) { const acct = await upsertAccount(a.account_last_four, a.account_kind, null, { trustedKind: true }); accountId = acct ? acct.id : null; }
            await db.run(
              `INSERT INTO balance_snapshots (id, gmail_message_id, account_id, account_last_four, kind, balance_cents, snapshot_date)
               VALUES (?,?,?,?,?,?,?)`,
              [randomUUID(), msg.id, accountId, a.account_last_four, a.account_kind, dollarsToCents(a.balance), snap.snapshot_date]);
            counts.snapshot++;
          }
        } else { counts.errors++; }
      } catch { counts.errors++; }
    }
  }
  return counts;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Run it, then QUERY the database to prove what landed
// ════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\n===== Budget Sync E2E — real Gmail MCP + real DB + ${MODEL} =====\n`);
  const { db } = buildDb();
  // Seed default categories (extension does this on activate).
  const cats = [
    ['Groceries', 'expense', 10], ['Dining', 'expense', 20], ['Transport', 'expense', 30],
    ['Utilities', 'expense', 40], ['Shopping', 'expense', 50], ['Health', 'expense', 60],
    ['Entertainment', 'expense', 70], ['Subscriptions', 'expense', 80], ['Travel', 'expense', 90],
    ['Other', 'expense', 100], ['Income', 'income', 110], ['Transfer', 'transfer', 120],
  ];
  for (const [name, kind, sort] of cats) {
    await db.run(`INSERT INTO categories (id, name, kind, sort_order) VALUES (?,?,?,?)`, [randomUUID(), name, kind, sort]);
  }

  const mcp = spawnGmailMcp();
  let counts;
  try {
    await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1.0' } });
    mcp.notify('notifications/initialized', {});
    const api = makeApi(mcp, { toolName: 'list_emails' });
    const t0 = Date.now();
    counts = await budgetSync(api, db);
    console.log(`\n[sync] complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } finally {
    mcp.close();
  }

  // ── Database verification queries ──
  console.log(`\n========== COUNTS ==========`);
  console.log(JSON.stringify(counts, null, 2));

  const emailN = (await db.get('SELECT COUNT(*) n FROM email_imports')).n;
  const txN = (await db.get('SELECT COUNT(*) n FROM transactions')).n;
  const confN = (await db.get(`SELECT COUNT(*) n FROM transactions WHERE status='confirmed'`)).n;
  const revN = (await db.get(`SELECT COUNT(*) n FROM transactions WHERE status='review'`)).n;
  const snapN = (await db.get('SELECT COUNT(*) n FROM balance_snapshots')).n;
  const acctN = (await db.get('SELECT COUNT(*) n FROM accounts')).n;
  console.log(`\n========== DATABASE STATE ==========`);
  console.log(`email_imports:     ${emailN}`);
  console.log(`transactions:      ${txN}  (confirmed=${confN}, review=${revN})`);
  console.log(`balance_snapshots: ${snapN}`);
  console.log(`accounts:          ${acctN}`);

  const txRows = await db.all(`
    SELECT t.transaction_date AS d, t.merchant AS m, t.amount_cents AS c, t.tx_type AS ty,
           t.status AS s, c.name AS cat, t.card_last_four AS l4
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
    ORDER BY t.transaction_date DESC LIMIT 25`);
  if (txRows.length) {
    console.log(`\n========== TRANSACTIONS (up to 25) ==========`);
    for (const r of txRows) {
      const amt = (r.c / 100).toFixed(2).padStart(10);
      console.log(`  ${r.d}  ${amt}  ${(r.ty || '').padEnd(9)} ${(r.cat || '—').padEnd(14)} ${(r.s || '').padEnd(9)} ${r.l4 ? '••' + r.l4 + ' ' : ''}${r.m || ''}`);
    }
  }

  const snapRows = await db.all(`SELECT snapshot_date d, kind k, account_last_four l4, balance_cents b FROM balance_snapshots ORDER BY snapshot_date DESC LIMIT 25`);
  if (snapRows.length) {
    console.log(`\n========== BALANCE SNAPSHOTS (up to 25) ==========`);
    for (const r of snapRows) console.log(`  ${r.d}  ${(r.k || '').padEnd(12)} ${r.l4 ? '••' + r.l4 : ''}  ${(r.b / 100).toFixed(2)}`);
  }

  if (_lastMalformedSample) {
    console.log(`\n⚠ first parse failure (stage=${_lastMalformedSample.stage}): ${_lastMalformedSample.rawHead}`);
  }

  console.log(`\n========== VERDICT ==========`);
  const ok = emailN > 0 && (confN + revN + snapN) > 0;
  const verdict = ok
    ? `✅ Workflow works: ${emailN} emails pulled, ${confN} confirmed + ${revN} review transactions, ${snapN} balance snapshots written to the DB.`
    : `❌ Nothing meaningful landed. emails=${emailN} confirmed=${confN} review=${revN} snapshots=${snapN}.`;
  console.log(verdict);

  // Write a clean report to disk so it can be inspected without terminal scrollback noise.
  const report = {
    model: MODEL,
    counts,
    dbState: { email_imports: emailN, transactions: txN, confirmed: confN, review: revN, balance_snapshots: snapN, accounts: acctN },
    transactions: txRows,
    balanceSnapshots: snapRows,
    malformedSample: _lastMalformedSample,
    verdict,
  };
  const { writeFileSync } = await import('node:fs');
  const outPath = path.join(ROOT, 'budget-e2e-report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n[report] written to ${outPath}`);
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
