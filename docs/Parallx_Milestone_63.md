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

## UI / UX — Grounded in Parallx Design System

### How views work

Every budget view extends the `View` base class from `src/views/view.ts`.
Views render raw DOM (no React/JSX — consistent with all other Parallx views).
They use the standard design tokens and the `$()` DOM utility from `src/ui/dom.ts`.

### Design tokens in use

```css
var(--vscode-sideBar-background)    /* view background */
var(--vscode-panel-border)          /* dividers */
var(--vscode-foreground)            /* primary text */
var(--vscode-descriptionForeground) /* secondary text, amounts */
var(--vscode-list-hoverBackground)  /* row hover */
var(--vscode-focusBorder)           /* focus rings */
var(--vscode-input-background)      /* inline dropdowns */
var(--vscode-editorWarning-foreground) /* reconciliation amber gap */
var(--vscode-errorForeground)       /* reconciliation red gap */
var(--parallx-fontFamily-ui)
var(--parallx-fontSize-base)
var(--parallx-fontSize-sm)
var(--parallx-radius-sm)
```

### Existing UI components we reuse

| Need | Existing component |
|---|---|
| Category selector per row | `Dropdown` from `src/ui/dropdown.ts` |
| Transaction list with keyboard nav | `FilterableList` from `src/ui/list.ts` |
| Sync / Confirm / Delete buttons | `Button` from `src/ui/button.ts` |
| Month filter tabs | `SegmentedControl` from `src/ui/segmentedControl.ts` |
| View toolbars | `ActionBar` from `src/ui/actionBar.ts` |
| Confirmation dialogs | `Overlay` from `src/ui/overlay.ts` |
| Row hover tooltips | `Tooltip` from `src/ui/tooltip.ts` |

### What we need to build new

**Charts** — No chart component exists in `src/ui/`. The dashboard needs a
donut chart (spending by category) and a bar chart (month-over-month totals).

We build minimal **SVG charts** inline — ~150 lines total, no third-party
dependency, full control over design tokens. If more capability is needed later,
a charting library can be dropped in without changing the data layer.

### Dashboard view
- SVG donut chart: spending by category (current month)
- SVG bar chart: month-over-month total spend (last 6 months)
- Reconciliation row: `Derived: $X | Last snapshot: $Y | Gap: $Z`
  (amber if gap > $5, red if gap > $50)
- "Sync Now" via `ActionBar`

### Transaction list view
- `FilterableList` base for keyboard nav + fuzzy filter
- Each row: date · merchant · amount · card · inline `Dropdown` for category
- Soft-delete via right-click context menu
- Month filter via `SegmentedControl`

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
