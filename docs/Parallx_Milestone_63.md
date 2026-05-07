# Milestone 63 — Budget Dashboard (Gmail → AI → SQLite → UI)

**Status:** planning
**Branch:** `milestone-63`
**Predecessor:** M62 (MCP-Only Provider Integration)

---

## Vision

> Your Gmail inbox is already a ledger. Every transaction notification, every
> bank alert, every Venmo ping is a structured financial event buried in plain
> text. M63 turns that inbox into a live, AI-categorized budget dashboard —
> no external service, no subscription, no cloud sync. Just your email, a local
> SQLite database, and a Parallx tool.

The pipeline is:

```
Gmail MCP (list_unread)
    → AI extraction layer  (classify + parse transaction fields)
    → AI categorization layer  (merchant → budget category)
    → SQLite database  (source of truth)
    → Budget Dashboard tool  (read/write UI — charts, transaction list, review queue)
```

The AI is a **preprocessing step, not a runtime dependency.** Once transactions
are in the database, the dashboard renders and the budget works — even with
Ollama offline. The model runs at sync time, not at view time.

---

## Alignment with Parallx Principles

Parallx is a **second-brain workbench** — VS Code's architecture repurposed as a
tool platform. Every tool lives outside core, registered via manifest, and speaks
through the same `parallx.*` API. This milestone follows that contract exactly:

| Parallx Principle | How M63 honors it |
|---|---|
| Mirror VS Code's structure | Budget tool is a registered extension — manifest, contribute.views, contribute.commands, no core changes |
| Never reinvent the wheel | Reuses `DatabaseService` (IPC SQLite bridge), `ILanguageModelToolsService.invokeToolWithRuntimeControl`, `View` base class, design tokens |
| Local-only AI via Ollama | AI pipeline calls `ILanguageModelsService.sendChatRequest` — same path as all other model calls in the app |
| Skill-based tool system | Budget sync is a programmatic pipeline, not a chat skill — but it calls the same MCP tool (`mcp__parallx-gmail-mcp__list_unread`) via the same `invokeToolWithRuntimeControl` path autonomy already uses |
| No provider names in core (M62) | The Gmail MCP is an external server; core never sees Gmail-specific code |
| Second brain, not app store | Budget dashboard is a **domain tool** in the workbench, not a separate window or Electron app |

---

## Principles

1. **Gmail message ID is the deduplication key.** Every transaction row links
   to the Gmail message that produced it. Syncing the same email twice is
   safe — the insert is a no-op.
2. **Cursor-based sync — no gaps.** The sync engine stores the last-seen Gmail
   message ID (a cursor). Each sync job fetches only mail after that cursor.
   The first sync is the only special case.
3. **AI categorization is overridable.** The user can change any category. The
   DB records whether the category was AI-assigned or user-overridden. Re-sync
   never overwrites a user override.
4. **Balance is derived, reconciled by snapshots.** Running balance = sum of
   all imported transactions. Chase balance-notification emails become
   reconciliation snapshots — if derived ≠ snapshot, the UI flags the gap.
5. **Low-confidence transactions are quarantined.** If the AI cannot confidently
   extract a transaction, the row is inserted with `status = 'review'` and
   surfaced in a review queue. It does not count toward budget totals until
   confirmed.
6. **No core changes.** This is a Parallx tool — a manifest, its own views,
   and its own SQLite database domain. It does not modify `src/` core files.

---

## What this is NOT

- Not a bank API integration (Plaid, etc.) — we parse emails only.
- Not a multi-account reconciliation system — one user, one local DB.
- Not real-time — sync is manual or scheduled, not event-driven.
- Not a replacement for YNAB / Mint — a focused, private-by-default view of
  what the inbox already contains.

---

## Extension System Contract — How Budget Gets Wired

This milestone produces a Parallx **extension**, not a core feature. Everything
below is the contract every extension obeys, restated here so the implementation
plan has zero ambiguity.

### 1. What "being an extension" means in Parallx

An extension is a **directory containing a `parallx-manifest.json` and an entry
module** that exports `activate(api, context)` (and optionally `deactivate()`).
It ships either:

- **Unpacked** at `ext/<id>/` (development + first-party tools today: media-organizer, text-generator, workspace-graph), or
- **Packed** as a `.plx` zip (publishable artifact, produced by `scripts/package-*.mjs`).

At runtime the extension is a sandboxed module:

- It runs in the renderer process under the workbench's module loader (`ToolModuleLoader`).
- It cannot `import` from the core `src/` tree. The only external symbols it
  receives are the two arguments to `activate(api, context)`. There is no other
  channel — no `window.parallx`, no globals, no IPC handles.
- All persistent capability is through `api.*` and the `context.subscriptions`
  disposable list. Anything the extension creates that needs cleanup must be
  pushed onto `context.subscriptions` so deactivation can dispose it in reverse.

### 2. Discovery and lifecycle

Source: `src/tools/toolScanner.ts`, `src/tools/toolRegistry.ts`,
`src/tools/toolActivator.ts`.

```
startup
  → ToolScanner walks ext/* and the .plx install directory
  → For each: read parallx-manifest.json
  → Validate against src/tools/parallx-manifest.schema.json (toolValidator.ts)
  → Register an IToolDescription in ToolRegistry  (state: Discovered)
  → ActivationEventService matches activationEvents
       "*"               → activate immediately
       "onStartupFinished" → activate after first idle
       "onCommand:<id>"  → activate when command runs
       "onView:<id>"     → activate when view is first revealed
  → ToolActivator:
       Discovered → Activating
       loads main module via dynamic import
       constructs ToolContext { subscriptions, memento, toolPath }
       constructs scoped api via createToolApi(deps, toolId)
       calls module.activate(api, context) inside ToolErrorService isolation
       Activating → Activated
  → on shutdown / disable / force-deactivate:
       Activated → Deactivating
       calls module.deactivate() (if exported) in try/catch
       disposes context.subscriptions in reverse
       removes contributed views/commands/configuration
       Deactivating → Deactivated
```

State machine (verified `src/tools/toolRegistry.ts`):
`Discovered → Activating → Activated → Deactivating → Deactivated → (Disposed)`.

The Budget extension declares `"activationEvents": ["*"]` so it is active at
startup — same as media-organizer. View-on-demand activation
(`onView:budget.dashboard`) is a P5 optimization, not P1.

### 3. The `api` surface — what extensions are allowed to do

Built per-extension by `createToolApi()` in `src/api/apiFactory.ts`. The frozen
namespace exposed to Budget:

| Namespace | Purpose | Notes |
|---|---|---|
| `api.commands` | `registerCommand(id, handler)` (line 100) | Adds to command palette + lets other code invoke. Disposed on deactivate. |
| `api.views` | `registerViewProvider(viewId, { createView })` (line 96), `reveal(viewId)` | View id must match a `contributes.views` entry. |
| `api.database` | `run / get / all / runTransaction / migrate(dir)` (line 217) | **External-only** — built-in tools do not receive this. Each extension gets its own SQLite file. |
| `api.lm` | `getModels()`, `sendChatRequest(modelId, messages, options?)` (line 686) | Streaming async-iterable. The **only** way to call models. |
| `api.services` | `has(id)`, `get<T>(id)` (line 668) | DI bridge. Budget uses `get(ILanguageModelToolsService)` to invoke MCP tools. |
| `api.chat` | `registerTool(name, def)` | Optional — lets extension expose its data to chat (P5 stretch). |
| `api.workspace` | Read-only workspace info | Used to scope storage paths. |
| `api.window` | Notifications, status messages | Toast / status bar. |
| `api.configuration` | Read settings declared in `contributes.configuration` | Reactive — `onDidChange` fires on edits. |

**Forbidden / will not work:**
- Importing anything from `src/` directly.
- Touching the DOM outside the container the view system gives you.
- Registering global keyboard shortcuts outside command contributions.
- Calling Electron `ipcRenderer` / `shell` / `app` directly (preload doesn't
  expose them to extensions).
- Reading another extension's database. `api.database` is namespaced by
  extension id at the `DatabaseManager` layer (`electron/database.cjs`).
- Modifying core CSS, icons, or theme tokens.

### 4. Dependencies — what Budget needs

Parallx **does not** support extension-to-extension dependencies. There is no
`extensionDependencies` field in the manifest schema (verified
`src/tools/parallx-manifest.schema.json`). Extensions are independent units.

Budget therefore depends only on:

1. **Parallx core** (manifest `engines.parallx: "^0.1.0"`).
2. **The Gmail MCP server** at `tools/gmail-mcp-server/` — but only at
   *runtime*. The dependency is not declared in the manifest because MCP servers
   are user-managed via the MCP Servers UI; Budget queries
   `ILanguageModelToolsService` for the tool by name and surfaces a clear error
   when the server isn't connected.
3. **An installed local model** (Ollama). Discovered via `api.lm.getModels()`;
   if empty, the sync engine errors with actionable guidance.

No npm dependencies bundled into the extension itself for P1. The packaged
artifact is the manifest + the compiled `main.js` + the SQL migration files
(mirrors `scripts/package-media-organizer.mjs` shape).

### 5. Per-extension storage layout (verified)

```
<APP_ROOT>/data/extensions/parallx.budget/
    db.sqlite        ← the SQLite file, opened with WAL + foreign keys by DatabaseManager
    db.sqlite-shm
    db.sqlite-wal
    state/           ← reserved for future api.storage
```

Migrations live inside the extension package at `db/migrations/*.sql`,
applied lexicographically by filename. Convention is
`budget_001_initial.sql`, `budget_002_*.sql`, …
(verified `scripts/package-media-organizer.mjs` lines 28–33).

### 6. Packaging

When Budget ships beyond development, `scripts/package-budget.mjs` (new, to be
modeled on `scripts/package-media-organizer.mjs`) will produce
`budget-0.1.0.plx` containing:

```
parallx-manifest.json
main.js
db/migrations/budget_001_initial.sql
```

Until then, Budget runs unpacked from `ext/budget/` — no install step, just
restart the workbench.

### 7. The sandbox boundary in one sentence

> An extension is a frozen `api.*` object plus a disposable subscription bag,
> running inside an error-isolated module loader, with its own SQLite file and
> no direct access to anything else in the workbench.

---

## SQLite Schema

### Where it lives

Extension databases live at:
`<workspacePath>/.parallx/extensions/parallx.budget/data.db`

This is the standard path used by all Parallx extensions (same pattern as
media-organizer). The `DatabaseManager` in `electron/database.cjs` handles
opening, WAL mode, foreign keys, and migrations automatically.
The renderer calls through `api.database` (the `IDatabaseService` IPC bridge).

### Migration file: `db/migrations/budget_001_initial.sql`

```sql
-- Cursor state
CREATE TABLE IF NOT EXISTS sync_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Every email that passed classification.
-- Stored so we can re-run categorization without re-fetching Gmail.
CREATE TABLE IF NOT EXISTS email_imports (
    gmail_message_id  TEXT PRIMARY KEY,
    received_at       TEXT NOT NULL,  -- ISO 8601
    raw_subject       TEXT,
    raw_snippet       TEXT,           -- snippet only, no full body
    processed_at      TEXT DEFAULT (datetime('now'))
);

-- One row per extracted transaction.
CREATE TABLE IF NOT EXISTS transactions (
    id                TEXT PRIMARY KEY,  -- UUID v4
    gmail_message_id  TEXT NOT NULL REFERENCES email_imports(gmail_message_id),
    merchant          TEXT,
    amount            REAL NOT NULL,     -- positive = debit, negative = credit/refund
    card_last_four    TEXT,
    transaction_date  TEXT NOT NULL,     -- YYYY-MM-DD
    category_id       TEXT REFERENCES categories(id),
    ai_confidence     TEXT CHECK(ai_confidence IN ('high','medium','low')),
    user_overridden   INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'confirmed'
                          CHECK(status IN ('confirmed','review','deleted')),
    notes             TEXT,
    created_at        TEXT DEFAULT (datetime('now'))
);

-- Balance snapshots from bank alert emails (reconciliation only).
CREATE TABLE IF NOT EXISTS balance_snapshots (
    id                TEXT PRIMARY KEY,
    gmail_message_id  TEXT REFERENCES email_imports(gmail_message_id),
    account_last_four TEXT,
    balance           REAL NOT NULL,
    snapshot_date     TEXT NOT NULL,
    created_at        TEXT DEFAULT (datetime('now'))
);

-- User-managed categories (seeded on first activate).
CREATE TABLE IF NOT EXISTS categories (
    id    TEXT PRIMARY KEY,
    name  TEXT UNIQUE NOT NULL,
    color TEXT,
    icon  TEXT
);
```

**SQLite type notes:** `DECIMAL` is not a native SQLite type; we use `REAL`.
`DATETIME` columns use ISO 8601 text — consistent with every other table in the
codebase (media-organizer uses the same convention).

**Default categories (inserted in activate() if `categories` is empty):**
Groceries, Dining, Transport, Utilities, Shopping, Health, Entertainment,
Subscriptions, Travel, Other.

---

## AI Pipeline Design

### How model calls work in Parallx (the real pattern)

The sync engine needs to call the local Ollama model programmatically — not
through a chat turn. The exposed extension surface is `api.lm` (verified in
`src/api/apiFactory.ts` line 686). It requires a `modelId`:

```typescript
// 1. Pick a model. Prefer the user's default; fall back to the first available.
const models = await api.lm.getModels();
if (!models || models.length === 0) {
  throw new Error('No language models available — install/start Ollama first.');
}
const modelId = models[0].id; // P2: read user default once we wire that in

// 2. Stream chunks until done.
const chunks = [];
for await (const chunk of api.lm.sendChatRequest(
  modelId,
  [{ role: 'user', content: prompt }],
  { /* options */ },
)) {
  if (chunk.content) chunks.push(chunk.content);
  if (chunk.done) break;
}
const response = chunks.join('');
```

Under the hood `api.lm` is the `LanguageModelsService` IPC bridge — the same
path chat / autonomy use. No direct Ollama HTTP calls; model selection,
token streaming, and error handling all live in the service.

**Cancellation:** `sendChatRequest` does not currently take an `AbortSignal`
on the `api.lm` surface. To cancel a sync mid-run we will track a `cancelled`
flag on the sync engine and break the iteration loop — sufficient for a UI
"Cancel Sync" button. (If a stricter primitive is needed later, add it to
`api.lm` then.)

### How MCP tools are called programmatically

`api.tools` is the **management** surface (install/uninstall/enable) — it does
not expose tool invocation. The actual invocation primitive lives on
`ILanguageModelToolsService`, which extensions reach via the DI bridge
`api.services` (verified pattern in `src/built-in/ai-settings/main.ts`):

```typescript
import { ILanguageModelToolsService } from '../../services/chatTypes.js';
// (Path resolved at build time; in compiled main.js we use a string-id ref.)

const toolsService = api.services.has(ILanguageModelToolsService)
  ? api.services.get(ILanguageModelToolsService)
  : null;
if (!toolsService) throw new Error('Tools service not available');

const result = await toolsService.invokeToolWithRuntimeControl(
  'mcp__parallx-gmail-mcp__list_unread',
  { max: 100, query: `after:${cursorDate}` },
  cancellationToken,
);
if (result.isError) {
  throw new Error(`Gmail MCP error: ${result.content?.[0]?.text ?? 'unknown'}`);
}
const messages = JSON.parse(result.content[0].text);
```

The Gmail MCP server must be connected (added via the MCP Servers UI) before
sync runs. If it is not connected, `invokeToolWithRuntimeControl` returns
`{ isError: true }` — the sync engine surfaces this as a clear error in the
Sync Log view.

### Stage 1 — Classification

One model call per email. Short prompt, binary answer.

```
System: You are a transaction classifier. Answer only with valid JSON.
User:
  Subject: {subject}
  Snippet: {snippet}

  Is this a bank or card transaction notification? Answer:
  { "is_transaction": true | false }
```

If `false` → skip. No DB write. No Stage 2.

### Stage 2 — Extraction (only if Stage 1 = true)

```
System: You are a financial data extractor. Answer only with valid JSON.
User:
  Subject: {subject}
  Snippet: {snippet}

  Extract:
  {
    "merchant": string | null,
    "amount": number,           // positive = charge, negative = refund/credit
    "card_last_four": string | null,
    "transaction_date": "YYYY-MM-DD",
    "confidence": "high" | "medium" | "low"
  }
```

`confidence = "low"` → insert with `status = 'review'`, skip Stage 3.

### Stage 3 — Categorization (confidence ≥ medium only)

```
System: You are a budget categorizer. Answer only with valid JSON.
User:
  Merchant: {merchant}
  Amount: ${amount}
  Categories: {comma-separated list from categories table}

  Assign one category: { "category": string }
```

Keeping stages separate means Stage 3 can be re-run independently when the
user edits the category list — without re-fetching any emails.

### Balance snapshot detection (parallel to Stage 1)

A second Stage 1 variant checks for balance-notification emails:

```
  Is this a bank balance notification (shows an account balance, not a
  specific transaction)? { "is_balance_snapshot": true | false }
```

If true, a second extraction prompt pulls `account_last_four` and `balance`
and inserts into `balance_snapshots`.

---

## Sync Engine

### Cursor pattern

```
sync_state key: "last_gmail_message_id"
sync_state key: "last_synced_at"
```

### Flow

1. Read `last_gmail_message_id` from `sync_state`.
2. Resolve the tools service (`api.services.get(ILanguageModelToolsService)`),
   then call `mcp__parallx-gmail-mcp__list_unread` via
   `invokeToolWithRuntimeControl`.
   - If cursor exists: `{ query: "after:<last_date>", max: 100 }`
   - If no cursor (first sync): use `budget.syncStartDate` config value,
     default 90 days ago.
3. For each message, chronological order:
   a. Check `email_imports` — if `gmail_message_id` exists, skip (dedup).
   b. Run Stage 1 classification (is_transaction + is_balance_snapshot).
   c. If transaction: run Stage 2 + Stage 3, insert rows.
   d. If balance snapshot: insert into `balance_snapshots`.
   e. Log result to `sync_state` progress key (for UI progress updates).
4. After all messages processed: update `last_gmail_message_id` and
   `last_synced_at` to the newest values seen.

**Cursor update is the last write.** If sync crashes mid-run, the next run
re-processes the same window. Dedup prevents double-inserts.

### First-sync bootstrapping

`sync_state` has no `last_gmail_message_id`. Use `budget.syncStartDate`
config value (settable in Parallx settings UI via the contributed
`configuration` schema in the manifest).

### Error handling

- Gmail MCP not connected → error recorded in `sync_state`, surfaced in
  Sync Log view with "Connect Gmail MCP first" guidance.
- Individual email parse failure → logged to `sync_state` error list,
  inserted with `status = 'review'`, sync continues.
- Stage 1/2/3 model returns malformed JSON → retry once with a stricter
  prompt, then mark `status = 'review'` and continue.

---

## Tool Structure — Grounded in Existing Architecture

The budget tool is a **first-party extension** living at `ext/budget/`, identical
in shape to `ext/media-organizer/` and `ext/text-generator/`. No new patterns
needed — we follow what already works.

```
ext/budget/
    parallx-manifest.json     — declares viewContainers, views, commands, configuration
    main.js                   — activate(api, context) entry point (compiled from src/)
    src/
        budgetDatabase.ts     — thin wrapper around api.database (mirrors MO's db object)
        syncEngine.ts         — cursor-based sync orchestrator
        aiPipeline.ts         — Stage 1/2/3 prompt builders + JSON response parsers
        views/
            DashboardView.ts  — extends View base class, raw DOM + CSS tokens
            TransactionList.ts
            ReviewQueue.ts
            SyncLog.ts
    db/
        migrations/
            budget_001_initial.sql
```

### Manifest shape (follows `ext/media-organizer/parallx-manifest.json`)

```json
{
  "manifestVersion": 1,
  "id": "parallx.budget",
  "name": "Budget",
  "version": "0.1.0",
  "publisher": "parallx",
  "description": "Gmail-sourced budget dashboard",
  "main": "main.js",
  "activationEvents": ["*"],
  "engines": { "parallx": "^0.1.0" },
  "contributes": {
    "viewContainers": [
      { "id": "budget-container", "title": "Budget", "icon": "graph", "location": "sidebar" }
    ],
    "views": [
      { "id": "budget.dashboard",    "name": "Dashboard",          "defaultContainerId": "budget-container" },
      { "id": "budget.transactions", "name": "Transactions",       "defaultContainerId": "budget-container" },
      { "id": "budget.reviewQueue",  "name": "Review Queue",       "defaultContainerId": "budget-container" },
      { "id": "budget.syncLog",      "name": "Sync Log",           "defaultContainerId": "budget-container" }
    ],
    "commands": [
      { "id": "budget.sync",          "title": "Sync Gmail Transactions", "category": "Budget" },
      { "id": "budget.openDashboard", "title": "Open Dashboard",          "category": "Budget" }
    ],
    "configuration": [
      {
        "title": "Budget",
        "properties": {
          "budget.syncStartDate": { "type": "string", "default": "", "description": "ISO date — import mail from this date on first sync." }
        }
      }
    ]
  }
}
```

### activate() entry point (follows media-organizer pattern)

```javascript
// main.js (compiled)
let _dbBridge = null;

const db = {
  async run(sql, params = [])  { const r = await _dbBridge.run(sql, params);  if (r.error) throw r.error; return r; },
  async get(sql, params = [])  { const r = await _dbBridge.get(sql, params);  if (r.error) throw r.error; return r.row ?? null; },
  async all(sql, params = [])  { const r = await _dbBridge.all(sql, params);  if (r.error) throw r.error; return r.rows ?? []; },
  async tx(ops)                { const r = await _dbBridge.runTransaction(ops); if (r.error) throw r.error; return r.results ?? []; },
};

export async function activate(api, context) {
  _dbBridge = api.database;
  await _dbBridge.migrate('db/migrations/');           // runs budget_001_initial.sql once

  // Register view providers
  api.views.registerViewProvider('budget.dashboard',    { createView: (el) => new DashboardView(el, db, api) });
  api.views.registerViewProvider('budget.transactions', { createView: (el) => new TransactionListView(el, db, api) });
  api.views.registerViewProvider('budget.reviewQueue',  { createView: (el) => new ReviewQueueView(el, db, api) });
  api.views.registerViewProvider('budget.syncLog',      { createView: (el) => new SyncLogView(el, db, api) });

  // Register commands
  api.commands.registerCommand('budget.sync',          () => runSync(api, db));
  api.commands.registerCommand('budget.openDashboard', () => api.views.reveal('budget.dashboard'));
}
```

**Verified API surfaces (in `src/api/apiFactory.ts`):**
- `api.database` — line 217, includes `migrate(dir)`, `run/get/all/runTransaction`. External-extension only.
- `api.views.registerViewProvider(viewId, { createView(container) })` — line 96. Called by media-organizer at `ext/media-organizer/main.js` line 18068.
- `api.commands.registerCommand(id, handler)` — line 100.
- `api.lm.sendChatRequest(modelId, messages, options?)` — line 686. Streaming `AsyncIterable<{ content, done }>`.
- `api.lm.getModels()` — returns the list of available models from `LanguageModelsService`.
- `api.services.get(ILanguageModelToolsService)` — line 668. Returns the tools service for `invokeToolWithRuntimeControl`.
- `api.chat.registerTool(name, def)` — used by media-organizer at line 17850 if we want to expose budget queries to chat (P5 stretch).

---

## Visual Design — How Budget Looks

The Budget extension contributes one **viewContainer** to the activity bar
("Budget", icon `graph`) sitting below the Media Organizer container. Selecting
it reveals a vertical stack of four collapsible sub-views in the side panel.
Selecting a sub-view opens the full editor area to that view.

### Layout philosophy

- **Native first.** Budget should feel like part of the workbench, not a
  brought-in third-party app. Every color, font, radius, hover, focus ring is a
  Parallx token. Nothing custom-styled.
- **Information-dense, not decorative.** A budget is read at a glance. Tables
  beat cards. Hard numbers beat icons-as-data.
- **Keyboard-first.** Every action is reachable from the keyboard. The mouse
  is optional. (Same principle as the rest of Parallx.)
- **One amount per row, big and aligned.** Spending data fails when amounts are
  small or misaligned. Right-aligned tabular numerals, baseline `--parallx-fontSize-base`,
  bold `--vscode-foreground` for debits, regular `--vscode-descriptionForeground`
  for credits.
- **Sparing color.** Categories get a muted dot (8×8 px) in their assigned
  color. Status uses semantic tokens (warning amber, error red). No gradients,
  no shadows, no decorative imagery.

### Design tokens — full mapping

```css
/* Surfaces */
--vscode-sideBar-background           /* view background */
--vscode-editor-background            /* nested panels (chart card, snapshot card) */
--vscode-panel-border                 /* dividers between rows + view sections */
--vscode-list-hoverBackground         /* row hover */
--vscode-list-activeSelectionBackground   /* selected row */
--vscode-list-activeSelectionForeground

/* Text */
--vscode-foreground                   /* primary numbers + merchant names */
--vscode-descriptionForeground        /* dates, card last-four, secondary metadata */
--vscode-disabledForeground           /* hidden / pending rows */

/* Inputs */
--vscode-input-background
--vscode-input-foreground
--vscode-input-border
--vscode-focusBorder                  /* focus rings (everywhere) */
--vscode-button-background
--vscode-button-foreground
--vscode-button-hoverBackground

/* Semantic */
--vscode-charts-blue / -green / -yellow / -orange / -red / -purple
                                       /* category dots + chart slices */
--vscode-editorWarning-foreground     /* reconciliation amber gap, low-confidence badge */
--vscode-errorForeground              /* reconciliation red gap, sync errors */
--vscode-testing-iconPassed           /* "confirmed" badge */

/* Parallx */
--parallx-fontFamily-ui               /* all UI text */
--parallx-fontFamily-mono             /* amounts (tabular nums) */
--parallx-fontSize-base               /* 13px — table rows */
--parallx-fontSize-sm                 /* 11px — metadata */
--parallx-radius-sm                   /* 4px — inputs, buttons */
--parallx-radius-md                   /* 6px — cards (chart panels) */
```

### How a view renders (the actual pattern)

Every view extends `View` from `src/views/view.ts`, returns a root `HTMLElement`,
and uses `$()` from `src/ui/dom.ts` for construction. There is no JSX, no
React. Example skeleton (matches what `media-organizer/main.js` does):

```typescript
class TransactionListView extends View {
  constructor(private readonly el: HTMLElement, private readonly db: BudgetDb, private readonly api: ParallxApi) {
    super();
    this.render();
  }
  private render() {
    const root = $('div.budget-tx-list', { tabindex: '0' });
    const toolbar = new ActionBar(root, [
      { id: 'sync',   icon: 'refresh', label: 'Sync',   run: () => this.api.commands.execute('budget.sync') },
      { id: 'add',    icon: 'plus',    label: 'Add',    run: () => this.openAddModal() },
      { id: 'export', icon: 'export',  label: 'Export', run: () => this.exportCsv() },
    ]);
    const monthTabs = new SegmentedControl(root, this.last6Months(), { onChange: m => this.filterMonth(m) });
    const list = new FilterableList(root, this.rows(), {
      renderRow: (tx) => this.renderRow(tx),
      onSelect: (tx) => this.openDetail(tx),
    });
    this._register(toolbar); this._register(monthTabs); this._register(list);
    this.el.append(root);
  }
}
```

### ASCII layouts — the four core views

**Side panel (collapsed sub-views):**

```
╔═ BUDGET ════════════════╗
║ ▾ Dashboard             ║   ← active view chevron
║   Transactions          ║
║   Review Queue   [3]    ║   ← badge for pending
║   Sync Log              ║
║   Categories            ║
╚═════════════════════════╝
```

**Dashboard (main editor area):**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Dashboard                                  [Sync now] [Settings ⚙] │  ← ActionBar
├─────────────────────────────────────────────────────────────────────┤
│  This month · November 2026                          ◀ Nov ▶        │  ← SegmentedControl
├─────────────────────────────────────────────────────────────────────┤
│ ┌─ Spent so far ────────┐ ┌─ Budget left ────┐ ┌─ Net worth ────┐ │
│ │  $2,481.93            │ │  $1,018.07       │ │  $14,290.55    │ │  ← KPI tiles
│ │  ▼ 12% vs last month  │ │  29% remaining    │ │  ▲ $812 / 30d  │ │
│ └───────────────────────┘ └───────────────────┘ └────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│  Spending by category                Budget vs actual               │
│  ╭───────────╮                       ▓▓▓▓▓▓▓▓░░  Groceries  $410/$500 │
│  │  ◔  ◑   │  ● Groceries  $410   ▓▓▓▓▓▓▓▓▓▓▓ Dining     $235/$200 ! │
│  │ ◐ donut │  ● Dining     $235   ▓▓▓▓▓▓░░░░  Transport $ 78/$150 │
│  │  ◓  ◔   │  ● Transport  $ 78   ▓▓▓▓▓▓▓▓▓░  Utilities $185/$200 │
│  ╰───────────╯  ● Utilities $185   ▓▓░░░░░░░░  Shopping  $ 92/$300 │
│                  + 5 more →         ▓▓▓▓▓░░░░░  Subs      $ 47/$100 │
├─────────────────────────────────────────────────────────────────────┤
│  Reconciliation                                                     │
│  Derived $14,290.55  ·  Last snapshot $14,288.40 (Nov 18)  ·       │
│  Gap +$2.15  (within tolerance)                              ✓     │
├─────────────────────────────────────────────────────────────────────┤
│  Recent activity                                          See all → │
│  Nov 21  STARBUCKS                Dining          -$ 7.45   ····2391 │
│  Nov 21  TRADER JOES              Groceries       -$83.12   ····2391 │
│  Nov 20  AMAZON.COM               Shopping        -$24.99   ····5872 │
│  Nov 20  PAYCHECK · ACME CORP     Income         +$2,400.00 ····0033 │
└─────────────────────────────────────────────────────────────────────┘
```

**Transactions:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Transactions                          [Sync] [Add] [Export] [⋮]    │
├─────────────────────────────────────────────────────────────────────┤
│  ◀ Sep · Oct · [Nov] · Dec ▶          🔍 amount:>50 cat:Dining     │  ← month tabs + smart filter
├─────────────────────────────────────────────────────────────────────┤
│ □ Date   Merchant            Category ▾    Amount    Card    Notes │  ← header (sortable)
│ □ Nov21  STARBUCKS           ● Dining   ▾  -$ 7.45   2391    —    │
│ ☑ Nov21  TRADER JOES         ● Groceries▾  -$83.12   2391    —    │  ← selected (active row)
│ □ Nov20  AMAZON.COM   ⓘ      ● Shopping ▾  -$24.99   5872    —    │  ← ⓘ = AI low-conf
│ □ Nov20  ACME PAYROLL        ● Income   ▾ +$2,400    0033    —    │
│ □ Nov19  ZELLE → Sarah ⇄     ● Transfer ▾ -$ 50.00   2391    rent │  ← transfer (excluded)
│ □ Nov18  NETFLIX 🔁          ● Subs     ▾ -$ 15.49   5872    —    │  ← 🔁 = recurring
│ □ Nov18  CHEVRON             ● Transport▾ -$ 42.10   2391    —    │
│ ─────────────────────────────────────────────────────────────────  │
│  47 transactions · $2,481.93 spent · $2,400 income                 │  ← footer summary
└─────────────────────────────────────────────────────────────────────┘
```

**Review Queue:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Review Queue · 3 pending                  [Confirm all] [Reject all]│
├─────────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────────────────┐  │
│ │ ⚠ Low-confidence — Nov 19                                     │  │
│ │ Subject: "Your statement is ready"                            │  │
│ │ Snippet: "...balance changed by $42.10..."                    │  │
│ │                                                               │  │
│ │ Merchant     [ CHEVRON              ▾ ]  ← editable          │  │
│ │ Amount       [ 42.10                  ]                       │  │
│ │ Date         [ 2026-11-18  ▾]                                 │  │
│ │ Category     [ ● Transport          ▾ ]                       │  │
│ │                                                               │  │
│ │       [Confirm]   [Reject (delete)]   [Mark as not a tx]     │  │
│ └───────────────────────────────────────────────────────────────┘  │
│  ↓ next ↓                                                          │
└─────────────────────────────────────────────────────────────────────┘
```

**Sync Log:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Sync Log                                            [Run sync now]  │
├─────────────────────────────────────────────────────────────────────┤
│  Last sync · Nov 21, 14:22 · 4 new tx · 0 errors           ✓       │
│  Cursor: msg_18f3a92b (Nov 21 14:18)                                │
├─────────────────────────────────────────────────────────────────────┤
│  14:22:41  Sync started · cursor=msg_18f3a92b                       │
│  14:22:41  Gmail MCP returned 12 new messages                       │
│  14:22:43  msg_18f3a91f  CHASE                stage1 → tx           │
│  14:22:45  msg_18f3a91f  $7.45 STARBUCKS      stage2 → high         │
│  14:22:46  msg_18f3a91f  → Dining             stage3 → confirmed    │
│  14:22:47  msg_18f3a920  CHASE                stage1 → balance      │
│  14:22:48  msg_18f3a920  bal $14,288.40       snapshot inserted     │
│  14:22:50  msg_18f3a92b  AMAZON               stage2 → low ⚠       │
│  14:22:50  msg_18f3a92b  → review queue                             │
│  14:23:01  Sync complete · 4 confirmed · 1 review · 1 snapshot     │
└─────────────────────────────────────────────────────────────────────┘
```

**Categories:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Categories                                          [+ Add category]│
├─────────────────────────────────────────────────────────────────────┤
│  ●  Groceries        $500/mo  rollover ✓    47 tx     [Edit] [×]   │
│  ●  Dining           $200/mo  rollover ✗    23 tx     [Edit] [×]   │
│  ●  Transport        $150/mo  rollover ✓    12 tx     [Edit] [×]   │
│  ●  Utilities        $200/mo  rollover ✗     4 tx     [Edit] [×]   │
│  ●  Shopping         $300/mo  rollover ✓    18 tx     [Edit] [×]   │
│  ●  Subscriptions    $100/mo  rollover ✗     8 tx     [Edit] [×]   │
│  ◌  Income          (no cap)               12 tx     [Edit]        │
│  ⇄  Transfer        (excluded from spend)   6 tx     [Edit]        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Per-View Control Inventory

The single source of truth for what the user can do in each view. Implementation
checklist for P1–P4.

### Dashboard

| Control | Mechanism | Action |
|---|---|---|
| Sync now | `ActionBar` button | Runs `budget.sync` command |
| Settings | `ActionBar` button | Opens Parallx settings filtered to `budget.*` |
| Period selector | `SegmentedControl` (`This month`, `Last month`, `YTD`, `Custom…`) | Filters all KPI + chart data |
| Month nav arrows | Buttons `◀ ▶` | Step the period one unit |
| KPI tile click | Click handler | Navigates to Transactions filtered to that scope |
| Donut slice click | SVG event | Navigates to Transactions filtered to that category |
| Bar click | SVG event | Selects that month in Transactions |
| Reconciliation row | Click | Opens snapshot detail overlay |
| Recent activity row | Click | Opens transaction detail overlay |
| `R` shortcut | Keyboard | Sync now |
| `T` shortcut | Keyboard | Jump to Transactions |
| `Q` shortcut | Keyboard | Jump to Review Queue |

### Transactions

| Control | Mechanism | Action |
|---|---|---|
| Sync / Add / Export / ⋮ | `ActionBar` | Sync · manual add · CSV/JSON export · overflow menu |
| ⋮ overflow | `Dropdown` | Hide/show columns · Show hidden tx · Rebuild from scratch |
| Smart search | Text input with parser | `amount:>50 cat:Dining month:Nov merchant:starb` |
| Month tabs | `SegmentedControl` (last 12) | Filter month |
| Header click | Sort | Date · Merchant · Category · Amount · Card |
| Checkbox | Multi-select | Bulk re-categorize / bulk delete / bulk hide |
| Row category dropdown | Inline `Dropdown` | Re-categorize one tx (sets `user_overridden=1`) |
| Row click | Selection + detail overlay | Shows full email source + edit form |
| Right-click row | Context menu | Edit · Split · Mark as transfer · Hide · Delete · Create rule from this · Open source email |
| `↑/↓` | Keyboard | Move selection |
| `Enter` | Keyboard | Open detail |
| `C` | Keyboard | Open category dropdown for selected row |
| `Del` | Keyboard | Soft-delete (status=deleted) |
| `H` | Keyboard | Hide / unhide |
| `/` | Keyboard | Focus search |
| Footer | Live summary | Count · spent · income · net |

### Review Queue

| Control | Mechanism | Action |
|---|---|---|
| Confirm all | Header button | Bulk-promote all queue items to `confirmed` |
| Reject all | Header button | Bulk soft-delete |
| Per-item editable fields | Inline inputs + `Dropdown` | Merchant · amount · date · category |
| Confirm | Button | Sets `status='confirmed'`, `user_overridden=1` |
| Reject | Button | Sets `status='deleted'` |
| Mark as not a transaction | Button | Removes from `transactions`, marks `email_imports.is_transaction=false` so it never re-promotes |
| `↓` | Keyboard | Next item |
| `Enter` | Keyboard | Confirm |
| `Esc` | Keyboard | Reject |

### Sync Log

| Control | Mechanism | Action |
|---|---|---|
| Run sync now | Header button | Runs `budget.sync` |
| Cancel sync | Conditional button (during sync) | Sets cancel flag, breaks loop after current message |
| Clear log | ⋮ menu | Truncates `sync_state` log entries |
| Filter | Search box | Substring filter on log lines |
| Click on `msg_…` | Link | Opens Gmail in browser via `shell:openExternal` (if supported) or copies the message id |

### Categories

| Control | Mechanism | Action |
|---|---|---|
| + Add category | Header button | Opens overlay form (name, color, monthly limit, rollover) |
| Edit | Row button | Same overlay, prefilled |
| × delete | Row button | Confirmation, then soft-deletes (re-categorizes affected tx to "Other") |
| Drag handle | Drag-to-reorder | Persists `sort_order` |

---

## Best-in-Class Budgeting Features

The reference set, drawn from envelope budgeting (YNAB, Actual Budget) and
modern reconciliation tools (Copilot Money, Monarch, Lunch Money). Items marked
**P1** ship in the first cut; the rest are stretch in this milestone, planned
for follow-on iterations.

### Core financial model — envelope / zero-sum (P2)

- **Monthly category limits** with **rollover** (unspent rolls to next month)
  vs **reset** (use it or lose it). Field already in the categories table:
  `monthly_limit REAL`, `rollover INTEGER`.
- **Available = limit + previous rollover − spent this month**. Computed in
  the dashboard's "Budget vs actual" bar.
- **Overage warning** (red bar) when actual > limit. Suggested reallocation
  ("Move from Subscriptions?") via the row's overflow menu.
- **Income separate from spending categories.** "Income" and "Transfer" are
  reserved category kinds, excluded from spend totals.

### Transactions you actually have to handle (P1)

- **Splits** — one transaction → multiple categories (`amount` divided across
  child rows that link back via `parent_id`).
- **Transfers** — Zelle / internal transfers between owned accounts. Marked
  `category='Transfer'`, excluded from spend rollups, paired by detection rule.
- **Refunds / credits** — negative amounts, reduce category spend totals.
- **Manual transactions** — cash spending, gifts, anything not in email.
  Inserted with `gmail_message_id=NULL` (need to relax FK in `001`).
- **Pending vs cleared** — extracted from email when present, surfaced as a
  row badge.
- **Hidden** — `status='hidden'`, excluded from totals but visible behind the
  ⋮ → "Show hidden" toggle. Useful for medical reimbursements, business expenses.

### Recurring detection (P3)

Detect recurring charges by `(merchant, amount±10%, monthly cadence)` over the
last 90 days. Store in `recurring_transactions` table:

```sql
CREATE TABLE recurring_transactions (
    id              TEXT PRIMARY KEY,
    merchant        TEXT NOT NULL,
    expected_amount REAL,
    cadence_days    INTEGER,
    last_seen_date  TEXT,
    next_expected   TEXT,
    category_id     TEXT REFERENCES categories(id)
);
```

Surfaced on the dashboard as "Upcoming this week" and on rows as the 🔁 badge.

### Rules engine (P3)

Persistent rule table — when a future transaction matches, apply the action.

```sql
CREATE TABLE rules (
    id            TEXT PRIMARY KEY,
    match_type    TEXT CHECK(match_type IN ('merchant_eq','merchant_contains','amount_eq','regex')),
    match_value   TEXT NOT NULL,
    set_category  TEXT REFERENCES categories(id),
    set_status    TEXT,
    set_hidden    INTEGER DEFAULT 0,
    sort_order    INTEGER NOT NULL,
    created_at    TEXT DEFAULT (datetime('now'))
);
```

Right-click any transaction → "Create rule from this…" → pre-fills merchant
+ category. Rules apply at insert time (after Stage 3, overrides AI category)
and via "Apply rules to history" command.

### Search & filters (P2)

Smart-search bar with a tiny parser:

```
amount:>50              amount greater than 50
amount:<10              less than 10
amount:25..100          between
cat:Dining              category equals
merchant:starb          merchant substring
month:Nov  month:2026-11
year:2026
status:review
recurring:true
```

Free text outside qualifiers searches merchant + notes.

### Charts & insights (P1 + P3)

- **P1:** Donut (spend by category, current period), bar (last 6 months total),
  KPI tiles (spent, budget left, net worth).
- **P3:** Sankey (income → categories → savings), heatmap calendar (spend per
  day), trend line (per-category 12-month), forecast bar (projected month-end
  based on current pace).

### Comparison periods (P2)

Every KPI tile and bar can show **vs previous** in muted overlay (e.g. ▼ 12%
vs last month). The period selector includes "Compare to: previous period /
same month last year / none".

### Net worth tracking (P2)

`balance_snapshots` already exists. Net worth = sum of latest snapshot per
distinct `account_last_four`. Dashboard tile + 30-day delta. New table for
manual non-bank assets/liabilities later.

### Goals (P3)

```sql
CREATE TABLE goals (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    target_amount  REAL NOT NULL,
    target_date    TEXT,
    category_id    TEXT REFERENCES categories(id),  -- contributions count toward goal
    created_at     TEXT DEFAULT (datetime('now'))
);
```

Dashboard tile shows progress bars (e.g. "Emergency fund · $4,200 / $10,000").

### Export & import (P1 export, P3 import)

- **Export:** CSV (transactions, all columns) and JSON (full DB dump). One
  click in Transactions toolbar.
- **Import (P3):** Drop a CSV from a bank that doesn't email; same dedup key
  mechanism (synthetic id when `gmail_message_id` is null).

### Privacy & data integrity (P1)

- All data local — no network calls except Ollama (local) and Gmail MCP
  (user-owned OAuth token).
- "Forget transaction" — hard delete, removes from all rollups.
- "Reset extension" — drops db.sqlite, re-runs migrations. (Confirmation overlay.)
- "Export & wipe" — export CSV + JSON, then reset.

### AI features beyond the import pipeline (P5)

- **Natural-language query via chat:** Budget registers `api.chat.registerTool`
  with a `budget.query` tool that accepts a question and returns numbers
  ("How much did I spend on coffee in October?"). Implementation: convert NL →
  SQL via the local model, run against the read-only DB view, return the result.
- **Categorization improvement:** When a user overrides a category, optionally
  auto-create a rule.

---

## UI / UX Details — Per-View Implementation Notes

### Dashboard view (`DashboardView.ts`)

- KPI tiles: 3 fixed slots (Spent, Budget left, Net worth). Each is a
  `div.kpi-tile` with primary number + delta line; click navigates to filtered
  Transactions.
- Donut: inline SVG, ~80 lines. Slices use `--vscode-charts-*` tokens. Hover
  reveals category name + amount via `Tooltip`.
- Budget bars: stacked horizontal. Filled portion uses category color, overage
  portion uses `--vscode-errorForeground`.
- Reconciliation row: `Derived: $X | Last snapshot: $Y | Gap: $Z`
  (amber if `|gap| > $5`, red if `|gap| > $50`, green if within $5).

### Transactions view (`TransactionListView.ts`)

- Built on `FilterableList` from `src/ui/list.ts`.
- Each row: date · merchant · `Dropdown` for category · amount · card · notes.
- Selection model: single (Enter for detail) + multi via checkbox (bulk actions).
- Smart search bar above; query parsed into a SQL `WHERE` fragment.
- Footer: live count · sum · income · net.
- Right-click → context menu (see Per-View Control Inventory).

### Review Queue view (`ReviewQueueView.ts`)

- One card per pending row. Cards stack vertically.
- Editable fields prefilled with AI-extracted values.
- Confirm / Reject / Mark-as-not-a-tx buttons at the bottom of each card.
- Auto-advance to next card after action.

### Sync Log view (`SyncLogView.ts`)

- Header: last sync time, count, status icon, Run/Cancel button.
- Body: virtualized log list (newest first). Each line: timestamp · message id ·
  message · status. Color by status (info/warn/error).
- Filter: substring search.

### Categories view (`CategoriesView.ts`)

- Table: name · monthly limit · rollover toggle · current spend · tx count · actions.
- Drag-to-reorder via row handle.
- Add/Edit overlay: name, color picker (predefined chart palette), monthly
  limit, rollover checkbox.

---

## Reuse table

(Repeats from earlier sections, consolidated for the implementation reviewer.)

### Review queue view
- Same layout as transaction list, filtered to `status = 'review'`
- "Confirm" and "Delete" `Button` per row
- Confirm runs Stage 3 (categorize), sets `status = 'confirmed'`

### Sync log view
- Last sync: timestamp, message count, cursor
- Error list: failed emails with subject
- Scrollable, read-only

---

## Phases

### P1 — Schema + database layer
- Create `ext/budget/` directory, `parallx-manifest.json`, `main.js` scaffold
- Migration SQL: `budget_001_initial.sql`
- `budgetDatabase.ts`: mirrors media-organizer `db` wrapper pattern
- Seed default categories on first `activate()`
- Unit tests: schema, insert, dedup, cursor read/write
- **Verification gate:** `npx tsc --noEmit` clean, `npx vitest run` green

### P2 — AI pipeline + sync engine
- `aiPipeline.ts`: Stage 1/2/3 prompt builders, JSON response parsers,
  retry-on-malformed logic
- `syncEngine.ts`: cursor logic, MCP tool call, pipeline orchestration,
  error logging to `sync_state`
- **First task in P2:** capture 5–10 real transaction emails (Chase, BofA,
  Venmo, PayPal) as test fixtures. Build the parser tests against these
  before wiring the live MCP call. The biggest unknown in this milestone is
  whether the model can extract reliably — prove it on fixtures first.
- Unit tests with fixture emails
- Smoke test: `budget.sync` command runs end-to-end against a real Gmail
  account, fixtures land in DB, dedup verified by running twice.

### P3 — Tool scaffold + basic views
- Wire `parallx-manifest.json` contributions: viewContainers, views, commands,
  configuration
- `SyncLog.ts` and `TransactionList.ts` views (no charts yet)
- `budget.sync` command wired end-to-end
- Manual smoke test: sync → see rows in transaction list

### P4 — Full dashboard UI
- `DashboardView.ts`: SVG donut + bar charts, reconciliation row
- `ReviewQueue.ts`
- Category management (add/rename/recolor via Overlay)

### P5 — Polish + verification
- Edge cases: refunds (negative amounts), split transactions, duplicate alerts
- (Stretch) Expose `budget.search` and `budget.summary` via `api.chat.registerTool`
  so the chat agent can answer "how much did I spend on dining last month?"
- `npx tsc --noEmit` clean
- `npx vitest run` green
- Manual end-to-end: sync real Gmail → review queue → confirm → dashboard

---

## What reuses existing architecture vs. what is new

### Reuses directly — no new solutions needed

| Concern | Existing solution | Where |
|---|---|---|
| Extension manifest + registration | `parallx-manifest.json` + `ToolRegistry` | `src/tools/toolRegistry.ts`, `src/tools/parallx-manifest.schema.json` |
| SQLite database access | `DatabaseManager` + per-extension IPC bridge | `electron/database.cjs`, `api.database` (apiFactory.ts:217) |
| DB migrations | Lexicographic `.sql` file runner | `electron/database.cjs` `migrate()`, called via `api.database.migrate(dir)` |
| Model calls outside chat | `LanguageModelsService` via `api.lm.sendChatRequest(modelId, msgs)` | `src/services/languageModelsService.ts`, exposed at apiFactory.ts:686 |
| MCP tool invocation | `ILanguageModelToolsService.invokeToolWithRuntimeControl` via `api.services.get(...)` | `src/services/languageModelToolsService.ts`, accessed via apiFactory.ts:668 |
| View base class + DOM rendering | `View` + `$()` + `addDisposableListener` | `src/views/view.ts`, `src/ui/dom.ts` |
| View registration | `api.views.registerViewProvider(viewId, { createView(container) })` | apiFactory.ts:96, used at media-organizer/main.js:18068 |
| Design tokens | `--vscode-*` + `--parallx-*` CSS properties | `src/workbench.css`, `src/theme/` |
| List with keyboard nav + filter | `FilterableList` | `src/ui/list.ts` |
| Dropdown, Button, Tabs, ActionBar, Overlay | All exist | `src/ui/` |
| Configuration settings in UI | `contributes.configuration` in manifest | `src/contributions/` |
| Command palette registration | `contributes.commands` in manifest | `src/contributions/commandContribution.ts` |
| View container in sidebar | `contributes.viewContainers` + `contributes.views` | `src/contributions/viewContribution.ts` |

### Requires new solutions

| Concern | Why it's new | Plan |
|---|---|---|
| **SVG charts** | No chart component exists in `src/ui/` | Build minimal SVG donut + bar chart (≈150 lines). No library dependency — full token control. Revisit if more sophistication is needed. |
| **AI pipeline orchestration** | No "batch AI processing" pattern exists — all existing AI calls are interactive (chat turn or autonomy heartbeat) | Build in the extension. The `sendChatRequest` primitive exists; the loop + retry + JSON parsing around it is new code in `aiPipeline.ts`. |
| **Cursor-based background sync** | Existing background execution is the autonomy heartbeat (chat-turn model). Budget sync is a one-shot batch job, not a conversation. | Implement as a plain `async function runSync()` called by the `budget.sync` command. No new executor needed — it's just an async command handler. |
| **Budget-domain DB schema** | First domain-specific financial schema in the codebase | `budget_001_initial.sql` as described above. Standard SQLite text dates, REAL amounts, UUID PKs. |

---

## Open questions (to resolve in P1/P2)

| # | Question | Current thinking |
|---|---|---|
| Q1 | Does `mcp__parallx-gmail-mcp__list_unread` return message ID, subject, snippet, and date in one call? | Yes per the MCP server implementation (`gmailClient.ts`). Verify in P2 by logging the first response. |
| Q2 | How do we handle multi-transaction emails (e.g. "5 transactions this week")? | Stage 2 returns an array. Each item gets its own `transactions` row referencing the same `email_imports` row. |
| Q3 | First sync — how far back? | `budget.syncStartDate` config, default 90 days ago. |
| Q4 | Where does the budget DB file live exactly? | Per-extension isolated DB at `<APP_ROOT>/data/extensions/parallx.budget/db.sqlite` (path managed by `DatabaseManager`; extension only sees `api.database`). |
| Q5 | Should categories be editable before first sync? | Yes — seed defaults on `activate()`, let user customize in settings, then sync. |
| Q6 | Does the Gmail MCP tool require the server to be running/connected at sync time? | Yes. `invokeToolWithRuntimeControl` returns `{ isError: true, content: [...] }` if the MCP server is not connected. The sync engine must check this and surface a clear error. |
| Q7 | Which model does the AI pipeline use? | P1: first model returned by `api.lm.getModels()`. P5 polish: read user's preferred default if/when that becomes a settable preference. |
| Q8 | What does the MCP tool's content shape actually look like? | MCP tools return `{ content: [{ type: 'text', text: '...' }] }`. The text payload is the JSON string. Confirmed in P2 first-run logging. |
| Q9 | Are migrations stored as files inside the .plx package, or shipped alongside? | Inside the package — same as media-organizer (`db/migrations/`). The packager script picks them up; `api.database.migrate('db/migrations/')` reads from the extension's installed dir. |

---

## Success criteria

- A sync job correctly parses at least the following email formats:
  Chase debit alert, Chase Sapphire credit alert, Venmo payment, PayPal receipt.
- Every imported transaction has a stable `gmail_message_id` — re-syncing the
  same window produces zero new rows.
- User can change a transaction's category; re-sync does not overwrite it.
- Low-confidence transactions appear in the review queue and are excluded from
  dashboard totals until confirmed.
- Dashboard shows correct month-to-date spend by category.
- Reconciliation row correctly computes gap between derived balance and most
  recent balance snapshot.
- `npx tsc --noEmit` produces no output.
- `npx vitest run` green.
