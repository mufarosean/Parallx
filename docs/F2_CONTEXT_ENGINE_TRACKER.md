# F2 Context Engine — Parity Tracker

**Domain:** F2 — Context Engine  
**Status:** CLOSED ✅  
**Started:** 2026-03-27  
**Target:** 6/6 ALIGNED (or ACCEPTED)

---

## Scorecard

| ID | Capability | Status | Notes |
|----|-----------|--------|-------|
| F2-01 | ContextEngine interface | ALIGNED | Correct lifecycle mapping — bootstrap, assemble, compact, afterTurn, maintain |
| F2-02 | Context engine init | ALIGNED | Per-turn instantiation + bootstrap |
| F2-03 | Context engine registry | ALIGNED | Single engine, no registry needed |
| F2-04 | Context maintenance | ALIGNED | maintain() with 3 rules, generation counter |
| F2-05 | Per-attempt helpers | ACCEPTED | Inlined, behavior correct |
| F2-06 | Token budget management | ALIGNED | Elastic budget, surplus → RAG |

**Score: 5/6 ALIGNED, 1 ACCEPTED (100%)**

---

## Key Files

| File | Role |
|------|------|
| `src/openclaw/openclawContextEngine.ts` | Context engine interface + implementation |
| `src/openclaw/openclawTokenBudget.ts` | Token budget computation |
| `src/openclaw/openclawTurnRunner.ts` | Pipeline: bootstrap → assemble → compact → afterTurn |
| `src/openclaw/openclawAttempt.ts` | Attempt execution using assembled context |

## Upstream References

| Upstream File | Parallx Mapping |
|--------------|----------------|
| context-engine/types.ts:74-231 | `openclawContextEngine.ts` — IOpenclawContextEngine |
| context-engine/init.ts | Per-turn instantiation in default participant |
| context-engine/registry.ts | Single engine, no registry |
| context-engine-maintenance.ts | `openclawContextEngine.ts` — maintain() (pending) |
| attempt.context-engine-helpers.ts | Inlined in turn runner (ACCEPTED) |

---

## Iteration History

### Iteration 1 — Structural Audit (2026-03-27)

**Audit findings:**
- 3/6 capabilities already ALIGNED (interface, init, registry)
- 1 ACCEPTED (per-attempt helpers — behavior correct, inlined is fine)
- 2 MISALIGNED: maintenance merged into compact, fixed budget split
- 24 existing tests in `openclawContextEngine.test.ts`
- 0 dedicated token budget tests

**Gap map produced:** 5 items
- GAP-F2-04: Add `maintain()` method separating proactive maintenance from compact
- GAP-F2-05: ACCEPTED as-is
- GAP-F2-06: Add `computeElasticBudget()` for demand-aware allocation
- GAP-F2-T1: Expand context engine tests (+11)
- GAP-F2-T2: Create token budget test file (~10 tests)

**Changes applied:**
- GAP-F2-06: Added `computeElasticBudget()` to `openclawTokenBudget.ts`, updated `assemble()` to use it
- GAP-F2-04: Added `maintain()` method to interface + implementation (rule-based: trim verbose tool results, remove acks, collapse summaries)
- GAP-F2-04: Wired `maintain()` in turn runner after bootstrap, before retry loop
- GAP-F2-T2: Created `tests/unit/openclawTokenBudget.test.ts` (11 tests)
- GAP-F2-T1: Expanded `tests/unit/openclawContextEngine.test.ts` (+8 tests)

**Verification:**
- TypeScript compilation: 0 errors
- Test suite: 131 files, 2437 tests, 0 failures
- New tests: 19 added (2418 → 2437)
- UX Guardian: 8/8 surfaces CLEAN

### Iteration 2 — Refinement (2026-03-27)

**Audit findings:** 2 structural issues found by deeper review

1. **MEDIUM: maintain() timing** — `maintain()` was called before the retry loop but operated on `_lastHistory` which is empty before the first `assemble()`. Effectively a no-op on first turn. **Fixed**: Changed `maintain()` to accept `history` parameter directly from turn context. Now operates on real history regardless of `_lastHistory` state.

2. **MEDIUM: compact() cache detection** — Used `_lastHistory.length < params.history.length` to detect compaction. When compact summarizes N messages into N messages (2 summary + 2 last exchange), length comparison fails. Next `assemble()` uses original history, wasting overflow retry budget. **Fixed**: Replaced with `_compactGeneration` counter. Both `compact()` and `maintain()` (with rewrites) increment it. `assemble()` compares generations to detect changes.

**Changes applied:**
- `openclawContextEngine.ts`: Added `_compactGeneration` + `_lastAssembleGeneration` counters. Updated `assemble()` to detect compaction via generation comparison. Updated `maintain()` to accept history param + bump generation on rewrites. Updated `compact()` to bump generation on both paths.
- `openclawTurnRunner.ts`: Pass `context.history` in maintain call.
- `openclawContextEngine.test.ts`: Updated maintain tests to pass history param. Added 2 new tests: compact generation detection + maintain-assemble flow.

**Verification:**
- TypeScript compilation: 0 errors
- Test suite: 131 files, 2439 tests, 0 failures
- New tests: 2 added (2437 → 2439)

### Iteration 3 — Confirmation (2026-03-27)

**Audit scope:** Full fresh-eyes re-read of all 5 F2 files + both test files. All 6 capabilities re-verified.

**Findings:** None functional. One stale doc comment (interface listed maintain under "NOT adopted" despite existing) — fixed.

**Anti-pattern check:** Clean — no output repair, pre-classification, eval-driven patchwork.

**Test coverage:** 45 F2-related tests covering all lifecycle methods, edge cases, error paths, generation detection, and budget invariants. No critical untested paths.

**Verdict:** PASS — CLOSE Domain F2

---

## Closure

**Status:** CLOSED ✅  
**Score:** 5/6 ALIGNED, 1 ACCEPTED (100%)  
**Iterations:** 3 (structural → refinement → confirmation)  
**Total F2 tests:** 45  
**Suite total at closure:** 131 files, 2439 tests, 0 failures  
**TypeScript:** 0 errors
