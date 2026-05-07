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

All tables live in a dedicated database file:
`~/.parallx/budget/budget.db`

```sql
-- Cursor state (also stores any other persistent sync config)
CREATE TABLE sync_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Every email that passed the "is this a transaction?" classification.
-- Kept so we can re-run categorization without re-fetching Gmail.
CREATE TABLE email_imports (
    gmail_message_id  TEXT PRIMARY KEY,
    received_at       DATETIME NOT NULL,
    raw_subject       TEXT,
    raw_snippet       TEXT,        -- Gmail snippet only — no full body stored
    processed_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- One row per transaction extracted from an email.
CREATE TABLE transactions (
    id                TEXT PRIMARY KEY,   -- UUID v4
    gmail_message_id  TEXT NOT NULL REFERENCES email_imports(gmail_message_id),
    merchant          TEXT,
    amount            DECIMAL(10,2) NOT NULL,
    card_last_four    TEXT,
    transaction_date  DATE NOT NULL,
    category_id       TEXT REFERENCES categories(id),
    ai_confidence     TEXT CHECK(ai_confidence IN ('high','medium','low')),
    user_overridden   INTEGER NOT NULL DEFAULT 0,  -- 0 = AI, 1 = user
    status            TEXT NOT NULL DEFAULT 'confirmed'
                          CHECK(status IN ('confirmed','review','deleted')),
    notes             TEXT,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Balance snapshots parsed from bank statement / balance-alert emails.
-- Used for reconciliation only — not summed into budget totals.
CREATE TABLE balance_snapshots (
    id                TEXT PRIMARY KEY,
    gmail_message_id  TEXT REFERENCES email_imports(gmail_message_id),
    account_last_four TEXT,
    balance           DECIMAL(10,2) NOT NULL,
    snapshot_date     DATE NOT NULL,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User-managed category list (seeded with defaults on first run).
CREATE TABLE categories (
    id    TEXT PRIMARY KEY,
    name  TEXT UNIQUE NOT NULL,
    color TEXT,
    icon  TEXT
);
```

**Default categories (seeded):** Groceries, Dining, Transport, Utilities,
Shopping, Health, Entertainment, Subscriptions, Travel, Other.

---

## AI Pipeline Design

### Stage 1 — Classification

Prompt Gemma with the email subject + snippet. Answer is binary.

```
Is this email a bank/card transaction notification?
Return JSON: { "is_transaction": true|false }
```

If `false` → skip. No DB write.

### Stage 2 — Extraction (only if Stage 1 = true)

```
Extract the transaction fields from this notification.
Return JSON:
{
  "merchant": string | null,
  "amount": number,           // positive = debit, negative = credit/refund
  "card_last_four": string | null,
  "transaction_date": "YYYY-MM-DD",
  "confidence": "high" | "medium" | "low"
}
```

Low confidence → `status = 'review'`.

### Stage 3 — Categorization (only if Stage 2 confidence ≥ medium)

```
Given merchant "{merchant}" and amount ${amount},
assign one category from this list: {categories}.
Return JSON: { "category": string }
```

Low-confidence transactions skip categorization and land in the review queue
with `category_id = null`.

### Balance snapshot detection (parallel to Stage 1)

A second classifier checks if the email is a balance-notification from a bank.
If yes, extract `account_last_four` and `balance`. Insert into
`balance_snapshots`. No category needed.

---

## Sync Engine

### Cursor pattern

```
sync_state key: "last_gmail_message_id"
```

1. Read cursor from `sync_state`.
2. Call Gmail MCP `list_unread` with `query: "after:<cursor-date>"` (or no
   constraint on first sync).
3. For each message, in chronological order:
   a. Check `email_imports` — if `gmail_message_id` exists, skip (dedup).
   b. Run Stage 1 classification.
   c. If transaction: run Stage 2 + Stage 3, insert rows.
   d. If balance snapshot: insert into `balance_snapshots`.
4. After all messages processed successfully: update cursor to newest
   `gmail_message_id` seen.
5. Cursor update is the last write — if sync crashes mid-run, the next run
   re-processes the same window. Dedup prevents double-inserts.

### First-sync bootstrapping

On first sync (`sync_state` has no cursor), user chooses a start date in the
UI (default: 90 days ago). Sync pulls all mail since that date.

---

## Tool Structure (Parallx extension pattern)

```
src/tools/budget/
    manifest.json          — tool registration (name, views, commands)
    budgetDatabase.ts      — SQLite wrapper (schema init, CRUD, migrations)
    syncEngine.ts          — cursor-based sync orchestrator
    aiPipeline.ts          — Stage 1/2/3 prompt builders + response parsers
    budgetService.ts       — service layer (DI registration)
    views/
        DashboardView.tsx  — charts: spending by category, month-over-month
        TransactionList.tsx — table with inline category picker, delete
        ReviewQueue.tsx    — low-confidence transactions awaiting user confirm
        SyncLog.tsx        — last sync status, cursor, error history
    commands/
        budget.sync.ts
        budget.openDashboard.ts
```

The tool registers via the existing `parallx.*` tool manifest system. No
`src/` core changes required.

---

## UI / UX

### Dashboard view
- Donut chart: spending by category (current month)
- Bar chart: month-over-month total spend (last 6 months)
- Reconciliation row: `Derived balance: $X | Last snapshot: $Y | Gap: $Z`
  — gap shown in amber if > $5, red if > $50

### Transaction list
- Sortable by date, amount, merchant, category
- Inline category dropdown (changes `category_id`, sets `user_overridden = 1`)
- Soft-delete (sets `status = 'deleted'`, excluded from totals)
- Filter by month, category, card

### Review queue
- Shows all `status = 'review'` transactions
- Each row: AI's best guess at fields + a "Confirm" / "Delete" action
- Confirming runs Stage 3 categorization if not already done, sets
  `status = 'confirmed'`

### Sync log
- Last sync timestamp, cursor, message count processed
- Any parse errors with the originating email subject

---

## Phases

### P1 — Schema + database layer
- Create `budgetDatabase.ts`: schema init, migrations, CRUD helpers
- Wire to Parallx's Electron `database.cjs` storage path pattern
- Unit tests for schema, insert, dedup logic

### P2 — AI pipeline + sync engine
- Build `aiPipeline.ts`: Stage 1/2/3 prompt templates + JSON response parsers
- Build `syncEngine.ts`: cursor logic, Gmail MCP call, pipeline orchestration
- Unit tests with fixture emails (Chase, BofA, Venmo, PayPal formats)
- **Validate against real emails before building the full UI**

### P3 — Tool scaffold + basic views
- `manifest.json` registration
- `SyncLog.tsx` and `TransactionList.tsx` (no charts yet — validate data first)
- `budget.sync` command wired end-to-end

### P4 — Full dashboard UI
- `DashboardView.tsx`: charts (spending by category, month-over-month)
- Reconciliation row
- `ReviewQueue.tsx`
- Category management (add/rename/recolor categories)

### P5 — Polish + verification
- Edge cases: refunds (negative amounts), split transactions, duplicate alerts
- `npx tsc --noEmit` clean
- `npx vitest run` green
- Manual end-to-end: sync real Gmail → review queue → confirm → dashboard

---

## Open questions (to resolve in P1/P2)

| # | Question | Current thinking |
|---|---|---|
| Q1 | Does the Gmail MCP `list_unread` tool return enough metadata (subject, snippet, date, message ID) without fetching the full body? | Yes — snippet + subject is sufficient for most bank alerts. Full body only needed as fallback for unusual formats. |
| Q2 | How do we handle multi-transaction emails (e.g. "5 transactions this week")? | Stage 2 returns an array. Each item gets its own `transactions` row, all referencing the same `email_imports` row. |
| Q3 | First sync — how far back? | User-configurable start date, default 90 days. |
| Q4 | Where does the budget DB file live? | `~/.parallx/budget/budget.db` — same pattern as gmail-mcp credentials. |
| Q5 | Should categories be editable before first sync? | Yes — seed defaults, let user customize, then sync. |

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
