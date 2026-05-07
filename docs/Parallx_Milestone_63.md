# Milestone 63 — Budget Dashboard (Gmail → AI → SQLite → UI)

**Status:** planning
**Branch:** `milestone-63`
**Predecessor:** M62 (MCP-Only Provider Integration)

---

## Decisions & Invariants — Read This First

These are non-negotiable. The implementation MUST NOT silently change them. If
a decision below blocks implementation, raise it as a question — do not improvise.

| # | Decision | Reason |
|---|---|---|
| D1 | **Extension type:** external, unpacked at `ext/budget/`. ID `parallx.budget`. | Needs `api.database` (built-ins don't get it — verified `apiFactory.ts` `database` factory branch on `isBuiltin`). |
| D2 | **Database location:** `<workspacePath>/.parallx/extensions/budget/data.db`. **Not** `db.sqlite`, **not** `<APP_ROOT>/data/extensions/...`. The directory name is the **extension short name** (`budget`), derived from the tool ID by `toolId.split('.').slice(1).join('.')` — verified `apiFactory.ts` `extName` derivation. | Single source of truth — both `electron/database.cjs` (line 340) and the `apiFactory` `database` namespace agree on this layout. |
| D3 | **Money is stored as INTEGER cents.** Column `amount_cents INTEGER NOT NULL`. All UI converts to dollars at display time. **Never store dollars as REAL.** | SQLite REAL = IEEE-754 double; `0.1 + 0.2 ≠ 0.3`. Cents-as-integer is the only correct way to add up money. |
| D4 | **Dates are ISO 8601 text in the user's local timezone.** `transaction_date = 'YYYY-MM-DD'` (date only). `received_at`, `created_at`, `processed_at = 'YYYY-MM-DDTHH:MM:SS.sssZ'` (UTC for timestamps). | Local-date for transactions matches what the user sees on their statement; UTC for system timestamps avoids DST bugs. |
| D5 | **MCP server ID is configurable, not hardcoded.** Read from `budget.gmailMcpServerId` (default `parallx-gmail-mcp`). The full namespaced tool name is `mcp__${configValue}__list_since`. | The user names their MCP server when adding it — verified `src/openclaw/mcp/mcpToolBridge.ts:80` (`mcp__${serverId}__${schema.name}`). |
| D6 | **Gmail MCP tool input shape:** `list_since` accepts `{ since: ISO8601 string, max?: 1..500, query?: GmailSearchSyntax }`. `since` is required. Returns ALL messages (read + unread) received strictly after `since`, oldest-first. | New tool added by M63 P0 (D7). |
| D7 | **Sync uses the new `list_since` MCP tool**, which returns ALL messages received after a cursor timestamp regardless of Gmail read/unread status. `list_unread` is NOT used by Budget. The new tool is shipped as part of M63 P0 inside `tools/gmail-mcp-server`. | A budget needs historical mail; read-status-filtering breaks that. |
| D8 | **One targeted core change is required.** Add `api.mcp.invokeTool(toolName, args, token?)` to `ParallxApiObject` in `src/api/apiFactory.ts`. External extensions cannot today reach `ILanguageModelToolsService` (the symbol lives in `src/services/chatTypes.ts` which they cannot import). This is P0 of M63. **Do not attempt the workaround of calling `api.services.get({ id: '...' })` with a magic string** — the identifier comparison is by reference, not by string. | Honest reading of `apiFactory.ts` — `services.get/has` take a `ServiceIdentifier` *object*, not a string id. |
| D9 | **`api.views.reveal()` does not exist.** To navigate to a view from a command, call `api.commands.executeCommand('workbench.view.<viewId>')` (the workbench registers a navigation command per contributed view) — or, if that command is not registered for sub-views in this workbench, use `api.commands.executeCommand('budget.openDashboard')` which itself uses an internal mechanism (e.g. setting a context key the side-bar listens to). **Verify the exact command at P1 implementation time** — do not invent. | Verified: `apiFactory.ts` `views` shape exposes only `registerViewProvider` and `setBadge`. |
| D10 | **`api.commands.executeCommand`** (not `execute`). | Verified `apiFactory.ts` line ~99. |
| D11 | **Database open() must precede migrate().** Migration directory is **absolute**, computed from `api.env.toolPath` + platform separator + `'db/migrations'`. Not relative. | Verified pattern in `ext/media-organizer/main.js:17910-17924`. |
| D12 | **No external npm dependencies in the extension bundle for P1.** All UI is hand-written DOM via `$()` from `src/ui/dom.ts` (extension copies the helper, since it can't import from `src/`). Charts are inline SVG. JSON parsing is `JSON.parse`. | Same shape as `ext/media-organizer/main.js` (single bundled JS file). |
| D13 | **Sync runs single-flight.** A module-level `_syncInProgress` boolean guards against concurrent invocations of `runSync`. If true, the second call no-ops and the UI shows "Sync already running". | SQLite is single-writer; concurrent syncs would interleave inserts and corrupt the cursor. |
| D14 | **Categories are FK-referenced but the FK is enforced.** Order of CREATE TABLE in the migration file places `categories` BEFORE `transactions` so a strict reader can verify FK validity at parse time. (SQLite is lenient about order, but a less-smart human/AI reader is not.) | Readability + reviewability. |
| D15 | **Visual placeholders in ASCII are not literal Unicode in the UI.** Glyphs like `🔁`, `⇄`, `ⓘ`, `◀`, `▶`, `▾`, `⚙` in this doc represent **codicons** to be rendered via `api.icons.createIconHtml(<id>)`. The codicon-id mapping table is in the "Visual Design" section. The extension MUST NOT emit raw Unicode emojis in HTML. | Visual consistency with the workbench. |

---

## Vision

> Your Gmail inbox is already a ledger. Every transaction notification, every
> bank alert, every Venmo ping is a structured financial event buried in plain
> text. M63 turns that inbox into a live, AI-categorized budget dashboard —
> no external service, no subscription, no cloud sync. Just your email, a local
> SQLite database, and a Parallx tool.

The pipeline is:

```
Gmail MCP (list_since)
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
| Skill-based tool system | Budget sync is a programmatic pipeline, not a chat skill — but it calls the same MCP tool (`mcp__parallx-gmail-mcp__list_since`) via the same `invokeToolWithRuntimeControl` path autonomy already uses |
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
6. **One targeted core change, then no more.** Per D8, M63 P0 adds an
   `api.mcp.invokeTool(toolName, args, token?)` namespace to
   `src/api/apiFactory.ts` so external extensions can invoke MCP tools
   without importing service-identifier symbols. Once shipped, the extension
   itself lives entirely under `ext/budget/` and modifies no other `src/` file.

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
| `api.views` | `registerViewProvider(viewId, { createView })` (line 96), `setBadge(viewId, badge)` | View id must match a `contributes.views` entry. **No `reveal()` method** (D9) — use `api.commands.executeCommand` to navigate. |
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

Verified by reading `electron/database.cjs:340` and the `database` factory
branch in `src/api/apiFactory.ts`:

```
<workspacePath>/.parallx/extensions/<extName>/
    data.db            ← SQLite, WAL + foreign keys, opened by ExtensionDatabaseManager
    data.db-shm
    data.db-wal
```

For Budget: `extName = 'budget'` (derived from `toolId 'parallx.budget'` by
`toolId.split('.').slice(1).join('.')`).

Migrations live inside the extension's installed directory at
`<api.env.toolPath>/db/migrations/*.sql` and are applied lexicographically.
Migration filenames MUST start with a zero-padded ordinal:
`budget_001_initial.sql`, `budget_002_*.sql`, …
(verified `scripts/package-media-organizer.mjs` lines 28–33).

**`api.database.migrate()` requires an absolute path.** Compute it as:

```js
const sep = api.env.toolPath.includes('\\') ? '\\' : '/';
const migrationsDir = api.env.toolPath + sep + 'db' + sep + 'migrations';
```

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

See D2: `<workspacePath>/.parallx/extensions/budget/data.db`. WAL + foreign
keys are enabled automatically by `ExtensionDatabaseManager`
(`electron/database.cjs`).

### Migration file: `db/migrations/budget_001_initial.sql`

Tables are CREATEd in dependency order so a sequential reader can verify FKs
without backtracking. Money is INTEGER cents (D3). Dates follow D4.

```sql
PRAGMA foreign_keys = ON;

-- ── Cursor + log state (key/value blob) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL          -- JSON-encoded; readers MUST JSON.parse
);

-- Reserved keys (writers MUST use these spellings):
--   'last_gmail_message_id'   value: "<id>"          (JSON string)
--   'last_synced_at'          value: "<ISO8601>"    (JSON string)
--   'last_run_status'         value: {"ok":bool,"errors":number,"new":number}
--   'in_progress'             value: "true"|"false" (heartbeat for D13 mutex)

-- ── Sync log (one row per sync event line) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id      TEXT NOT NULL,             -- UUID v4 per sync run
    ts          TEXT NOT NULL,             -- ISO 8601 UTC
    level       TEXT NOT NULL CHECK(level IN ('info','warn','error')),
    msg_id      TEXT,                      -- gmail message id if applicable
    stage       TEXT,                      -- 'fetch'|'stage1'|'stage2'|'stage3'|'snapshot'|'commit'
    message     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_log_run_id_idx ON sync_log(run_id, id);

-- ── Categories (FK target, defined first) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id              TEXT PRIMARY KEY,         -- UUID v4
    name            TEXT UNIQUE NOT NULL,
    color           TEXT,                     -- hex like '#7aa2f7' OR semantic key like 'charts-blue'
    icon            TEXT,                     -- codicon id
    kind            TEXT NOT NULL DEFAULT 'expense'
                        CHECK(kind IN ('expense','income','transfer')),
    monthly_limit_cents INTEGER,              -- NULL = uncapped
    rollover        INTEGER NOT NULL DEFAULT 0 CHECK(rollover IN (0,1)),
    sort_order      INTEGER NOT NULL DEFAULT 0,
    archived        INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS categories_sort_idx ON categories(sort_order);

-- ── Email imports (one row per Gmail message we have processed) ────────────
CREATE TABLE IF NOT EXISTS email_imports (
    gmail_message_id  TEXT PRIMARY KEY,
    received_at       TEXT NOT NULL,                  -- ISO 8601 UTC
    raw_subject       TEXT,
    raw_snippet       TEXT,                           -- snippet only — no full body
    is_transaction    INTEGER,                        -- 0|1|NULL=unknown (Stage 1 result, cached)
    is_balance        INTEGER,                        -- 0|1|NULL=unknown (Stage 1b result, cached)
    classifier_model  TEXT,                           -- model id used for Stage 1 (audit)
    processed_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS email_imports_received_idx ON email_imports(received_at);

-- ── Transactions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id                TEXT PRIMARY KEY,                          -- UUID v4
    gmail_message_id  TEXT REFERENCES email_imports(gmail_message_id) ON DELETE SET NULL,
                                                                -- NULLable: manual-entry txns have no email source
    parent_id         TEXT REFERENCES transactions(id) ON DELETE CASCADE,
                                                                -- non-NULL = this is a split child of parent_id
    merchant          TEXT,
    amount_cents      INTEGER NOT NULL,                          -- positive = debit/spend, negative = refund/credit
    currency          TEXT NOT NULL DEFAULT 'USD',
    card_last_four    TEXT,
    transaction_date  TEXT NOT NULL,                             -- YYYY-MM-DD (local TZ)
    category_id       TEXT REFERENCES categories(id) ON DELETE SET NULL,
    ai_confidence     TEXT CHECK(ai_confidence IN ('high','medium','low')),
    extractor_model   TEXT,                                      -- model id used for Stage 2
    categorizer_model TEXT,                                      -- model id used for Stage 3
    user_overridden   INTEGER NOT NULL DEFAULT 0 CHECK(user_overridden IN (0,1)),
    status            TEXT NOT NULL DEFAULT 'confirmed'
                          CHECK(status IN ('confirmed','review','hidden','deleted')),
    notes             TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS tx_date_idx     ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS tx_category_idx ON transactions(category_id);
CREATE INDEX IF NOT EXISTS tx_status_idx   ON transactions(status);
CREATE INDEX IF NOT EXISTS tx_parent_idx   ON transactions(parent_id);

-- ── Balance snapshots (reconciliation source) ──────────────────────────────
CREATE TABLE IF NOT EXISTS balance_snapshots (
    id                TEXT PRIMARY KEY,
    gmail_message_id  TEXT REFERENCES email_imports(gmail_message_id) ON DELETE SET NULL,
    account_last_four TEXT,
    balance_cents     INTEGER NOT NULL,
    currency          TEXT NOT NULL DEFAULT 'USD',
    snapshot_date     TEXT NOT NULL,                             -- YYYY-MM-DD
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS bs_date_idx ON balance_snapshots(snapshot_date);
```

**Default categories** are seeded on first `activate()` only when
`SELECT COUNT(*) FROM categories = 0`. UUIDs MUST be generated at seed time
(do not embed literal UUIDs in the migration — every workspace gets fresh ones):

| name | kind | color | icon | monthly_limit_cents | rollover |
|---|---|---|---|---|---|
| Groceries | expense | charts-green | basket | NULL | 1 |
| Dining | expense | charts-orange | flame | NULL | 0 |
| Transport | expense | charts-blue | rocket | NULL | 1 |
| Utilities | expense | charts-purple | plug | NULL | 0 |
| Shopping | expense | charts-yellow | tag | NULL | 1 |
| Health | expense | charts-red | heart | NULL | 1 |
| Entertainment | expense | charts-orange | play | NULL | 0 |
| Subscriptions | expense | charts-purple | sync | NULL | 0 |
| Travel | expense | charts-blue | globe | NULL | 1 |
| Other | expense | foreground | circle-outline | NULL | 0 |
| Income | income | charts-green | arrow-down | NULL | 0 |
| Transfer | transfer | descriptionForeground | arrow-swap | NULL | 0 |

### Future migrations (not in 001 — explicit deferral)

The "Best-in-Class" features below describe additional tables (`rules`,
`recurring_transactions`, `goals`). These are **not** part of `001_initial.sql`.
They ship in successive numbered files (`002_rules.sql`, `003_recurring.sql`,
`004_goals.sql`) at the phase that introduces the feature. P1 ships only `001`.

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

### How MCP tools are called programmatically (after P0 lands)

Per D8, P0 of M63 adds a new namespace to the extension API. The exact shape
MUST be:

```typescript
// Added to ParallxApiObject in src/api/apiFactory.ts
readonly mcp: {
  /**
   * Invoke a registered MCP tool by its namespaced name.
   * @param toolName e.g. 'mcp__parallx-gmail-mcp__list_since'
   * @param args    JSON-serializable arguments matching the tool's inputSchema
   * @param token   optional CancellationToken-shaped object { isCancellationRequested, onCancellationRequested }
   * @returns { content: { type: 'text'; text: string }[]; isError?: boolean }
   */
  invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    token?: { isCancellationRequested: boolean },
  ): Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
  /** List currently-registered MCP tools (so the extension can verify connection). */
  listTools(): Promise<readonly { name: string; description?: string }[]>;
} | undefined;
```

Implementation: `invokeTool` is a thin bridge that resolves
`ILanguageModelToolsService` from the workbench's services container and calls
`invokeToolWithRuntimeControl`, mapping result/errors through the standard
MCP content shape. `listTools` returns the names of currently-registered tools
(intersection of installed MCP servers' capabilities).

Sync-engine usage:

```typescript
if (!api.mcp) {
  throw new Error('parallx.mcp namespace unavailable — core too old');
}
const gmailServerId = api.workspace.getConfiguration('budget')
  .get<string>('gmailMcpServerId', 'parallx-gmail-mcp');
const toolName = `mcp__${gmailServerId}__list_since`;

// Verify the tool is reachable BEFORE running the sync loop
const available = await api.mcp.listTools();
if (!available.some(t => t.name === toolName)) {
  throw new Error(
    `Gmail MCP tool '${toolName}' is not connected. ` +
    `Open Settings → MCP Servers and connect '${gmailServerId}'.`,
  );
}

const lastSync = await db.get(
  `SELECT value FROM sync_state WHERE key = 'last_synced_at'`,
);
const sinceIso = lastSync ? JSON.parse(lastSync.value)
                          : isoNDaysAgo(api.workspace.getConfiguration('budget')
                              .get<number>('syncStartDays', 90));

// D6: { since, max, query }. Do NOT pass after: in `query`.
const result = await api.mcp.invokeTool(toolName, {
  since: sinceIso,
  max: 100,
  // Optional: narrow with Gmail label (D7 mitigation)
  // query: 'label:transactions',
});
if (result.isError) {
  throw new Error(`Gmail MCP error: ${result.content?.[0]?.text ?? 'unknown'}`);
}
const messages = JSON.parse(result.content[0].text);
// messages: Array<{ id: string; receivedAt: ISO8601; subject: string; snippet: string; from: string; labels: string[] }>
```

### Prompt contract — applies to ALL stages

Every prompt below is a **literal template**. Substitute `{var}` placeholders
from the row data. Do not paraphrase. The implementation MUST:

1. Send `messages: [{ role: 'system', content: <SYSTEM> }, { role: 'user', content: <USER> }]`.
2. Pass `options: { temperature: 0, format: 'json' }` to `sendChatRequest`
   (the Ollama provider honors `format: 'json'` to constrain output).
3. Concatenate the streamed `content` chunks until `done: true`.
4. Wrap `JSON.parse(response)` in try/catch. On parse failure: retry **once**
   with the same prompt + a trailing user message `'Respond ONLY with the
   JSON object — no prose, no markdown.'`. On second failure, treat as a
   malformed response per the per-stage rules below.
5. Validate the parsed object's shape against the schema below. Missing or
   wrong-typed fields → treat as malformed.

### Stage 1 — Classification (one model call per email)

```
SYSTEM:
You classify emails. Respond with a single JSON object and nothing else.

USER:
Subject: {subject}
Snippet: {snippet}

Return:
{
  "is_transaction": <true if this email reports a single bank or card transaction (charge, payment, refund, transfer); false otherwise>,
  "is_balance":     <true if this email reports an account balance (statement, daily balance alert); false otherwise>
}
```

Expected response schema: `{ is_transaction: boolean, is_balance: boolean }`.
Malformed → set both to `false` (skip). Log a warn line to `sync_log`.

### Stage 2 — Extraction (only if Stage 1 `is_transaction = true`)

```
SYSTEM:
You extract financial transaction data from emails. Respond with a single JSON
object and nothing else. Money is reported in dollars; if you see cents, divide
by 100. If multiple transactions are mentioned, return them in the "items" array.

USER:
Subject: {subject}
Snippet: {snippet}

Return:
{
  "items": [
    {
      "merchant":         <string or null>,
      "amount":           <number — positive for spend/charge, negative for refund/credit>,
      "card_last_four":   <string of 4 digits or null>,
      "transaction_date": <"YYYY-MM-DD">,
      "confidence":       <"high" | "medium" | "low">
    }
  ]
}
```

Expected schema: `{ items: Array<{ merchant: string|null, amount: number,
card_last_four: string|null, transaction_date: string, confidence:
'high'|'medium'|'low' }> }`. Empty `items` → no transactions extracted, skip
this email entirely (no `transactions` rows). For each item with
`confidence='low'` → insert with `status='review'`, skip Stage 3 for that item.
Malformed → insert one synthetic `review` row with `amount_cents=0` linked to
the email so the user can manually triage.

### Stage 3 — Categorization (per-item, confidence ≥ medium only)

The categories list is fetched once per sync run as
`SELECT id, name FROM categories WHERE archived=0 AND kind='expense' ORDER BY sort_order` — Income/Transfer kinds are excluded so the AI doesn't mis-assign them.

```
SYSTEM:
You pick the best-fitting budget category for a transaction. Respond with a
single JSON object and nothing else. The category MUST be one of the listed
names (case-insensitive); if none fits, pick "Other".

USER:
Merchant: {merchant}
Amount:   {amount} {currency}
Categories: {comma-separated category names}

Return:
{ "category": <one of the listed category names> }
```

The response's `category` is matched case-insensitively against `categories.name`;
on match, `transactions.category_id` is set to that row's id. On no-match or
malformed → leave `category_id = NULL` and `status = 'review'`.

### Stage 1b — Balance snapshot extraction (only if Stage 1 `is_balance = true`)

```
SYSTEM:
You extract account balance information from emails. Respond with a single JSON
object and nothing else.

USER:
Subject: {subject}
Snippet: {snippet}

Return:
{
  "account_last_four": <string of 4 digits or null>,
  "balance":           <number, in dollars>,
  "snapshot_date":     <"YYYY-MM-DD">
}
```

Malformed → log warn, no `balance_snapshots` row inserted.

### Re-running stages independently

Because Stage 1 results are cached in `email_imports.is_transaction` and
`is_balance`, the user can run "Re-categorize all" (Categories view command)
which loops `SELECT t.id, t.merchant, t.amount_cents, t.currency FROM
transactions t WHERE t.user_overridden=0 AND t.status='confirmed'` and re-runs
Stage 3 only — no Gmail calls, no re-extraction.

---

## Gmail MCP Server Changes (M63 P0)

The existing `tools/gmail-mcp-server` ships only `list_unread`, which filters
by Gmail's read state and is therefore unfit for a budget pipeline (D7).
M63 P0 adds a NEW tool **alongside** `list_unread` (do not remove the old one
— other consumers may rely on it):

### Tool spec — `list_since`

**Name:** `list_since`
**Description (used by tool catalog):** `"List Gmail messages received after a cursor timestamp, regardless of read/unread status. Returns oldest-first."`

**Input schema (JSON Schema):**

```json
{
  "type": "object",
  "required": ["since"],
  "properties": {
    "since": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 UTC timestamp. Returns messages with internalDate strictly greater than this."
    },
    "max": {
      "type": "integer",
      "minimum": 1,
      "maximum": 500,
      "default": 100,
      "description": "Maximum number of messages to return in this call."
    },
    "query": {
      "type": "string",
      "description": "Optional Gmail search syntax to narrow results (e.g. 'from:chase.com OR from:venmo.com'). Combined with the since cursor via AND."
    }
  }
}
```

**Output (returned as JSON-encoded string in MCP `content[0].text`):**

```typescript
Array<{
  id: string;            // Gmail message id (stable, used for dedup)
  threadId: string;
  receivedAt: string;    // ISO 8601 UTC, derived from internalDate
  from: string;          // header value, raw
  subject: string;       // header value, raw
  snippet: string;       // Gmail snippet — first ~200 chars, no HTML
  labels: string[];      // e.g. ["INBOX", "CATEGORY_UPDATES", "Label_123"]
}>
```

The array MUST be sorted **oldest-first** (ascending `receivedAt`) so the
sync engine processes mail in chronological order and the cursor advances
monotonically.

### Implementation notes

- Use Gmail API `users.messages.list` with `q: \`after:${unixSeconds(since)} ${userQuery ?? ''}\`.trim()`. Gmail's `after:` is **inclusive at second granularity**; the budget engine's dedup table (`email_imports.gmail_message_id`) handles the off-by-one second case correctly.
- For each id returned by `list`, call `users.messages.get(id, { format: 'metadata', metadataHeaders: ['From','Subject'] })` to fetch headers + snippet without downloading bodies. **Do not request `format: 'full'`** — bodies are not needed and inflate latency / response size.
- Pagination: if Gmail returns `nextPageToken` AND total fetched < `max`, follow it. Otherwise return what was fetched.
- Errors propagate as MCP `{ isError: true, content: [{ type: 'text', text: '<message>' }] }`.

### Rationale for not modifying `list_unread`

Other surfaces (chat, autonomy) already invoke `list_unread`. Touching its
schema would be a breaking change. Adding a sibling tool keeps the contract
clean and lets the existing tool keep its (legitimate) "show me what's new
in my inbox" semantics.

---

## Sync Engine

### Cursor pattern

Cursor lives in the `sync_state` key/value table (see schema). The Gmail MCP
tool is queried with the **timestamp** cursor (`since`), not the message-id
cursor. Message-id is only used for dedup once a message has been fetched.

```
sync_state key: "last_synced_at"          # JSON string of an ISO 8601 UTC timestamp
sync_state key: "last_gmail_message_id"   # JSON string of the newest msg.id seen (audit/debug only)
sync_state key: "last_run_status"         # JSON object: { ok, errors, new, ... }
sync_state key: "in_progress"             # JSON "true"/"false" — D13 single-flight heartbeat
```

### Flow (precise pseudocode)

```
runSync(api, db):
  if _syncInProgress: return                                      # D13 mutex
  _syncInProgress = true
  runId = uuidv4()
  log(runId, 'info', 'fetch', 'Sync started')
  try:
    cfg = api.workspace.getConfiguration('budget')
    serverId = cfg.get('gmailMcpServerId', 'parallx-gmail-mcp')
    toolName = `mcp__${serverId}__list_since`
    sinceIso = (await db.get('SELECT value FROM sync_state WHERE key=?', ['last_synced_at']))?.value
               ? JSON.parse(prev) : isoNDaysAgo(cfg.get('syncStartDays', 90))

    result = await api.mcp.invokeTool(toolName, { since: sinceIso, max: 100 })
    if result.isError: throw...
    messages = JSON.parse(result.content[0].text)        # array, oldest-first

    models = await api.lm.getModels()
    if models.length == 0: throw 'No local models — install/start Ollama'
    modelId = cfg.get('preferredModelId', '') || models[0].id

    newestSeenIso = sinceIso
    newestSeenId  = null
    counts = { confirmed: 0, review: 0, snapshot: 0, skipped: 0, errors: 0 }

    for msg in messages:                                  # ORDERED: oldest → newest
      if _cancelRequested: break
      already = await db.get('SELECT 1 FROM email_imports WHERE gmail_message_id=?', [msg.id])
      if already: { counts.skipped++; continue }

      # Stage 1 (transaction?) and 1b (balance snapshot?) — two prompts, parallel ok
      [isTxn, isBal] = await stage1(api, modelId, msg)
      await db.run(
        'INSERT INTO email_imports(gmail_message_id, received_at, raw_subject, raw_snippet, is_transaction, is_balance, classifier_model, processed_at) VALUES (?,?,?,?,?,?,?,?)',
        [msg.id, msg.receivedAt, msg.subject, msg.snippet, isTxn?1:0, isBal?1:0, modelId, nowIso()]
      )

      if isTxn:
        try:
          extracted = await stage2(api, modelId, msg)        # may return array (multi-tx)
          for tx in extracted:
            categoryId = tx.confidence != 'low'
              ? await stage3(api, modelId, tx, categoriesList)   # returns category id or null
              : null
            await db.run(
              'INSERT INTO transactions(id, gmail_message_id, merchant, amount_cents, card_last_four, transaction_date, category_id, ai_confidence, extractor_model, categorizer_model, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
              [uuidv4(), msg.id, tx.merchant, dollarsToCents(tx.amount), tx.card_last_four,
               tx.transaction_date, categoryId, tx.confidence, modelId, modelId,
               tx.confidence == 'low' ? 'review' : 'confirmed']
            )
            counts[tx.confidence == 'low' ? 'review' : 'confirmed']++
        catch jsonErr:
          log(runId, 'warn', 'stage2', `Parse failed for ${msg.id}: ${jsonErr.message}`)
          # fall through to review-queue insert with NULL fields
          await db.run('INSERT INTO transactions(id, gmail_message_id, status, ai_confidence, transaction_date, amount_cents) VALUES (?,?,?,?,?,?)',
            [uuidv4(), msg.id, 'review', 'low', isoDate(msg.receivedAt), 0])
          counts.review++

      if isBal:
        try:
          snap = await stage1bExtract(api, modelId, msg)
          await db.run(
            'INSERT INTO balance_snapshots(id, gmail_message_id, account_last_four, balance_cents, snapshot_date) VALUES (?,?,?,?,?)',
            [uuidv4(), msg.id, snap.account_last_four, dollarsToCents(snap.balance), snap.snapshot_date]
          )
          counts.snapshot++
        catch e:
          log(runId, 'warn', 'snapshot', `Balance parse failed for ${msg.id}: ${e.message}`)
          counts.errors++

      if msg.receivedAt > newestSeenIso:
        newestSeenIso = msg.receivedAt
        newestSeenId  = msg.id

    # Cursor write — LAST step, single transaction
    await db.tx([
      { type:'run', sql:"INSERT OR REPLACE INTO sync_state(key,value) VALUES('last_gmail_message_id', ?)", params:[JSON.stringify(newestSeenId)] },
      { type:'run', sql:"INSERT OR REPLACE INTO sync_state(key,value) VALUES('last_synced_at', ?)",        params:[JSON.stringify(newestSeenIso)] },
      { type:'run', sql:"INSERT OR REPLACE INTO sync_state(key,value) VALUES('last_run_status', ?)",       params:[JSON.stringify({ ok:true, ...counts })] },
    ])
    log(runId, 'info', 'commit', `Sync complete: ${JSON.stringify(counts)}`)
  catch err:
    log(runId, 'error', 'fetch', err.message)
    await db.run("INSERT OR REPLACE INTO sync_state(key,value) VALUES('last_run_status', ?)", [JSON.stringify({ ok:false, error: err.message })])
  finally:
    _syncInProgress = false
```

**Cursor update is the last write.** If sync crashes mid-run, the next run
re-processes the same window. Dedup via `email_imports.gmail_message_id`
PRIMARY KEY prevents double-inserts.

### First-sync bootstrapping

`sync_state` has no `last_synced_at`. Use `budget.syncStartDays` config value
(integer; default 90). Compute `sinceIso = now - N days` in UTC.

### Multi-transaction emails

If Stage 2 returns an **array**, each element becomes its own `transactions`
row, all referencing the same `email_imports.gmail_message_id`. The prompt
must explicitly allow array-or-single output (see updated Stage 2 prompt below).

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
          "budget.gmailMcpServerId": {
            "type": "string",
            "default": "parallx-gmail-mcp",
            "description": "The MCP server ID under which the Gmail server is registered. Must match the ID used in the MCP Servers UI exactly."
          },
          "budget.syncStartDays": {
            "type": "integer",
            "default": 90,
            "minimum": 1,
            "maximum": 3650,
            "description": "On the very first sync (no cursor yet), import mail received within this many days."
          },
          "budget.preferredModelId": {
            "type": "string",
            "default": "",
            "description": "Model id to use for classification/extraction/categorization. Empty = first model returned by api.lm.getModels()."
          }
        }
      }
    ]
  }
}
```

### activate() entry point (follows verified media-organizer pattern)

```javascript
// main.js (compiled, single-file bundle — no imports from src/)
let _dbBridge = null;
let _api = null;
let _activated = false;
let _syncInProgress = false;     // D13 mutex
let _cancelRequested = false;
const _disposables = [];

const db = {
  async run(sql, params = [])  { const r = await _dbBridge.run(sql, params);  if (r.error) throw r.error; return r; },
  async get(sql, params = [])  { const r = await _dbBridge.get(sql, params);  if (r.error) throw r.error; return r.row ?? null; },
  async all(sql, params = [])  { const r = await _dbBridge.all(sql, params);  if (r.error) throw r.error; return r.rows ?? []; },
  async tx(ops)                { const r = await _dbBridge.runTransaction(ops); if (r.error) throw r.error; return r.results ?? []; },
};

export async function activate(api, context) {
  if (_activated) return;
  _activated = true;
  _api = api;

  // ── Hard guards (D-list invariants) ─────────────────────────────────────────────
  if (!api.database) { throw new Error('[budget] api.database unavailable — ext must not be built-in'); }
  if (!api.lm)       { throw new Error('[budget] api.lm unavailable — language models service missing'); }
  if (!api.mcp)      { throw new Error('[budget] api.mcp unavailable — core too old; M63 P0 not landed'); }

  // ── Open + migrate (D11: open() must precede migrate(), absolute path) ────────────
  _dbBridge = api.database;
  const openRes = await _dbBridge.open();
  if (openRes.error) throw new Error('[budget] db open failed: ' + openRes.error.message);
  const sep = api.env.toolPath.includes('\\') ? '\\' : '/';
  const migrationsDir = api.env.toolPath + sep + 'db' + sep + 'migrations';
  const migRes = await _dbBridge.migrate(migrationsDir);
  if (migRes.error) throw new Error('[budget] migration failed: ' + migRes.error.message);

  // Seed default categories on first run (idempotent: COUNT(*)=0 check)
  await seedDefaultCategoriesIfEmpty(db);

  // ── Register sub-views ──────────────────────────────────────────────────────
  _disposables.push(api.views.registerViewProvider('budget.dashboard',    { createView: el => new DashboardView(el, db, api) }));
  _disposables.push(api.views.registerViewProvider('budget.transactions', { createView: el => new TransactionListView(el, db, api) }));
  _disposables.push(api.views.registerViewProvider('budget.reviewQueue',  { createView: el => new ReviewQueueView(el, db, api) }));
  _disposables.push(api.views.registerViewProvider('budget.syncLog',      { createView: el => new SyncLogView(el, db, api) }));
  _disposables.push(api.views.registerViewProvider('budget.categories',   { createView: el => new CategoriesView(el, db, api) }));

  // ── Register commands (D10: executeCommand, not execute) ──────────────────────────────
  _disposables.push(api.commands.registerCommand('budget.sync',           () => runSync(api, db)));
  _disposables.push(api.commands.registerCommand('budget.cancelSync',     () => { _cancelRequested = true; }));
  // D9: navigation command — EXACT workbench command id MUST be verified during P1.
  // The candidate is 'workbench.view.show' with the viewId arg; if that does not exist in this build,
  // fall back to wiring through a Parallx-internal context key. DO NOT INVENT a method on api.views.
  _disposables.push(api.commands.registerCommand('budget.openDashboard', () =>
    api.commands.executeCommand('workbench.view.show', 'budget.dashboard')));
}

export async function deactivate() {
  for (const d of _disposables.splice(0)) { try { d.dispose?.(); } catch {} }
  if (_dbBridge) await _dbBridge.close();
  _activated = false;
}
```

**Verified API surfaces (in `src/api/apiFactory.ts`):**
- `api.database` — line 217. Methods: `open()`, `close()`, `migrate(absoluteDir)`, `run(sql, params)`, `get(sql, params)`, `all(sql, params)`, `runTransaction(ops)`. All return `Promise<{ error?, row?, rows?, results? }>`. **External-extension only** — returns `undefined` for built-ins.
- `api.views.registerViewProvider(viewId, { createView(container) })` — line 96. Used by media-organizer at `ext/media-organizer/main.js:18068`. **`api.views` does NOT expose `reveal` (D9).**
- `api.commands.registerCommand(id, handler)` — line 100.
- `api.commands.executeCommand(id, ...args)` — line 99. **Not `execute` (D10).**
- `api.lm.sendChatRequest(modelId, messages, options?)` — line 686. Returns `AsyncIterable<{ content?: string; done: boolean }>`. May be `undefined` (guard before use).
- `api.lm.getModels()` — returns the list of available models from `LanguageModelsService`.
- `api.mcp.invokeTool(name, args, token?)` — **added by M63 P0** (D8). Returns `Promise<{ content: { type: string; text: string }[]; isError?: boolean }>`.
- `api.mcp.listTools()` — added by M63 P0. Returns `Promise<readonly { name; description? }[]>`.
- `api.icons.createIconHtml(iconId, size?)` — codicon-rendering helper. Used everywhere ASCII layouts in this doc show a Unicode glyph (D15).
- `api.env.toolPath` — absolute path to the unpacked extension directory (used to derive `migrationsDir`).
- `api.chat.registerTool(name, def)` — used by media-organizer at line 17850 if we want to expose budget queries to chat (P5 stretch). May be `undefined`.

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
      { id: 'sync',   icon: 'refresh', label: 'Sync',   run: () => this.api.commands.executeCommand('budget.sync') },
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

### Glyph → codicon mapping (D15)

The ASCII art below uses Unicode characters as **placeholders** so the document
is readable. The runtime extension MUST render every glyph as a codicon via
`api.icons.createIconHtml(<id>, 16)`. **Do not emit raw Unicode emojis in the
extension's HTML** — use the table below.

| ASCII glyph | codicon id | Used for |
|---|---|---|
| `🔁` `↻` | `sync` | Sync now, refresh |
| `⇄` | `arrow-swap` | Transfers, swap |
| `ⓘ` | `info` | Info hints |
| `◀` `▶` | `chevron-left` `chevron-right` | Month nav |
| `▾` `▸` | `chevron-down` `chevron-right` | Tree expand |
| `⋮` | `more` | Row context menu |
| `⚙` | `gear` | Settings |
| `✓` | `check` | Confirmed |
| `!` (warning) | `warning` | Over-budget |
| `▼` (down delta) | `arrow-down` | Spending trend down |
| `▲` (up delta) | `arrow-up` | Spending trend up |
| `●` (color dot) | (no codicon) | Hand-drawn `<span class="cat-dot">` colored with `--vscode-charts-*` |
| `▓` `░` (bars) | (no codicon) | Hand-drawn `<div>` bars styled with category color + neutral track |

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
    id                   TEXT PRIMARY KEY,
    merchant             TEXT NOT NULL,
    expected_amount_cents INTEGER,                       -- D3: cents, not REAL
    cadence_days         INTEGER,
    last_seen_date       TEXT,                           -- YYYY-MM-DD
    next_expected        TEXT,                           -- YYYY-MM-DD
    category_id          TEXT REFERENCES categories(id) ON DELETE SET NULL
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
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    target_amount_cents INTEGER NOT NULL,                          -- D3: cents
    target_date         TEXT,                                      -- YYYY-MM-DD
    category_id         TEXT REFERENCES categories(id) ON DELETE SET NULL,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
| Q1 | Does `mcp__parallx-gmail-mcp__list_since` return message ID, subject, snippet, received-at, from, and labels in one call? | **MUST** — implementer designs the tool's response payload to include all of these fields per the schema in the "Gmail MCP server changes" section. Log the first response in P2 to confirm. |
| Q2 | How do we handle multi-transaction emails (e.g. "5 transactions this week")? | Stage 2 returns an array. Each item gets its own `transactions` row referencing the same `email_imports` row. |
| Q3 | First sync — how far back? | `budget.syncStartDays` config (integer days), default 90. |
| Q4 | Where does the budget DB file live exactly? | **ANSWERED (D2):** `<workspacePath>/.parallx/extensions/budget/data.db`. Verified `electron/database.cjs:340`. |
| Q5 | Should categories be editable before first sync? | Yes — seed defaults on `activate()`, let user customize in settings, then sync. |
| Q6 | Does the Gmail MCP tool require the server to be running/connected at sync time? | Yes. `invokeToolWithRuntimeControl` returns `{ isError: true, content: [...] }` if the MCP server is not connected. The sync engine must check this and surface a clear error. |
| Q7 | Which model does the AI pipeline use? | P1: first model returned by `api.lm.getModels()`. P5 polish: read user's preferred default if/when that becomes a settable preference. |
| Q8 | What does the MCP tool's content shape actually look like? | MCP tools return `{ content: [{ type: 'text', text: '...' }] }`. The text payload is the JSON string. Confirmed in P2 first-run logging. |
| Q9 | Are migrations stored as files inside the .plx package, or shipped alongside? | Inside the package — same as media-organizer (`db/migrations/`). The packager script picks them up; `api.database.migrate(<absolute path>)` reads from the extension's installed dir. **Path MUST be absolute** (D11). |
| Q10 | How do we sync transactions whose emails the user has already read? | **ANSWERED.** P1 ships a NEW MCP tool `list_since` in `tools/gmail-mcp-server` that returns ALL messages received after a cursor timestamp **regardless of read/unread status**. The Budget sync engine calls `mcp__<serverId>__list_since` (not `list_unread`). Tool spec is in the "Gmail MCP server changes" section below. |
| Q11 | What is the exact workbench command id to programmatically reveal a sub-view? (D9) | **Implementer's call at P1.** Candidate: `api.commands.executeCommand('workbench.view.show', 'budget.dashboard')`. If that command id does not exist, the implementer picks a working alternative (Parallx context-key listener, or registering a custom command). The constraint stays: do NOT invent a method on `api.views`. |

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
