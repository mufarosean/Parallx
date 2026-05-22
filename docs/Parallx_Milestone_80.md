# Milestone 80 — Budget Sync as a Skill+Tools Agent

> **Status:** Planning. Awaiting user sign-off.
>
> **Active milestone.** Supersedes the bespoke budget AI pipeline that was
> introduced in M40-era work and consolidated under M64. The README's
> "Active milestone" line is stale (still says M64) — update on close.

## Why

The Budget extension ships a parallel AI runtime inside the extension:
hand-rolled JSON-mode prompts (`aiStage1Classify`, `aiStage1bBalance`,
`aiStage2Extract`, `aiStage3Categorize`), a private LLM transport
(`lmRunJson` + `LmTransportError`), a private model picker
(`pickModelId` + `budget.preferredModelId`), and a private progress bus
(`_emitSync` + `sync_log` AI rows) that the user cannot directly observe
because it runs outside any chat session.

This was wired before Parallx's skill+tool infrastructure matured. Today
the result is:

- **Speed.** Each email goes through 2–3 sequential LLM calls with a
  3 KB body excerpt and zero context about the user's accounts, categories,
  recurring patterns, or already-processed history. 250 emails costs
  ~1750 LLM round trips, taking hours.
- **Visibility.** The user cannot see the prompt, cannot see thinking,
  cannot pause, cannot intervene. The only post-hoc surface is the
  Sync Log with the first 400 chars of thinking written after each call.
- **Reliability.** A single transport hiccup on May 9 2026 malformed 73
  emails in 30 ms because every parse-or-transport error was caught and
  marked `malformed=1` on `email_imports`. The skip-check on
  `gmail_message_id` then made retries impossible. The user lost a
  $2,703.65 paycheck row and 76 others until a manual wipe.
- **Architecture.** The extension is duplicating infrastructure that
  Parallx already has — skills (M11, M65b parity), chat tools
  (`api.chat.registerTool`), tool-call visibility in the chat surface,
  pause/cancel, and the system-prompt skill listing
  (`buildSkillsSection`, M65b).

The fix is not to make the bespoke pipeline observable. The fix is to
**delete the bespoke pipeline** and expose budget as a set of thin
data-layer tools the chat AI calls, driven by a single skill document.
The pattern is already shipping in the `web-research` extension.

## Reference precedent: `web-research`

The web-research extension is the model. It does exactly this:

- [ext/web-research/main.js L706–770](../ext/web-research/main.js) —
  registers `webSearch`, `webFetch`, `getResearchHub`, `setResearchHub`,
  `logResearchEvent` via `api.chat.registerTool`. Implementations are
  thin: each one is a primitive that touches one data source or one
  cap-checked egress call. The extension never calls the LLM directly.
- [ext/web-research/skills/research-topic.md](../ext/web-research/skills/research-topic.md)
  + [src/built-in/chat/skills/defaultSkillContents.ts L459](../src/built-in/chat/skills/defaultSkillContents.ts) —
  ships a skill markdown that becomes
  `.parallx/skills/research-topic/SKILL.md` on first scan. The skill
  drives the agent: trigger phrases, hard rules, sequence, citations.
- The AI sees the skill listed in every system prompt via
  `buildSkillsSection` (M65b). When the user says "research X", the
  AI reads the skill body via `read_file`, then orchestrates the
  `webSearch` / `webFetch` tools to do the work — all visible in the
  chat surface the user is already watching.

M80 ports the Budget extension to this exact shape.

## UX contract

> **The user asks the AI in plain language. The skill drives the run.
> The AI orchestrates via tools, visible in the chat surface. The user
> can edit, delete, re-categorize, and explain transactions from chat,
> any time. Categories and rules are the AI's hard guardrails — never
> invented, only used or proposed.**

- No new console. No new panel. No new event bus.
- The Budget tab's existing UI (Overview, Transactions, Plan, Settings
  per M64) is unchanged in this milestone.
- The user gets visibility for free: every prompt, every tool call,
  every result, every error is in the chat thread.

## Verified codebase facts

Confirmed before Phase 1 by reading actual code. Use these as the contract.

**Chat tool API:**
- `api.chat.registerTool(name, { description, parameters, requiresConfirmation?, handler })`
  is the canonical surface. See [ext/web-research/main.js L706+](../ext/web-research/main.js)
  and [ext/budget/main.js L7395+](../ext/budget/main.js).
- Budget already registers 5 chat tools: `budget.sync`, `budget.summary`,
  `budget.search`, `budget.setBudget`, `budget.addRule`. The shells stay;
  the implementations of `budget.sync` and the registration set both change.

**Skill discovery:**
- `SkillLoaderService` ([src/services/skillLoaderService.ts](../src/services/skillLoaderService.ts))
  scans `.parallx/skills/*/SKILL.md` on workspace open and on filesystem
  change. Auto-pickup. No restart needed.
- `buildSkillsSection` (M65b, [src/openclaw/openclawSystemPrompt.ts](../src/openclaw/openclawSystemPrompt.ts))
  emits `<skill><name/><location/><description/></skill>` for every
  discovered skill into every system prompt. The AI sees `budget-sync`
  listed alongside `research-topic` and reads the body via `read_file`
  when the user's intent matches.
- Default skills get seeded into `.parallx/skills/` either via the
  legacy `/init` command ([initCommand.ts](../src/built-in/chat/commands/initCommand.ts))
  or via the post-scan seeding loop in [chat/main.ts L2444](../src/built-in/chat/main.ts).
  M72 (planned) removes `/init`.

**Decision (senior call, no user approval needed): extension-owned skill seeding.**
The Budget extension writes
`.parallx/skills/budget-sync/SKILL.md` itself on activation if missing.
Body lives at `ext/budget/skills/budget-sync.md` in source. No change to
`defaultSkillContents.ts` — that file is core. Extension-owned seeding
is the correct pattern for extension-shipped skills going forward
(consistent with the M72 direction of moving away from init-based
scaffolding).

**Existing data layer (already correct, no migration needed):**
- `accounts`, `categories`, `categorization_rules`, `transactions`,
  `balance_snapshots`, `recurring_series`, `recurring_occurrences`,
  `budgets`, `reconciliations` — all preserved.
- `email_imports` — kept as the dedup table; the AI uses it via
  `budget.markEmailProcessed`.
- `sync_state` — kept as the cursor source for `budget.getLastSyncCursor`.
- `sync_log` — kept but no longer receives AI thinking rows (those went
  to a duplicate visibility surface that's now redundant). UI sync
  events (manual button click, scheduled run start/stop) still log
  here for the Sync Log tab in Settings.

**New tables in this milestone:**
- `pending_review` — `{id, email_id, reason, partial_data_json, created_at, resolved_at, resolution}`
  (the Review Queue UI in Settings already exists per M64 audit; this
  table is its backing store going forward).
- `transactions_trash` — full row mirror + `deleted_at`, `delete_reason`.
  30-day TTL purge on workspace open. Backs `budget.deleteTransaction`
  (soft delete) so the AI/user can undo via `budget.restoreTransaction`.

## Scope

In scope for M80:

- Delete the bespoke 4-stage pipeline and all its plumbing.
- Replace `budget.sync` chat tool with a thin "tell user this is
  driven by the budget-sync skill now" notice (or remove entirely —
  see Phase 4 decision).
- Add the new chat tools listed in Phase 2.
- Ship `ext/budget/skills/budget-sync.md` and seed it on activation.
- Soft-delete migration + trash purge.
- Documentation: update Budget section of
  `docs/PARALLX_EXTENSION_AUTHORING_FOR_AI.md` if it references the
  old pipeline; update `docs/README.md` "Active milestone" line.

Out of scope for M80:

- Changes to any other extension.
- Core changes (no edits to `src/`). If a core change is discovered
  necessary mid-execution, stop and ask the user.
- Replacing or rewriting the budget UI (Overview, Transactions, Plan,
  Settings tabs all stay).
- The scheduled background sync timer. Phase 5 makes a decision:
  either remove (user always initiates via chat) or repurpose to
  fire an AI turn with the skill. Default position: **remove**, lean
  on user-initiated chat invocation. Confirmation captured in Phase 5.
- Recurring detection logic. It already runs in the data layer
  on `recordTransaction`; we keep that as-is and let the AI also
  call a future `budget.detectRecurring` if needed (not in M80).

## Hard constraints

1. **No core changes.** Every change in this milestone is inside
   `ext/budget/`. If a tool call surface or skill loader behavior needs
   to change in core, stop and surface it.
2. **No new IPC, no new preload handlers, no new bridge code.** Budget
   talks to Gmail through the existing `api.mcp` surface and to the DB
   through the existing extension storage API.
3. **Working AI surfaces untouched.** Chat tool registration semantics,
   skill scanning, system-prompt assembly, `buildSkillsSection`, and
   the chat tool-call viewer all stay as-is. M80 is a *consumer* of
   that infrastructure, not a modifier.
4. **No new model contention.** The skill drives the conversation in
   whatever chat the user is in. The model is whatever chat is using.
   No private model picker.
5. **No data loss.** Every existing transaction, account, category,
   rule, recurring series, budget, reconciliation row is preserved.
   Migration is purely additive (two new tables).
6. **Soft delete only.** `budget.deleteTransaction` writes to
   `transactions_trash` first. No tool in M80 hard-deletes anything
   the user could lose accidentally.

## Phases

### Phase 1 — Tool surface (additive)

Register the following new chat tools in `ext/budget/main.js`. Each
is a thin DB or Gmail-MCP wrapper. No LLM calls inside any handler.

**Read tools** (`requiresConfirmation: false`):

| Tool | Returns | Backed by |
|---|---|---|
| `budget.getLastSyncCursor` | `{lastSyncedDate, lastMessageId}` | `SELECT` from `sync_state` |
| `budget.listAccounts` | `[{id, label, kind, last4}]` | `SELECT` from `accounts` |
| `budget.listCategories` | `[{id, name, parentId?, description?}]` | `SELECT` from `categories` |
| `budget.listCategorizationRules` | `[{id, matcher, matchType, categoryId, accountId?, note?}]` | `SELECT` from `categorization_rules` |
| `budget.listRecurringSeries` | `[{merchant, accountId, cadence, lastAmount, lastDate}]` | `SELECT` from `recurring_series` |
| `budget.queryTransactions` | rows matching `{dateRange?, accountId?, categoryId?, merchantContains?, amountRange?, status?}` | `SELECT` from `transactions` with filters |
| `budget.getTransaction` | full row + linked email row | `SELECT` from `transactions JOIN email_imports` |
| `budget.listPendingReview` | rows in `pending_review` where `resolved_at IS NULL` | `SELECT` from `pending_review` |
| `budget.listTrash` | rows in `transactions_trash` where `deleted_at > now()-30d` | `SELECT` from `transactions_trash` |

**Gmail tool** (`requiresConfirmation: false` — egress already approved by Gmail MCP install):

| Tool | Returns | Backed by |
|---|---|---|
| `budget.pullEmails` | `[{id, from, subject, date, body, snippet}]` | The body of the current `budgetSync` Gmail fetch loop, lifted into a tool handler. Honors `since` / `until` / `maxResults` args. Does NOT touch `email_imports` — the AI calls `markEmailProcessed` per email. |

**Write tools** (`requiresConfirmation: true` for destructive/structural; `false` for routine):

| Tool | Conf? | Backed by |
|---|---|---|
| `budget.recordTransaction` | false | `INSERT` into `transactions`; also runs `categorization_rules` first if AI didn't pre-resolve a `ruleId` |
| `budget.recordBalance` | false | `INSERT` into `balance_snapshots` |
| `budget.flagForReview` | false | `INSERT` into `pending_review` |
| `budget.markEmailProcessed` | false | `INSERT` into `email_imports` with `reason` (e.g. `non-financial`, `duplicate`) |
| `budget.updateSyncCursor` | false | `UPDATE` `sync_state` |
| `budget.updateTransaction` | false | `UPDATE` `transactions` (re-category, re-amount, etc.) |
| `budget.deleteTransaction` | **true** | Soft delete: move row to `transactions_trash`, delete from `transactions` |
| `budget.restoreTransaction` | false | Move row from `transactions_trash` back |
| `budget.resolveReview` | false | `UPDATE` `pending_review` + optionally call `recordTransaction` |
| `budget.createCategory` | **true** | `INSERT` into `categories` |
| `budget.renameCategory` | **true** | `UPDATE` `categories` |
| `budget.deleteCategory` | **true** | `UPDATE` transactions to reassigned category, then delete |
| `budget.createCategorizationRule` | **true** | `INSERT` into `categorization_rules` |
| `budget.deleteCategorizationRule` | **true** | `DELETE` from `categorization_rules` |

The existing `budget.summary` / `budget.search` / `budget.setBudget` /
`budget.addRule` tools stay — they're already correct.
`budget.addRule` is superseded by `budget.createCategorizationRule`
but stays for backward compat through one milestone cycle, then is
deprecated in M81 if there's no consumer.

**Per-handler implementation rule:** thin. No LLM call inside any
handler. No JSON-mode parsing. No `lmRunJson`. If a handler is more
than ~30 lines of code, it's doing too much.

### Phase 2 — Skill document

Create `ext/budget/skills/budget-sync.md`. Frontmatter and shape match
`ext/web-research/skills/research-topic.md`:

```yaml
---
name: budget-sync
description: Sync new transaction and balance emails from Gmail into the budget ledger. Pulls emails since the last cursor, classifies each, records transactions and balances, and flags ambiguous cases for user review. Can also edit, delete, or recategorize existing transactions on user request.
version: 1.0.0
author: parallx
kind: workflow
permission: requires-approval
user-invocable: true
tags: [workflow, budget, gmail, finance]
parameters:
  - name: since
    type: string
    description: Optional ISO date to override the stored cursor (rare).
    required: false
---
```

Body sections (full text drafted in Phase 2 execution; outline here):

1. **Trigger phrases.** "sync my budget", "pull new transactions",
   "refresh my budget", "import new bank emails", "categorize my
   recent transactions". Plus edit/delete patterns: "that Amazon
   charge was actually groceries", "delete the duplicate Netflix row",
   "show me everything from Chase last week".

2. **UX contract (verbatim).** The user asks. The AI does. Tools are
   approved once at the start. Destructive tools always confirm per call.

3. **The sequence (numbered, MUST follow):**
   1. Call `budget.getLastSyncCursor()`.
   2. Call `budget.pullEmails({since: cursor.lastSyncedDate})`.
   3. Call `budget.listAccounts()`, `budget.listCategories()`,
      `budget.listCategorizationRules()`, `budget.listRecurringSeries()`
      once at the start. Hold the results in your working memory for
      the whole run.
   4. **For every email in the pulled list, in order:**
      - Decide: transaction notification / balance summary / non-financial?
      - If transaction: extract amount/date/merchant/account.
        - First check the rules. If a rule matches, apply its category
          and `ruleId` directly — do not second-guess.
        - Otherwise pick a category **from the listCategories result only**.
        - If the right category genuinely does not exist, propose
          `budget.createCategory` to the user with a clear name and
          rationale. Wait for approval. Then use it.
        - Call `budget.recordTransaction(...)`.
      - If balance: call `budget.recordBalance(...)`.
      - If ambiguous (unknown account, unparseable amount, two
        plausible categories with no rule, low confidence): call
        `budget.flagForReview(...)` with `partial_data_json`.
      - If non-financial: call `budget.markEmailProcessed(id, 'non-financial')`.
      - Never silently skip. Every email gets exactly one terminal
        tool call (`recordTransaction`, `recordBalance`,
        `flagForReview`, or `markEmailProcessed`).
   5. After the loop, call
      `budget.updateSyncCursor(latestMessageId, latestDate)`.
   6. Report a summary to the user: counts of recorded / balance /
      flagged / non-financial, plus the count and reasons for any
      flagged.

4. **Hard constraints.**
   - Never invent categories. Use only what `listCategories` returns,
     or propose a new one explicitly.
   - Rules override your judgment. If a rule matches, apply it.
   - Process every email in the pulled list. Never bail early on
     a single email's failure — call `flagForReview` and continue.
   - One terminal tool call per email.

5. **Transaction types.** `purchase`, `deposit`, `transfer`, `fee`,
   `refund`, `balance_summary`. One-line semantics each.

6. **Edit/delete conversation patterns.**
   - "Move X from Y to Z category" → `queryTransactions` + `updateTransaction`.
   - "Delete the duplicate" → `getTransaction` + show user + `deleteTransaction` (confirms).
   - "Undo that" → `listTrash` + `restoreTransaction`.
   - "Always categorize Spotify as Entertainment" → `createCategorizationRule`.

7. **Negative examples.** Do not skip emails. Do not invent categories.
   Do not stop on first error. Do not call `pullEmails` more than once
   per run. Do not write directly to `transactions` — use the tools.

### Phase 3 — Skill seeding from the extension

In `activate()`, after the existing `_disposables` setup and before
chat-tool registration, run a seeding pass:

```js
async function _seedSkill(api, context) {
  try {
    const dst = '.parallx/skills/budget-sync/SKILL.md';
    const fs = api.fs ?? api.workspace?.fs;
    if (!fs) return;
    if (await _exists(fs, dst)) return; // never overwrite user edits
    const src = context.toolUri.joinPath?.('skills', 'budget-sync.md')
      ?? path.join(context.toolPath, 'skills', 'budget-sync.md');
    const body = await _readSourceSkill(src);
    await _mkdirp(fs, '.parallx/skills/budget-sync/');
    await fs.writeFile(dst, body);
  } catch (e) {
    console.warn('[Budget] skill seeding failed (non-fatal):', e);
  }
}
```

Detail of the `api.fs` / `api.workspace.fs` shape and the exact path
resolution is confirmed by reading the api factory during Phase 3
execution — this milestone doc is the plan, not the final code.

The SkillLoaderService picks the file up on its next scan
(triggered by the `fs.watch` already wired in M11) and the AI sees
`budget-sync` listed in the next system prompt with no restart.

### Phase 4 — Bespoke pipeline removal

Delete from `ext/budget/main.js` (line numbers approximate; verify in
execution):

- `LmTransportError` class + `isLmTransportError` (L6204-6240).
- `lmRunJson` function and all its callers (the four `aiStageN` functions).
- `aiStage1Classify`, `aiStage1bBalance`, `aiStage2Extract`,
  `aiStage3Categorize` and their prompt builders.
- The full `budgetSync` orchestration body (the for-loop that
  classifies → extracts → categorizes → inserts). Replaced by:
  the `budget.sync` chat tool body becomes a one-liner that returns
  a friendly error pointing the user at the skill:
  ```js
  handler: async () => ({
    content: 'Budget sync is now driven by the budget-sync skill. Just ask in chat: "sync my budget" or "pull new transactions". The AI will orchestrate via the budget tools and you can watch / pause / intervene in real time.',
    isError: false,
  })
  ```
  Alternatively, **remove** the `budget.sync` chat tool registration
  entirely. **Senior decision: keep it for one milestone with the
  notice body, then remove in M81.** Avoids breaking any user/skill/AI
  that learned the old name.
- `pickModelId` and `budget.preferredModelId` config property.
- `_emitSync` calls related to AI progress (`kind: 'progress'` with
  AI-stage detail). Keep `_emitSync` for non-AI events (manual
  sync start/end, error toasts) since the Sync Log Settings tab
  consumes it.
- `email_imports.malformed` column reads and the skip-check that uses
  it. Schema column stays for historical rows but no new writes set it
  to 1. (No migration drop — additive only.)
- Schedule timer body (Phase 5 decision).

Update the manifest `parallx-manifest.json`:

- Remove `aiInvocable: true` and `aiDescription` from `budget.sync`
  command. (Command stays palette-invocable for users; AI uses the
  skill, not the command, going forward.)
- Remove the `budget.preferredModelId` configuration property.

### Phase 5 — Scheduled sync decision

The current scheduled background sync timer fires every N minutes,
calls the bespoke pipeline silently, and writes to the same DB.
Senior decision: **remove the scheduled timer.** Rationale:

- M80 is fundamentally user-initiated. The user asks in chat.
- A scheduled timer that fired the new flow would need to start a
  chat turn autonomously — that violates the M68/M69 hard constraint
  (no autonomous LLM calls) and the M11 "user intent triggers AI" rule.
- Daily/automatic sync is a future milestone if the user wants it
  back, and would belong under M72's "AI Ecosystem Cohesion" — a
  proper autonomous-task surface, not an extension timer.

Remove the `budget.syncIntervalMinutes` setting and the timer body.
Keep the Sync Log tab — it still receives manual run events.

### Phase 6 — Trash table + 30-day purge

Migration `ext_NNN_transactions_trash.sql`:

```sql
CREATE TABLE IF NOT EXISTS transactions_trash (
  id            TEXT PRIMARY KEY,
  row_json      TEXT NOT NULL,
  deleted_at    TEXT NOT NULL,
  delete_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_trash_deleted_at
  ON transactions_trash(deleted_at);
```

On `activate()`, run `DELETE FROM transactions_trash WHERE deleted_at < datetime('now','-30 days')`.

### Phase 7 — Review queue table

Migration `ext_NNN_pending_review.sql`:

```sql
CREATE TABLE IF NOT EXISTS pending_review (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id          TEXT NOT NULL,
  reason            TEXT NOT NULL,
  partial_data_json TEXT,
  created_at        TEXT NOT NULL,
  resolved_at       TEXT,
  resolution        TEXT
);
```

(The Review Queue UI in Settings already exists per M64 audit at
[ext/budget/main.js L1202](../ext/budget/main.js). Phase 7 execution
either reuses an existing table for this or creates the new one and
points the renderer at it — confirmed by reading L1202 during execution.)

### Phase 8 — Verification

Each phase verified independently before the next begins.

| Phase | Verification |
|---|---|
| 1 | `node --check ext/budget/main.js`; restart Parallx; in chat, `@budget` does not exist (correct — no participant), but `read_file ext/budget/main.js` and grepping for `registerTool` shows all the new names; manually call one read tool via chat ("list my budget accounts") and confirm it returns. |
| 2 | `ext/budget/skills/budget-sync.md` exists and validates against `parseSkillManifest` (run a quick node script that loads `src/services/skillLoaderService.ts` parseFrontmatter on it). |
| 3 | Restart Parallx. Confirm `.parallx/skills/budget-sync/SKILL.md` is created. Confirm `buildSkillsSection` output includes `budget-sync` (check by opening any chat, inspecting the system prompt — Settings → AI → Prompt Inspector, or via `console.log` in dev mode). |
| 4 | No `lmRunJson` / `LmTransportError` / `aiStageN` references remain in `ext/budget/main.js`. `npx tsc --noEmit` clean (TypeScript only cares about `src/`, but rebuild check). `node scripts/build.mjs` clean. |
| 5 | `budget.syncIntervalMinutes` removed from manifest; no `setInterval` for sync remains. |
| 6 | Manually delete a test transaction via `budget.deleteTransaction` (chat); `budget.listTrash` returns it; `budget.restoreTransaction` brings it back. |
| 7 | Manually call `budget.flagForReview` via chat; the Review Queue tab in Settings shows the row. |
| End-to-end | Wipe budget DB. In chat, type "sync my budget for the last 30 days." Confirm the AI: reads the skill, calls `getLastSyncCursor`, `pullEmails`, the three list-context tools, then loops through emails calling `recordTransaction` / `flagForReview` / `markEmailProcessed`, updates the cursor, reports a summary. Verify rows in the DB match the chat narrative. |

The end-to-end test is the real one. If the AI does not follow the
skill correctly, the fix is to the **skill prose**, not the code.
That is the whole point of this redesign: the AI's behavior is
shaped by prompt engineering, the code only provides primitives and
guardrails.

## Deletion summary

After M80, the following are gone from the budget extension:

- `aiStage1Classify`, `aiStage1bBalance`, `aiStage2Extract`, `aiStage3Categorize`
- `lmRunJson`, `LmTransportError`, `isLmTransportError`
- `pickModelId`
- Bespoke `budgetSync(api)` orchestration body (the function name may
  survive as a thin shim for the deprecation-window `budget.sync` chat
  tool, but its body is gone)
- `_emitSync` AI-progress event kinds and sync_log AI-thinking writes
- `email_imports.malformed` writes (column stays for legacy rows only)
- Scheduled sync timer
- `budget.preferredModelId` config
- `budget.syncIntervalMinutes` config

Approximate LOC reduction: ~800–1200 lines of `main.js` removed,
~300–400 lines of new tool handlers added. Net ~500–800 line reduction.

## Risk register

| Risk | Mitigation |
|---|---|
| AI doesn't follow the skill order on small models | Skill is prescriptive, numbered, with negative examples. M65b's compact-mode fallback may truncate; mitigate by keeping the skill body under 18k chars (the M65b budget cap). |
| User runs sync, hits Gmail rate limit, gets stuck mid-loop | `pullEmails` honors a `maxResults` arg; skill instructs the AI to batch by date ranges if it pulls > 200 emails. |
| AI invents a category despite the constraint | The skill says "propose `createCategory` and wait for user approval." `createCategory` has `requiresConfirmation: true` so the user is the gate. |
| AI deletes the wrong transaction | `deleteTransaction` has `requiresConfirmation: true` AND is soft-only. `restoreTransaction` is available at any time. |
| Scheduled sync removal angers a user who liked silent background syncs | Document in the milestone close note; a future M-N can reintroduce as an autonomous-task surface under M72. |
| Skill file conflicts with user edits | Seeding only runs if the file does not already exist. User edits are preserved across extension upgrades. |
| Old `budget.preferredModelId` setting in user config orphans | Manifest removal is enough; Parallx ignores unknown setting keys without warning. |

## Open questions (none requiring user input)

All previously-asked questions are decided. Recorded here for the
audit trail:

- **Categories source of truth:** DB. AI reads via `listCategories`.
- **Rules source of truth:** DB. AI reads via `listCategorizationRules`.
- **Soft vs hard delete:** Soft, with 30-day trash.
- **Skill auto-attach:** None needed. System prompt skill listing
  (M65b) makes the AI aware; trigger phrases in the skill body
  + `read_file` on demand is how all skills work today.
- **Tool exposure scope:** All tools registered globally (any chat).
  Skill drives the sync workflow specifically; read tools are useful
  for any "how much did I spend on X" question.
- **`budget.sync` chat tool fate:** Kept for one milestone with a
  notice body pointing the AI at the skill; removed in M81.
- **`budget.sync` command `aiInvocable` flag:** Removed in this
  milestone per user decision (a).

## Cutover order

1. Phase 1 — new tools (additive, ship them first so the AI has the
   primitives even before the skill ships).
2. Phase 2 — skill markdown source file.
3. Phase 3 — skill seeding logic.
4. Phase 6 + 7 — new tables (additive, no behavior change yet).
5. Phase 4 — delete the bespoke pipeline.
6. Phase 5 — remove the scheduled timer.
7. Phase 8 — end-to-end verification.
8. Commit.

Each phase is verified before the next. If any verification fails,
stop and surface to the user.

## Acceptance

M80 is complete when:

- A user in chat says "sync my budget" or "pull my new transactions"
  and the AI orchestrates the full flow via tools, visible in the
  chat surface.
- The user can edit, delete, recategorize, restore, and explain
  transactions from chat using natural language.
- The bespoke pipeline (`aiStageN`, `lmRunJson`, etc.) is fully
  deleted from `ext/budget/main.js`.
- No core file (`src/`, `electron/`) is modified.
- All existing budget UI tabs render the same data as before.
- `npx tsc --noEmit` and `node scripts/build.mjs` both clean.
- The milestone close commit updates `docs/README.md` "Active
  milestone" line to point at M80 (and on close, archive the doc).

---

**Next step:** user signs this doc → execution begins with Phase 1.
