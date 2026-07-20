# Milestone 90 — The Consent Model (initiator-based permissions)

**Status: IMPLEMENTED 2026-07-20 (same session as approval; branch
m89-personality).**

**Mufaro's principle (verbatim intent, 2026-07-20):** "Anything that is
labeled autonomous should accept the risks of autonomous work. Anything the
user actively activates is okay and approved already. Autonomous is when the
AI gives itself something to do. If I hit refresh, that means everything is
approved for that refresh. The always-allow thing is a symptom of an
overcomplicated system."

## The model

Every turn has exactly one initiator, and the initiator decides consent:

| Initiator | Examples | Tool policy |
|---|---|---|
| **interactive** | chat message, canvas AI action | Everything allowed. Exceptions: `never-allowed` bans; the destruction belt (`terminal_run_command`, `fs_delete_file`) still prompts. |
| **user-task** | widget Refresh click, Refresh-all — user-triggered but headless | Same as interactive, but the belt DEFERS to the autonomy log (nothing can prompt headless). |
| **autonomous** | heartbeat, cron, scheduled widget refresh | The autonomy dial governs: manual blocks, allow-policy-actions auto-approves, otherwise gated tools defer to the log with a receipt. Never prompts. |

## What was REMOVED

- **The M65 color gate — removed entirely** (Mufaro's informed decision
  2026-07-20; AskUserQuestion, "remove it entirely", injection risk shown
  on the card and accepted). Web-taint no longer forces approval of writes
  on ANY turn type. Taint bookkeeping remains in the code but gates nothing;
  the transcript's tool cards are the visibility mechanism. Residual risk
  owned by Mufaro: a malicious web page the AI is told to read could instruct
  edits within the same turn without a checkpoint.
- **Per-tool requires-approval prompts on user turns.** `requiresConfirmation`
  on tool definitions now only matters for autonomous turns and the belt.
  "Always allow" / "Allow for session" survive only as belt-tool affordances;
  `never-allowed` bans still hold everywhere.

## What was KEPT

- The destruction belt (2 tools) — irreversible, low-frequency, still worth
  a prompt on interactive turns. Kill it later if it ever nags.
- `never-allowed` persistent bans; tool enablement; the kill switch;
  the command blocklist (rule 1); autonomy dial semantics for autonomous
  sessions.

## Implementation map

- `permissionService.ts` — `markUserTaskSession` / `getSessionInitiator`;
  `confirmToolInvocation` short-circuits user-task sessions (belt → defer).
- `policyDecisionPoint.ts` — Rule 5 (color gate) deleted; Rule 6 only fires
  for autonomous sessions.
- `backgroundPromptRunner.ts` — `initiator` on the request; user →
  markUserTaskSession, autonomous → markHeartbeatSession(dial).
- Dashboard — manual refresh / Refresh-all pass `initiator: 'user'`;
  scheduler passes `initiator: 'autonomous'`.
