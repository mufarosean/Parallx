---
name: budget-sync
description: Sync new transaction and balance emails from Gmail into the budget ledger, or edit / delete / recategorize existing budget rows on user request. Pulls emails since the last cursor, classifies each, records transactions and balances, and flags ambiguous cases for the user. Use this skill whenever the user mentions syncing, importing, pulling, refreshing, or categorizing budget data, or wants to edit / delete / explain a transaction.
version: 1.0.0
author: parallx
kind: workflow
permission: requires-approval
user-invocable: true
tags: [workflow, budget, gmail, finance]
parameters:
  - name: since
    type: string
    description: Optional ISO date (YYYY-MM-DD) to override the stored cursor. Rare — only use when the user explicitly says "resync from <date>" or "go back further than usual".
    required: false
---

# Budget Sync — Skill

You are running this skill because the user asked you to interact with
their budget. For a **sync**, call the single `budget.runSync` tool and
report its result. For **edits, deletes, and questions**, orchestrate the
read/write `budget.*` tools — **you do the thinking, the tools are dumb
data primitives.** Never invent values; never write to the DB directly.

## Trigger phrases

Treat any of these as a request to run the **full sync flow** below:

- "sync my budget" / "run a budget sync" / "pull new transactions"
- "import / refresh / catch up / update my budget"
- "categorize my recent transactions" / "process my bank emails"
- "check Gmail for new charges"

Treat any of these as a request for the **edit / inspect flow** instead:

- "show me <merchant> charges" / "how much did I spend on <category>"
  → `budget.queryTransactions` or `budget.summary`
- "that <merchant> charge was actually <category>"
  → `budget.queryTransactions` (find it) then `budget.updateTransaction`
- "delete the duplicate / wrong row"
  → `budget.getTransaction` (confirm) then `budget.deleteTransaction`
- "undo that" / "put back the one I just deleted"
  → `budget.listTrash` then `budget.restoreTransaction`
- "always categorize <merchant> as <category>"
  → `budget.createCategorizationRule`
- "what's in my review queue" / "look at the flagged transactions"
  → `budget.listPendingReview` (then walk the user through resolving
  each via `budget.resolveReview`)

## The sync sequence — call ONE tool

The sync is a single deterministic operation. **Do not orchestrate it
email-by-email yourself** with `budget.pullEmails` / `budget.recordTransaction`
— that path is unreliable on local models. Instead:

1. Call **`budget.runSync()`** once. It does everything in-process:
   pulls recent bank/credit-card emails (since the last cursor, or the
   last 90 days on first run), classifies each one, extracts and
   categorizes transactions (deterministic rules first, then the model),
   records balance snapshots, flags ambiguous items for review, advances
   the sync cursor, and learns new rules from stable categorizations.
2. `budget.runSync` returns counts:
   `{ recorded, flaggedForReview, balanceSnapshots, alreadyImported, errors }`.
   Report a single short summary to the user, e.g.
   "Recorded 23 transactions, 2 balance snapshots, flagged 1 for review."
3. If `flaggedForReview > 0`, offer to walk the user through the review
   queue: call `budget.listPendingReview()` and resolve each via
   `budget.resolveReview`.

That's the entire sync flow. The per-email classification, extraction,
categorization, cross-check, and cursor logic all live inside
`budget.runSync` — you do not need (and should not use) the lower-level
`budget.pullEmails` / `budget.recordTransaction` / `budget.recordBalance`
/ `budget.updateSyncCursor` tools to perform a sync. Those remain only
for advanced manual corrections.

## Hard constraints

1. **One sync = one `budget.runSync` call.** Do not loop over emails or
   call `budget.pullEmails` to do the sync by hand.
2. **Rules override judgment.** Rule-based categorization happens inside
   `budget.runSync` before the model is consulted — trust it.
3. **Report once at the end.** Summarize `budget.runSync`'s returned
   counts in a single message; don't narrate mid-run.
4. **Never write directly to `transactions`** or any DB table. Use the
   `budget.*` tools.
5. For the **edit / inspect flow** (below), the read/write `budget.*`
   tools are the right primitives — use them as documented.

## Transaction types

- `purchase` — a real charge on a debit or credit card (gas,
  restaurant, subscription). Positive amount.
- `refund` — a return / credit on a card. Negative amount. Stored
  as a purchase with negative sign in the DB; pass `txType:
  "refund"` so the tool wraps the sign correctly.
- `deposit` — money INTO a bank account from outside (paycheck,
  direct deposit, external transfer-in). Negative amount.
- `transfer` — INTERNAL movement between the user's own accounts.
  Includes paying a credit card from checking. Positive or
  negative depending on direction.
- `fee` — bank fee, overdraft fee, ATM fee, late fee. Positive
  amount.

## Edit / delete patterns (user-driven, after a sync)

When the user wants to change a transaction:

- "Move my Amazon March 12th from Shopping to Groceries":
  1. `budget.queryTransactions({ merchantContains: 'Amazon', dateRange: {...} })`
  2. Confirm with the user which row.
  3. `budget.updateTransaction({ id, categoryId })`.

- "That Netflix charge is a duplicate":
  1. `budget.queryTransactions({ merchantContains: 'Netflix', ... })`
  2. Show both rows to the user, confirm which to delete.
  3. `budget.deleteTransaction({ id, reason })`. Tool requires
     confirmation; the row goes to `transactions_trash` and can be
     restored.

- "Always tag Spotify as Subscriptions":
  1. Resolve `Subscriptions` against `listCategories` (or propose
     creating it).
  2. `budget.createCategorizationRule({ pattern: 'Spotify',
     matchType: 'contains', categoryId })`. Tool requires
     confirmation.

- "Undo the last delete":
  1. `budget.listTrash({ limit: 5 })`.
  2. Confirm which.
  3. `budget.restoreTransaction({ id })`.

## Negative examples — DO NOT

- Do **not** run a sync by hand with `budget.pullEmails` +
  `budget.recordTransaction`. One sync is one `budget.runSync` call.
- Do **not** call `budget.runSync` more than once for the same request
  — it is deterministic given the stored cursor.
- Do **not** call `budget.deleteTransaction` without user
  confirmation in the conversation (the tool will require an
  approval prompt anyway, but you should also say what you're
  about to delete first).
- Do **not** use any non-`budget.*` tool for budget work. No
  `read_file` of the SQLite DB. No `run_command` that touches the
  ledger.
- Do **not** write a summary in the middle of the run. One summary
  at the end.
