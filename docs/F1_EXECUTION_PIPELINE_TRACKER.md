# F1 Execution Pipeline — Parity Tracker

**Domain:** F1 — Execution Pipeline  
**Status:** CLOSED ✅  
**Started:** 2026-03-27  
**Target:** 13/13 ALIGNED

---

## Scorecard

| ID | Capability | Status | Notes |
|----|-----------|--------|-------|
| F1-01 | 4-layer pipeline | ALIGNED | 2-layer Parallx adaptation of L1-L4 |
| F1-02 | Context overflow retry | ALIGNED | MAX_OVERFLOW_COMPACTION = 3 |
| F1-03 | Transient HTTP error retry | ALIGNED | Exponential backoff 2500→15000ms |
| F1-04 | Model fallback | ALIGNED | GAP-F1-01 — implemented via isModelError + fallbackModels retry |
| F1-05 | Model resolution | ALIGNED | UI-driven via ILanguageModelsService |
| F1-06 | Main retry loop | ALIGNED | Implicit bounds from retry counters |
| F1-07 | Workspace/sandbox setup | ALIGNED | Bootstrap entries loaded |
| F1-08 | Skill loading | ALIGNED | Skill catalog → prompt + tools |
| F1-09 | System prompt construction | ALIGNED | Structured multi-section builder |
| F1-10 | Tool creation | ALIGNED | Platform + skill → policy filtering |
| F1-11 | Ollama num_ctx injection | ALIGNED | tokenBudget → numCtx → Ollama |
| F1-12 | Context engine bootstrap | ALIGNED | Once before retry loop |
| F1-13 | Context engine assembly | ALIGNED | Parallel retrieval, budget-aware |

**Score: 13/13 ALIGNED (100%)**

---

## Key Files

| File | Role |
|------|------|
| `src/openclaw/openclawTurnRunner.ts` | Layer 1: retry loop (L2+L3) |
| `src/openclaw/openclawAttempt.ts` | Layer 2: single attempt (L4) |
| `src/openclaw/openclawErrorClassification.ts` | Error classifiers |
| `src/openclaw/openclawReadOnlyTurnRunner.ts` | Readonly participant turn runner |
| `src/openclaw/openclawContextEngine.ts` | Context engine lifecycle |
| `src/openclaw/openclawModelTier.ts` | Model tier resolution |

## Upstream References

| Upstream File | Parallx Mapping |
|--------------|----------------|
| `agent-runner.ts` (L1) | N/A — single-user |
| `agent-runner-execution.ts` (L2) | `openclawTurnRunner.ts` |
| `run.ts` (L3) | `openclawTurnRunner.ts` |
| `attempt.ts` (L4) | `openclawAttempt.ts` |
| `model-fallback.ts` | `openclawTurnRunner.ts` — fallback retry branch |

---

## Iteration History

### Iteration 1 — Structural Audit (2026-03-27)

**Audit findings:**
- 12/13 capabilities already ALIGNED from F7/F8/F3 work
- 1 MISSING: model fallback (F1-04)
- 4 test files missing: turn runner, attempt, error classification, model tier
- Readonly runner lacks ChatToolLoopSafety

**Gap map produced:** 6 gaps (1 production, 1 safety fix, 4 test-only)

**Changes planned:**
- GAP-F1-01: Add `isModelError` + fallback retry in turn runner
- GAP-F1-02: Add `ChatToolLoopSafety` to readonly runner
- GAP-F1-03 through GAP-F1-06: Create 4 test files

**Verification:** Pending

**Changes applied:**
- GAP-F1-01: Added `isModelError` classifier + fallback fields on `IOpenclawTurnContext` + fallback retry branch in turn runner + wired in participant
- GAP-F1-02: Added `ChatToolLoopSafety` to readonly turn runner
- GAP-F1-03: Created `openclawTurnRunner.test.ts` (12 tests)
- GAP-F1-04: Created `openclawAttempt.test.ts` (10 tests)
- GAP-F1-05: Created `openclawErrorClassification.test.ts` (40 tests)
- GAP-F1-06: Created `openclawModelTier.test.ts` (11 tests)

**Verification results:**
- TypeScript compilation: 0 errors
- Test suite: 130 files, 2406 tests, 0 failures
- New tests: 73 added (2333 → 2406)

### Iteration 2 — Refinement (2026-03-27)

**Audit findings:** 5 structural issues found by deeper review

1. **CRITICAL: Model fallback shared retry counters** — Overflow/timeout/transient counters persisted across model candidates. Upstream `runWithModelFallback` wraps the full inner execution, giving each candidate fresh counters. **Fixed**: Reset all counters on model switch.

2. **HIGH: Silent no-op fallback** — When `fallbackModels` defined but `rebuildSendChatRequest` undefined, fallback retry ran without changing the model. **Fixed**: Guard requires both fields.

3. **MEDIUM: Proactive compaction consuming error-path budget** — Shared `overflowAttempts` counter between proactive (80% capacity) and post-error compaction. **Fixed**: Independent `proactiveCompactions` counter.

4. **MEDIUM: Readonly runner partial tool-result state** — Assistant message pushed before tool execution; safety block left orphaned tool-call references. **Fixed**: Aligned with main attempt's batch-collect pattern.

5. **MEDIUM: Missing Ollama transient patterns** — `unexpected EOF`, `socket hang up`, `fetch failed`, HTTP 500 not classified as transient. **Fixed**: Added to regex.

**Changes applied:**
- `openclawTurnRunner.ts`: Counter reset on fallback, independent proactive counter, rebuildSendChatRequest guard
- `openclawReadOnlyTurnRunner.ts`: Batch-collect pattern for tool results
- `openclawErrorClassification.ts`: Added 4 Ollama transient patterns

**New tests:** 12 added (2406 → 2418)

**Verification results:**
- TypeScript compilation: 0 errors
- Test suite: 130 files, 2418 tests, 0 failures

### Iteration 3 — Confirmation (2026-03-27)

**Audit scope:** Full fresh-eyes re-read of all 8 F1 files (4 production + 4 test). All 13 capabilities re-verified line-by-line.

**Findings:** None. All 13 capabilities confirmed ALIGNED.

**Anti-pattern check:** Clean — no output repair, pre-classification, eval-driven patchwork, or heuristic shortcuts detected. Proactive compaction at >80% is a documented Parallx-specific optimization with independent counter.

**Test coverage:** 82 F1-related tests covering every retry branch, error class, fallback path, lifecycle hook, and edge case. No critical untested paths.

**Verdict:** PASS — CLOSE Domain F1

---

## Closure

**Status:** CLOSED ✅  
**Score:** 13/13 ALIGNED (100%)  
**Iterations:** 3 (structural → refinement → confirmation)  
**Total F1 tests:** 82  
**Suite total at closure:** 130 files, 2418 tests, 0 failures  
**TypeScript:** 0 errors
