# F7 Participant Runtime — Iteration Tracker

**Domain:** F7 — Participant Runtime
**Upstream:** `github.com/openclaw/openclaw` @ e635cedb
**Owner:** Parity Orchestrator
**Last updated:** 2026-03-27
**Status:** CLOSED (confirmed iteration 3 — zero new gaps)

---

## Current Status

| Metric              | Value |
|---------------------|-------|
| Total capabilities  | 17    |
| ALIGNED             | 17    |
| MISALIGNED          | 0     |
| MISSING             | 0     |
| HEURISTIC           | 0     |
| Iterations complete | 3 (2 active + 1 confirmation) |

---

## Iteration Summary

| Iteration | Type | Gaps Found | Gaps Fixed | Result |
|-----------|------|------------|------------|--------|
| 1 | Structural | 4 (3 MISALIGNED, 1 HEURISTIC) | 4 | 13/13 ALIGNED |
| 2 | Refinement | 4 (3 MISALIGNED, 1 MISSING) | 4 | 17/17 ALIGNED |
| 3 | Confirmation | 0 | 0 | **DOMAIN CLOSED** |

---

## Iteration 1 — Structural Migration

**Date:** 2026-04-16
**Audit:** [F7_PARTICIPANT_RUNTIME_AUDIT.md](F7_PARTICIPANT_RUNTIME_AUDIT.md)
**Gap Map:** [F7_PARTICIPANT_RUNTIME_GAP_MAP.md](F7_PARTICIPANT_RUNTIME_GAP_MAP.md)

### What was found

| # | Gap | Severity | Classification |
|---|-----|----------|---------------|
| F7-10 | Workspace participant bypasses pipeline (uses `executeOpenclawModelTurn`) | HIGH | MISALIGNED |
| F7-11 | Canvas participant same bypass | HIGH | MISALIGNED |
| F7-12 | Old execution path still exported, no deprecation | MEDIUM | MISALIGNED |
| F7-13 | Hardcoded heuristic followup suggestions | LOW | HEURISTIC |

### What was fixed

| # | Change | Files modified |
|---|--------|----------------|
| F7-10/11 | Created `openclawReadOnlyTurnRunner.ts` — shared runner with retry loop + tool policy | `src/openclaw/openclawReadOnlyTurnRunner.ts` (new) |
| F7-10 | Migrated workspace participant to `runOpenclawReadOnlyTurn` | `src/openclaw/participants/openclawWorkspaceParticipant.ts` |
| F7-11 | Migrated canvas participant to `runOpenclawReadOnlyTurn` | `src/openclaw/participants/openclawCanvasParticipant.ts` |
| F7-12 | Marked `executeOpenclawModelTurn` as `@deprecated` | `src/openclaw/participants/openclawParticipantRuntime.ts` |
| F7-13 | Removed `generateFollowupSuggestions`, return `[]` from `provideFollowups` | `src/openclaw/participants/openclawDefaultParticipant.ts` |

### Verification

- tsc: 0 errors
- Tests: 16/16 OpenClaw tests pass

### Scorecard after iteration 1

| ALIGNED | MISALIGNED | HEURISTIC | MISSING |
|---------|------------|-----------|---------|
| 13      | 0          | 0         | 0       |

*Note: 13 capabilities total at this point. Iteration 2 discovered 4 additional capabilities via deeper inspection.*

---

## Iteration 2 — Refinement & Test Coverage

**Date:** 2026-03-27
**Audit:** [F7_PARTICIPANT_RUNTIME_AUDIT_v2.md](F7_PARTICIPANT_RUNTIME_AUDIT_v2.md)
**Gap Map:** Produced by Gap Mapper subagent (inline, not persisted as separate file)

### Why new gaps appeared

Iteration 1 fixed the *structural* problem (wrong execution path). Iteration 2 found *refinement-level* gaps that were invisible before iteration 1 landed:

- **F7-14 (error handling):** Only relevant once the code actually calls the runner — can't audit error handling for a call that didn't exist.
- **F7-15 (config propagation):** The unsafe cast was a workaround introduced during the iteration 1 migration; canvas passing empty config was pre-existing but only became parity-relevant once the execution path was correct.
- **F7-16 (structured prompts):** Ad-hoc prompt construction was always there, but auditing prompt parity only makes sense once the pipeline is wired correctly.
- **F7-17 (test coverage):** The readonly turn runner was created in iteration 1 — it had zero tests because it was new code.

### What was found

| # | Gap | Severity | Classification |
|---|-----|----------|---------------|
| F7-14 | No try/catch around `runOpenclawReadOnlyTurn` in workspace/canvas | MEDIUM | MISALIGNED |
| F7-15 | `unifiedConfigService` not on workspace/canvas interfaces; unsafe cast in workspace, empty config in canvas | LOW | MISALIGNED |
| F7-16 | Ad-hoc string-concatenated prompts instead of `buildOpenclawSystemPrompt` | MEDIUM | MISALIGNED |
| F7-17 | Zero unit tests for `openclawReadOnlyTurnRunner.ts` | MEDIUM | MISSING |

### What was fixed

| # | Change | Files modified |
|---|--------|----------------|
| F7-15 | Added `unifiedConfigService?: IUnifiedAIConfigService` to `IWorkspaceParticipantServices` and `ICanvasParticipantServices` | `src/openclaw/openclawTypes.ts` |
| F7-15 | Replaced unsafe cast with typed `services.unifiedConfigService?.getEffectiveConfig()` | `src/openclaw/participants/openclawWorkspaceParticipant.ts` |
| F7-15 | Canvas now reads config for temperature/maxTokens | `src/openclaw/participants/openclawCanvasParticipant.ts` |
| F7-14 | Wrapped `runOpenclawReadOnlyTurn` in try/catch in both participants, returns `{ errorDetails }` | `openclawWorkspaceParticipant.ts`, `openclawCanvasParticipant.ts` |
| F7-16 | Replaced ad-hoc `[...].join('\n\n')` with `buildOpenclawSystemPrompt()` in both participants | `openclawWorkspaceParticipant.ts`, `openclawCanvasParticipant.ts` |
| F7-17 | Created 13 unit tests: happy path, token reporting, thinking, tool calls, missing invoker, transient retry, cancellation, budget exhaustion, error propagation, tool policy, multi-chunk, empty response, cross-iteration tool counting | `tests/unit/openclawReadOnlyTurnRunner.test.ts` (new) |

### Test update

- Updated assertion in `openclawScopedParticipants.test.ts` to expect `### AGENTS.md` (structured builder format) instead of `[AGENTS.md]` (old ad-hoc format).

### Verification

- tsc: 0 errors
- Tests: 29/29 OpenClaw tests pass (6 test files, including new readonly runner tests)

### Scorecard after iteration 2

| ALIGNED | MISALIGNED | HEURISTIC | MISSING |
|---------|------------|-----------|---------|
| 17      | 0          | 0         | 0       |

---

## Deferred to Other Domains

| Item | Deferred to | Reason |
|------|-------------|--------|
| Skills XML, tool summaries, preferences in readonly prompts | F3 (System Prompt Builder) | Readonly participants now call `buildOpenclawSystemPrompt` but pass empty `skills: []` and `tools: []`. Populating these requires F3 infrastructure. |
| Misleading comment in `resolveToolProfile` | F7 minor (future iteration) | Comment-only issue, no behavioral impact |
| Duplicate `OPENCLAW_MAX_READONLY_ITERATIONS` constant | F7 minor (future iteration) | Maintenance risk but no current divergence |

---

## Capability Matrix (All 17)

| # | Capability | After Iter 1 | After Iter 2 |
|---|-----------|-------------|-------------|
| F7-01 | Participant registration | ALIGNED | ALIGNED |
| F7-02 | Default participant pipeline | ALIGNED | ALIGNED |
| F7-03 | Turn runner retry loop | ALIGNED | ALIGNED |
| F7-04 | Attempt execution | ALIGNED | ALIGNED |
| F7-05 | Context engine lifecycle | ALIGNED | ALIGNED |
| F7-06 | Structured system prompt | ALIGNED | ALIGNED |
| F7-07 | Tool policy pipeline | ALIGNED | ALIGNED |
| F7-08 | Runtime support | ALIGNED | ALIGNED |
| F7-09 | Service interfaces | ALIGNED | ALIGNED |
| F7-10 | Workspace participant pipeline | **MISALIGNED → ALIGNED** | ALIGNED |
| F7-11 | Canvas participant pipeline | **MISALIGNED → ALIGNED** | ALIGNED |
| F7-12 | Deprecated old execution path | **MISALIGNED → ALIGNED** | ALIGNED |
| F7-13 | Followup suggestions | **HEURISTIC → ALIGNED** | ALIGNED |
| F7-14 | Error handling (readonly) | *(not yet audited)* | **MISALIGNED → ALIGNED** |
| F7-15 | Config propagation (readonly) | *(not yet audited)* | **MISALIGNED → ALIGNED** |
| F7-16 | System prompt construction (readonly) | *(not yet audited)* | **MISALIGNED → ALIGNED** |
| F7-17 | Readonly turn runner tests | *(not yet audited)* | **MISSING → ALIGNED** | ALIGNED |

---

## Iteration 3 — Confirmation Audit

**Date:** 2026-03-27
**Audit result:** Zero new MISALIGNED or MISSING findings.

### Verification

- All 8 previous fixes (F7-10 through F7-17) independently verified as still intact
- All 9 F7 source files read end-to-end and compared against upstream contracts
- tsc: 0 errors
- Tests: 29/29 pass (6 files)
- UX Guardian: all 4 surfaces clear

### Minor observations (not gaps)

1. Misleading comment in `resolveToolProfile` — cosmetic only
2. `executeOpenclawModelTurn` still exported with `@deprecated` — zero callers, removable in cleanup

### Cross-domain deferrals

| Item | Target domain |
|------|---------------|
| System prompt content quality (skills XML, model-tier rules) | F3 |
| Context engine compaction internals | F2 |
| Routing heuristics (`detectSemanticFallback`) | F5 |
| Citation/extractive fallback quality | F6 |
| Memory writeback and session lifecycle | F8 |

### Verdict

**DOMAIN COMPLETE.** F7 Participant Runtime is closed. All 17 capabilities ALIGNED. Ready to proceed to next domain.
