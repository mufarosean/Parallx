# The Harness Charter

*Started 2026-08-30, on the finding that the same Claude weights ran measurably
"stupider" inside Parallx than inside Claude Code. The harness delta IS
intelligence. This charter closes it.*

## The objective

The harness must not artificially limit the model, and must not bloat it with
what it doesn't need. Right information, right tools, right skills — at the
right time. The agent should know where it is, what it is doing, what it has
already done, what it remembers, what it has learned.

**Discipline:** every change in this charter is anchored to a pattern already
proven in a working frontier harness (Claude Code, the Anthropic context
management API, or equivalent). No novel inventions in this pass. Behavior
verification by eval happens on away-days (the ai-eval rig opens screens);
until then, behavior-affecting changes ship reversible.

## The diagnosis (why Claude-in-Parallx felt dumber)

1. **Between-turn amnesia.** `flattenHistory` / `buildOpenclawSeedMessages`
   strip every tool call and result at each turn boundary. The model starts
   each turn remembering only its own prose. It re-reads, re-derives,
   contradicts its own prior work. The data was persisted all along
   (`IChatToolInvocationContent` carries name, args, status, isError, result)
   — the flatteners just dropped it.
2. **Bloat.** ~16K fixed tokens of system + 51 tool schemas every request
   (measured: 6.1K system + 10.2K tool definitions), teaching prose inside
   schemas, plus a standing-context message of near-miss RAG chunks.
3. **A lossy seam.** OpenAI-shaped internal messages translated at the edge:
   tool_use ids regenerated and re-matched by name, `is_error` unused in
   favor of a text prefix.
4. **Compaction that can't win.** The elastic budget refills every token
   compaction frees (surplus → RAG lane), tool results are kept whole
   mid-loop, and the uncompactable floor is fat. Observed: 100% → ~70%,
   where Claude Code reaches ~25%.

## The principles

**1. The transcript is sacred.** What the agent did IS its working memory.
Tool calls and results stay in history; old results age into placeholders
rather than vanishing. *(Evidence: Claude Code preserves full tool history;
Anthropic context-management API clears old tool results but keeps the calls.)*

**2. Progressive disclosure.** Index first, body on demand: tool schemas,
skills, memory. The model pulls detail when it needs it. *(Evidence: Claude
Code deferred tools + ToolSearch, skill one-liners loaded on invocation,
memory index → files.)*

**3. Push state, pull content.** The harness tells the agent where it is —
workspace, surface, date, mode, plan, memory index, what changed. It never
pushes content; the agent pulls pages/files/PDFs through search with a
relevance floor that can fail, and cites what it used. *(Evidence: Claude
Code environment block + system reminders; no retrieval lane.)*

**4. Legible action.** Every consequential action carries a model-written
summary of what it is about to do, surfaced in approval UI and the activity
journal. *(Evidence: Claude Code's required Bash `description` parameter.)*

**5. Recovery over permission.** Default-allow inside a checkpointed world:
snapshot before writes, revert per turn, approval only for the irreversible.
*(Evidence: Claude Code's evolution to auto-accept + rewind/checkpoints.)*

**6. Delegation is context hygiene.** A subagent burns its own window and
returns a digest; the report is relayed, the transcript is not. Read-only
delegation is free. *(Evidence: Claude Code's Agent tool.)*

## Build order

### Wave 1 — fidelity (static-verifiable, no flags needed) — SHIPPED 2026-08-30
- [x] 1.1 Transcript preservation: one shared flattener emits tool calls +
      results into history; aging policy elides old results (errors kept
      longer); orphaned-tool-head guard at every history cut point.
- [x] 1.2 Compaction honesty: compact() transcript labels tool activity;
      elastic budget stops refilling freed space after compaction;
      round-boundary-aware last-exchange selection.
- [x] 1.3 `/compact` — audit correction: the command already existed
      end-to-end; its lossy third flattener replaced with the shared
      flattener + transcript serializer, stale boundary cache dropped on
      compact, first test coverage added.
- [x] 1.4 Real token accounting: mid-loop budget check uses
      provider-reported prompt tokens as base (completion covered by
      provider figure; only tool results estimated); toolCalls weight
      counted in estimates.
- [x] 1.5 Housekeeping: dead modules deleted (button, actionBar, countBadge,
      toolDescriptionSummary), stale JSDoc fixed.

### Wave 2 — legibility + recovery
- [ ] 2.1 `description` param on writes/terminal/python, surfaced in
      approval UI + activity journal.
- [ ] 2.2 File checkpoints + per-turn Revert.
- [ ] 2.3 Mode collapse: Chat / Agent (default) / Careful; strip dead
      color-gate machinery. (Read applyOpenclawToolPolicy path fully first.)

### Wave 3 — disclosure (flagged, behavior-affecting)
- [ ] 3.1 Teaching prose moves from tool schemas to loadable guidance.
- [ ] 3.2 Standing context becomes state-not-content; search gains a real
      relevance floor + citations.
- [ ] 3.3 Tool tiers / deferral — **away-day eval required before default-on.**

### Wave 4 — delegation
- [ ] 4.1 Enforce the parsed-then-discarded subagent tools allowlist (M59 debt).
- [ ] 4.2 Free read-only spawns; typed profiles (searcher / reader / worker).

## Ledger

| Date | Item | Commit | Notes |
|------|------|--------|-------|
| 2026-08-30 | 1.1 transcript preservation | 48a954f6 | flattenPairsToMessages; aging; orphan guard; toolCalls in estimates |
| 2026-08-30 | 1.2 compaction honesty | 07a910a3 | tool-aware transcript; capRagAtBase on all three compaction paths |
| 2026-08-30 | 1.3 /compact fidelity | d935c96d | audit correction: trigger existed; third flattener replaced; cache dropped |
| 2026-08-30 | 1.4 real token accounting | 0807e61a | mid-loop check anchored to provider promptTokens |
| 2026-08-30 | 1.5 housekeeping | 5f25a117 | 4 dead modules deleted; displaySummary JSDoc truthful |

Wave 1 verification: tsc clean, full vitest 5,709 passed / 16 skipped / 0
failed, build green. In-app eyes-on owed at next session: a long tool-heavy
turn should show (a) the model referencing earlier tool results without
re-reading, (b) /compact reporting meaningfully larger savings, (c) the
context gauge dropping further after compaction than before.
