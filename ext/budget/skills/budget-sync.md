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
their budget. Your job is to orchestrate the `budget.*` tools to
get the work done. **You do the thinking. The tools are dumb data
primitives.** Never invent values, never skip an email, never bail
on the first error.

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

## The sync sequence — MUST follow in order

1. Call `budget.getLastSyncCursor()`. Note the returned
   `lastSyncedDate` — this is your `since`.
2. Call `budget.pullEmails({ since: <lastSyncedDate>, maxResults: 500 })`.
   If `maxResults` is hit, do another `pullEmails` pass with the
   newest date from the first batch as the new `since`, until you
   get back fewer than `maxResults` emails. The user-supplied `since`
   parameter (if any) overrides the cursor.
3. Load the context you need **once** at the start. Hold it in
   working memory for the whole run:
   - `budget.listAccounts()`
   - `budget.listCategories()`
   - `budget.listCategorizationRules()`
   - `budget.listRecurringSeries()`
4. **For every email in the pulled list, in order:**
   1. Decide the email type:
      - **transaction notification** (purchase / fee / transfer /
        deposit / refund — a single money event)
      - **balance summary** (daily account balance email listing
        one or more accounts)
      - **non-financial** (marketing, security alert, password
        reset, statement-ready notice — no money moved)
   2. If **transaction**:
      - Extract `merchant`, `amount` (dollars; positive = money OUT,
        negative = money IN), `transactionDate` (YYYY-MM-DD),
        `cardLastFour` (4 digits or null), `txType` (one of
        `purchase`, `deposit`, `transfer`, `fee`, `refund`).
      - **Category resolution (in this order):**
        1. Check `categorization_rules`. If a rule matches the
           merchant (its `matchType` is `exact` / `contains` /
           `regex`), apply that rule's `categoryId` and set
           `ruleId` on the record call. Do **not** second-guess
           a rule match.
        2. Otherwise pick a category from `listCategories` result.
           Use only names that appear in that list.
        3. If you genuinely believe no existing category fits,
           propose `budget.createCategory` to the user with a clear
           name and one-line reason. Wait for the user to approve
           (the tool requires confirmation). Then re-pick using the
           new category.
      - Call `budget.recordTransaction({...})`.
   3. If **balance summary**: extract each account's
      `accountKind` (`checking` / `savings` / `credit_card` /
      `other`), optional `accountLastFour`, and `balance` (positive
      for cash on hand, negative for credit-card amount owed). Call
      `budget.recordBalance` once per account in the summary.
   4. If **ambiguous** (unknown account, unparseable amount, two
      plausible categories with no rule, low confidence, malformed
      body): call `budget.flagForReview({ emailId, reason,
      partialData })`. Continue with the next email — do not abort.
   5. If **non-financial**: call
      `budget.markEmailProcessed({ emailId, reason: 'non-financial' })`.
   6. Exactly **one terminal tool call per email**
      (`recordTransaction`, `recordBalance`, `flagForReview`, or
      `markEmailProcessed`). Never skip silently.
5. After the loop, call
   `budget.updateSyncCursor({ lastMessageId, lastSyncedDate })`
   with the newest email's id and date.
6. Report a single short summary to the user:
   `N recorded, M balance snapshots, K flagged for review, J skipped.`
   If anything was flagged, list each by reason in 1 sentence each.

## Hard constraints

1. **Never invent categories.** Only use names from
   `listCategories`. If nothing fits, propose `createCategory` and
   wait for user approval.
2. **Rules override your judgment.** If a categorization rule
   matches the merchant, apply it. Do not "fix" it to something
   you think is better.
3. **Process every email.** If one email fails, call
   `flagForReview` and move to the next. Never abort the run for
   a single failure.
4. **One terminal call per email.** No duplicates, no skips.
5. **`pullEmails` once per range.** Don't re-pull the same window
   to "double-check" — the result is deterministic given the
   `since` cursor.
6. **Never write directly to `transactions`** or any DB table.
   Always go through the `budget.*` tools.

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

- Do **not** call `pullEmails` more than once for the same `since`.
- Do **not** invent a category name not in `listCategories`. Even
  "Other" — confirm it exists first.
- Do **not** abort the loop on the first parse failure. Flag and
  continue.
- Do **not** call `budget.deleteTransaction` without user
  confirmation in the conversation (the tool will require an
  approval prompt anyway, but you should also say what you're
  about to delete first).
- Do **not** use any non-`budget.*` tool for budget work. No
  `read_file` of the SQLite DB. No `run_command` that touches the
  ledger.
- Do **not** write a summary in the middle of the run. One summary
  at the end.
