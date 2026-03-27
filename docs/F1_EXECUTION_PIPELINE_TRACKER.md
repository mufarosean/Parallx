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
